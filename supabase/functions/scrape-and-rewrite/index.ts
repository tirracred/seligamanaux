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
  // slug gerado para custom URL (opcional)
  slug?: string;
  // caminho canônico baseado no slug (opcional)
  canonical_path?: string;
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

// (Configuração PORTAIS_CONFIG... mantida exatamente como no original)
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

// (Funções de filtro... mantidas exatamente como no original)
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

// (Funções de normalização... mantidas exatamente como no original)
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

// (Funções de fetch... mantidas exatamente como no original)
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
NOVO HELPER DE EXTRAÇÃO
========================= */

/**
 * Tenta extrair conteúdo ou atributo do HTML usando uma lista de seletores simples (baseado em Regex).
 * @param html HTML limpo (sanitizado)
 * @param selectors Lista de seletores (ex: "h1.title", ".content", "meta[property='og:image']")
 * @param getAttribute Se null, retorna innerHTML. Se string (ex: "src", "content"), retorna o valor desse atributo.
 * @returns O texto encontrado (innerHTML ou valor do atributo) ou null.
 */
function extractBySelectors(
  html: string,
  selectors: string[],
  getAttribute: string | null = null
): string | null {
  for (const selector of selectors) {
    let regex: RegExp;
    let match: RegExpExecArray | null;

    try {
      // 1. Seletor de Meta Tag: meta[property="og:image"]
      if (selector.startsWith("meta[")) {
        const metaMatch = selector.match(/\[property="([^"]+)"\]/);
        if (metaMatch?.[1] && getAttribute === "content") {
          regex = new RegExp(
            `<meta[^>]*property="${metaMatch[1]}"[^>]*content="([^"]+)"`,
            "i"
          );
          match = regex.exec(html);
          if (match?.[1]) return match[1];
        }
        continue;
      }

      // 2. Seletor de Imagem (com classe no container ou na própria tag)
      if (selector.includes("img") && getAttribute === "src") {
        // Caso A: Classe na própria tag <img (ex: "img.wp-post-image")
        if (selector.startsWith("img.")) {
          const className = selector.split(".")[1];
          regex = new RegExp(
            `<img[^>]*class="[^"]*${className}[^"]*"[^>]* (?:src|data-src)="([^"]+)"`,
            "i"
          );
          match = regex.exec(html);
          if (match?.[1]) return match[1];
        }
        // Caso B: Classe no container (ex: ".content-media__image img")
        else if (selector.startsWith(".") && selector.endsWith(" img")) {
          const className = selector.split(" ")[0].replace(".", "");
          // Regex para encontrar o container
          const containerRegex = new RegExp(
            `<[^>]+class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:div|figure|picture)>`,
            "i"
          );
          const containerMatch = containerRegex.exec(html);
          const searchHtml = containerMatch?.[1] || html; // Busca dentro do container ou no HTML todo (fallback)

          // Regex para encontrar a primeira imagem dentro do container
          regex = /(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i;
          match = regex.exec(searchHtml);
          if (match?.[1]) return match[1];
        }
        // Caso C: Seletor genérico de imagem (ex: "figure img")
        else if (selector.endsWith(" img")) {
          const tagName = selector.split(" ")[0];
          const containerRegex = new RegExp(
            `<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
            "i"
          );
          const containerMatch = containerRegex.exec(html);
          const searchHtml = containerMatch?.[1] || html;
          
          regex = /(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i;
          match = regex.exec(searchHtml);
          if (match?.[1]) return match[1];
        }
        continue;
      }

      // 3. Seletor de Tag com Classe (ex: "h1.content-head__title") ou só Classe (ex: ".entry-content")
      let tag = "div|article|section|h1|h2|h3|p|main"; // Tags comuns
      let className = "";

      if (selector.startsWith(".")) {
        className = selector.replace(".", "").split(" ")[0]; // Pega só a classe (ex: .entry-content)
      } else if (selector.includes(".")) {
        [tag, className] = selector.split(".", 2);
        className = className.split(" ")[0]; // Pega só a classe (ex: h1.title)
      } else {
        tag = selector.split(" ")[0]; // ex: "h1"
      }

      if (getAttribute) {
        // Não suporta extrair atributo deste tipo de seletor (ainda)
        continue;
      }

      // Regex para innerHTML
      if (className) {
        regex = new RegExp(
          `<(${tag})[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>`,
          "i"
        );
      } else {
        regex = new RegExp(`<(${tag})[^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
      }

      match = regex.exec(html);
      // Retorna o innerHTML (grupo 2)
      if (match?.[2]) return match[2].trim();
    } catch (e) {
      console.log(`[REGEX_ERROR] Seletor: ${selector}, Erro: ${e.message}`);
    }
  }
  return null; // Nenhum seletor correspondeu
}

/* =========================
EXTRAÇÃO DE LINKS / CONTEÚDO
========================= */

// (Funções extractNewsLinks, deduplicateLinks, buildPaginationUrls... mantidas como no original)
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
HELPERS DE REPARO/FORMATAÇÃO
========================= */

// (Funções normalizeAsciiQuotes, ensureParagraphsHTML, repairGroqJsonString, makeSlug... mantidas como no original)
// Normaliza aspas “inteligentes” para aspas ASCII
function normalizeAsciiQuotes(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

// Garante que o texto tenha parágrafos em HTML (<p>...</p>). Se já houver tags <p>, retorna o texto intacto.
function ensureParagraphsHTML(text: string): string {
  const hasHtmlP = /<p[\s>]/i.test(text) || /<\/p>/i.test(text);
  if (hasHtmlP) return text;
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
  const parts = (blocks.length ? blocks : text.split(/(?<=[.!?])\s{2,}/))
    .map(x => x.trim()).filter(Boolean);
  return parts.map(p => `<p>${p}</p>`).join("");
}

/**
 * Repara respostas quase JSON retornadas pela LLM:
 * - Extrai apenas o primeiro objeto {...} do texto.
 * - Normaliza aspas “ ” para ".
 * - Se o valor de "conteudo" não estiver entre aspas, envolve em aspas e escapa.
 * - Converte campos com aspas simples para aspas duplas (caso raro).
 */
function repairGroqJsonString(raw: string): string {
  if (!raw) return raw;
  let s = normalizeAsciiQuotes(raw).trim();
  // recorta o primeiro {...}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  try { JSON.parse(s); return s; } catch {}
  // Força aspas ao redor do valor de "conteudo" se não houver
  const rxUnquotedConteudo = /("conteudo"\s*:\s*)(?!")(.*)\s*}\s*$/s;
  if (rxUnquotedConteudo.test(s)) {
    s = s.replace(rxUnquotedConteudo, (_full: string, prefix: string, val: string) => {
      // Limpa espaços/linhas, escapa barras e aspas
      const cleaned = val.trim().replace(/\\|"/g, (m: string) => (m === '\\' ? '\\\\' : '\\"')).replace(/\n/g, "\\n");
      return `${prefix}\"${cleaned}\"}`;
    });
    try { JSON.parse(s); return s; } catch {}
  }
  // Troca aspas simples em chaves por aspas duplas (caso raro)
  const maybeJson5 = s.replace(/(['"])(titulo|conteudo)\1\s*:/g, '"$2":');
  try { JSON.parse(maybeJson5); return maybeJson5; } catch {}
  return s;
}

// Gera um slug a partir do título (remove acentos, espaços e caracteres inválidos)
function makeSlug(title: string): string {
  const base = title.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base}-${Date.now().toString(36)}`;
}

/* =========================
REESCRITA VIA GROQ
========================= */

// (Função rewriteWithGroq... mantida exatamente como no original)
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

  // ✅ Sanitizar entrada
  const cleanTitle = (title || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .trim()
    .slice(0, 300);

  const cleanContent = (content || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .trim()
    .slice(0, 5000);

  const prompt = `Reescreva o seguinte título e conteúdo em português, garantindo:
1. Texto original (sem cópia acima de 80%)
2. Nenhuma sequência de 12+ palavras idênticas
3. Formatação em parágrafos (pode usar <p>...</p>)
4. Entre 2000 e 5000 caracteres
5. Tom jornalístico profissional 
6. Atue como o "Se Liga Manaus": um jornal com identidade única, focado em máximo impacto, que explora tragédias e usa IMPACTOS inteligentes. 
Mantenha um tom de alerta, incisivo e direto, focado 100% em Manaus. Use português padrão culto, sem gírias ou regionalismos, para chocar e informar o leitor.

TÍTULO: ${cleanTitle}

CONTEÚDO: ${cleanContent}

Responda APENAS em JSON:
{"titulo": "novo título", "conteudo": "novo conteúdo"}`;

  try {
    console.log(`[GROQ_DEBUG] Retry: ${retryCount} | Temp: ${temperature}`);

    // ✅ EXATAMENTE COMO FUNCIONOU NO CURL:
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              'Responda ESTRITAMENTE com um único objeto JSON válido UTF-8, sem markdown, sem blocos de código, sem rótulos. ' +
              'Formato exato: {"titulo":"...","conteudo":"..."}. ' +
              'O "conteudo" deve ter entre 2000 e 5000 caracteres e estar em parágrafos (pode usar <p>...</p>). ' +
              'Não inclua nada além do objeto JSON.'
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: Math.max(0.2, temperature ?? 0.5),
        max_tokens: 3000,
      }),
    });

    console.log(`[GROQ_RESPONSE] Status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[GROQ_ERROR] HTTP ${response.status} | ${errorText.slice(0, 200)}`);

      // Detectar erro de autenticação
      if (response.status === 401) {
        console.log(`[GROQ_FATAL] 401 - API Key inválida!`);
        return null;
      }

      // Detectar modelo não encontrado
      if (response.status === 404) {
        console.log(`[GROQ_FATAL] 404 - Modelo não encontrado!`);
        return null;
      }

      // Retry para outros erros
      if (retryCount < 2) {
        console.log(`[GROQ_RETRY] Tentativa ${retryCount + 1}/3...`);
        await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
        return rewriteWithGroq(title, content, apiKey, retryCount + 1);
      }
      return null;
    }

    const data = await response.json();
    const textContent = data.choices?.[0]?.message?.content || "";

    if (!textContent) {
      console.log(`[GROQ_EMPTY] Resposta vazia, retry...`);
      if (retryCount < 2) {

        return rewriteWithGroq(title, content, apiKey, retryCount + 1);
      }
      return null;
    }

    console.log(`[GROQ_RAW] Resposta recebida: ${textContent.slice(0, 100)}...`);

    // Parsear JSON de forma robusta: tenta JSON.parse; se falhar, tenta reparar
    let parsed: { titulo?: string; conteudo?: string } | null = null;
    try {
      parsed = JSON.parse(textContent);
    } catch {
      const repaired = repairGroqJsonString(textContent);
      try {
        parsed = JSON.parse(repaired);
      } catch (e) {
        console.log(`[GROQ_JSON_ERROR] Não é JSON válido: ${textContent.slice(0, 120)}`);
        if (retryCount < 2) {
          return rewriteWithGroq(title, content, apiKey, retryCount + 1);
        }
        return null;
      }
    }

    const novoTitulo = (parsed?.titulo || "").trim();
    let novoConteudo = (parsed?.conteudo || "").trim();
    // garante que o conteúdo tenha parágrafos HTML (<p>...</p>)
    novoConteudo = ensureParagraphsHTML(novoConteudo);

    console.log(
      `[REWRITE_OK] Título: ${novoTitulo.slice(0, 40)}... | Len: ${novoConteudo.length}`
    );

    // ✅ VALIDAÇÃO ANTI-CÓPIA
    if (
      novoConteudo.length < 1800 ||
      tooSimilar(content, novoConteudo) ||
      has12ConsecutiveMatches(content, novoConteudo)
    ) {
      console.log(`[REWRITE_REJECTED] Similar ou curto (${novoConteudo.length} chars), retry...`);
      if (retryCount < 2) {
        return rewriteWithGroq(title, content, apiKey, retryCount + 1);
      }
      return null;
    }

    return { titulo: novoTitulo, conteudo: novoConteudo };

  } catch (err) {
    console.log(`[GROQ_EXCEPTION] ${err}`);
    if (retryCount < 2) {
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
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

        // ======================================================
        // INÍCIO DA LÓGICA DE EXTRAÇÃO CORRIGIDA
        // ======================================================

        // 1. Extrair título usando seletores
        const titleHtml = extractBySelectors(
          cleanHtml,
          portalConfig.titleSelectors,
          null
        );
        let originalTitle = (titleHtml || "Sem título")
          .replace(/<[^>]+>/g, "") // Limpa HTML interno (ex: <span>)
          .trim();

        // Fallback se seletores falharem
        if (originalTitle === "Sem título") {
          const titleMatch = cleanHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          originalTitle = (titleMatch?.[1] || "Sem título")
            .replace(/<[^>]+>/g, "")
            .trim();
        }

        if (isBlacklistedTitle(originalTitle)) {
          console.log(`[SKIP] Título na blacklist: ${originalTitle}`);
          continue;
        }

        // 2. Extrair conteúdo usando seletores
        let originalContentHtml = extractBySelectors(
          cleanHtml,
          portalConfig.contentSelectors,
          null
        );

        // Fallback se seletores falharem
        if (!originalContentHtml || originalContentHtml.length < 500) {
          const contentMatch = cleanHtml.match(
            /<article[^>]*>([\s\S]*?)<\/article>/is
          );
          originalContentHtml = contentMatch?.[1] || cleanHtml;
        }

        // Limpar o HTML para obter texto plano
        let originalContent = (originalContentHtml || "")
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
        
        // 3. Extrair imagem usando seletores
        let imagemUrl =
          extractBySelectors(cleanHtml, portalConfig.imageSelectors, "src") ||
          extractBySelectors(cleanHtml, portalConfig.imageSelectors, "content"); // para meta tags

        // Fallback se seletores falharem
        if (!imagemUrl) {
          const imgMatch = cleanHtml.match(
            /(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i
          );
          imagemUrl = imgMatch?.[1] || null;
        }

        // ======================================================
        // FIM DA LÓGICA DE EXTRAÇÃO CORRIGIDA
        // ======================================================

        // Higienizar
        originalContent = stripSourceArtifacts(originalContent);
        if (
          looksPromotional(originalContent) ||
          looksPromotional(originalTitle)
        ) {
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

        // Gerar slug e caminho canônico para URL customizada
        const slug = makeSlug(rewritten.titulo);
        const canonicalPath = `/artigo/${slug}`;

        // Montar registro com status "pendente" e slug
        const newRecord: NoticiaScrapedData = {
          titulo_original: originalTitle.slice(0, 255),
          titulo_reescrito: rewritten.titulo.slice(0, 255),
          resumo_original: originalContent.slice(0, 500),
          // resumo em texto plano (remove tags HTML) para evitar cortar tags
          resumo_reescrito: rewritten.conteudo
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500),
          conteudo_reescrito: rewritten.conteudo,
          url_original: newsUrl,
          fonte: portalConfig.name,
          status: "pendente",
          data_coleta: new Date().toISOString(),
          imagem_url: imagemUrl,
          categoria: portalConfig.category,
          slug,
          canonical_path: canonicalPath,
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