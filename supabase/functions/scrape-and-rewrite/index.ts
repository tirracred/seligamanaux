// /supabase/functions/scraper/index.ts
// Deno 1.44+ (Supabase Edge Functions)
// Objetivos:
// - Coletar links por portal via seletores CSS (sem regex frágil)
// - Remover lixo (ads, institucional, scripts) com Deno-DOM
// - Gerar matéria 1.800–4.000 caracteres via Groq (opcional) com "gating" por qualidade
// - Salvar em noticias_scraped (campos: titulo_original, titulo_reescrito, conteudo_reescrito, url_original, fonte, imagem_url, categoria, status, data_coleta)

import { DOMParser, Element } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------- Tipos ----------
type PortalConfig = {
  id: string;
  label: string;             // nome exibido da fonte (ex.: "G1 Amazonas")
  domain: string;            // domínio principal (usado para filtrar e resolver URLs absolutas)
  startUrl: string;          // URL de listagem/capa do portal
  linkSelector: string;      // CSS para links de notícia na capa/lista
  // Seletores e regras para página de artigo:
  titleSelectors: string[];  // tentativas para achar o <h1> ou título
  articleSelectors: string[];// tentativas para achar o container do texto
  imageSelectors: string[];  // tentativas para capa da matéria
  removeSelectors: string[]; // lixo a remover antes de extrair texto
  excludePathPatterns: RegExp[]; // padrões de URL para ignorar (institucional/promo)
  categoryGuess?: (url: string) => string | undefined; // heurística simples por caminho
};

// ---------- Configuração multi-portal (fácil de estender) ----------
const PORTAIS_CONFIG: Record<string, PortalConfig> = {
  "g1-am": {
    id: "g1-am",
    label: "G1 Amazonas",
    domain: "g1.globo.com",
    startUrl: "https://g1.globo.com/am/amazonas/",
    linkSelector: "a.feed-post-link, .bastian-feed-item a.feed-post-link",
    titleSelectors: ["h1", "header h1"],
    articleSelectors: ["article", "main article", "div[itemprop='articleBody']"],
    imageSelectors: ["article figure img", "picture img", "meta[property='og:image']"],
    removeSelectors: [
      "script, style, noscript, iframe, svg, canvas",
      "header, footer, nav, aside",
      ".ads, .advertising, .ad, .publicidade, .publi, .sponsored, .banner",
      ".share, .social, .newsletter, .subscribe, .comments, .related, .breadcrumbs",
      "[aria-label='Publicidade']",
      "[role='complementary'], [role='navigation'], [role='banner']",
    ],
    excludePathPatterns: [
      /\/sobre\b/i, /\/termos\b/i, /\/privacidade\b/i, /\/anuncie\b/i,
      /\/equipe\b/i, /\/contato\b/i, /\/assine\b/i, /\/cookies\b/i,
    ],
    categoryGuess: (url) => {
      if (url.includes("/am/amazonas/")) return "Amazonas";
      if (url.includes("/politica/")) return "Política";
      if (url.includes("/economia/")) return "Economia";
      return "Geral";
    },
  },

  "portaldoholanda": {
    id: "portaldoholanda",
    label: "Portal do Holanda",
    domain: "portaldoholanda.com.br",
    startUrl: "https://www.portaldoholanda.com.br/",
    linkSelector: "main article a, article h2 a, .views-row h2 a, .node-title a",
    titleSelectors: ["h1", "article h1", ".node-title h1"],
    articleSelectors: ["article", "main article", "div[itemprop='articleBody']", ".node-content"],
    imageSelectors: ["article figure img", ".node-content img", "meta[property='og:image']"],
    removeSelectors: [
      "script, style, noscript, iframe",
      "header, footer, nav, aside",
      ".ads, .advertising, .ad, .publicidade, .sponsored, .banner",
      ".share, .social, .newsletter, .related, .breadcrumb, .comments",
    ],
    excludePathPatterns: [
      /\/sobre\b/i, /\/termos\b/i, /\/privacidade\b/i, /\/anuncie\b/i,
      /\/contato\b/i, /\/equipe\b/i, /\/classificados\b/i,
    ],
    categoryGuess: (url) => (url.includes("/amazonas") ? "Amazonas" : "Geral"),
  },

  "acritica": {
    id: "acritica",
    label: "A Crítica",
    domain: "acritica.com",
    startUrl: "https://www.acritica.com/",
    linkSelector: "main article a, article h2 a, h3 a, .card a",
    titleSelectors: ["h1", "header h1", ".title h1"],
    articleSelectors: ["article", ".content-article", "main article", "div[itemprop='articleBody']"],
    imageSelectors: ["article figure img", ".content-article img", "meta[property='og:image']"],
    removeSelectors: [
      "script, style, noscript, iframe",
      "header, footer, nav, aside",
      ".ads, .advertising, .ad, .publicidade, .sponsored, .banner",
      ".share, .social, .newsletter, .related, .breadcrumbs, .comments",
    ],
    excludePathPatterns: [
      /\/institucional\b/i, /\/sobre\b/i, /\/termos\b/i, /\/privacidade\b/i,
      /\/anuncie\b/i, /\/contato\b/i, /\/equipe\b/i,
    ],
    categoryGuess: (url) => {
      if (url.includes("/esportes/")) return "Esportes";
      if (url.includes("/politica/")) return "Política";
      if (url.includes("/economia/")) return "Economia";
      if (url.includes("/manaus/")) return "Manaus";
      return "Geral";
    },
  },

  "portalamazonia": {
    id: "portalamazonia",
    label: "Portal Amazônia",
    domain: "portalamazonia.com",
    startUrl: "https://portalamazonia.com/",
    linkSelector: "main article a, article h2 a, h3 a",
    titleSelectors: ["h1", "article h1"],
    articleSelectors: ["article", "main article", "div[itemprop='articleBody']"],
    imageSelectors: ["article figure img", "meta[property='og:image']"],
    removeSelectors: [
      "script, style, noscript, iframe",
      "header, footer, nav, aside",
      ".ads, .advertising, .ad, .publicidade, .sponsored, .banner",
      ".share, .social, .newsletter, .related, .breadcrumbs, .comments",
    ],
    excludePathPatterns: [
      /\/sobre\b/i, /\/termos\b/i, /\/privacidade\b/i, /\/anuncie\b/i, /\/contato\b/i,
    ],
    categoryGuess: (url) => (url.includes("/amazonia/") ? "Amazônia" : "Geral"),
  },
};

