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

// ========== CONFIGURAÇÕES DOS PORTAIS (CORRIGIDAS) ==========
const PORTAIS_CONFIG: Record<string, PortalConfig> = {
  'g1.globo.com': {
    name: 'G1 Amazonas',
    baseUrl: 'https://g1.globo.com/am/amazonas/',
    linkSelectors: [
      'a[href*="/am/amazonas/noticia/"]',     // Links específicos de notícias do AM
      'a.feed-post-link[href*=".ghtml"]',     // Links do feed principal
      'a.bstn-hl-link[href*=".ghtml"]'        // Links de destaque
    ],
    titleSelectors: [
      'h1[itemprop="headline"]',              // ⭐ NOVO: Microdata
      'h1.content-head__title',
      'h1.gui-color-primary',
      'h1'
    ],
    contentSelectors: [
      'main [itemprop="articleBody"]',        // ⭐ NOVO: Microdata confiável
      'article:first-of-type',                // ⭐ NOVO: Tag article
      '.content-text__container',
      '.mc-article-body',
      '.post__content'
    ],
    imageSelectors: [
      'main img[itemprop="image"]',           // ⭐ NOVO: Microdata
      '.content-media__image img',
      '.progressive-img img',
      'figure img'
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
      'h1[itemprop="headline"]',
      'h1'
    ],
    contentSelectors: [
      'main [itemprop="articleBody"]',
      'article:first-of-type',
      '.entry-content',
      '.post-content',
      '.content'
    ],
    imageSelectors: [
      'main img[itemprop="image"]',
      '.featured-image img',
      '.post-thumbnail img',
      'article img'
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
      'h1[itemprop="headline"]',
      'h1.post-title',
      'h1.entry-title',
      'h1'
    ],
    contentSelectors: [
      'main [itemprop="articleBody"]',
      'article:first-of-type',
      '.post-content',
      '.entry-content',
      '.article-content'
    ],
    imageSelectors: [
      'main img[itemprop="image"]',
      '.featured-image img',
      '.post-image img',
      'article img'
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
      'h1[itemprop="headline"]',
      'h1.entry-title',
      'h1.post-title',
      'h1'
    ],
    contentSelectors: [
      'main [itemprop="articleBody"]',
      'article:first-of-type',
      '.entry-content',
      '.post-content',
      '.article-body'
    ],
    imageSelectors: [
      'main img[itemprop="image"]',
      '.featured-image img',
      '.post-thumbnail img',
      'article img'
    ],
    category: 'Amazônia'
  }
};

