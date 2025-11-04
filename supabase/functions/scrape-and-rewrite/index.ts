// Importa o 'edge-runtime' para tipos Deno
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Importa o createClient da biblioteca supabase-js v2
import { createClient } from "npm:@supabase/supabase-js@2";

/* =========================
   Tipos
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
   Configuração de Portais
   ========================= */
const PORTAIS_CONFIG: Record<string, PortalConfig> = {
  "g1.globo.com": {
    name: "G1 Amazonas",
    baseUrl: "https://g1.globo.com/am/amazonas/",
    linkSelectors: [
      'a[href*="/am/amazonas/noticia/"]',
      'a[href*="/amazonas/noticia/"]',
      '.feed-post-link[href*="/noticia/"]',
      'a[href*="/am/amazonas/"][href*="/noticia/"]', // extra
      'a[href*="/am/amazonas/20"]', // URLs com data
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
    // entrar direto na editoria ajuda muito
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
};

/* =========================
   Filtros anti-promo/institucional
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
  "/tag/",
  "/tags/",
  "/ao-vivo/",
  "/galeria/",
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

function isBlacklistedUrl(u: string) {
  const x = u.toLowerCase();
  return URL_BLACKLIST.some((b) => x.includes(b));
}
function isBlacklistedTitle(t: string) {
  const x = (t || "").toLowerCase().trim();
  return x.length < 8 || TITLE_BLACKLIST.some((b) => x.includes(b));
}
function looksPromotional(text: string) {
  const x = (text || "").toLowerCase();
  return /publieditorial|publicidade|assessoria de imprensa|assine|clique aqui|programação|assista ao/i.test(
    x,
  );
}

/* =========================
   Utilitários de fetch (AMP + Língua)
   ========================= */
function ampCandidates(u: string) {
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

async function fetchHtmlPreferAmp(url: string, ua: string) {
  const common = {
    "User-Agent": ua,
    Accept: "text/html",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  };

  for (const cand of ampCandidates(url)) {
    const r = await fetch(cand, {
      headers: common,
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok) return await r.text();
  }
  const r = await fetch(url, {
    headers: common,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
  return await r.text();
}

function sanitizeHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(
      /<(nav|header|footer|aside|form|iframe|button|svg|noscript|figure|section)[\s\S]*?<\/\1>/gi,
      "",
    )
    .replace(
      /\b(class|id)="[^"]*(menu|newsletter|social|share|advert|ad-|banner|promo|sponsored)[^"]*"/gi,
      "",
    );
}

/* =========================
   Extração de links
   ========================= */
function extractNewsLinks(
  html: string,
  config: PortalConfig,
  maxLinks = 15,
): string[] {
  const links: Set<string> = new Set();
  const page = sanitizeHtml(html);

  // tenta por seletores conhecidos
  for (const selector of config.linkSelectors) {
    let pattern: RegExp;

    if (selector.includes('[href*=')) {
      const hrefPattern = selector.match(/\[href\*="([^"]+)"\]/);
      if (!hrefPattern) continue;
      pattern = new RegExp(
        `<a[^>]+href=["']([^"']*${hrefPattern[1].replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"']*)["'][^>]*>([\\s\\S]*?)<\\/a>`,
        "gi",
      );
    } else {
      const className = selector.replace(".", "").replace(/\s+img$/, "");
      pattern = new RegExp(
        `<a([^>]+class=["'][^"']*${className}[^"']*["'][^>]*)href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>`,
        "gi",
      );
    }

    let m: RegExpExecArray | null;
    while ((m = pattern.exec(page)) !== null && links.size < maxLinks * 3) {
      let url = m[1]?.startsWith("class") ? (m[2] as string) : (m[1] as string);
      const txt = (m[3] || "").replace(/<[^>]*>/g, " ").trim().toLowerCase();

      if (!url) continue;
      if (url.startsWith("/")) {
        const base = new URL(config.baseUrl);
        url = base.origin + url;
      } else if (!/^https?:\/\//.test(url)) {
        url = config.baseUrl + url;
      }

      if (isBlacklistedUrl(url)) continue;
      if (txt && isBlacklistedTitle(txt)) continue;

      const isNewsish =
        /(\/20\d{2}\/\d{2}\/\d{2}\/|\/noticia\/|\/noticias\/|\/noticias\/amazonas\/|\/amazonas\/[^/]+$|\/manaus\/[^/]+$)/.test(
          url,
        );
      if (!isNewsish) continue;

      links.add(url);
      if (links.size >= maxLinks * 2) break;
    }
  }

  // fallback amplo
  if (links.size < 5) {
    const general =
      /<a[^>]+href=["']([^"']*(?:\/noticia\/|\/noticias\/|\/20\d{2}\/\d{2}\/\d{2}\/|\/noticias\/amazonas\/)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = general.exec(page)) !== null && links.size < maxLinks * 2) {
      let url = m[1] as string;
      const txt = (m[2] || "").replace(/<[^>]*>/g, " ").trim().toLowerCase();
      if (url.startsWith("/")) {
        const base = new URL(config.baseUrl);
        url = base.origin + url;
      }
      if (!/^https?:\/\//.test(url)) continue;
      if (isBlacklistedUrl(url) || isBlacklistedTitle(txt)) continue;
      links.add(url);
    }
  }

  const arr = Array.from(links).sort((a, b) => {
    const score = (u: string) =>
      (/(\/20\d{2}\/\d{2}\/\d{2}\/|\/noticia\/)/.test(u) ? 2 : 0) +
      (u.length < 120 ? 1 : 0);
    return score(b) - score(a);
  });

  console.log(`Encontrados ${arr.length} links únicos para ${config.name}`);
  return arr.slice(0, maxLinks);
}

/* =========================
   Extração de conteúdo
   ========================= */
function extractContentWithRegex(
  html: string,
  config: PortalConfig,
): { titulo: string; conteudo: string; resumo: string; imagem: string } {
  const clean = sanitizeHtml(html).replace(
    /glb\.cdnConfig[\s\S]*?(?:;|\})/gi,
    "",
  );

  let titulo = "Título não encontrado";
  let conteudo = "Conteúdo não encontrado";
  let resumo = "";
  let imagem = "";

  try {
    // Título
    for (const selector of config.titleSelectors) {
      const patterns = [
        new RegExp(`<${selector}[^>]*>(.*?)</${selector}>`, "is"),
        new RegExp(
          `<[^>]+class=["'][^"']*${selector.replace(/[.#]/g, "")}[^"']*["'][^>]*>(.*?)</[^>]+>`,
          "is",
        ),
      ];
      for (const pattern of patterns) {
        const match = clean.match(pattern);
        if (match && match[1]) {
          titulo = match[1].replace(/<[^>]*>/g, "").trim();
          if (titulo && titulo !== "Título não encontrado") break;
        }
      }
      if (titulo !== "Título não encontrado") break;
    }

    // Conteúdo
    for (const selector of config.contentSelectors) {
      const patterns = [
        new RegExp(
          `<[^>]+class=["'][^"']*${selector.replace(/[.#]/g, "")}[^"']*["'][^>]*>(.*?)</[^>]+>`,
          "is",
        ),
        new RegExp(`<${selector}[^>]*>(.*?)</${selector}>`, "is"),
      ];
      for (const pattern of patterns) {
        const match = clean.match(pattern);
        if (match && match[1]) {
          conteudo = match[1]
            .replace(/<script[^>]*>.*?<\/script>/gis, "")
            .replace(/<style[^>]*>.*?<\/style>/gis, "")
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (conteudo.length > 100) break;
        }
      }
      if (conteudo.length > 100) break;
    }

    // Fallback <p>
    if (conteudo === "Conteúdo não encontrado" || conteudo.length < 100) {
      const paragraphs = clean.match(/<p[^>]*>(.*?)<\/p>/gis);
      if (paragraphs && paragraphs.length > 0) {
        conteudo = paragraphs
          .map((p) => p.replace(/<[^>]*>/g, "").trim())
          .filter(
            (p) =>
              p.length > 60 &&
              !/publicidade|assine|programação|clique aqui/i.test(p),
          )
          .slice(0, 12)
          .join(" ");
      }
    }

    // Imagem (por seletor e og:image)
    if (!imagem) {
      for (const selector of config.imageSelectors) {
        if (selector.startsWith("meta[")) {
          const og = clean.match(
            /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
          );
          if (og && og[1]) {
            imagem = og[1];
            break;
          }
        } else {
          const patterns = [
            new RegExp(
              `<img[^>]+class=["'][^"']*${selector
                .replace(/[.#]/g, "")
                .replace(" img", "")}[^"']*["'][^>]+src=["']([^"']+)["']`,
              "i",
            ),
            new RegExp(
              `<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*${selector
                .replace(/[.#]/g, "")
                .replace(" img", "")}[^"']*["']`,
              "i",
            ),
          ];
          for (const pattern of patterns) {
            const match = clean.match(pattern);
            if (match && match[1]) {
              let imgUrl = match[1];
              if (imgUrl.startsWith("/")) {
                const baseUrl = new URL(config.baseUrl);
                imgUrl = baseUrl.origin + imgUrl;
              }
              if (
                /\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(imgUrl) ||
                /^https?:\/\//.test(imgUrl)
              ) {
                imagem = imgUrl;
                break;
              }
            }
          }
          if (imagem) break;
        }
      }
    }

    // Resumo
    if (conteudo && conteudo !== "Conteúdo não encontrado") {
      resumo =
        conteudo.substring(0, 300) +
        (conteudo.length > 300 ? "..." : "");
    }

    // Filtro final anti-promo
    if (isBlacklistedTitle(titulo) || looksPromotional(conteudo)) {
      return {
        titulo: "CONTEÚDO IGNORADO",
        conteudo: "",
        resumo: "",
        imagem: "",
      };
    }

    console.log(
      `${config.name} - Extraído: Título: ${titulo.substring(0, 50)}..., Conteúdo: ${conteudo.length} chars, Imagem: ${imagem ? "Sim" : "Não"}`,
    );
  } catch (error) {
    console.error(`Erro na extração para ${config.name}:`, error);
  }

  return { titulo, conteudo, resumo, imagem };
}

/* =========================
   Reescrita com Groq
   ========================= */
async function rewriteWithGroq(
  titulo: string,
  conteudo: string,
  fonte: string,
): Promise<GroqResponse> {
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_API_KEY) {
    console.error("GROQ_API_KEY não está definida");
    return { titulo, conteudo };
  }

  const system =
    "Você é um editor jornalístico. Reescreva em PT-BR, sem publicidade. Tamanho alvo entre 1800 e 4000 caracteres.";
  const user = `Fonte: ${fonte}
TÍTULO ORIGINAL: ${titulo}
TEXTO ORIGINAL (limpo):
${conteudo.slice(0, 7000)}

Responda SOMENTE um JSON com as chaves:
{"titulo": "...", "conteudo": "... (artigo 1800-4000 caracteres)"}
Se for publieditorial/anúncio, responda exatamente {"titulo":"CONTEÚDO IGNORADO","conteudo":"publieditorial"}.`;

  async function callGroq(model: string) {
    const resp = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          max_tokens: 1400,
          response_format: { type: "json_object" },
        }),
      },
    );
    if (!resp.ok) throw new Error(`Groq API ${resp.status}`);
    const data = await resp.json();
    let content = data?.choices?.[0]?.message?.content || "";
    if (!content.trim().startsWith("{")) {
      content = content.match(/{[\s\S]*}/)?.[0] || "{}";
    }
    return JSON.parse(content) as GroqResponse;
  }

  try {
    let out = await callGroq("llama-3.1-70b-versatile");
    if (out?.conteudo === "publieditorial") return out;

    let len = (out?.conteudo || "").replace(/\s+/g, " ").length;
    if (!out?.titulo || len < 1700) {
      // 2ª tentativa
      out = await callGroq("llama-3.1-8b-instant");
      if (out?.conteudo === "publieditorial") return out;
      len = (out?.conteudo || "").replace(/\s+/g, " ").length;
      if (!out?.titulo || len < 1700) throw new Error("Reescrita insuficiente");
    }
    return out;
  } catch (error) {
    console.error("Erro Groq:", error);
    return { titulo, conteudo };
  }
}

