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
  conteudo_reescrito?: string;
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
  linkSelectors: string[];
  titleSelectors: string[];
  contentSelectors: string[];
  imageSelectors: string[];
  category: string;
}

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// Configurações dos portais (Ajustado G1 para ser mais específico)
const PORTAIS_CONFIG: Record<string, PortalConfig> = {
  'g1.globo.com': {
    name: 'G1 Amazonas',
    baseUrl: 'https://g1.globo.com/am/amazonas/',
    linkSelectors: [
      'a[href*="/am/amazonas/noticia/"]', // Links específicos de notícias do AM
      'a.feed-post-link[href*=".ghtml"]', // Links do feed principal que são notícias
      'a.bstn-hl-link[href*=".ghtml"]' // Links de destaque (headline)
    ],
    titleSelectors: [
      'h1.content-head__title',
      'h1.gui-color-primary',
      'h1',
      '.content-head__title'
    ],
    contentSelectors: [
      '.content-text__container',
      '.mc-article-body',
      '.post__content',
      'article .content'
    ],
    imageSelectors: [
      '.content-media__image img',
      '.progressive-img img',
      'figure img',
      '.content-head__image img'
    ],
    category: 'Amazonas'
  },
  'portaldoholanda.com.br': {
    name: 'Portal do Holanda',
    baseUrl: 'https://portaldoholanda.com.br/',
    linkSelectors: [
      'a[href*="/noticia/"]',
      'a[href*="/noticias/"]',
      '.post-link',
      'h2 a',
      'h3 a'
    ],
    titleSelectors: [
      'h1.entry-title',
      'h1.post-title',
      'h1',
      '.title'
    ],
    contentSelectors: [
      '.entry-content',
      '.post-content',
      '.content',
      'article .text'
    ],
    imageSelectors: [
      '.featured-image img',
      '.post-thumbnail img',
      'article img',
      '.wp-post-image'
    ],
    category: 'Amazonas'
  },
  'acritica.com': {
    name: 'A Crítica',
    baseUrl: 'https://www.acritica.com/',
    linkSelectors: [
      'a[href*="/noticias/"]',
      'a[href*="/noticia/"]',
      '.post-item a',
      'h2 a',
      'h3 a'
    ],
    titleSelectors: [
      'h1.post-title',
      'h1.entry-title',
      'h1',
      '.article-title'
    ],
    contentSelectors: [
      '.post-content',
      '.entry-content',
      '.article-content',
      'article .content'
    ],
    imageSelectors: [
      '.featured-image img',
      '.post-image img',
      'article img',
      '.thumbnail img'
    ],
    category: 'Amazonas'
  },
  'portalamazonia.com': {
    name: 'Portal Amazônia',
    baseUrl: 'https://portalamazonia.com/',
    linkSelectors: [
      'a[href*="/noticias/"]',
      'a[href*="/noticia/"]',
      '.post-link',
      'h2 a',
      'h3 a'
    ],
    titleSelectors: [
      'h1.entry-title',
      'h1.post-title',
      'h1',
      '.article-title'
    ],
    contentSelectors: [
      '.entry-content',
      '.post-content',
      '.article-body',
      'article .content'
    ],
    imageSelectors: [
      '.featured-image img',
      '.post-thumbnail img',
      'article img',
      '.wp-post-image'
    ],
    category: 'Amazônia'
  }
};

