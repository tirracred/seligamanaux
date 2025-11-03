// Importa o 'edge-runtime' para tipos Deno [12]
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Importa o createClient da biblioteca supabase-js v2 [7, 13, 14]
import { createClient } from "npm:@supabase/supabase-js@2";
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
}

Deno.serve(async (req) => {
  // 1. AUTENTICAÇÃO E INICIALIZAÇÃO DO CLIENTE ADMIN

  // PONTO CRÍTICO: Usamos a SUPABASE_SERVICE_ROLE_KEY.[5, 7]
  // Esta chave é fornecida automaticamente ao ambiente da função.
  // Ela cria um cliente "admin" que ignora todas as políticas de RLS [6],
  // permitindo-nos inserir na tabela 'noticias' que agora está protegida.
  
  // Armadilhas comuns a evitar:
  // - Não use SUPABASE_ANON_KEY (não teria permissão de INSERT).
  // - Não confunda com SUPABASE_SECRET_KEY, que se refere a chaves JWT 
  //   mais recentes e pode não estar populada por padrão.[8]
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let targetUrl: string;
  try {
    const { url } = await req.json();
    if (!url) {
      return new Response("JSON body must contain 'url'", { status: 400 });
    }
    targetUrl = url;
  } catch (e) {
    return new Response(`Invalid request body: ${e.message}`, { status: 400 });
  }

  // 2. ESTRATÉGIA DE SCRAPING (LIDANDO COM O ERRO 403)

  // O "erro 403 do googleads" é um Web Application Firewall (WAF)
  // bloqueando a solicitação porque ela se origina de um IP de data center
  // e/ou tem um User-Agent Deno (ex: 'Deno/1.x.x').

  // Nível 1: Evasão Simples (Falsificação de User-Agent)
  // Isso raramente funciona contra firewalls sofisticados.
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  // Nível 3 (Recomendado): Usar uma API de Scraping
  // Esta é a solução robusta. Um serviço como ScraperAPI, ZenRows ou BrightData
  // lida com proxies rotativos, solução de CAPTCHAs e evasão de WAF.
  // A chave de API deve ser definida como um segredo (ver Etapa 5).
  const SCRAPER_API_KEY = Deno.env.get("SCRAPER_API_KEY");

  const urlToFetch = SCRAPER_API_KEY
   ? `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}`
    : targetUrl; // Fallback para Nível 1 se a chave não estiver definida
  
  const fetchHeaders = SCRAPER_API_KEY? {} : { "User-Agent": userAgent };

  let htmlContent: string;
  try {
    const response = await fetch(urlToFetch, { headers: fetchHeaders });
    
    if (!response.ok) {
      // Isso captura o 403 e outros erros
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText} from ${urlToFetch}`);
    }
    htmlContent = await response.text();

  } catch (error) {
    console.error("Scraping error:", error);
    return new Response(`Error during scraping: ${error.message}`, { status: 500 });
  }

  // 3. LÓGICA DE PARSING E "REWRITE"
  
  const doc = new DOMParser().parseFromString(htmlContent, "text/html");
  if (!doc) {
    return new Response("Failed to parse HTML", { status: 500 });
  }

  // Exemplo de extração de dados (substitua pelos seletores CSS reais)
  const titulo = doc.querySelector("h1")?.textContent?.trim() |

| "Título não encontrado";
  const conteudo = doc.querySelector(".article-body")?.textContent?.trim() |

| "Conteúdo não encontrado";

  // ********** PONTO DE "REWRITE" **********
  // Aqui é onde uma chamada para uma API de IA (ex: OpenAI) seria feita
  // para reescrever o 'titulo' e 'conteudo'.
  // Para este exemplo, usaremos placeholders.
  const tituloReescrito = ` ${titulo}`;
  const conteudoReescrito = ` ${conteudo.substring(0, 1000)}...`;
  // *****************************************

  // 4. ESCRITA NO BANCO DE DADOS SUPABASE

  const dadosNoticia: NoticiaData = {
    url_original: targetUrl,
    categoria: "Geral", // Exemplo
    titulo_original: titulo,
    conteudo_original: conteudo,
    titulo_reescrito: tituloReescrito,
    conteudo_reescrito: conteudoReescrito,
    is_public: true, // Define como 'true' para que o RLS o mostre publicamente
  };

  // Inserir os dados usando o cliente admin [14, 15]
  const { data, error } = await supabaseAdmin
   .from("noticias") // Referencia a tabela de 
   .insert(dadosNoticia)
   .select(); //.select() para retornar os dados inseridos

  if (error) {
    // A causa mais provável de erro aqui é a violação 'UNIQUE'
    // se 'url_original' já existir.
    console.error("Supabase insert error:", error);
    return new Response(`Database error: ${error.message}`, { status: 500 });
  }

  // 5. SUCESSO
  return new Response(
    JSON.stringify({
      message: "Scrape, rewrite, and save successful.",
      data: data,
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );
});