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
  slug?: string;
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
CONFIGURAÇÃO DE PORTAIS (FOCO EM NOTÍCIA)
========================= */

// Ajustado para focar nas editorias corretas (polícia, cidades)
const PORTAIS_CONFIG: Record<string, PortalConfig> = {
  "g1.globo.com": {
    name: "G1 Amazonas",
    baseUrl: "https://g1.globo.com/am/amazonas/",
    linkSelectors: [
      'a[href*="/am/amazonas/noticia/"]', // Foco principal
      '.feed-post-link[href*="/noticia/"]', // Links de feed
      'a[href*="/am/amazonas/cidade/"]', // Foco em cidades
      'a[href*="/am/amazonas/policia/"]', // Foco em polícia
    ],
    titleSelectors: [
      "h1.content-head__title", // Seletor específico G1
      "h1.gui-color-primary",
      "h1", // Fallback genérico
    ],
    contentSelectors: [
      ".content-text__container", // Seletor específico G1
      ".mc-article-body",
      ".post__content",
      "article", // Fallback genérico
    ],
    imageSelectors: [
      // De-prioritizado 'og:image' para evitar logos
      ".content-media__image img", // Seletor específico G1
      ".progressive-img img",
      "article img", // Imagem dentro do artigo
      'meta[property="og:image"]', // Último recurso
    ],
    category: "Amazonas",
  },

  "portaldoholanda.com.br": {
    name: "Portal do Holanda",
    baseUrl: "https://portaldoholanda.com.br/amazonas",
    linkSelectors: [
      'a[href*="/noticia/"]',
      'a[href*="/noticias/"]',
      'a[href*="/amazonas/"]',
      'a[href*="/policia/"]', // Foco em polícia
      'a[href*="/cidades/"]', // Foco em cidades
      'a[href*="/manaus/"]',
    ],
    titleSelectors: ["h1.entry-title", "h1.post-title", "h1"],
    contentSelectors: [".entry-content", ".post-content", "article"],
    imageSelectors: [
      ".featured-image img", // Imagem de destaque
      "article img", // Imagem no artigo
      'meta[property="og:image"]', // Recurso
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
      'a[href*="/policia/"]',
    ],
    titleSelectors: ["h1.post-title", "h1.entry-title", "h1"],
    contentSelectors: [".post-content", ".entry-content", "article"],
    imageSelectors: [
      ".featured-image img",
      "article img",
      'meta[property="og:image"]',
    ],
    category: "Amazonas",
  },

  "portalamazonia.com": {
    name: "Portal Amazônia",
    baseUrl: "https://portalamazonia.com/noticias/amazonas",
    linkSelectors: [
      'a[href^="/noticias/amazonas/"]',
      'a[href*="/noticias/cidades/"]',
      'a[href*="/noticias/policia/"]',
      'a[href*="/noticias/"]',
    ],
    titleSelectors: ["h1.entry-title", "h1.post-title", "h1"],
    contentSelectors: [".entry-content", ".post-content", "article"],
    imageSelectors: [
      ".featured-image img",
      "article img",
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
      'a[href*="/cidades/"]',
      'a[href*="/policia/"]',
    ],
    titleSelectors: ["h1.entry-title", "h1.post-title", "h1"],
    contentSelectors: [".entry-content", ".post-content", "article"],
    imageSelectors: [
      ".post-thumbnail img",
      "article img",
      'meta[property="og:image"]',
    ],
    category: "Amazonas",
  },
};


/* =========================
FILTROS ANTI-PROMO/INSTITUCIONAL
========================= */

// Blacklists atualizadas para remover o lixo do G1
const URL_BLACKLIST = [
  "/sobre", "/institucional", "/anuncie", "/publicidade", "/assine",
  "/assinante", "/trabalhe-", "/faq", "/politica-de-privacidade",
  "/termos", "/contato", "/equipe", "/comercial", "/videos/", "/podcast/",
  "/ao-vivo/", "/classificados/", "/redacao", "/nossa-equipe", "/quem-somos",
  "/menu", "/globonews", "/programacao", "/pme/", "/globo-reporter/",
  "/agronegocios/", "/bem-estar/", "/saude/coronavirus/", "/globo-rural/"
];

const TITLE_BLACKLIST = [
  "menu", "nossa equipe", "equipe", "redação",
  "siga a globonews nas redes sociais",
  "conheça a história do globo repórter", // Exatamente o seu problema
  "programação", "assista", "pequenas empresas", "agronegócios",
  "globo rural", "bem estar"
];