// -------------------------------------------------------------------
// MUDANÇA: 'extractNewsLinks' foi modificada para remover o "fallback"
// -------------------------------------------------------------------
function extractNewsLinks(html: string, config: PortalConfig, maxLinks = 15): string[] {
  const links: Set<string> = new Set();
  
  try {
    console.log(`Buscando links para ${config.name}...`);
    
    for (const selector of config.linkSelectors) {
      let pattern: RegExp;
      
      if (selector.includes('[href*=')) {
        // Para seletores com href*=
        const hrefPattern = selector.match(/\[href\*="([^"]+)"\]/);
        if (hrefPattern) {
          pattern = new RegExp(`<a[^>]+href=["']([^"']*${hrefPattern[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"']*)["'][^>]*>`, 'gi');
        } else {
          continue;
        }
      } else {
        // Para seletores de classe
        const className = selector.replace('.', '');
        pattern = new RegExp(`<a[^>]+class=["'][^"']*${className}[^"']*["'][^>]+href=["']([^"']+)["']`, 'gi');
      }
      
      let match;
      while ((match = pattern.exec(html)) !== null && links.size < maxLinks) {
        let url = match[1];
        
        // Normaliza URLs
        if (url.startsWith('/')) {
          const baseUrl = new URL(config.baseUrl);
          url = baseUrl.origin + url;
        } else if (!url.startsWith('http')) {
          url = config.baseUrl + url;
        }
        
        // Filtra URLs válidas de notícias (ainda checa por 'noticia' como segurança)
        if (url.includes('/noticia') || url.includes('/noticias/') || url.endsWith('.ghtml')) {
          links.add(url);
        }
      }
    }

    // -------------------------------------------------------------------
    // MUDANÇA: O "fallback" (if (links.size < 5)) FOI REMOVIDO.
    // É melhor não pegar nada do que pegar lixo.
    // -------------------------------------------------------------------

  } catch (error) {
    console.error('Erro ao extrair links:', error);
  }

  const linkArray = Array.from(links);
  console.log(`Encontrados ${linkArray.length} links (rigorosos) para ${config.name}`);
  return linkArray;
}


// --- FUNÇÃO MELHORADA PARA EXTRAIR CONTEÚDO E IMAGEM --- (Sem alterações)
function extractContentWithRegex(html: string, config: PortalConfig): { titulo: string; conteudo: string; resumo: string; imagem: string } {
  let titulo = "Título não encontrado";
  let conteudo = "Conteúdo não encontrado";
  let resumo = "";
  let imagem = "";

  try {
    // Extrai título
    for (const selector of config.titleSelectors) {
      const patterns = [
        new RegExp(`<${selector}[^>]*>(.*?)</${selector}>`, 'is'),
        new RegExp(`<[^>]+class=["'][^"']*${selector.replace(/[.#]/g, '')}[^"']*["'][^>]*>(.*?)<\/[^>]+>`, 'is')
      ];
      
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          titulo = match[1].replace(/<[^>]*>/g, '').trim();
          if (titulo && titulo !== "Título não encontrado") break;
        }
      }
      if (titulo !== "Título não encontrado") break;
    }

    // Extrai conteúdo
    for (const selector of config.contentSelectors) {
      const patterns = [
        new RegExp(`<[^>]+class=["'][^"']*${selector.replace(/[.#]/g, '')}[^"']*["'][^>]*>(.*?)<\/[^>]+>`, 'is'),
        new RegExp(`<${selector}[^>]*>(.*?)</${selector}>`, 'is')
      ];
      
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          conteudo = match[1]
            .replace(/<script[^>]*>.*?<\/script>/gis, '')
            .replace(/<style[^>]*>.*?<\/style>/gis, '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (conteudo.length > 100) break;
        }
      }
      if (conteudo.length > 100) break;
    }

    // Extrai imagem
    for (const selector of config.imageSelectors) {
      const patterns = [
        new RegExp(`<img[^>]+class=["'][^"']*${selector.replace(/[.#]/g, '').replace(' img', '')}[^"']*["'][^>]+src=["']([^"']+)["']`, 'i'),
        new RegExp(`<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*${selector.replace(/[.#]/g, '').replace(' img', '')}[^"']*["']`, 'i')
      ];
      
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          let imgUrl = match[1];
          
          // Normaliza URL da imagem
          if (imgUrl.startsWith('/')) {
            const baseUrl = new URL(config.baseUrl);
            imgUrl = baseUrl.origin + imgUrl;
          }
          
          // Verifica se é uma imagem válida
          if (imgUrl.includes('.jpg') || imgUrl.includes('.jpeg') || imgUrl.includes('.png') || imgUrl.includes('.webp')) {
            imagem = imgUrl;
            break;
          }
        }
      }
      if (imagem) break;
    }

    // Fallback para extração de conteúdo
    if (conteudo === "Conteúdo não encontrado" || conteudo.length < 100) {
      const paragraphs = html.match(/<p[^>]*>(.*?)<\/p>/gis);
      if (paragraphs && paragraphs.length > 0) {
        conteudo = paragraphs
          .map(p => p.replace(/<[^>]*>/g, '').trim())
          .filter(p => p.length > 30)
          .slice(0, 10)
          .join(' ');
      }
    }

    // Fallback para imagem
    if (!imagem) {
      const imgMatch = html.match(/<img[^>]+src=["']([^"']+(?:\.jpg|\.jpeg|\.png|\.webp)[^"']*)["']/i);
      if (imgMatch) {
        let imgUrl = imgMatch[1];
        if (imgUrl.startsWith('/')) {
          const baseUrl = new URL(config.baseUrl);
          imgUrl = baseUrl.origin + imgUrl;
        }
        imagem = imgUrl;
      }
    }

    // Cria resumo
    if (conteudo && conteudo !== "Conteúdo não encontrado") {
      resumo = conteudo.substring(0, 300) + (conteudo.length > 300 ? "..." : "");
    }

    console.log(`${config.name} - Extraído: Título: ${titulo.substring(0, 50)}..., Conteúdo: ${conteudo.length} chars, Imagem: ${imagem ? 'Sim' : 'Não'}`);

  } catch (error) {
    console.error(`Erro na extração para ${config.name}:`, error);
  }

  return { titulo, conteudo, resumo, imagem };
}

