// Importa o 'edge-runtime' para tipos Deno
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Importa o createClient da biblioteca supabase-js v2
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
// Importa uma biblioteca de parsing de HTML para Deno
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

// Interface para os dados da notícia
interface NoticiaData {
  url_original: string;
  categoria?: string;
  titulo_original?: string;
  conteudo_original?: string;
  titulo_reescrito?: string;
  conteudo_reescrito?: string;
  is_public: boolean;
  user_id: string; // <-- CRÍTICO: Para o RLS
}

// Interface para a resposta da API de IA
interface GrokResponse {
  titulo: string;
  conteudo: string;
}

// --- FUNÇÃO DE REESCRITA COM IA (GROK) ---
async function rewriteWithGrok(titulo: string, conteudo: string): Promise<GrokResponse> {
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
        model: "mixtral-8x7b-32768", // Um ótimo modelo para essa tarefa
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }, // Pede para a Grok forçar um JSON
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`Erro na API Grok: ${response.statusText}`);
    }

    const data = await response.json();
    const jsonResponse = JSON.parse(data.choices[0].message.content);
    
    return jsonResponse as GrokResponse;

  } catch (error) {
    console.error("Erro ao reescrever com Grok:", error);
    // Fallback em caso de erro da IA
    return {
      titulo: `(IA Falhou) ${titulo}`,
      conteudo: `(IA Falhou) ${conteudo}`,
    };
  }
}

// --- FUNÇÃO PRINCIPAL ---
Deno.serve(async (req) => {
  // 1. AUTENTICAÇÃO E INICIALIZAÇÃO DOS CLIENTES

  // Cliente Admin (para inserir dados ignorando RLS)
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Cliente do Usuário (para descobrir QUEM está chamando a função)
  // Isso é essencial para associar o post ao user_id correto
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    // Passa o token de autenticação do usuário que fez a chamada
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
  );

  const { data: { user }, error: userError } = await userClient.auth.getUser();

  if (userError || !user) {
    return new Response("Usuário não autenticado", { status: 401 });
  }
  const userId = user.id; // <-- CONSEGUIMOS O ID DO ADMIN!

  // Pega a URL do corpo da requisição
  let targetUrl: string;
  try {
    // Tornamos flexível: aceita 'url' ou 'urlParaScrape'
    const body = await req.json();
    targetUrl = body.url || body.urlParaScrape; 
    if (!targetUrl) {
      return new Response("JSON body must contain 'url'", { status: 400 });
    }
  } catch (e) {
    return new Response(`Invalid request body: ${e.message}`, { status: 400 });
  }

  // 2. ESTRATÉGIA DE SCRAPING
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
    return new Response(`Error during scraping: ${error.message}`, { status: 500 });
  }

  // 3. LÓGICA DE PARSING E "REWRITE"
  
  const doc = new DOMParser().parseFromString(htmlContent, "text/html");
  if (!doc) {
    return new Response("Falha ao parsear HTML", { status: 500 });
  }

  // !!! ATENÇÃO !!!
  // Esses seletores (h1, .article-body) são genéricos e VÃO FALHAR.
  // Você precisa criar uma lógica para usar seletores DIFERENTES
  // dependendo do 'targetUrl'.
  // Por simplicidade, mantemos assim, mas isso precisa ser melhorado.
  const titulo = doc.querySelector("h1")?.textContent?.trim() || "Título não encontrado";
  const conteudo = doc.querySelector("article")?.textContent?.trim() || doc.querySelector(".article-body")?.textContent?.trim() || "Conteúdo não encontrado";

  // ********** PONTO DE "REWRITE" (AGORA COM GROK) **********
  const { titulo: tituloReescrito, conteudo: conteudoReescrito } = await rewriteWithGrok(titulo, conteudo);
  // *********************************************************

  // 4. ESCRITA NO BANCO DE DADOS SUPABASE
  const dadosNoticia: NoticiaData = {
    url_original: targetUrl,
    categoria: "Geral", // Você pode tentar extrair isso também
    titulo_original: titulo,
    conteudo_original: conteudo,
    titulo_reescrito: tituloReescrito,
    conteudo_reescrito: conteudoReescrito,
    is_public: true, 
    user_id: userId, // <-- A CORREÇÃO MÁGICA
  };

  // Inserir os dados usando o cliente admin
 const { data, error } = await supabaseAdmin // <--- CORRIGIDO
 .from("noticias") // Usando sua tabela principal
 .insert(dadosNoticia)
 .select();

  if (error) {
    console.error("Supabase insert error:", error);
    // Causa comum: 'url_original' já existe (violação de UNIQUE)
    if (error.code === '23505') { // Código de violação de unique
        return new Response(
            JSON.stringify({ message: "Notícia já existe no banco de dados." }),
            { headers: { "Content-Type": "application/json" }, status: 200 } // Retorna sucesso para não assustar o usuário
        );
    }
    return new Response(`Database error: ${error.message}`, { status: 500 });
  }

  // 5. SUCESSO
  return new Response(
    JSON.stringify({
      message: "Scrape, reescrita e salvamento concluídos com sucesso!",
      data: data,
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );
});