// ========== FUNÇÃO 1: EXTRAIR LINKS (RIGOROSA - SEM FALLBACK) ==========
function extractNewsLinks(html: string, config: PortalConfig, maxLinks = 15): string[] {
  const links: Set<string> = new Set();
  
  try {
    console.log(`🔍 Buscando links para ${config.name}...`);
    
    for (const selector of config.linkSelectors) {
      let pattern: RegExp;
      
      if (selector.includes('[href*=')) {
        // Para seletores com href*= (ex: a[href*="/noticia/"])
        const hrefPattern = selector.match(/\[href\*="([^"]+)"\]/);
        if (hrefPattern) {
          const escapedHref = hrefPattern[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          pattern = new RegExp(`<a[^>]+href=["']([^"']*${escapedHref}[^"']*?)["'][^>]*>`, 'gi');
        } else {
          continue;
        }
      } else if (selector.includes('.')) {
        // Para seletores de classe (ex: .feed-post-link)
        const className = selector.replace(/^\./, '');
        pattern = new RegExp(`<a[^>]+class=["']([^"']*${className}[^"']*?)["'][^>]*href=["']([^"']+?)["']`, 'gi');
      } else {
        // Para seletores de tag (ex: h2 a)
        continue;
      }

      let match;
      while ((match = pattern.exec(html)) !== null && links.size < maxLinks) {
        let url = match[2] || match[1];
        
        // Normaliza URLs
        if (url.startsWith('/')) {
          const baseUrl = new URL(config.baseUrl);
          url = baseUrl.origin + url;
        } else if (!url.startsWith('http')) {
          url = config.baseUrl + url;
        }

        // Validação rigorosa de URLs de notícias
        const isNewsUrl = url.includes('/noticia') || 
                          url.includes('/noticias/') || 
                          url.endsWith('.ghtml');
        
        if (!isNewsUrl) continue;

        // Filtro especial para G1: Remove URLs institucionais
        if (config.name === 'G1 Amazonas') {
          const blockedPatterns = ['/equipe', '/sobre', '/principios', '/termo-de-uso', '/vc-no', '/faq', '/publicidade'];
          if (blockedPatterns.some(pattern => url.includes(pattern))) {
            console.log(`⏭️ Pulando link institucional: ${url}`);
            continue;
          }
        }

        links.add(url);
      }
    }

    const linkArray = Array.from(links);
    console.log(`✅ Encontrados ${linkArray.length} links (rigorosos) para ${config.name}`);
    
    return linkArray;

  } catch (error) {
    console.error('❌ Erro ao extrair links:', error);
    return [];
  }
}

// ========== FUNÇÃO 2: LIMPAR CONTEÚDO (ROBUSTA) ==========
function cleanContent(html: string): string {
  let cleaned = html
    // Remove tags script e style completamente
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    
    // Remove comentários HTML
    .replace(/<!--[\s\S]*?-->/g, '')
    
    // Remove variáveis JavaScript e objetos
    .replace(/\w+\.\w+\s*=\s*(\{[^}]*\}|\"[^\"]*\"|'[^']*'|\d+|true|false);?/g, '')
    .replace(/window\.\w+\s*=\s*[^;]*;?/g, '')
    .replace(/var\s+\w+\s*=\s*[^;]*;?/g, '')
    .replace(/const\s+\w+\s*=\s*[^;]*;?/g, '')
    
    // Remove data-* attributes e atributos HTML desnecessários
    .replace(/\s+data-[a-z-]+=["'][^"']*["']/gi, '')
    .replace(/\s+(id|class|style|onclick|onload)=["'][^"']*["']/gi, '')
    
    // Remove tags HTML
    .replace(/<[^>]*>/g, '')
    
    // Remove entities HTML comuns
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    
    // Limpa múltiplos espaços e quebras
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

// ========== FUNÇÃO 3: EXTRAIR CONTEÚDO (MELHORADA) ==========
function extractContentWithRegex(
  html: string,
  config: PortalConfig
): { titulo: string; conteudo: string; resumo: string; imagem: string } {
  
  let titulo = "";
  let conteudo = "";
  let resumo = "";
  let imagem = "";

  try {
    // ========== EXTRAI TÍTULO ==========
    for (const selector of config.titleSelectors) {
      if (titulo) break;

      // Tenta encontrar com regex flexível
      let patterns = [
        new RegExp(`<h1[^>]*>([^<]+)<\\/h1>`, 'i'),
        new RegExp(`itemprop=["']headline["'][^>]*>([^<]+)<`, 'i'),
        new RegExp(`<[^>]*${selector.replace(/[.#]/g, '')}[^>]*>([^<]+)<`, 'i')
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          titulo = cleanContent(match[1]).trim();
          if (titulo && titulo.length > 5) break;
        }
      }
    }

    // ========== EXTRAI CONTEÚDO ==========
    for (const selector of config.contentSelectors) {
      if (conteudo && conteudo.length > 200) break;

      // Tenta encontrar com regex flexível
      let patterns = [
        new RegExp(`<main[^>]*>(.*?)<\\/main>`, 'is'),
        new RegExp(`<article[^>]*>(.*?)<\\/article>`, 'is'),
        new RegExp(`itemprop=["']articleBody["'][^>]*>(.*?)<\\/[^>]+>`, 'is'),
        new RegExp(`<[^>]*${selector.replace(/[.#]/g, '')}[^>]*>(.*?)<\\/[^>]+>`, 'is')
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          let tempContent = cleanContent(match[1]).trim();
          
          // Valida se o conteúdo é suficiente
          if (tempContent.length > 200) {
            conteudo = tempContent;
            break;
          }
        }
      }
    }

    // ========== EXTRAI RESUMO (primeira frase) ==========
    if (conteudo) {
      const sentences = conteudo.split(/[.!?]+/);
      resumo = sentences.slice(0, 2).join('. ').trim() + '.';
    }

    // ========== EXTRAI IMAGEM ==========
    for (const selector of config.imageSelectors) {
      if (imagem) break;

      let patterns = [
        /itemprop=["']image["'][^>]*src=["']([^"']+)["']/i,
        /<img[^>]*src=["']([^"']+)["'][^>]*>/i,
        /<img[^>]*src=["']([^"']+)["']/i
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          imagem = match[1];
          // Normaliza URL de imagem
          if (imagem.startsWith('/')) {
            const baseUrl = new URL(config.baseUrl);
            imagem = baseUrl.origin + imagem;
          }
          break;
        }
      }
    }

    return { titulo, conteudo, resumo, imagem };

  } catch (error) {
    console.error('❌ Erro ao extrair conteúdo:', error);
    return { titulo: "", conteudo: "", resumo: "", imagem: "" };
  }
}

// ========== FUNÇÃO 4: VALIDAR CONTEÚDO ==========
function validateContent(conteudo: string): { isValid: boolean; wordCount: number; reason?: string } {
  const wordCount = conteudo.split(/\s+/).filter(w => w.length > 0).length;
  
  // Rejeita conteúdo muito curto (provavelmente apenas resumo)
  if (wordCount < 100) {
    return { 
      isValid: false, 
      wordCount, 
      reason: `Conteúdo muito curto (${wordCount} palavras, esperado: 100+)` 
    };
  }

  // Rejeita conteúdo com muito código
  const codePatterns = /glb\./gi;
  const codeMatches = conteudo.match(codePatterns);
  if (codeMatches && codeMatches.length > 5) {
    return { 
      isValid: false, 
      wordCount, 
      reason: `Conteúdo contém código JavaScript` 
    };
  }

  return { isValid: true, wordCount };
}

// ========== FUNÇÃO 5: GERAR PROMPT PARA GROQ ==========
function generateGrokPrompt(titulo: string, conteudo: string): string {
  return `Você é um editor de notícias especializado em jornalismo digital. Reescreva o seguinte artigo de forma clara, concisa e profissional.

TÍTULO ORIGINAL:
"${titulo}"

TEXTO ORIGINAL:
"""
${conteudo}
"""

INSTRUÇÕES CRÍTICAS:
1. Se o texto original tiver menos de 100 palavras, responda: "CONTEÚDO IGNORADO - Texto muito curto"
2. Se detectar código JavaScript (glb.cdnConfig, window.config, etc), responda: "CONTEÚDO IGNORADO - Contém código"
3. Reescreva mantendo 80-90% do conteúdo e informação original
4. Mantenha o tom jornalístico profissional
5. Melhore a estrutura e legibilidade
6. Crie um título atrativo mas fiel ao original

RESPONDA APENAS EM JSON (sem markdown):
{
  "titulo": "Título reescrito aqui",
  "conteudo": "Conteúdo reescrito aqui..."
}`;
}

// ========== FUNÇÃO 6: CHAMAR GROQ API ==========
async function callGroqAPI(prompt: string): Promise<GrokResponse | null> {
  try {
    const grokApiKey = Deno.env.get("GROQ_API_KEY");
    if (!grokApiKey) {
      console.error("❌ GROQ_API_KEY não configurada");
      return null;
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${grokApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-32768",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Erro ao chamar Groq:", data);
      return null;
    }

    const content = data.choices?.[0]?.message?.content || "";
    
    // Tenta fazer parse do JSON
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error("❌ Erro ao fazer parse JSON da resposta Groq:", content);
      return null;
    }

    return null;

  } catch (error) {
    console.error("❌ Erro ao chamar Groq:", error);
    return null;
  }
}

// ========== FUNÇÃO 7: SALVAR NO SUPABASE ==========
async function saveToSupabase(
  supabase: any,
  noticia: NoticiaScrapedData
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("noticias_scraped")
      .insert([noticia]);

    if (error) {
      console.error("❌ Erro ao salvar no Supabase:", error);
      return false;
    }

    console.log(`✅ Notícia salva: ${noticia.titulo_reescrito.substring(0, 50)}...`);
    return true;

  } catch (error) {
    console.error("❌ Erro ao salvar:", error);
    return false;
  }
}