// --- FUNÇÃO DE REESCRITA COM IA (Sem alterações) ---
async function rewriteWithGrok(titulo: string, conteudo: string, fonte: string): Promise<GrokResponse> {
  const GROK_API_KEY = Deno.env.get("GROK_API_KEY"); 
  if (!GROK_API_KEY) {
    console.error("GROK_API_KEY não está definida");
    return { titulo, conteudo };
  }

  const prompt = `Você é um jornalista sênior e editor-chefe do "SeligaManaux", o principal portal de notícias de Manaus e do Amazonas. Sua missão é reescrever a notícia abaixo, transformando-a em um **artigo robusto e completo**.

**Instruções de Identidade (SeligaManaux):**
1.  **Tom de Voz:** Direto, vibrante, e com a "boca no trombone". Use uma linguagem que o manauara entende, sem ser vulgar. "Se liga!"
2.  **Foco Local:** Sempre que possível, traga o impacto da notícia para a realidade de Manaus/Amazonas.
3.  **Comprimento:** O artigo final deve ser robusto, contendo entre **1500 e 4000 caracteres**. Não entregue resumos.

**Filtro de Conteúdo (IMPORTANTE):**
Se a "notícia" original for claramente um anúncio, um publieditorial, ou apenas uma propaganda para um programa de TV (ex: "Assista ao Jornal do Amazonas" ou "Veja a programação completa"), **não reescreva**. Em vez disso, responda APENAS com o seguinte JSON:
{
  "titulo": "CONTEÚDO IGNORADO",
  "conteudo": "publieditorial"
}

**Notícia Original (Fonte: ${fonte}):**
Título Original: ${titulo}
Texto Original (base): ${conteudo.substring(0, 4000)} 

**Sua Tarefa (Se for notícia):**
Reescreva o texto acima como um artigo completo e original (1500-4000 caracteres) para o SeligaManaux. Mantenha 100% dos fatos, mas mude a estrutura e as palavras.

Responda **APENAS** com um objeto JSON válido, sem nenhum texto antes ou depois:
{
  "titulo": "Um novo título chamativo, com a cara do SeligaManaux",
  "conteudo": "O artigo completo reescrito por você, com vários parágrafos, de forma robusta e interessante para o povo manauara (mínimo de 1500 caracteres)."
}`;

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
        temperature: 0.5,
        max_tokens: 4096, 
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Limpeza da resposta JSON (Correção do erro anterior)
    let content = data.choices[0].message.content;
    const jsonMatch = content.match(/{[\s\S]*}/);
    
    if (!jsonMatch) {
      throw new Error("Resposta da IA não contém JSON válido. Resposta: " + content);
    }
    
    const jsonString = jsonMatch[0];
    const jsonResponse = JSON.parse(jsonString); 

    if (jsonResponse.titulo && jsonResponse.conteudo) {
      // VERIFICA O FILTRO DE PUBLI
      if (jsonResponse.conteudo === "publieditorial") {
        console.log(`Groq identificou publieditorial, pulando: ${titulo}`);
        return { titulo: "CONTEÚDO IGNORADO", conteudo: "publieditorial" };
      }
      return jsonResponse as GrokResponse;
    }
    
  } catch (error) {
    console.error("Erro Groq:", error);
  }

  // Fallback em caso de erro da IA
  return { titulo, conteudo };
}

