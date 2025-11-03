// Importa o 'edge-runtime' para tipos Deno
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Importa o createClient da biblioteca supabase-js v2
import { createClient } from "npm:@supabase/supabase-js@2";

// Interface para a tabela NOTICIAS_SCRAPED
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

// Interface para resposta da IA
interface GrokResponse {
  titulo: string;
  conteudo: string;
}

// Interface para configuração de portais
interface PortalConfig {
  name: string;
  baseUrl: string;
  articleSelectors: string[];
  titleSelectors: string[];
  contentSelectors: string[];
  linkSelectors: string[];
  category: string;
}

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// Configurações dos portais de Manaus/Amazonas
const PORTAIS_CONFIG: Record<string, PortalConfig> = {
  'g1.globo.com': {
    name: 'G1 Amazonas',
    baseUrl: 'https://g1.globo.com/am/amazonas/',
    articleSelectors: ['.feed-post-link', '.bastian-feed-item', 'a[href*="/noticia/"]'],
    titleSelectors: ['h1.content-head__title', 'h1', '.content-title', '.post-title'],
    contentSelectors: ['.content-text__container', '.mc-article-body', 'article', '.post-content'],
    linkSelectors: ['a[href*="/noticia/"]', '.feed-post-link', '.bastian-feed-item a'],
    category: 'Amazonas'
  },
  'portaldoholanda.com.br': {
    name: 'Portal do Holanda',
    baseUrl: 'https://portaldoholanda.com.br/amazonas',
    articleSelectors: ['.post-item', '.news-item', 'article', '.entry'],
    titleSelectors: ['h1', '.post-title', '.entry-title', 'h2.title'],
    contentSelectors: ['.post-content', '.entry-content', '.news-content', 'article'],
    linkSelectors: ['a[href*="/noticia"]', '.post-item a', '.news-item a'],
    category: 'Amazonas'
  },
  'acritica.com': {
    name: 'A Crítica',
    baseUrl: 'https://www.acritica.com/',
    articleSelectors: ['.post-item', '.news-card', 'article'],
    titleSelectors: ['h1', '.post-title', '.article-title'],
    contentSelectors: ['.post-content', '.article-content', '.entry-content'],
    linkSelectors: ['a[href*="/noticia"]', '.post-item a'],
    category: 'Amazonas'
  },
  'portalamazonia.com': {
    name: 'Portal Amazônia',
    baseUrl: 'https://portalamazonia.com/',
    articleSelectors: ['.post', '.news-item', 'article'],
    titleSelectors: ['h1', '.post-title', '.entry-title'],
    contentSelectors: ['.post-content', '.entry-content', '.news-content'],
    linkSelectors: ['a[href*="/noticias"]', '.post a'],
    category: 'Amazônia'
  },
  'cenariomt.com.br': {
    name: 'Cenário MT',
    baseUrl: 'https://www.cenariomt.com.br/',
    articleSelectors: ['.post', '.news-item'],
    titleSelectors: ['h1', '.post-title'],
    contentSelectors: ['.post-content', '.entry-content'],
    linkSelectors: ['a[href*="/noticia"]'],
    category: 'Regional'
  }
};

// --- FUNÇÃO PARA EXTRAIR LINKS DE NOTÍCIAS DA PÁGINA INICIAL ---
function extractNewsLinks(html: string, config: PortalConfig): string[] {
  const links: Set<string> = new Set();
  
  try {
    // Busca por links usando os seletores específicos do portal
    for (const selector of config.linkSelectors) {
      // Regex para encontrar links que correspondem ao padrão
      const linkPattern = new RegExp(`<a[^>]*href=["']([^"']*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*')}[^"']*)["'][^>]*>`, 'gi');
      let match;
      
      while ((match = linkPattern.exec(html)) !== null) {
        let url = match[1];
        
        // Normaliza URLs relativas
        if (url.startsWith('/')) {
          const baseUrl = new URL(config.baseUrl);
          url = baseUrl.origin + url;
        } else if (!url.startsWith('http')) {
          url = config.baseUrl + url;
        }
        
        // Filtra apenas URLs de notícias válidas
        if (url.includes('/noticia') || url.includes('/news') || url.includes('/post')) {
          links.add(url);
        }
      }
    }

    // Também busca por links em elementos de artigo
    const articlePattern = /<a[^>]*href=["']([^"']*(?:noticia|news|post)[^"']*)["'][^>]*>/gi;
    let match;
    while ((match = articlePattern.exec(html)) !== null) {
      let url = match[1];
      if (url.startsWith('/')) {
        const baseUrl = new URL(config.baseUrl);
        url = baseUrl.origin + url;
      }
      if (url.startsWith('http')) {
        links.add(url);
      }
    }

  } catch (error) {
    console.error('Erro ao extrair links:', error);
  }

  const linkArray = Array.from(links).slice(0, 10); // Máximo 10 links
  console.log(`Encontrados ${linkArray.length} links de notícias para ${config.name}`);
  return linkArray;
}