function isBlacklistedUrl(u: string): boolean {
  const x = (u || "").toLowerCase();
  return URL_BLACKLIST.some((b) => x.includes(b));
}

function isBlacklistedTitle(t: string): boolean {
  const x = (t || "").toLowerCase().trim();
  return x.length < 8 || TITLE_BLACKLIST.some((b) => x.includes(b));
}

function looksPromotional(text: string): boolean {
  const x = (text || "").toLowerCase();
  return /publieditorial|publicidade|assessoria de imprensa|assine|clique aqui|programação|assista ao|patrocinado|publipost|oferecimento|oferecido por|parceria/i.test(
    x
  );
}

// Regex para identificar URLs que são *provavelmente* artigos de notícia
const ARTICLE_REGEX =
  /\/noticia(s)?\/|\/artigo(s)?\/|\/post(s)?\/|\/policia\/|\/cidades\/|\/manaus\/|\/amazonas\/|\/politica\/|\/economia\/|\/esportes\/|\/\d{4}\/\d{2}\/\d{2}\//i;

// ✅ FUNÇÃO para detectar heurística de notícia
function looksNewsish(url: string): boolean {
  const lower = url.toLowerCase();
  // Um link de notícia DEVE bater a regex de artigo E NÃO PODE estar na blacklist
  return ARTICLE_REGEX.test(lower) && !isBlacklistedUrl(lower);
}


/* =========================
NORMALIZAÇÃO / HIGIENE DE TEXTO
(Mantido do seu original)
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
  return inter / min > 0.8;
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
UTILITÁRIOS DE FETCH
(Mantido do seu original)
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
      const r = await fetch(cand, { headers: common, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.text();
    } catch {}
  }
  const r = await fetch(url, { headers: common, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
  return await r.text();
}

async function fetchListHtml(url: string): Promise<string> {
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  return await fetchHtmlPreferAmp(url, ua);
}

/* =========================
✅ SANITIZE HTML (CORRIGIDO)
========================= */
function sanitizeHtml(html: string): string {
  return (html || "")
    .replace(/<script[^>]*>.*?<\/script>/gis, "")
    .replace(/<style[^>]*>.*?<\/style>/gis, "")
    .replace(/<nav[^>]*>.*?<\/nav>/gis, "")
    // .replace(/<header[^>]*>.*?<\/header>/gis, "") // ✅ REMOVIDO - ESTA LINHA ESTAVA QUEBRANDO O G1
    .replace(/<footer[^>]*>.*?<\/footer>/gis, "")
    .replace(/<aside[^>]*>.*?<\/aside>/gis, "")
    .replace(/<form[^>]*>.*?<\/form>/gis, "")
    .replace(/<iframe[^>]*>.*?<\/iframe>/gis, "")
    .replace(/<button[^>]*>.*?<\/button>/gis, "")
    .replace(/<svg[^>]*>.*?<\/svg>/gis, "")
    .replace(/<noscript[^>]*>.*?<\/noscript>/gis, "");
}


/* =========================
✅ NOVA FUNÇÃO DE EXTRAÇÃO (Helper)
========================= */

/**
 * Tenta extrair conteúdo (texto ou atributo) do HTML usando uma lista de seletores (baseado em Regex).
 */
