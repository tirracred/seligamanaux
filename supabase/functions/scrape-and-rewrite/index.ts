// Importa o 'edge-runtime' para tipos Deno
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Importa o createClient da biblioteca supabase-js v2
import { createClient } from "npm:@supabase/supabase-js@2";

/* =========================
TIPOS
========================= */

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
  imagem_url?: string | null;
  categoria: string;
}

interface GroqResponse {
  titulo: string;
  conteudo: string;
}

interface PortalConfig {
  name: string;
  baseUrl: string;
  linkSelectors: string[];
  titleSelectors: string[];
  contentSelectors: string[];
  imageSelectors: string[];
  category: string;
}

/* =========================
CORS
========================= */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, Authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

/* =========================
CONFIGURAÇÃO DE PORTAIS
========================= */

const PORTAIS_CONFIG: Record<string, PortalConfig> = {
  "g1.globo.com": {
    name: "G1 Amazonas",
    baseUrl: "https://g1.globo.com/am/amazonas/",
    linkSelectors: [
      'a[href*="/am/amazonas/noticia/"]',
      'a[href*="/amazonas/noticia/"]',
      '.feed-post-link[href*="/noticia/"]',
      'a[href*="/am/amazonas/"][href*="/noticia/"]',
      'a[href*="/am/amazonas/20"]',
    ],
    titleSelectors: [
      "h1.content-head__title",
      "h1.gui-color-primary",
      "h1",
      ".content-head__title",
    ],
    contentSelectors: [
      ".content-text__container",
      ".mc-article-body",
      ".post__content",
      "article .content",
    ],
    imageSelectors: [
      ".content-media__image img",
      ".progressive-img img",
      "figure img",
      ".content-head__image img",
      'meta[property="og:image"]',
    ],
    category: "Amazonas",
  },

  "portaldoholanda.com.br": {
    name: "Portal do Holanda",
    baseUrl: "https://portaldoholanda.com.br/amazonas",
    linkSelectors: [
      'a[href*="/noticia/"]',
      'a[href*="/noticias/"]',
      ".post-link",
      "h2 a",
      "h3 a",
      'a[href*="/amazonas/"]',
      'a[href*="/policia/"]',
      'a[href*="/politica/"]',
    ],
    titleSelectors: ["h1.entry-title", "h1.post-title", "h1", ".title"],
    contentSelectors: [
      ".entry-content",
      ".post-content",
      ".content",
      "article .text",
    ],
    imageSelectors: [
      ".featured-image img",
      ".post-thumbnail img",
      "article img",
      ".wp-post-image",
      'meta[property="og:image"]',
    ],
    category: "Amazonas",
  },

  "acritica.com": {
    name: "A Crítica",
    baseUrl: "https://www.acritica.com/",
    linkSelectors: [
      'a[href*="/noticias/"]',
      'a[href*="/noticia/"]',
      'a[href*="/amazonas/"]',
      'a[href*="/cidades/"]',
      'a[href*="/economia/"]',
      'a[href*="/esportes/"]',
      ".post-item a",
      "h2 a",
      "h3 a",
    ],
    titleSelectors: ["h1.post-title", "h1.entry-title", "h1", ".article-title"],
    contentSelectors: [
      ".post-content",
      ".entry-content",
      ".article-content",
      "article .content",
    ],
    imageSelectors: [
      ".featured-image img",
      ".post-image img",
      "article img",
      ".thumbnail img",
      'meta[property="og:image"]',
    ],
    category: "Amazonas",
  },

  "portalamazonia.com": {
    name: "Portal Amazônia",
    baseUrl: "https://portalamazonia.com/noticias/amazonas",
    linkSelectors: [
      'a[href^="/noticias/amazonas/"]',
      'a[href*="/noticias/"]',
      'a[href*="/noticia/"]',
      "h2 a",
      "h3 a",
      ".post-link",
      'a[href*="/amazonas/"]',
      'a[href*="/202"]',
    ],
    titleSelectors: [
      "h1.entry-title",
      "h1.post-title",
      "h1",
      ".article-title",
      "h1.td-post-title",
    ],
    contentSelectors: [
      ".entry-content",
      ".post-content",
      ".article-body",
      "article .content",
      'div[itemprop="articleBody"]',
      ".td-post-content",
    ],
    imageSelectors: [
      ".featured-image img",
      ".post-thumbnail img",
      "article img",
      ".wp-post-image",
      'meta[property="og:image"]',
    ],
    category: "Amazônia",
  },

  "d24am.com": {
    name: "D24AM",
    baseUrl: "https://d24am.com/amazonas",
    linkSelectors: [
      'a[href*="/amazonas/"]',
      'a[href*="/manaus/"]',
      'a[href*="/noticias/"]',
      "article a",
      "h2 a",
      "h3 a",
    ],
    titleSelectors: [
      "h1.entry-title",
      "h1.post-title",
      "h1",
      ".article-title",
    ],
    contentSelectors: [
      ".entry-content",
      ".post-content",
      "article .content",
      'div[itemprop="articleBody"]',
    ],
    imageSelectors: [
      'meta[property="og:image"]',
      ".post-thumbnail img",
      "article img",
    ],
    category: "Amazonas",
  },
};