// --- FUNÇÃO DE PARSING HTML MELHORADA ---
function extractContentWithRegex(html: string, config: PortalConfig): { titulo: string; conteudo: string; resumo: string } {
  let titulo = "Título não encontrado";
  let conteudo = "Conteúdo não encontrado";
  let resumo = "";

  try {
    // Extrai título usando seletores específicos do portal
    for (const selector of config.titleSelectors) {
      const pattern = new RegExp(`<${selector.includes('.') ? 'div' : selector}[^>]*class="[^"]*${selector.replace('.', '')}[^"]*"[^>]*>(.*?)</${selector.includes('.') ? 'div' : selector}>`, 'is');
      const match = html.match(pattern) || html.match(new RegExp(`<${selector}[^>]*>(.*?)</${selector}>`, 'is'));
      
      if (match && match[1]) {
        titulo = match[1].replace(/<[^>]*>/g, '').trim();
        break;
      }
    }

    // Extrai conteúdo usando seletores específicos do portal
    for (const selector of config.contentSelectors) {
      const pattern = new RegExp(`<${selector.includes('.') ? 'div' : selector}[^>]*class="[^"]*${selector.replace('.', '')}[^"]*"[^>]*>(.*?)</${selector.includes('.') ? 'div' : selector}>`, 'is');
      const match = html.match(pattern) || html.match(new RegExp(`<${selector}[^>]*>(.*?)</${selector}>`, 'is'));
      
      if (match && match[1]) {
        conteudo = match[1]
          .replace(/<script[^>]*>.*?<\/script>/gis, '')
          .replace(/<style[^>]*>.*?<\/style>/gis, '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        break;
      }
    }

    // Fallback: Se não conseguiu extrair, tenta métodos genéricos
    if (titulo === "Título não encontrado") {
      const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
      if (h1Match) titulo = h1Match[1].replace(/<[^>]*>/g, '').trim();
    }

    if (conteudo === "Conteúdo não encontrado" || conteudo.length < 100) {
      const paragraphs = html.match(/<p[^>]*>(.*?)<\/p>/gis);
      if (paragraphs && paragraphs.length > 0) {
        conteudo = paragraphs
          .map(p => p.replace(/<[^>]*>/g, '').trim())
          .filter(p => p.length > 30)
          .slice(0, 15)
          .join(' ');
      }
    }

    // Cria resumo
    if (conteudo && conteudo !== "Conteúdo não encontrado") {
      resumo = conteudo.substring(0, 300) + (conteudo.length > 300 ? "..." : "");
    }

    console.log(`${config.name} - Título: ${titulo.substring(0, 50)}...`);
    console.log(`${config.name} - Conteúdo: ${conteudo.length} caracteres`);

  } catch (error) {
    console.error(`Erro na extração de conteúdo para ${config.name}:`, error);
  }

  return { titulo, conteudo, resumo };
}

// --- FUNÇÃO DE REESCRITA COM IA ---
async function rewriteWithGrok(titulo: string, conteudo: string, fonte: string): Promise<GrokResponse> {
  const GROK_API_KEY = Deno.env.get("GROK_API_KEY"); 
  if (!GROK_API_KEY) {
    console.error("GROK_API_KEY não está definida");
    return { titulo, conteudo };
  }

  const prompt = `Você é jornalista do "SeligaManaux", portal de notícias de Manaus/Amazonas.
Reescreva esta notícia de forma clara, objetiva e interessante para manauaras.
Mantenha os fatos, mas mude as palavras e estrutura.

ORIGINAL (${fonte}):
Título: ${titulo}
Texto: ${conteudo.substring(0, 1800)}

Responda APENAS com JSON válido:
{"titulo": "novo título focado em Manaus/Amazonas", "conteudo": "texto reescrito de forma clara e interessante"}`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();
    
    if (content.startsWith('```json')) {
      content = content.replace(/```json\n?/, '').replace(/\n?```$/, '');
    }
    
    const jsonResponse = JSON.parse(content);
    if (jsonResponse.titulo && jsonResponse.conteudo) {
      return jsonResponse as GrokResponse;
    }
    
  } catch (error) {
    console.error("Erro Groq:", error);
  }

  return { titulo, conteudo };
}