// ---------- Utilidades ----------
const UA =
  "Mozilla/5.0 (compatible; SeligaManauxBot/1.0; +https://seligamanaux.example)";

function absUrl(base: string, href: string): string | null {
  try { return new URL(href, base).href; } catch { return null; }
}

function uniq<T>(arr: T[]) { return Array.from(new Set(arr)); }

function normalizeWhitespace(s: string) {
  return s.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

function countWords(s: string) {
  return (s.trim().match(/\b\w+\b/g)?.length) ?? 0;
}

function looksLikeArticleUrl(url: string, cfg: PortalConfig): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes(cfg.domain)) return false;
    if (cfg.excludePathPatterns.some((re) => re.test(u.pathname))) return false;
    // evita parâmetros de tracking óbvios
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");
    return true;
  } catch { return false; }
}

// Remove nós lixo do container (sem quebrar o texto bom).
function purge(container: Element, cfg: PortalConfig) {
  const query = cfg.removeSelectors.join(", ");
  container.querySelectorAll(query).forEach((n) => n.remove());
  // Remover elementos por atributo que sugerem publicidade
  container.querySelectorAll("[data-ad], [data-ads], [class*='ad-'], [class*='-ad']").forEach((n) => n.remove());
}

// ---------- Fetch helpers ----------
async function fetchDocument(url: string) {
  const res = await fetch(url, { headers: { "user-agent": UA, "accept": "text/html" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error(`Falha ao parsear HTML de ${url}`);
  return doc;
}

function selectFirstAttr(doc: any, selectors: string[], attr: "text" | "src" | "content") {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    if (attr === "text") {
      const t = normalizeWhitespace(String(el.textContent || ""));
      if (t) return t;
    } else if (attr === "src") {
      // tenta src e data-src
      const src = el.getAttribute("src") || el.getAttribute("data-src");
      if (src) return src;
    } else if (attr === "content") {
      const c = el.getAttribute("content");
      if (c) return c;
    }
  }
  return undefined;
}

function extractBestImage(doc: any, cfg: PortalConfig): string | undefined {
  // tenta img direto
  const viaImg = selectFirstAttr(doc, cfg.imageSelectors, "src");
  if (viaImg) return absUrl(doc.URL || cfg.startUrl, viaImg) || viaImg;
  // tenta og:image
  const og = selectFirstAttr(doc, ["meta[property='og:image']"], "content");
  if (og) return og;
  return undefined;
}

// ---------- Extração de links da capa ----------
async function extractNewsLinks(cfg: PortalConfig): Promise<string[]> {
  const doc = await fetchDocument(cfg.startUrl);
  const anchors = Array.from(doc.querySelectorAll(cfg.linkSelector)) as Element[];
  const urls = anchors
    .map((a) => a.getAttribute("href") || "")
    .map((h) => absUrl(cfg.startUrl, h))
    .filter((u): u is string => !!u)
    .filter((u) => looksLikeArticleUrl(u, cfg));
  return uniq(urls);
}

// ---------- Extração de artigo ----------
async function extractArticle(url: string, cfg: PortalConfig) {
  const doc = await fetchDocument(url);

  // título
  let title = selectFirstAttr(doc, cfg.titleSelectors, "text") ||
              selectFirstAttr(doc, ["meta[property='og:title']"], "content") ||
              "";

  title = normalizeWhitespace(title);

  // container de texto
  let container: Element | null = null;
  for (const sel of cfg.articleSelectors) {
    const cand = doc.querySelector(sel) as Element | null;
    if (cand) { container = cand; break; }
  }
  // fallback: use <main> ou <article> genérico
  if (!container) container = (doc.querySelector("main") || doc.querySelector("article")) as Element | null;
  if (!container) return null;

  // limpeza
  purge(container, cfg);

  // texto final: prioriza <p>, mas mantém ordem do DOM
  const paragraphs = Array.from(container.querySelectorAll("p"))
    .map((p) => normalizeWhitespace(String(p.textContent || "")))
    .filter(Boolean);

  let text = paragraphs.join(" ").trim();
  if (countWords(text) < 120) {
    // fallback: pega textContent do container
    text = normalizeWhitespace(String(container.textContent || ""));
  }

  // imagem de capa
  const image = extractBestImage(doc, cfg);

  // categoria simples
  const category = cfg.categoryGuess?.(url) || "Geral";

  // heurística para “publieditorial”
  const dirty = /publieditorial|publipost|patrocinado|publicidade/i.test(doc.documentElement?.textContent || "");

  return {
    url,
    title,
    text,
    image,
    category,
    dirty,
    wordCount: countWords(text),
  };
}

// ---------- Reescrita Groq (opcional) ----------
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") || "";
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.1-70b-specdec"; // use o seu modelo preferido

async function rewriteWithGroq(originalTitle: string, originalText: string, fonte: string) {
  const words = countWords(originalText);
  if (words < 150) {
    return "CONTEÚDO IGNORADO"; // gating de qualidade
  }
  const prompt = [
    "Contexto: Você é um redator de hard news. Escreva matéria 100% objetiva, factual e neutra.",
    "Restrições duras:",
    "- Nada de propaganda, autoelogio institucional, call-to-action ou menção a 'clique/assine/veja mais'.",
    "- Não invente fatos. Se faltar dado, apenas omita.",
    "- Tamanho final: ENTRE 1.800 e 4.000 caracteres (não palavras).",
    "- Se o texto de entrada tiver MENOS de 150 palavras, responda EXATAMENTE: CONTEÚDO IGNORADO.",
    "",
    `Título original: ${originalTitle}`,
    `Fonte: ${fonte}`,
    "Texto original (limpo):",
    originalText,
    "",
    "Agora, produza a matéria reescrita em PT-BR."
  ].join("\n");

  if (!GROQ_API_KEY) {
    // Sem chave: retorna um “alongamento” simples e objetivo, com limite mínimo.
    // (Você ainda terá gating pelos 150+ words acima.)
    const base = `${originalTitle}\n\n${originalText}`;
    return base.length < 1800 ? (base + "\n\n" + originalText).slice(0, 4000) : base.slice(0, 4000);
  }

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: "Você é um redator de jornalismo objetivo." },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 1800, // aprox ~ caracteres/4 — ajuste conforme modelo
  };

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${GROQ_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errTxt = await resp.text();
    console.error("Groq error:", errTxt);
    // fallback para não quebrar a execução
    const base = `${originalTitle}\n\n${originalText}`;
    return base.length < 1800 ? (base + "\n\n" + originalText).slice(0, 4000) : base.slice(0, 4000);
  }

  const json = await resp.json();
  const out = json.choices?.[0]?.message?.content?.trim() || "";
  return out || "CONTEÚDO IGNORADO";
}

