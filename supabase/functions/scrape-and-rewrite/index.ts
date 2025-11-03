// Importa o 'edge-runtime' para tipos Deno
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Importa o createClient da biblioteca supabase-js v2
import { createClient } from "npm:@supabase/supabase-js@2";

// Interface para os dados da notícia
interface NoticiaData {
  url_original: string;
  categoria?: string;
  titulo_original?: string;
  conteudo_original?: string;
  titulo_reescrito?: string;
  conteudo_reescrito?: string;
  is_public: boolean;
  user_id: string; 
}

// Interface para a resposta da API de IA
interface GrokResponse {
  titulo: string;
  conteudo: string;
}

// CORS Headers - DEVE estar disponível para todas as responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// --- FUNÇÃO DE PARSING HTML SIMPLES COM REGEX ---
function extractContentWithRegex(html: string): { titulo: string; conteudo: string } {
  let titulo = "Título não encontrado";
  let conteudo = "Conteúdo não encontrado";

  try {
    // Extrai título da tag h1
    const tituloMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
    if (tituloMatch && tituloMatch[1]) {
      titulo = tituloMatch[1].replace(/<[^>]*>/g, '').trim();
    }

    // Tenta extrair conteúdo de diferentes seletores comuns de sites de notícia
    const contentSelectors = [
      /<article[^>]*>(.*?)<\/article>/is,
      /<div[^>]*class="[^"]*article[^"]*"[^>]*>(.*?)<\/div>/is,
      /<div[^>]*class="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/is,
      /<main[^>]*>(.*?)<\/main>/is,
      /<div[^>]*id="[^"]*content[^"]*"[^>]*>(.*?)<\/div>/is,
    ];

    let extractedContent = '';
    for (const selector of contentSelectors) {
      const match = html.match(selector);
      if (match && match[1]) {
        extractedContent = match[1];
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

    // Se não conseguiu extrair via seletores específicos, pega todos os parágrafos
    if (conteudo === "Conteúdo não encontrado" || conteudo.length < 50) {
      const paragraphs = html.match(/<p[^>]*>(.*?)<\/p>/gis);
      if (paragraphs && paragraphs.length > 0) {
        conteudo = paragraphs
          .map(p => p.replace(/<[^>]*>/g, '').trim())
          .filter(p => p.length > 20)
          .join(' ');
      }
    }

    console.log('Título extraído:', titulo);
    console.log('Conteúdo extraído (primeiros 200 chars):', conteudo.substring(0, 200));

  } catch (error) {
    console.error('Erro na extração de conteúdo:', error);
  }

  return { titulo, conteudo };
}

// --- FUNÇÃO DE REESCRITA COM IA (GROK) ---
async function rewriteWithGrok(titulo: string, conteudo: string): Promise<GrokResponse> {
  const GROK_API_KEY = Deno.env.get("GROK_API_KEY"); 
  if (!GROK_API_KEY) {
    console.error("GROK_API_KEY não está definida nos segredos da Função.");
    return {
      titulo: `${titulo}`,
      conteudo: `${conteudo}`,
    };
  }

  const prompt = `
    Você é um jornalista assistente para o portal "SeligaManaux", um site de notícias de Manaus.
    Sua tarefa é reescrever a seguinte notícia. Não copie o texto, inspire-se nele.
    O tom deve ser direto, informativo e popular, focado no público manauara.
    Retorne APENAS um objeto JSON com as chaves "titulo" e "conteudo".

    Notícia Original:
    Título: ${titulo}
    Conteúdo: ${conteudo.substring(0, 2000)}...
  `;

  try {
    console.log('Enviando para Grok API...');
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-32768",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.error(`Erro na API Grok: ${response.status} ${response.statusText}`);
      throw new Error(`Erro na API Grok: ${response.statusText}`);
    }

    const data = await response.json();
    const jsonResponse = JSON.parse(data.choices[0].message.content);
    console.log('Resposta da Grok recebida com sucesso');
    return jsonResponse as GrokResponse;

  } catch (error) {
    console.error("Erro ao reescrever com Grok:", error);
    return {
      titulo: `${titulo}`,
      conteudo: `${conteudo}`,
    };
  }
}

// --- FUNÇÃO PRINCIPAL ---
Deno.serve(async (req) => {
  console.log(`${req.method} ${req.url}`);

  // 1. RESPOSTA IMEDIATA PARA OPTIONS (CORS PREFLIGHT)
  if (req.method === 'OPTIONS') {
    console.log('Respondendo ao preflight CORS');
    return new Response('ok', { 
      status: 200,
      headers: corsHeaders 
    });
  }

  // 2. APENAS ACEITA POST
  if (req.method !== 'POST') {
    return new Response('Método não permitido', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    // 3. VALIDAÇÃO DE AUTENTICAÇÃO
    const authHeader = req.headers.get("Authorization");
    console.log('Auth header presente:', !!authHeader);
    
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Sem cabeçalho de autorização" }), 
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Criação dos clientes Supabase
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
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Usuário autenticado:', user.id);

    // 4. PARSE DO BODY E VALIDAÇÃO DA URL
    let targetUrl: string;
    try {
      const body = await req.json();
      targetUrl = body.url || body.urlParaScrape; 
      if (!targetUrl) {
        return new Response(
          JSON.stringify({ error: "JSON body deve conter 'url'" }), 
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: `Corpo da requisição inválido: ${e.message}` }), 
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('URL alvo:', targetUrl);

    // 5. SCRAPING DA PÁGINA
    const SCRAPER_API_KEY = Deno.env.get("SCRAPER_API_KEY"); 
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    
    const urlToFetch = SCRAPER_API_KEY
      ? `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}`
      : targetUrl;
    
    const fetchHeaders = SCRAPER_API_KEY ? {} : { "User-Agent": userAgent };

    console.log('Fazendo scraping de:', urlToFetch);

    let htmlContent: string;
    try {
      const response = await fetch(urlToFetch, { headers: fetchHeaders });
      if (!response.ok) {
        throw new Error(`Falha ao buscar: ${response.status} ${response.statusText}`);
      }
      htmlContent = await response.text();
      console.log('HTML recebido, tamanho:', htmlContent.length);
    } catch (error) {
      console.error("Erro no scraping:", error);
      return new Response(
        JSON.stringify({ error: `Erro durante scraping: ${error.message}` }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // 6. EXTRAÇÃO DE CONTEÚDO
    const { titulo, conteudo } = extractContentWithRegex(htmlContent);
    
    if (titulo === "Título não encontrado" || conteudo === "Conteúdo não encontrado") {
      console.warn('Dificuldade na extração de conteúdo');
    }

    // 7. REESCRITA COM IA
    const { titulo: tituloReescrito, conteudo: conteudoReescrito } = await rewriteWithGrok(titulo, conteudo);

    // 8. SALVAMENTO NO BANCO DE DADOS
    const dadosNoticia: NoticiaData = {
      url_original: targetUrl,
      categoria: "Geral", 
      titulo_original: titulo,
      conteudo_original: conteudo,
      titulo_reescrito: tituloReescrito,
      conteudo_reescrito: conteudoReescrito,
      is_public: true, 
      user_id: user.id,
    };

    console.log('Salvando no banco de dados...');
    const { data, error } = await supabaseAdmin
      .from("noticias") 
      .insert(dadosNoticia)
      .select(); 

    if (error) {
      console.error("Erro ao inserir no Supabase:", error);
      if (error.code === '23505') { // Violação de unique constraint
        return new Response(
          JSON.stringify({ 
            success: false,
            message: "Notícia já existe no banco de dados." 
          }),
          { 
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }
      return new Response(
        JSON.stringify({ error: `Erro no banco: ${error.message}` }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // 9. SUCESSO
    console.log('Processo concluído com sucesso');
    return new Response(
      JSON.stringify({
        success: true,
        message: "Scrape, reescrita e salvamento concluídos com sucesso!",
        data: {
          titulo_original: titulo,
          titulo_reescrito: tituloReescrito,
          url_original: targetUrl,
          id: data[0]?.id
        },
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error('Erro geral na função:', error);
    return new Response(
      JSON.stringify({ 
        error: `Erro interno: ${error.message}` 
      }), 
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});