/* =========================
FILTROS ANTI-PROMO/INSTITUCIONAL
========================= */

const URL_BLACKLIST = [
  "/sobre",
  "/institucional",
  "/anuncie",
  "/publicidade",
  "/assine",
  "/assinante",
  "/trabalhe-",
  "/faq",
  "/politica-de-privacidade",
  "/termos",
  "/contato",
  "/equipe",
  "/comercial",
  "/videos/",
  "/podcast/",
  "/ao-vivo/",
  "/classificados/",
  "/redacao",
  "/nossa-equipe",
  "/quem-somos",
  "/menu",
  "/globonews",
  "/programacao",
];

const TITLE_BLACKLIST = [
  "menu",
  "nossa equipe",
  "equipe",
  "redação",
  "siga a globonews nas redes sociais",
  "conheça a história do globo repórter",
  "programação",
  "assista",
];

function isBlacklistedUrl(u: string): boolean {
  const x = (u || "").toLowerCase();
  return URL_BLACKLIST.some((b) => x.includes(b));
}

function isBlacklistedTitle(t: string): boolean {
  const x = (t || "").toLowerCase().trim();
  return x.length < 8 || TITLE_BLACKLIST.some((b) => x.includes(b));
}

// ✅ ÚNICA DEFINIÇÃO de looksPromotional no arquivo
function looksPromotional(text: string): boolean {
  const x = (text || "").toLowerCase();
  return /publieditorial|publicidade|assessoria de imprensa|assine|clique aqui|programação|assista ao|patrocinado|publipost|oferecimento|oferecido por|parceria/i.test(
    x
  );
}

// ✅ FUNÇÃO para detectar heurística de notícia
function looksNewsish(url: string): boolean {
  const lower = url.toLowerCase();
  const newsPatterns = [
    /\/amazonas\//i,
    /\/manaus\//i,
    /\/noticia(s)?\//i,
    /\/politica\//i,
    /\/policia\//i,
    /\/cidades\//i,
    /\/economia\//i,
    /\/esportes\//i,
    /\/entretenimento\//i,
    /\/saude\//i,
    /\/cultura\//i,
    /\d{4}-\d{2}-\d{2}/,
    /\d{1,2}[.\/]\d{1,2}/,
  ];
  return newsPatterns.some((rx) => rx.test(lower)) && !isBlacklistedUrl(lower);
}

/* =========================
NORMALIZAÇÃO / HIGIENE DE TEXTO
========================= */