function extractContent(
  html: string,
  selectors: string[],
  getAttribute: string | null = null
): string | null {
  for (const selector of selectors) {
    try {
      let regex: RegExp;
      let match: RegExpExecArray | null;

      // Caso 1: Meta Tag (ex: 'meta[property="og:image"]')
      if (selector.startsWith("meta[")) {
        const propMatch = selector.match(/\[property="([^"]+)"\]/);
        if (propMatch?.[1]) {
          const attr = getAttribute || "content";
          regex = new RegExp(
            `<meta[^>]*property="${propMatch[1]}"[^>]*${attr}="([^"]+)"`, "i"
          );
          match = regex.exec(html);
          if (match?.[1]) return match[1];
        }
      }
      // Caso 2: Seletor de Imagem (ex: '.content-media__image img')
      else if (selector.includes(" img") && getAttribute === "src") {
        let searchHtml = html;
        const parts = selector.split(" ");
        const containerSelector = parts[0];

        if (containerSelector.startsWith(".")) {
          const className = containerSelector.replace(".", "");
          const containerRegex = new RegExp(
            `<[^>]+class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:div|figure|picture)>`, "i"
          );
          const containerMatch = containerRegex.exec(html);
          if (containerMatch?.[1]) searchHtml = containerMatch[1];
        } else if (parts.length > 1) { // ex: 'figure img'
            const tagName = containerSelector;
            const containerRegex = new RegExp(
            `<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"
           );
           const containerMatch = containerRegex.exec(html);
           if (containerMatch?.[1]) searchHtml = containerMatch[1];
        }
        
        regex = /(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i;
        match = regex.exec(searchHtml);
        if (match?.[1]) return match[1];
      }
      // Caso 3: Seletor de Texto (ex: 'h1.content-head__title' ou '.entry-content')
      else if (!getAttribute) {
        let tag = "div|article|section|h1|h2|h3|p|main";
        let className = "";

        if (selector.startsWith(".")) {
          className = selector.replace(".", "").split(" ")[0];
        } else if (selector.includes(".")) {
          [tag, className] = selector.split(".", 2);
          className = className.split(" ")[0];
        } else {
          tag = selector.split(" ")[0];
        }

        if (className) {
          regex = new RegExp(
            `<(${tag})[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>`, "i"
          );
        } else {
          regex = new RegExp(`<(${tag})[^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
        }
        match = regex.exec(html);
        if (match?.[2]) return match[2].trim(); // Retorna o innerHTML
      }
    } catch (e) {
      console.log(`[REGEX_ERROR] Seletor: ${selector}, Erro: ${e.message}`);
    }
  }
  return null;
}

/* =========================
✅ EXTRAÇÃO DE LINKS (CORRIGIDA)
========================= */

// Esta função substitui a sua original, pois ela era a fonte do "lixo" (Globo Repórter, etc)
function extractNewsLinks(
  htmlContent: string,
  portalConfig: PortalConfig,
  sourceUrl: string
): string[] {
  if (!htmlContent || htmlContent.length === 0) {
    console.log(`[DEBUG] HTML vazio para ${sourceUrl}`);
    return [];
  }

  const allLinks: string[] = [];
  // Regex para achar *apenas* tags <a>
  const linkBlockRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  const hrefRegex = /href=["']([^"']+)["']/i;
  let match;

  while ((match = linkBlockRegex.exec(htmlContent)) !== null) {
    const linkTag = match[0]; // O <a>...</a> completo

    // Verifica se o <a> corresponde a algum seletor de link
    const matchesSelector = portalConfig.linkSelectors.some(selector => {
      try {
        if (selector.startsWith(".")) { // ex: .feed-post-link
          const className = selector.replace(".", "");
          return new RegExp(`class="[^"]*${className}[^"]*"`).test(linkTag);
        }
        if (selector.startsWith("a[href*=")) { // ex: a[href*="/noticia/"]
          const hrefPart = selector.match(/\[href\*="([^"]+)"\]/)?.[1];
          return hrefPart ? linkTag.includes(hrefPart) : false;
        }
         if (selector.startsWith("a[href^=")) { // ex: a[href^="/noticias/amazonas/"]
          const hrefPart = selector.match(/\[href\^="([^"]+)"\]/)?.[1];
          const hrefMatch = linkTag.match(hrefRegex);
          return hrefPart && hrefMatch?.[1] ? hrefMatch[1].startsWith(hrefPart) : false;
        }
      } catch {}
      return false;
    });

    // Se o linkTag bateu com um seletor, extrai o href dele
    if (matchesSelector) {
        const hrefMatch = linkTag.match(hrefRegex);
        if(hrefMatch?.[1]) { // Pega o grupo 1 (a URL)
           allLinks.push(hrefMatch[1]);
        }
    }
  }

  console.log(
    `[EXTRACT] Portal: ${portalConfig.name} | Links brutos (pós-seletor): ${allLinks.length}`
  );

  // Normalizar e filtrar URLs
  const newsLinks: string[] = [];
  for (const href of allLinks) {
    try {
      const fullUrl = new URL(href, sourceUrl).toString();
      // Filtro final: deve parecer notícia E não estar na blacklist
      if (
        looksNewsish(fullUrl) && // (Usa a regex de artigo E a blacklist de URL)
        !newsLinks.includes(fullUrl)
      ) {
        newsLinks.push(fullUrl);
      }
    } catch {}
  }

  console.log(
    `[EXTRACT_FILTERED] ${portalConfig.name}: ${newsLinks.length} links após filtro final`
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
  const maxPages = 4; // Limite de paginação

  if (portalName === "Portal do Holanda") {
    for (let p = 2; p <= maxPages; p++) {
      urls.push(`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}paged=${p}`);
    }
  } else if (portalName === "Portal Amazônia") {
    for (let p = 2; p <= maxPages; p++) {
      urls.push(baseUrl.replace(/\/$/, "") + `/page/${p}/`);
    }
  } else if (portalName === "A Crítica") {
    for (let p = 2; p <= maxPages; p++) {
      urls.push(`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}pag=${p}`);
    }
  } else if (portalName === "D24AM") {
    for (let p = 2; p <= maxPages; p++) {
      urls.push(baseUrl.replace(/\/$/, "") + `?page=${p}`);
    }
  }

  return urls;
}

/* =========================
HELPERS DE REPARO/FORMATAÇÃO
(Mantido do seu original)
========================= */

function normalizeAsciiQuotes(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function ensureParagraphsHTML(text: string): string {
  const hasHtmlP = /<p[\s>]/i.test(text) || /<\/p>/i.test(text);
  if (hasHtmlP) return text;
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
  const parts = (blocks.length ? blocks : text.split(/(?<=[.!?])\s{2,}/))
    .map(x => x.trim()).filter(Boolean);
  return parts.map(p => `<p>${p}</p>`).join("");
}

function repairGroqJsonString(raw: string): string {
  if (!raw) return raw;
  let s = normalizeAsciiQuotes(raw).trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  try { JSON.parse(s); return s; } catch {}
  const rxUnquotedConteudo = /("conteudo"\s*:\s*)(?!")(.*)\s*}\s*$/s;
  if (rxUnquotedConteudo.test(s)) {
    s = s.replace(rxUnquotedConteudo, (_full: string, prefix: string, val: string) => {
      const cleaned = val.trim().replace(/\\|"/g, (m: string) => (m === '\\' ? '\\\\' : '\\"')).replace(/\n/g, "\\n");
      return `${prefix}\"${cleaned}\"}`;
    });
    try { JSON.parse(s); return s; } catch {}
  }
  const maybeJson5 = s.replace(/(['"])(titulo|conteudo)\1\s*:/g, '"$2":');
  try { JSON.parse(maybeJson5); return maybeJson5; } catch {}
  return s;
}

function makeSlug(title: string): string {
  const base = title.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base}-${Date.now().toString(36)}`;
}

/* =========================
REESCRITA VIA GROQ (PROMPT AJUSTADO)
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

  const cleanTitle = (title || "")
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/\n/g, "\\n").replace(/\r/g, "\\r")
    .trim().slice(0, 300);

  const cleanContent = (content || "")
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/\n/g, "\\n").replace(/\r/g, "\\r")
    .trim().slice(0, 5000); // Manter 5k de contexto

  // ✅ PROMPT AJUSTADO
  const prompt = `Reescreva o seguinte título e conteúdo em português, garantindo:
1. FOCO: O texto deve ser um fato noticioso sobre Manaus. Priorize eventos factuais, segurança pública, polícia, fatalidades, e impactos diretos na cidade. Evite artigos institucionais ou de desenvolvimento.
2. ORIGINALIDADE: Texto original (sem cópia acima de 80%) e nenhuma sequência de 12+ palavras idênticas.
3. FORMATO: Em parágrafos HTML (use <p>...</p>).
4. TAMANHO: O conteúdo reescrito deve ter entre 2000 e 4000 caracteres.
5. TOM: Atue como o "Se Liga Manaus": um jornal com identidade única, focado em máximo impacto. Mantenha um tom de alerta, incisivo e direto. Use português padrão culto.

TÍTULO: ${cleanTitle}

CONTEÚDO: ${cleanContent}

Responda APENAS em JSON:
{"titulo": "novo título", "conteudo": "novo conteúdo"}`;

  try {
    console.log(`[GROQ_DEBUG] Retry: ${retryCount} | Temp: ${temperature}`);

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
              'Responda ESTRITAMENTE com um único objeto JSON válido UTF-8, sem markdown. ' +
              'Formato exato: {"titulo":"...","conteudo":"..."}. ' +
              'O "conteudo" deve ter entre 2000 e 4000 caracteres e usar tags <p>. ' +
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
      if (response.status === 401) return null;
      if (response.status === 404) return null;
      if (retryCount < 2) {
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
    novoConteudo = ensureParagraphsHTML(novoConteudo);

    console.log(
      `[REWRITE_OK] Título: ${novoTitulo.slice(0, 40)}... | Len: ${novoConteudo.length}`
    );

    // ✅ VALIDAÇÃO ANTI-CÓPIA (AJUSTADA)
    if (
      novoConteudo.length < 1900 || // Ajustado
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

    // ✅ LÓGICA DE CUSTOM URL CORRIGIDA
    const isArticle = looksNewsish(url);

    let newsLinks: string[] = [];

    if (isArticle) {
      // Processar artigo único (Custom URL)
      newsLinks = [url];
      console.log(`[MODE] Artigo único detectado (Custom URL): ${url}`);
    } else {
      // Processar lista (Botões do Admin)
      console.log(`[MODE] Lista de portal detectada: ${url}`);
      let htmlContent = await fetchListHtml(url);
      console.log(`[FETCH] ${portalConfig.name}: ${htmlContent.length} bytes`);

      // Fallback para A Crítica (Mantido)
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
            if (htmlContent.length > 15000) break;
          } catch {}
        }
      }

      // ✅ USA A FUNÇÃO DE EXTRAÇÃO DE LINKS CORRIGIDA
      newsLinks = extractNewsLinks(htmlContent, portalConfig, url);

      // Paginação (Mantido)
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
            if (newsLinks.length >= 8) break;
          } catch (err) {
            console.log(`[PAGINATION_ERROR] ${pagUrl}: ${err}`);
          }
        }
      }
    }

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
        
        // ✅ BUG FIX: O sanitizeHtml CORRIGIDO ESTÁ SENDO CHAMADO AQUI
        const cleanHtml = sanitizeHtml(htmlContent);

        // ======================================================
        // ✅ LÓGICA DE EXTRAÇÃO HÍBRIDA (SELETOR + FALLBACK)
        // ======================================================

        // 1. Extrair título
        // Tenta com seletores primeiro
        let originalTitle = extractContent(
          cleanHtml,
          portalConfig.titleSelectors,
          null // Pega innerHTML
        );
        
        // Fallback para o regex genérico do SEU CÓDIGO ORIGINAL
        if (!originalTitle) {
          const titleMatch = cleanHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); // Procura <h1> em cleanHtml
          originalTitle = titleMatch?.[1] || "Sem título";
        }
        originalTitle = originalTitle.replace(/<[^>]+>/g, "").trim();


        if (isBlacklistedTitle(originalTitle) || originalTitle === "Sem título") {
          console.log(`[SKIP] Título na blacklist ou sem título: ${originalTitle}`);
          continue;
        }

        // 2. Extrair conteúdo
        // Tenta com seletores primeiro
        let originalContentHtml = extractContent(
          cleanHtml,
          portalConfig.contentSelectors,
          null // Pega innerHTML
        );

        // Fallback para o regex genérico do SEU CÓDIGO ORIGINAL
        if (!originalContentHtml) {
            const contentMatch = cleanHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/is);
            originalContentHtml = contentMatch?.[1] || cleanHtml;
        }
        
        // Se ainda assim for nulo (página vazia), pula
        if (!originalContentHtml) {
            console.log(`[SKIP] Não foi possível extrair conteúdo.`);
            continue;
        }

        let originalContent = originalContentHtml
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

        // 3. Extrair imagem (Prioridade 1: Seletores de artigo)
        const articleImageSelectors = portalConfig.imageSelectors.filter(s => !s.startsWith("meta["));
        let imagemUrl = extractContent(cleanHtml, articleImageSelectors, "src");

        // Prioridade 2: Regex genérico do SEU CÓDIGO ORIGINAL (evita logos)
        if (!imagemUrl) {
          // Busca a *primeira* imagem que parece notícia
          const imgMatch = cleanHtml.match(
            /(?:src|data-src)=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i
          );
          imagemUrl = imgMatch?.[1] || null;
        }
        
        // Prioridade 3: Fallback para 'og:image' (último caso, pode ser logo)
        if (!imagemUrl) {
           imagemUrl = extractContent(cleanHtml, ['meta[property="og:image"]'], "content");
        }
        // ======================================================


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

        const slug = makeSlug(rewritten.titulo);
        const canonicalPath = `/artigo/${slug}`;

        // Montar registro
        const newRecord: NoticiaScrapedData = {
          titulo_original: originalTitle.slice(0, 255),
          titulo_reescrito: rewritten.titulo.slice(0, 255),
          resumo_original: originalContent.slice(0, 500),
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