// --- FUNÇÃO PARA DETECTAR PORTAL --- (Sem alterações)
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

// --- FUNÇÃO PRINCIPAL --- (Sem alterações)
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

    // BUSCA URLs JÁ PROCESSADAS PARA EVITAR DUPLICATAS
    const { data: existingUrls } = await supabaseAdmin
      .from('noticias_scraped')
      .select('url_original')
      .eq('fonte', portalConfig.name)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()); // Últimos 7 dias

    const existingUrlsSet = new Set(existingUrls?.map(item => item.url_original) || []);
    console.log(`URLs já processadas: ${existingUrlsSet.size}`);

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
    const newsLinks = extractNewsLinks(htmlContent, portalConfig, 20) 
      .filter(url => !existingUrlsSet.has(url)); 
    
    if (newsLinks.length === 0) {
      return new Response(JSON.stringify({ 
        success: true,
        message: `Nenhuma notícia NOVA encontrada no ${portalConfig.name} (Modo Rigoroso).`,
        stats: { 
          total_encontradas: 0,
          processadas_com_sucesso: 0,
          erros: 0,
          portal: portalConfig.name
        }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    console.log(`Processando ${newsLinks.length} notícias novas de ${portalConfig.name}`);

    // PROCESSA CADA NOTÍCIA
    const processedNews = [];
    let successCount = 0;
    let errorCount = 0;

    for (const newsUrl of newsLinks.slice(0, 12)) { 
      try {
        console.log(`Processando: ${newsUrl}`);

        // Busca a página da notícia
        const newsResponse = await fetch(newsUrl, { 
          headers: { "User-Agent": userAgent },
          signal: AbortSignal.timeout(20000)
        });
        
        if (!newsResponse.ok) {
          console.log(`Erro HTTP ${newsResponse.status} para ${newsUrl}`);
          continue;
        }
        
        const newsHtml = await newsResponse.text();
        
        // Extrai conteúdo E imagem
        const { titulo, conteudo, resumo, imagem } = extractContentWithRegex(newsHtml, portalConfig);
        
        if (titulo === "Título não encontrado" || conteudo.length < 100) {
          console.log('Conteúdo insuficiente, pulando...');
          continue;
        }
        
        // Reescreve com IA
        const { titulo: tituloReescrito, conteudo: conteudoReescrito } = await rewriteWithGrok(titulo, conteudo, portalConfig.name);
        
        // VERIFICA SE A IA IGNOROU O CONTEÚDO
        if (conteudoReescrito === "publieditorial") {
          console.log(`Pulando publieditorial/anúncio: ${titulo}`);
          continue; // Pula para a próxima URL
        }

        const resumoReescrito = conteudoReescrito.substring(0, 300) + (conteudoReescrito.length > 300 ? "..." : "");

        // Salva no banco
        const noticiaData: NoticiaScrapedData = {
          titulo_original: titulo,
          titulo_reescrito: tituloReescrito,
          resumo_original: resumo,
          resumo_reescrito: resumoReescrito,
          conteudo_reescrito: conteudoReescrito, 
          url_original: newsUrl,
          fonte: portalConfig.name,
          status: 'processado',
          data_coleta: new Date().toISOString(),
          imagem_url: imagem || null,
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
            url: newsUrl,
            imagem: imagem ? 'Sim' : 'Não'
          });
          successCount++;
          console.log(`✅ Notícia salva: ${titulo.substring(0, 50)}...`);
        }

        // Pausa entre requests
        await new Promise(resolve => setTimeout(resolve, 1500));

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