function stripSourceArtifacts(t: string): string {
  return (t || "")
    .replace(/\s+—\s*Foto:.*?(?=\.|$)/gi, "")
    .replace(/—\s*Foto.*?$/gim, "")
    .replace(/^\s*Foto:.*$/gim, "")
    .replace(/^\s*Crédito:.*$/gim, "")
    .replace(/^\s*Fonte:.*$/gim, "")
    .replace(/^\s*Com informações de.*$/gim, "")
    .replace(/^\s*Leia mais:.*$/gim, "")
    .replace(/\b(g1|globonews|rede amazônica)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeText(t: string): string {
  return (t || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tooSimilar(a: string, b: string): boolean {
  const A = new Set(normalizeText(a).split(" "));
  const B = new Set(normalizeText(b).split(" "));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const min = Math.max(1, Math.min(A.size, B.size));
  return inter / min > 0.8; // > 80% palavras em comum = muito similar
}

function has12ConsecutiveMatches(
  original: string,
  rewritten: string
): boolean {
  const origWords = original.toLowerCase().split(/\s+/);
  const rewritWords = rewritten.toLowerCase().split(/\s+/);

  for (let i = 0; i <= origWords.length - 12; i++) {
    const window = origWords.slice(i, i + 12).join(" ");
    if (rewritWords.join(" ").includes(window)) {
      console.log(`[WARN_COPY] 12+ palavras consecutivas: "${window}"`);
      return true;
    }
  }
  return false;
}

/* =========================
UTILITÁRIOS DE FETCH (AMP + IDIOMA)
========================= */

function ampCandidates(u: string): string[] {
  const clean = u.replace(/#.*$/, "");
  const arr: string[] = [];

  if (!/outputType=amp/.test(clean)) {
    arr.push(clean + (clean.includes("?") ? "&" : "?") + "outputType=amp");
  }

  if (!/\/amp\/?$/.test(clean)) {
    arr.push(clean.replace(/\/$/, "") + "/amp");
  }

  arr.push(clean);
  return arr;
}

async function fetchHtmlPreferAmp(url: string, ua: string): Promise<string> {
  const common = {
    "User-Agent": ua,
    Accept: "text/html",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  };

  for (const cand of ampCandidates(url)) {
    try {
      const r = await fetch(cand, {
        headers: common,
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) return await r.text();
    } catch {}
  }

  const r = await fetch(url, {
    headers: common,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
  return await r.text();
}

async function fetchListHtml(url: string): Promise<string> {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  return await fetchHtmlPreferAmp(url, ua);
}

function sanitizeHtml(html: string): string {
  return (html || "")
    .replace(/<script[^>]*>.*?<\/script>/gis, "")
    .replace(/<style[^>]*>.*?<\/style>/gis, "")
    .replace(/<nav[^>]*>.*?<\/nav>/gis, "")
    .replace(/<header[^>]*>.*?<\/header>/gis, "")
    .replace(/<footer[^>]*>.*?<\/footer>/gis, "")
    .replace(/<aside[^>]*>.*?<\/aside>/gis, "")
    .replace(/<form[^>]*>.*?<\/form>/gis, "")
    .replace(/<iframe[^>]*>.*?<\/iframe>/gis, "")
    .replace(/<button[^>]*>.*?<\/button>/gis, "")
    .replace(/<svg[^>]*>.*?<\/svg>/gis, "")
    .replace(/<noscript[^>]*>.*?<\/noscript>/gis, "");
}

/* =========================
EXTRAÇÃO DE LINKS / CONTEÚDO
========================= */

function extractNewsLinks(
  htmlContent: string,
  portalConfig: PortalConfig,
  sourceUrl: string
): string[] {
  if (!htmlContent || htmlContent.length === 0) {
    console.log(`[DEBUG] HTML vazio para ${sourceUrl}`);
    return [];
  }

  // Parser simples (node-based mock)
  const linkPattern = /href=["']([^"']+)["']/gi;
  const allHrefs: string[] = [];
  let match;

  while ((match = linkPattern.exec(htmlContent)) !== null) {
    allHrefs.push(match[1]);
  }

  console.log(
    `[EXTRACT] Portal: ${portalConfig.name} | URLs extraídas: ${allHrefs.length}`
  );

  // Normalizar e filtrar URLs
  const newsLinks: string[] = [];
  for (const href of allHrefs) {
    try {
      const fullUrl = new URL(href, sourceUrl).toString();
      if (
        !isBlacklistedUrl(fullUrl) &&
        looksNewsish(fullUrl) &&
        !newsLinks.includes(fullUrl)
      ) {
        newsLinks.push(fullUrl);
      }
    } catch {}
  }

  console.log(
    `[EXTRACT_FILTERED] ${portalConfig.name}: ${newsLinks.length} links após filtro`
  );
  if (newsLinks.length > 0) {
    console.log(`[SAMPLE] Primeiros 3: ${newsLinks.slice(0, 3).join(" | ")}`);
  }

  return newsLinks;
}

function deduplicateLinks(links: string[]): string[] {
  return Array.from(new Set(links));
}

function buildPaginationUrls(
  baseUrl: string,
  portalName: string
): string[] {
  const urls = [baseUrl];

  if (portalName === "Portal do Holanda") {
    for (let p = 2; p <= 4; p++) {
      urls.push(
        `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}paged=${p}`
      );
    }
  } else if (portalName === "Portal Amazônia") {
    for (let p = 2; p <= 4; p++) {
      urls.push(baseUrl.replace(/\/$/, "") + `/page/${p}/`);
    }
  } else if (portalName === "A Crítica") {
    for (let p = 2; p <= 4; p++) {
      urls.push(
        `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}pag=${p}`
      );
    }
  } else if (portalName === "D24AM") {
    for (let p = 2; p <= 4; p++) {
      urls.push(baseUrl.replace(/\/$/, "") + `?page=${p}`);
    }
  }

  return urls;
}

/* =========================
REESCRITA VIA GROQ
========================= */

async function rewriteWithGroq(
  title: string,
  content: string,
  apiKey: string,
  retryCount: number = 0
): Promise<GroqResponse | null> {
  if (retryCount > 2) {
    console.log(`[REWRITE_ABORT] Máximo de tentativas atingido`);
    return null;
  }

  const temperature = retryCount === 0 ? 0.5 : retryCount === 1 ? 0.7 : 0.9;

  const prompt = `Você é um jornalista experiente. Reescreva o seguinte título e conteúdo de notícia em português, garantindo:
- Texto original e único (sem cópia acima de 80% de similaridade)
- Nenhuma sequência de 12+ palavras idênticas à original
- Formatação em parágrafos bem estruturados
- Entre 2000 e 4000 caracteres
- Tom jornalístico profissional

TÍTULO ORIGINAL:
${title}

CONTEÚDO ORIGINAL:
${content}

Responda APENAS em JSON válido, sem markdown ou explicações:
{"titulo": "novo título", "conteudo": "novo conteúdo reescrito"}`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-32768",
        messages: [{ role: "user", content: prompt }],
        temperature: temperature,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      console.log(`[GROQ_ERROR] HTTP ${response.status}`);
      if (retryCount < 2) {
        return rewriteWithGroq(title, content, apiKey, retryCount + 1);
      }
      return null;
    }

    const data: any = await response.json();
    const textContent = data.choices?.[0]?.message?.content || "";

    if (!textContent) {
      console.log(`[GROQ_EMPTY] Resposta vazia, retry...`);
      if (retryCount < 2) {
        return rewriteWithGroq(title, content, apiKey, retryCount + 1);
      }
      return null;
    }

    const parsed = JSON.parse(textContent);
    const novoTitulo = (parsed.titulo || "").trim();
    const novoConteudo = (parsed.conteudo || "").trim();

    console.log(
      `[REWRITE_DONE] Retry #${retryCount} | Título: ${novoTitulo.slice(0, 40)}... | Content len: ${novoConteudo.length}`
    );

    // Validação anti-cópia
    if (
      novoConteudo.length < 1800 ||
      tooSimilar(content, novoConteudo) ||
      has12ConsecutiveMatches(content, novoConteudo)
    ) {
      console.log(`[REWRITE_REJECTED] Similar ou curto, retry...`);
      if (retryCount < 2) {
        return rewriteWithGroq(title, content, apiKey, retryCount + 1);
      }
      return null;
    }

    return { titulo: novoTitulo, conteudo: novoConteudo };
  } catch (err) {
    console.log(`[GROQ_EXCEPTION] ${err}`);
    if (retryCount < 2) {
      return rewriteWithGroq(title, content, apiKey, retryCount + 1);
    }
    return null;
  }
}

/* =========================
MAIN HANDLER
========================= */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const { url, ampPreferred = false } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL obrigatória" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const urlObj = new URL(url);
    const hostKey = Object.keys(PORTAIS_CONFIG).find((key) =>
      urlObj.hostname.includes(key)
    );

    if (!hostKey) {
      return new Response(
        JSON.stringify({ error: `Portal não suportado: ${urlObj.hostname}` }),
        { status: 400, headers: corsHeaders }
      );
    }

    const portalConfig = PORTAIS_CONFIG[hostKey]!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const groqApiKey = Deno.env.get("GROQ_API_KEY");

    if (!supabaseUrl || !supabaseKey || !groqApiKey) {
      return new Response(
        JSON.stringify({ error: "Variáveis de ambiente incompletas" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verificar se é URL de artigo
    const articleRegex =
      /noticia|artigo|post|article|story|news|conteudo|reportagem/i;
    const isArticle = articleRegex.test(url);

    let newsLinks: string[] = [];

    if (isArticle) {
      // Processar artigo único
      newsLinks = [url];
      console.log(`[MODE] Artigo único detectado: ${url}`);
    } else {
      // Processar lista
      let htmlContent = await fetchListHtml(url);
      console.log(`[FETCH] ${portalConfig.name}: ${htmlContent.length} bytes`);

      // Fallback para A Crítica
      if (
        portalConfig.name === "A Crítica" &&
        htmlContent.length < 15000
      ) {
        console.log(`[FALLBACK] A Crítica: HTML curto, tentando editorias...`);
        const fallbackUrls = [
          "https://www.acritica.com/amazonas/",
          "https://www.acritica.com/noticias/",
          "https://www.acritica.com/politica/",
        ];

        for (const fallbackUrl of fallbackUrls) {
          try {
            htmlContent = await fetchListHtml(fallbackUrl);
            console.log(`[FALLBACK] Tentado: ${fallbackUrl} (${htmlContent.length} bytes)`);
            if (htmlContent.length > 15000) break;
          } catch {}
        }
      }

      newsLinks = extractNewsLinks(htmlContent, portalConfig, url);

      // Paginação se <8 links
      if (
        newsLinks.length < 8 &&
        !url.includes("pag=") &&
        !url.includes("page=")
      ) {
        console.log(
          `[PAGINATION] ${portalConfig.name}: ${newsLinks.length} links, tentando páginas...`
        );
        const paginatedUrls = buildPaginationUrls(url, portalConfig.name);

        for (const pagUrl of paginatedUrls.slice(1)) {
          try {
            const pagHtml = await fetchListHtml(pagUrl);
            const pagLinks = extractNewsLinks(pagHtml, portalConfig, pagUrl);
            newsLinks.push(...pagLinks.filter((l) => !newsLinks.includes(l)));
            console.log(
              `[PAGINATION] Página ${pagUrl}: +${pagLinks.length} links, total: ${newsLinks.length}`
            );
            if (newsLinks.length >= 8) break;
          } catch (err) {
            console.log(`[PAGINATION_ERROR] ${pagUrl}: ${err}`);
          }
        }
      }
    }

    // ✅ Deduplicate (reatribuição, não redeclaração)
    newsLinks = deduplicateLinks(newsLinks);
    console.log(`[DEDUPE] Links únicos: ${newsLinks.length}`);

    if (newsLinks.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          message: `Nenhum link extraído para ${portalConfig.name}`,
        }),
        { headers: corsHeaders }
      );
    }

    // Processar cada link
    const processedNews: NoticiaScrapedData[] = [];

    for (const newsUrl of newsLinks) {
      try {
        console.log(`[PROCESS] Artigo: ${newsUrl.slice(0, 60)}...`);

        const htmlContent = ampPreferred
          ? await fetchHtmlPreferAmp(newsUrl, "Mozilla/5.0")
          : await fetchListHtml(newsUrl);

        const cleanHtml = sanitizeHtml(htmlContent);

        // Extrair título
        const titleMatch = cleanHtml.match(/<h1[^>]*>(.*?)<\/h1>/i);
        const originalTitle = (titleMatch?.[1] || "Sem título")
          .replace(/<[^>]+>/g, "")
          .trim();

        if (isBlacklistedTitle(originalTitle)) {
          console.log(`[SKIP] Título na blacklist`);
          continue;
        }

        // Extrair conteúdo
        const contentMatch = cleanHtml.match(
          /<article[^>]*>(.*?)<\/article>/is
        ) ||
          cleanHtml.match(/<!-- .* -->(.*?)<!-- .*/is) || [
            null,
            cleanHtml,
          ];
        let originalContent = contentMatch[1] || cleanHtml;
        originalContent = originalContent
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (originalContent.length < 500) {
          console.log(
            `[SKIP] Conteúdo muito curto (${originalContent.length} chars)`
          );
          continue;
        }

        // Higienizar
        originalContent = stripSourceArtifacts(originalContent);
        if (looksPromotional(originalContent) || looksPromotional(originalTitle)) {
          console.log(`[SKIP] Promotional/institutional`);
          continue;
        }

        // Reescrever
        console.log(`[REWRITE_START] Título: ${originalTitle.slice(0, 50)}...`);
        const rewritten = await rewriteWithGroq(
          originalTitle,
          originalContent,
          groqApiKey
        );

        if (!rewritten) {
          console.log(`[SKIP] Reescrita falhou`);
          continue;
        }

        // Extrair imagem
        const imgMatch = cleanHtml.match(
          /(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i
        );
        const imagemUrl = imgMatch?.[1] || null;

        // ✅ Montar registro com status "pendente"
        const newRecord: NoticiaScrapedData = {
          titulo_original: originalTitle.slice(0, 255),
          titulo_reescrito: rewritten.titulo.slice(0, 255),
          resumo_original: originalContent.slice(0, 500),
          resumo_reescrito: rewritten.conteudo.slice(0, 500),
          conteudo_reescrito: rewritten.conteudo,
          url_original: newsUrl,
          fonte: portalConfig.name,
          status: "pendente", // ✅ CORRIGIDO: era "processado"
          data_coleta: new Date().toISOString(),
          imagem_url: imagemUrl,
          categoria: portalConfig.category,
        };

        processedNews.push(newRecord);
        console.log(`[INSERT_READY] ${rewritten.titulo.slice(0, 40)}...`);
      } catch (err) {
        console.log(`[PROCESS_ERROR] ${newsUrl}: ${err}`);
      }
    }

    // Salvar no Supabase
    if (processedNews.length > 0) {
      const { error } = await supabase
        .from("noticias_scraped")
        .insert(processedNews);

      if (error) {
        console.log(`[INSERT_ERROR] ${error.message}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message,
            inserted: processedNews.length,
          }),
          { status: 500, headers: corsHeaders }
        );
      }

      console.log(`[INSERT_SUCCESS] ${processedNews.length} registros salvos`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedNews.length,
        portal: portalConfig.name,
        message: `${processedNews.length} notícias processadas e salvas com status "pendente"`,
      }),
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("[MAIN_ERROR]", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});