// --- FUNÇÃO PARA DETECTAR PORTAL ---
function detectPortal(url: string): PortalConfig | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    
    for (const [key, config] of Object.entries(PORTAIS_CONFIG)) {
      if (hostname.includes(key.replace('www.', '')) || key.includes(hostname)) {
        return config;
      }
    }
  } catch (error) {
    console.error('Erro ao detectar portal:', error);
  }
  
  return null;
}

// --- FUNÇÃO PRINCIPAL ---
Deno.serve(async (req) => {
  console.log(`${req.method} ${req.url}`);

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
      return new Response(JSON.stringify({ error: "Sem autorização" }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
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
      return new Response(JSON.stringify({ error: "Usuário não autenticado" }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }

    // PARSE DA URL
    const body = await req.json();
    const targetUrl = body.url;
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "URL obrigatória" }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }

    console.log('Processando URL:', targetUrl);

    // DETECTA O PORTAL
    const portalConfig = detectPortal(targetUrl);
    if (!portalConfig) {
      return new Response(JSON.stringify({ error: "Portal não suportado" }), 
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }

    console.log('Portal detectado:', portalConfig.name);

    // BUSCA A PÁGINA INICIAL DO PORTAL
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    let htmlContent: string;
    
    try {
      const response = await fetch(targetUrl, { 
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(30000)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      htmlContent = await response.text();
      console.log('HTML recebido, tamanho:', htmlContent.length);
      
    } catch (error) {
      console.error("Erro no scraping:", error);
      return new Response(JSON.stringify({ error: `Erro ao acessar ${portalConfig.name}: ${error.message}` }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }

    // EXTRAI LINKS DE NOTÍCIAS
    const newsLinks = extractNewsLinks(htmlContent, portalConfig);
    if (newsLinks.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhuma notícia encontrada" }), 
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }

    console.log(`Processando ${newsLinks.length} notícias de ${portalConfig.name}`);

    // PROCESSA CADA NOTÍCIA
    const processedNews = [];
    let successCount = 0;
    let errorCount = 0;

    for (const newsUrl of newsLinks.slice(0, 5)) { // Máximo 5 notícias por vez
      try {
        console.log(`Processando: ${newsUrl}`);

        // Verifica se já existe no banco
        const { data: existing } = await supabaseAdmin
          .from('noticias_scraped')
          .select('id')
          .eq('url_original', newsUrl)
          .single();

        if (existing) {
          console.log('Notícia já existe, pulando...');
          continue;
        }

        // Busca a página da notícia
        const newsResponse = await fetch(newsUrl, { 
          headers: { "User-Agent": userAgent },
          signal: AbortSignal.timeout(20000)
        });
        
        if (!newsResponse.ok) continue;
        
        const newsHtml = await newsResponse.text();
        
        // Extrai conteúdo
        const { titulo, conteudo, resumo } = extractContentWithRegex(newsHtml, portalConfig);
        
        if (titulo === "Título não encontrado" || conteudo.length < 100) {
          console.log('Conteúdo insuficiente, pulando...');
          continue;
        }

        // Reescreve com IA
        const { titulo: tituloReescrito, conteudo: conteudoReescrito } = await rewriteWithGrok(titulo, conteudo, portalConfig.name);
        const resumoReescrito = conteudoReescrito.substring(0, 300) + (conteudoReescrito.length > 300 ? "..." : "");

        // Salva no banco
        const noticiaData: NoticiaScrapedData = {
          titulo_original: titulo,
          titulo_reescrito: tituloReescrito,
          resumo_original: resumo,
          resumo_reescrito: resumoReescrito,
          url_original: newsUrl,
          fonte: portalConfig.name,
          status: 'processado',
          data_coleta: new Date().toISOString(),
          categoria: portalConfig.category
        };

        const { error } = await supabaseAdmin
          .from("noticias_scraped")
          .insert(noticiaData);

        if (error) {
          console.error('Erro ao salvar:', error);
          errorCount++;
        } else {
          processedNews.push({
            titulo: tituloReescrito,
            fonte: portalConfig.name,
            url: newsUrl
          });
          successCount++;
          console.log(`✅ Notícia salva: ${titulo.substring(0, 50)}...`);
        }

        // Pausa entre requests para não sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Erro ao processar ${newsUrl}:`, error);
        errorCount++;
      }
    }

    // RESPOSTA FINAL
    return new Response(JSON.stringify({
      success: true,
      message: `Processamento do ${portalConfig.name} concluído!`,
      stats: {
        total_encontradas: newsLinks.length,
        processadas_com_sucesso: successCount,
        erros: errorCount,
        portal: portalConfig.name
      },
      noticias: processedNews
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});

  } catch (error) {
    console.error('Erro geral:', error);
    return new Response(JSON.stringify({ error: `Erro interno: ${error.message}` }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }
});