/* =========================
   Detectar portal por hostname
   ========================= */
function detectPortal(url: string): PortalConfig | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "");

    for (const [key, config] of Object.entries(PORTAIS_CONFIG)) {
      if (
        hostname.includes(key.replace("www.", "")) || key.includes(hostname)
      ) {
        return config;
      }
    }
  } catch (error) {
    console.error("Erro ao detectar portal:", error);
  }
  return null;
}

/* =========================
   Handler
   ========================= */
Deno.serve(async (req) => {
  console.log(`${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Método não permitido", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    // AUTENTICAÇÃO
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Sem autorização" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Usuário não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PARSE BODY
    const body = await req.json();
    const targetUrl = body.url as string;
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "URL obrigatória" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("Processando URL:", targetUrl);

    // DETECTA PORTAL
    const portalConfig = detectPortal(targetUrl);
    if (!portalConfig) {
      return new Response(JSON.stringify({ error: "Portal não suportado" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("Portal detectado:", portalConfig.name);

    // EVITAR DUPLICATAS (últimos 7 dias)
    const { data: existingUrls } = await supabaseAdmin
      .from("noticias_scraped")
      .select("url_original")
      .eq("fonte", portalConfig.name)
      .gte(
        "created_at",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      );

    const existingUrlsSet = new Set(
      existingUrls?.map((item) => item.url_original) || [],
    );
    console.log(`URLs já processadas: ${existingUrlsSet.size}`);

    // BAIXA HOME (com fallback de editoria no Portal Amazônia)
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    let htmlContent: string;
    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": userAgent,
          "Accept": "text/html",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      htmlContent = await response.text();
      console.log("HTML recebido, tamanho:", htmlContent.length);
    } catch (error: any) {
      console.error("Erro no scraping:", error);
      return new Response(
        JSON.stringify({
          error: `Erro ao acessar ${portalConfig.name}: ${error.message}`,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fallback específico Portal Amazônia
    if (portalConfig.name === "Portal Amazônia") {
      if (!htmlContent || htmlContent.length < 15000) {
        const alts = [
          "https://portalamazonia.com/noticias/amazonas",
          "https://portalamazonia.com/amazonas",
        ];
        for (const alt of alts) {
          try {
            htmlContent = await fetchHtmlPreferAmp(alt, userAgent);
            if (htmlContent && htmlContent.length > 15000) break;
          } catch {
            // segue
          }
        }
      }
    }

    // LINKS
    const newsLinks = extractNewsLinks(htmlContent, portalConfig, 20).filter(
      (url) => !existingUrlsSet.has(url),
    );

    if (newsLinks.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message:
            `Todas as notícias recentes do ${portalConfig.name} já foram processadas.`,
          stats: {
            total_encontradas: 0,
            processadas_com_sucesso: 0,
            erros: 0,
            portal: portalConfig.name,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      `Processando ${newsLinks.length} notícias novas de ${portalConfig.name}`,
    );

    // PROCESSA
    const processedNews: Array<{
      titulo: string;
      fonte: string;
      url: string;
      imagem: string;
    }> = [];
    let successCount = 0;
    let errorCount = 0;

    for (const newsUrl of newsLinks.slice(0, 12)) {
      try {
        console.log(`Processando: ${newsUrl}`);

        const newsHtml = await fetchHtmlPreferAmp(newsUrl, userAgent);

        const { titulo, conteudo, resumo, imagem } = extractContentWithRegex(
          newsHtml,
          portalConfig,
        );
        if (titulo === "Título não encontrado" || conteudo.length < 100) {
          console.log("Conteúdo insuficiente, pulando...");
          continue;
        }
        if (titulo === "CONTEÚDO IGNORADO" || looksPromotional(conteudo)) {
          console.log("Descartado (promo/institucional).");
          continue;
        }

        const {
          titulo: tituloReescrito,
          conteudo: conteudoReescrito,
        } = await rewriteWithGroq(titulo, conteudo, portalConfig.name);

        if (
          !conteudoReescrito ||
          conteudoReescrito === "publieditorial" ||
          conteudoReescrito.trim().length < 1700
        ) {
          console.log("Reescrita vazia/curta, pulando.");
          continue;
        }

        const resumoReescrito =
          conteudoReescrito.substring(0, 300) +
          (conteudoReescrito.length > 300 ? "..." : "");

        const noticiaData: NoticiaScrapedData = {
          titulo_original: titulo,
          titulo_reescrito: tituloReescrito,
          resumo_original: resumo,
          resumo_reescrito: resumoReescrito,
          conteudo_reescrito: conteudoReescrito,
          url_original: newsUrl,
          fonte: portalConfig.name,
          status: "processado",
          data_coleta: new Date().toISOString(),
          imagem_url: imagem || null,
          categoria: portalConfig.category,
        };

        const { error } = await supabaseAdmin
          .from("noticias_scraped")
          .insert(noticiaData);

        if (error) {
          console.error("Erro ao salvar:", error);
          errorCount++;
        } else {
          processedNews.push({
            titulo: tituloReescrito,
            fonte: portalConfig.name,
            url: newsUrl,
            imagem: imagem ? "Sim" : "Não",
          });
          successCount++;
          console.log(`✅ Notícia salva: ${titulo.substring(0, 50)}...`);
        }

        // respeita o portal (rate limit simples)
        await new Promise((r) => setTimeout(r, 1500));
      } catch (error) {
        console.error(`Erro ao processar ${newsUrl}:`, error);
        errorCount++;
      }
    }

    // RESPOSTA
    return new Response(
      JSON.stringify({
        success: true,
        message: `Processamento do ${portalConfig.name} concluído!`,
        stats: {
          total_encontradas: newsLinks.length,
          processadas_com_sucesso: successCount,
          erros: errorCount,
          portal: portalConfig.name,
        },
        noticias: processedNews,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("Erro geral:", error);
    return new Response(
      JSON.stringify({ error: `Erro interno: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