// ========== FUNÇÃO PRINCIPAL: PROCESSAR URL ==========
async function processNewsUrl(
  url: string,
  config: PortalConfig,
  supabase: any
): Promise<void> {
  try {
    console.log(`\n📰 Processando: ${url}`);

    // 1. Faz fetch da página
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      console.error(`❌ Erro ao acessar ${url}: ${response.status}`);
      return;
    }

    const html = await response.text();

    // 2. Extrai conteúdo
    const { titulo, conteudo, resumo, imagem } = extractContentWithRegex(html, config);

    if (!titulo || !conteudo) {
      console.warn(`⚠️ Não foi possível extrair conteúdo de ${url}`);
      return;
    }

    // 3. Valida conteúdo
    const validation = validateContent(conteudo);
    if (!validation.isValid) {
      console.warn(`⚠️ Conteúdo inválido: ${validation.reason}`);
      return;
    }

    console.log(`✅ Conteúdo válido: ${validation.wordCount} palavras`);

    // 4. Chama Groq para reescrever
    const prompt = generateGrokPrompt(titulo, conteudo);
    const grokResponse = await callGroqAPI(prompt);

    if (!grokResponse) {
      console.error("❌ Falha ao obter resposta da IA");
      return;
    }

    // 5. Prepara dados para salvar
    const noticia: NoticiaScrapedData = {
      titulo_original: titulo,
      titulo_reescrito: grokResponse.titulo || titulo,
      resumo_original: resumo,
      conteudo_reescrito: grokResponse.conteudo || conteudo,
      url_original: url,
      fonte: config.name,
      status: "processado",
      data_coleta: new Date().toISOString(),
      imagem_url: imagem,
      categoria: config.category
    };

    // 6. Salva no Supabase
    await saveToSupabase(supabase, noticia);

  } catch (error) {
    console.error(`❌ Erro ao processar ${url}:`, error);
  }
}

// ========== MAIN HANDLER ==========
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Inicializa Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: "Variáveis de ambiente não configuradas" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Processa cada portal
    console.log("\n🚀 INICIANDO SCRAPER DE NOTÍCIAS...\n");

    for (const [domain, config] of Object.entries(PORTAIS_CONFIG)) {
      try {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📍 PORTAL: ${config.name}`);
        console.log(`${'='.repeat(60)}`);

        // Faz fetch da página inicial
        const response = await fetch(config.baseUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });

        if (!response.ok) {
          console.error(`❌ Erro ao acessar ${config.name}: ${response.status}`);
          continue;
        }

        const html = await response.text();

        // Extrai links
        const links = extractNewsLinks(html, config);

        if (links.length === 0) {
          console.warn(`⚠️ Nenhum link encontrado para ${config.name}`);
          continue;
        }

        // Processa cada link
        for (const link of links) {
          await processNewsUrl(link, config, supabase);
        }

      } catch (error) {
        console.error(`❌ Erro ao processar portal ${config.name}:`, error);
      }
    }

    console.log("\n✅ SCRAPER FINALIZADO COM SUCESSO\n");

    return new Response(
      JSON.stringify({ success: true, message: "Scraper executado com sucesso" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Erro crítico:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});