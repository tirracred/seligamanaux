// Importa o 'edge-runtime' para tipos Deno
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Importa o createClient da biblioteca supabase-js v2
import { createClient } from "npm:@supabase/supabase-js@2";

// Interface para a tabela NOTICIAS_SCRAPED (colunas corretas)
interface NoticiaScrapedData {
  titulo_original: string;
  titulo_reescrito: string;
  resumo_original?: string;
  resumo_reescrito?: string;
  url_original: string;
  fonte: string;
  status: string;
  data_coleta: string;
  data_publicacao?: string;
  imagem_url?: string;
  categoria: string;
}

// Interface para a resposta da API de IA
interface GrokResponse {
  titulo: string;
  conteudo: string;
}

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// --- FUNÇÃO DE PARSING HTML COM REGEX ---
function extractContentWithRegex(html: string): { titulo: string; conteudo: string; resumo: string } {
  let titulo = "Título não encontrado";
  let conteudo = "Conteúdo não encontrado";
  let resumo = "";

  try {
    // Extrai título da tag h1
    const tituloMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
    if (tituloMatch && tituloMatch[1]) {
      titulo = tituloMatch[1].replace(/<[^>]*>/g, '').trim();
    }

    // Seletores para diferentes tipos de sites de notícia
    const contentSelectors = [
      // G1 e sites Globo
      /<div[^>]*class="[^"]*content-text[^"]*"[^>]*>(.*?)<\/div>/is,
      /<div[^>]*class="[^"]*mc-article-body[^"]*"[^>]*>(.*?)<\/div>/is,
      // Sites gerais
      /<article[^>]*>(.*?)<\/article>/is,
      /<div[^>]*class="[^"]*post-content[^"]*"[^>]*>(.*?)<\/div>/is,
      /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>(.*?)<\/div>/is,
      /<main[^>]*>(.*?)<\/main>/is,
    ];

    let extractedContent = '';
    for (const selector of contentSelectors) {
      const match = html.match(selector);
      if (match && match[1]) {
        extractedContent = match[1];
        console.log('Conteúdo extraído com seletor específico');
        break;
      }
    }

    if (extractedContent) {
      // Remove todas as tags HTML e mantém apenas o texto
      conteudo = extractedContent
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Fallback: Se não conseguiu extrair, pega todos os parágrafos
    if (conteudo === "Conteúdo não encontrado" || conteudo.length < 100) {
      const paragraphs = html.match(/<p[^>]*>(.*?)<\/p>/gis);
      if (paragraphs && paragraphs.length > 0) {
        conteudo = paragraphs
          .map(p => p.replace(/<[^>]*>/g, '').trim())
          .filter(p => p.length > 30)
          .slice(0, 15) // Primeiros 15 parágrafos
          .join(' ');
      }
    }

    // Cria resumo: primeiros 300 caracteres do conteúdo
    if (conteudo && conteudo !== "Conteúdo não encontrado") {
      resumo = conteudo.substring(0, 300) + (conteudo.length > 300 ? "..." : "");
    }

    console.log('Título extraído:', titulo);
    console.log('Conteúdo extraído (tamanho):', conteudo.length);
    console.log('Resumo criado (tamanho):', resumo.length);

  } catch (error) {
    console.error('Erro na extração de conteúdo:', error);
  }

  return { titulo, conteudo, resumo };
}

// --- FUNÇÃO DE REESCRITA COM IA (GROK) ---
async function rewriteWithGrok(titulo: string, conteudo: string): Promise<GrokResponse> {
  const GROK_API_KEY = Deno.env.get("GROK_API_KEY"); 
  if (!GROK_API_KEY) {
    console.error("GROK_API_KEY não está definida nos segredos da Função.");
    return {
      titulo: titulo,
      conteudo: conteudo,
    };
  }

  const prompt = `Reescreva esta notícia para o site "SeligaManaux" de Manaus.
Use linguagem clara, direta e focada no interesse dos manauaras.

Título: ${titulo}
Texto: ${conteudo.substring(0, 2000)}

Responda APENAS com JSON válido:
{"titulo": "novo título", "conteudo": "novo conteúdo"}`;

  try {
    console.log('Enviando para Grok API...');
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro na API Grok: ${response.status}`, errorText);
      throw new Error(`Erro na API Grok: ${response.statusText}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    
    // Remove markdown se houver
    if (content.startsWith('```json')) {
      content = content.replace(/```json\n?/, '').replace(/\n?```$/, '');
    }
    
    try {
      const jsonResponse = JSON.parse(content);
      if (jsonResponse.titulo && jsonResponse.conteudo) {
        console.log('Reescrita pela IA concluída com sucesso');
        return jsonResponse as GrokResponse;
      } else {
        throw new Error('JSON não contém titulo e conteudo');
      }
    } catch (parseError) {
      console.error('Erro ao parsear JSON da Grok:', parseError);
      return { titulo: titulo, conteudo: conteudo };
    }

  } catch (error) {
    console.error("Erro ao reescrever com Grok:", error);
    return { titulo: titulo, conteudo: conteudo };
  }
}

// --- FUNÇÃO PARA EXTRAIR DOMÍNIO ---
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return "Fonte desconhecida";
  }
}

