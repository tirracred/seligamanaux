// Importa o 'edge-runtime' para tipos Deno
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Importa o createClient da biblioteca supabase-js v2
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

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

// --- FUNÇÃO DE REESCRITA COM IA (GROK) ---
async function rewriteWithGrok(titulo: string, conteudo: string): Promise<GrokResponse> {
  // A chave GROK_API_KEY está salva nos "Secrets" da Função no Supabase
  const GROK_API_KEY = Deno.env.get("GROK_API_KEY"); 
  if (!GROK_API_KEY) {
    throw new Error("GROK_API_KEY não está definida nos segredos da Função.");
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
    if (!response.ok) throw new Error(`Erro na API Grok: ${response.statusText}`);
    const data = await response.json();
    const jsonResponse = JSON.parse(data.choices[0].message.content);
    return jsonResponse as GrokResponse;
  } catch (error) {
    console.error("Erro ao reescrever com Grok:", error);
    return {
      titulo: `(IA Falhou) ${titulo}`,
      conteudo: `(IA Falhou) ${conteudo}`,
    };
  }
}

// --- FUNÇÃO DE PARSING COM HTMLREWRITER ---
function extractContentWithHTMLRewriter(html: string): { titulo: string; conteudo: string } {
  let titulo = "Título não encontrado";
  let conteudo = "Conteúdo não encontrado";
  let paragrafos: string[] = [];

  // Cria um HTMLRewriter para processar o HTML
  const rewriter = new HTMLRewriter()
    .on('h1', {
      text(text) {
        if (text.text.trim()) {
          titulo = text.text.trim();
        }
      }
    })
    .on('article p, .article-body p, .content p, main p', {
      text(text) {
        if (text.text.trim()) {
          paragrafos.push(text.text.trim());
        }
      }
    })
    .on('p', {
      text(text) {
        if (text.text.trim() && text.text.length > 20) {
          paragrafos.push(text.text.trim());
        }
      }
    });

  // Processa o HTML
  try {
    rewriter.transform(new Response(html));
    if (paragrafos.length > 0) {
      conteudo = paragrafos.join(' ');
    }
  } catch (error) {
    console.error("Erro no HTMLRewriter:", error);
  }

  return { titulo, conteudo };
}

// --- FUNÇÃO PRINCIPAL ---
Deno.serve(async (req) => {

  // =======================================================
  // ============ TRATAMENTO DE CORS (REVISADO) ============
  // =======================================================
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 
  };

  // 1. Responda IMEDIATAMENTE ao pedido de permissão (preflight OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 2. Se não for um OPTIONS, trate o POST (a chamada real da função)
  if (req.method === 'POST') {
    
    // --- Bloco de Autenticação (Agora seguro) ---
    const authHeader = req.headers.get("Authorization");
    
    if (!authHeader) {
      return new Response("Sem cabeçalho de autorização", { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  
    // Cria o cliente usando o header de auth que pegamos
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
  
    const { data: { user }, error: userError } = await userClient.auth.getUser();
  
    if (userError || !user) {
      return new Response("Usuário não autenticado", { status: 401, headers: corsHeaders });
    }
    const userId = user.id; 
    // --- Fim do Bloco de Autenticação ---

    // --- Início da Lógica de Scraping/IA ---
    let targetUrl: string;
    try {
      const body = await req.json();
      targetUrl = body.url || body.urlParaScrape; 
      if (!targetUrl) {
        return new Response("JSON body must contain 'url'", { status: 400, headers: corsHeaders });
      }
    } catch (e) {
      return new Response(`Invalid request body: ${e.message}`, { status: 400, headers: corsHeaders });
    }
  
    // 2. SCRAPING
    const SCRAPER_API_KEY = Deno.env.get("SCRAPER_API_KEY"); 
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    const urlToFetch = SCRAPER_API_KEY
     ? `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}`
      : targetUrl;
    const fetchHeaders = SCRAPER_API_KEY ? {} : { "User-Agent": userAgent };
  
    let htmlContent: string;
    try {
      const response = await fetch(urlToFetch, { headers: fetchHeaders });
      if (!response.ok) {
        throw new Error(`Falha ao buscar: ${response.status} ${response.statusText} de ${urlToFetch}`);
      }
      htmlContent = await response.text();
    } catch (error) {
      console.error("Scraping error:", error);
      return new Response(`Error during scraping: ${error.message}`, { status: 500, headers: corsHeaders });
    }
  
    // 3. PARSING COM HTMLREWRITER
    const { titulo, conteudo } = extractContentWithHTMLRewriter(htmlContent);
    
    const { titulo: tituloReescrito, conteudo: conteudoReescrito } = await rewriteWithGrok(titulo, conteudo);
  
    // 4. ESCRITA NO DB
    const dadosNoticia: NoticiaData = {
      url_original: targetUrl,
      categoria: "Geral", 
      titulo_original: titulo,
      conteudo_original: conteudo,
      titulo_reescrito: tituloReescrito,
      conteudo_reescrito: conteudoReescrito,
      is_public: true, 
      user_id: userId,
    };
  
    const { data, error } = await supabaseAdmin
     .from("noticias") 
     .insert(dadosNoticia)
     .select(); 
  
    if (error) {
      console.error("Supabase insert error:", error);
      if (error.code === '23505') { 
          return new Response(
              JSON.stringify({ message: "Notícia já existe no banco de dados." }),
              { headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
      }
      return new Response(`Database error: ${error.message}`, { status: 500, headers: corsHeaders });
    }
  
    // 5. SUCESSO
    return new Response(
      JSON.stringify({
        message: "Scrape, reescrita e salvamento concluídos com sucesso!",
        data: data,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  // 3. Se for qualquer outro método (GET, PUT, etc.), rejeite.
  return new Response("Método não permitido", { status: 405, headers: corsHeaders });
});