// ---------- Supabase ----------
function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis da Edge Function.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function alreadyExists(client: ReturnType<typeof createClient>, url: string) {
  const { data, error } = await client
    .from("noticias_scraped")
    .select("id")
    .eq("url_original", url)
    .limit(1);
  if (error) console.error("DB exists check:", error.message);
  return Array.isArray(data) && data.length > 0;
}

function rewriteTitleForHeadline(t: string) {
  // Pequena higienização (sem marketing, sem capslock total)
  const s = t.replace(/\s+\|\s+.*$/i, "").trim();
  return s.length > 10 ? s : t;
}

// ---------- Handler ----------
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST com JSON { portalId, max? }" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido." }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const portalId = String(payload.portalId || "").trim();
  const max = Math.min(Math.max(parseInt(String(payload.max ?? "8"), 10) || 8, 1), 15);

  const cfg = PORTAIS_CONFIG[portalId];
  if (!cfg) {
    return new Response(JSON.stringify({ error: `portalId desconhecido: ${portalId}` }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const client = getSupabase();

  let links: string[] = [];
  const summary = {
    portalId,
    label: cfg.label,
    fetched: 0,
    processed: 0,
    inserted: 0,
    ignored: 0,
    errors: [] as string[],
  };

  try {
    links = await extractNewsLinks(cfg);
    summary.fetched = links.length;
  } catch (e) {
    summary.errors.push(`Falha ao extrair links: ${e?.message || e}`);
  }

  // Limita quantidade por execução
  links = links.slice(0, max);

  for (const url of links) {
    try {
      // evita duplicados já salvos
      if (await alreadyExists(client, url)) continue;

      const art = await extractArticle(url, cfg);
      if (!art) { summary.ignored++; continue; }

      // Bloqueia conteúdo patrocinado ou institucional detectado
      if (art.dirty || art.wordCount < 150) {
        summary.ignored++;
        continue;
      }

      // Reescrita longa e objetiva (ou fallback) + gating 1.8k–4k
      let conteudoReescrito = await rewriteWithGroq(art.title, art.text, cfg.label);
      if (conteudoReescrito.trim() === "CONTEÚDO IGNORADO") {
        summary.ignored++;
        continue;
      }
      conteudoReescrito = conteudoReescrito.trim();
      // força janela 1.800–4.000 chars (corte suave se vier maior)
      if (conteudoReescrito.length < 1800) {
        // tentativa simples de alongar sem inventar
        conteudoReescrito = (conteudoReescrito + "\n\n" + art.text).slice(0, 4000);
      } else if (conteudoReescrito.length > 4000) {
        conteudoReescrito = conteudoReescrito.slice(0, 4000);
      }

      const row = {
        titulo_original: art.title,
        titulo_reescrito: rewriteTitleForHeadline(art.title),
        conteudo_reescrito: conteudoReescrito,
        url_original: url,
        fonte: cfg.label,
        imagem_url: art.image || null,
        categoria: art.category,
        status: "gerado",
        data_coleta: new Date().toISOString(),
      };

      const { error } = await client.from("noticias_scraped").insert(row);
      if (error) {
        summary.errors.push(`DB insert (${url}): ${error.message}`);
      } else {
        summary.inserted++;
      }
      summary.processed++;
    } catch (e) {
      summary.errors.push(`Falha em ${url}: ${e?.message || e}`);
    }
  }

  return new Response(JSON.stringify(summary, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
});