// --- FUNÇÃO PRINCIPAL ---
Deno.serve(async (req) => {
  console.log(`${req.method} ${req.url}`);

  // CORS PREFLIGHT
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Método não permitido', { status: 405, headers: corsHeaders });
  }

  try {
    // AUTENTICAÇÃO
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Sem cabeçalho de autorização" }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
  
    const { data: { user }, error: userError } = await userClient.auth.getUser();
  
    if (userError || !user) {
      console.error('Erro de autenticação:', userError);
      return new Response(
        JSON.stringify({ error: "Usuário não autenticado" }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      );
    }

    // PARSE DA URL
    let targetUrl: string;
    try {
      const body = await req.json();
      targetUrl = body.url || body.urlParaScrape; 
      if (!targetUrl) {
        return new Response(
          JSON.stringify({ error: "JSON body deve conter 'url'" }), 
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
        );
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: `Corpo da requisição inválido: ${e.message}` }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      );
    }

    console.log('URL alvo:', targetUrl);

    // VALIDAÇÃO DE URL
    try {
      new URL(targetUrl); // Valida se é uma URL válida
    } catch {
      return new Response(
        JSON.stringify({ error: "URL fornecida é inválida" }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      );
    }

    // SCRAPING
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    
    console.log('Fazendo scraping de:', targetUrl);

    let htmlContent: string;
    try {
      const response = await fetch(targetUrl, { 
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(30000) // Timeout de 30 segundos
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      htmlContent = await response.text();
      console.log('HTML recebido, tamanho:', htmlContent.length);
      
    } catch (error) {
      console.error("Erro no scraping:", error);
      return new Response(
        JSON.stringify({ 
          error: `Erro ao acessar a URL: ${error.message}. Verifique se a URL está correta e o site está funcionando.` 
        }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      );
    }

    // EXTRAÇÃO DE CONTEÚDO
    const { titulo, conteudo, resumo } = extractContentWithRegex(htmlContent);
    
    if (titulo === "Título não encontrado" || conteudo === "Conteúdo não encontrado") {
      return new Response(
        JSON.stringify({ 
          error: "Não foi possível extrair conteúdo desta página. A estrutura do site pode não ser compatível." 
        }), 
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }}
      );
    }

    // REESCRITA COM IA
    const { titulo: tituloReescrito, conteudo: conteudoReescrito } = await rewriteWithGrok(titulo, conteudo);

    // Cria resumo reescrito (primeiros 300 chars do conteúdo reescrito)
    const resumoReescrito = conteudoReescrito.substring(0, 300) + (conteudoReescrito.length > 300 ? "..." : "");

    // PREPARAR DADOS PARA NOTICIAS_SCRAPED
    const dadosNoticia: NoticiaScrapedData = {
      titulo_original: titulo,
      titulo_reescrito: tituloReescrito,
      resumo_original: resumo,
      resumo_reescrito: resumoReescrito,
      url_original: targetUrl,
      fonte: extractDomain(targetUrl),
      status: 'processado',
      data_coleta: new Date().toISOString(),
      categoria: 'Geral'
    };

    console.log('Salvando na tabela noticias_scraped...');
    
    // INSERIR NA TABELA CORRETA: noticias_scraped
    const { data, error } = await supabaseAdmin
      .from("noticias_scraped") // ← TABELA CORRETA
      .insert(dadosNoticia)
      .select(); 

    if (error) {
      console.error("Erro ao inserir no Supabase:", error);
      if (error.code === '23505') {
        return new Response(
          JSON.stringify({ 
            success: false,
            message: "Notícia já existe no banco de dados." 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }}
        );
      }
      return new Response(
        JSON.stringify({ error: `Erro no banco: ${error.message}` }), 
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }}
      );
    }

    // SUCESSO
    console.log('Processo concluído com sucesso. ID:', data[0]?.id);
    return new Response(
      JSON.stringify({
        success: true,
        message: "Scrape, reescrita e salvamento concluídos com sucesso!",
        data: {
          id: data[0]?.id,
          titulo_original: titulo,
          titulo_reescrito: tituloReescrito,
          fonte: extractDomain(targetUrl),
          url_original: targetUrl,
          status: 'processado'
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }}
    );

  } catch (error) {
    console.error('Erro geral na função:', error);
    return new Response(
      JSON.stringify({ error: `Erro interno: ${error.message}` }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }}
    );
  }
});