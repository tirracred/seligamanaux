// Tipos do edge runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Supabase client (JSR recomendado para Edge)
import { createClient } from "jsr:@supabase/supabase-js@2";

// DOMParser via deno-dom (WASM)
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

// ----------------- Tipos -----------------
interface NoticiaRecord {
  titulo_original: string;
  titulo_reescrito: string;
  conteudo_reescrito: string;
  url_original: string;
  fonte: string;
  imagem_url?: string;
  categoria: string;
  status: string;
  data_coleta: string;
  data_publicacao?: string | null;
}

type PortalId = "g1-am" | "portaldoholanda" | "acritica" | "portalamazonia";

interface PortalConfig {
  id: PortalId;
  name: string;
  startUrl: string;
  baseUrl: string;
  linkSelector: string;          // lista: separados por vírgula
  titleSelector: string;         // primeira que bater
  contentSelector: string;       // container principal
  imageSelector?: string;
  category: string;
  // filtros extras
  blockedPathSubstrings: string[];
}

// ----------------- CORS -----------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// ----------------- Config de Portais (CSS) -----------------
const PORTAIS_CONFIG: Record<PortalId, PortalConfig> = {
  "g1-am": {
    id: "g1-am",
    name: "G1 Amazonas",
    startUrl: "https://g1.globo.com/am/amazonas/",
    baseUrl: "https://g1.globo.com",
    linkSelector: "a.feed-post-link[href*='/noticia/']", // presente no config atual
    titleSelector: "h1.content-head__title, h1.gui-color-primary, h1",
    contentSelector: ".mc-body, .content-text__container, article",
    imageSelector: ".content-media__image img, figure img, .progressive-img img",
    category: "Amazonas",
    blockedPathSubstrings: [
      "/sobre", "/termos", "/privacidade", "/anuncie", "/publicidade", "/equipe",
      "/contato", "/institucional", "/assinante", "/newsletter", "/faq", "/trabalhe"
    ],
  },
  "portaldoholanda": {
    id: "portaldoholanda",
    name: "Portal do Holanda",
    startUrl: "https://portaldoholanda.com.br/",
    baseUrl: "https://portaldoholanda.com.br",
    linkSelector: "h2 a, h3 a, a[href*='/noticia/'], a[href*='/noticias/']",
    titleSelector: "h1.entry-title, h1.post-title, h1",
    contentSelector: ".entry-content, .post-content, article",
    imageSelector: ".featured-image img, .post-thumbnail img, article img, .wp-post-image",
    category: "Amazonas",
    blockedPathSubstrings: [
      "/sobre", "/termos", "/privacidade", "/anuncie", "/publicidade", "/equipe",
      "/contato", "/institucional", "/assinante", "/newsletter", "/faq", "/trabalhe"
    ],
  },
  "acritica": {
    id: "acritica",
    name: "A Crítica",
    startUrl: "https://www.acritica.com/",
    baseUrl: "https://www.acritica.com",
    linkSelector: "h2 a, h3 a, a[href*='/noticias/'], a[href*='/noticia/']",
    titleSelector: "h1.post-title, h1.entry-title, h1",
    contentSelector: ".post-content, .entry-content, article",
    imageSelector: ".featured-image img, .post-image img, article img, .thumbnail img",
    category: "Amazonas",
    blockedPathSubstrings: [
      "/sobre", "/termos", "/privacidade", "/anuncie", "/publicidade", "/equipe",
      "/contato", "/institucional", "/assinante", "/newsletter", "/faq", "/trabalhe"
    ],
  },
  "portalamazonia": {
    id: "portalamazonia",
    name: "Portal Amazônia",
    startUrl: "https://portalamazonia.com/",
    baseUrl: "https://portalamazonia.com",
    linkSelector: "h2 a, h3 a, a[href*='/noticias/'], a[href*='/noticia/']",
    titleSelector: "h1.entry-title, h1.post-title, h1, .article-title",
    contentSelector: ".entry-content, .post-content, .article-body, article",
    imageSelector: ".featured-image img, .post-thumbnail img, article img, .wp-post-image",
    category: "Amazônia",
    blockedPathSubstrings: [
      "/sobre", "/termos", "/privacidade", "/anuncie", "/publicidade", "/equipe",
      "/contato", "/institucional", "/assinante", "/newsletter", "/faq", "/trabalhe"
    ],
  },
};

// ----------------- Utilitários -----------------
function absUrl(href: string, base: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function isBlocked(url: string, blocked: string[]) {
  const u = url.toLowerCase();
  return blocked.some((b) => u.includes(b));
}

function unique<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function cleanWhitespace(text: string) {
  return text.replace(/\s+/g, " ").replace(/\u00A0/g, " ").trim();
}

function countWords(text: string) {
  return cleanWhitespace(text).split(/\s+/).filter(Boolean).length;
}

// Remove lixo do DOM
function purgeDom(root: any) {
  const trashSelectors = [
    "script", "style", "noscript", "iframe", "svg", "template",
    "header", "footer", "aside", "nav",
    ".advertising", ".ads", "[class*='ad-']", "[id*='ad-']",
    ".share", ".social", ".breadcrumbs", ".comments", ".newsletter",
    ".related", ".relacionadas", ".interstitial", ".cookie", ".paywall"
  ];
  for (const sel of trashSelectors) {
    root.querySelectorAll(sel).forEach((n: any) => n.remove());
  }
}

// Extrai texto do container
function extractText(container: any) {
  if (!container) return "";
  // privilegia parágrafos e subtítulos
  const parts: string[] = [];
  container.querySelectorAll("p, h2, h3, li").forEach((el: any) => {
    const t = cleanWhitespace(el.textContent || "");
    if (t.length > 0) parts.push(t);
  });
  // fallback: texto de todo o container
  if (parts.length === 0) {
    const t = cleanWhitespace(container.textContent || "");
    if (t.length > 0) parts.push(t);
  }
  // monta parágrafos
  return parts.join("\n\n");
}

async function fetchHtml(url: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Falha ao buscar ${url}: ${res.status}`);
  return await res.text();
}

// ----------------- Groq Chat Completions -----------------
async function rewriteWithGroq(originalTitle: string, originalText: string) {
  const apiKey = Deno.env.get("GROQ_API_KEY") ?? "";
  if (!apiKey) throw new Error("GROQ_API_KEY ausente");

  // Se muito curto, devolve sinalização
  if (countWords(originalText) < 150) {
    return { titulo: originalTitle || "CONTEÚDO IGNORADO", conteudo: "CONTEÚDO IGNORADO" };
  }

  const system = [
    "Você é um editor de texto jornalístico em português do Brasil.",
    "Produza texto objetivo, factual, sem adjetivação excessiva, sem opinião.",
    "Nunca invente fatos; não inclua chamadas a ação, institucional ou autopromoção."
  ].join(" ");

  const user = [
    "Reescreva como matéria jornalística neutra e completa entre 1800 e 4000 caracteres, com título objetivo.",
    "Se o TEXTO ORIGINAL for insuficiente/curto/sujo, responda exatamente: CONTEÚDO IGNORADO.",
    "Responda apenas em JSON com campos: {\"titulo\": string, \"conteudo\": string}.",
    "",
    "TEXTO ORIGINAL (título + corpo limpo):",
    originalTitle,
    originalText
  ].join("\n\n");

  const payload = {
    model: "llama-3.3-70b-versatile",
    temperature: 0.3,
    top_p: 0.9,
    max_completion_tokens: 1400,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    response_format: { type: "json_object" }
  };

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) throw new Error(`Groq erro: ${resp.status}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  let parsed: { titulo?: string; conteudo?: string } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    // se conteúdo não for JSON válido, tenta heurística simples
    parsed = { titulo: originalTitle, conteudo: content };
  }

  let titulo = cleanWhitespace(parsed.titulo || originalTitle || "");
  let conteudo = cleanWhitespace(parsed.conteudo || "");

  // Sinalização do prompt
  if (conteudo === "CONTEÚDO IGNORADO") {
    return { titulo: "CONTEÚDO IGNORADO", conteudo };
  }

  // Ajuste de comprimento
  const len = conteudo.length;
  if (len < 1800 || len > 4000) {
    const adjustPayload = {
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_completion_tokens: 1400,
      messages: [
        { role: "system", content: "Ajuste o texto para ficar entre 1800 e 4000 caracteres, mantendo fidelidade e tom jornalístico neutro, sem opinião." },
        { role: "user", content: `Título: ${titulo}\n\nTexto:\n${conteudo}\n\nResponda apenas com o texto ajustado.` }
      ]
    };
    const adj = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(adjustPayload)
    });
    if (adj.ok) {
      const d = await adj.json();
      const c2 = cleanWhitespace(d?.choices?.[0]?.message?.content || conteudo);
      conteudo = c2;
    }
  }

  return { titulo: titulo || originalTitle || "Sem título", conteudo };
}

// ----------------- Supabase -----------------
function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ----------------- Scrape helpers -----------------
function pickFirst(doc: any, selectorCsv: string) {
  for (const sel of selectorCsv.split(",").map((s) => s.trim())) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function pickAll(doc: any, selectorCsv: string) {
  const all: any[] = [];
  for (const sel of selectorCsv.split(",").map((s) => s.trim())) {
    doc.querySelectorAll(sel).forEach((el: any) => all.push(el));
  }
  return all;
}

async function collectArticleLinks(cfg: PortalConfig, max = 8) {
  const html = await fetchHtml(cfg.startUrl);
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Falha ao parsear listagem");

  const anchors = pickAll(doc, cfg.linkSelector);
  const urls = anchors
    .map((a: any) => a.getAttribute("href"))
    .filter(Boolean)
    .map((h: string) => absUrl(h, cfg.baseUrl))
    .filter(Boolean) as string[];

  const filtered = urls.filter((u) => {
    if (isBlocked(u, cfg.blockedPathSubstrings)) return false;
    // heurística adicional para noticias
    const low = u.toLowerCase();
    const looksNews = low.includes("/noticia") || low.includes("/noticias");
    return looksNews;
  });

  return unique(filtered).slice(0, max);
}

async function extractArticle(cfg: PortalConfig, url: string) {
  const html = await fetchHtml(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Falha ao parsear artigo");

  purgeDom(doc);

  const titleEl = pickFirst(doc, cfg.titleSelector);
  const contentEl = pickFirst(doc, cfg.contentSelector) || doc.querySelector("article");
  const imgEl = cfg.imageSelector ? pickFirst(doc, cfg.imageSelector) : null;

  const titulo = cleanWhitespace(titleEl?.textContent || "");
  const texto = extractText(contentEl);
  let imagem_url = "";

  if (imgEl) {
    const src = imgEl.getAttribute("src") || imgEl.getAttribute("data-src");
    const abs = src ? absUrl(src, cfg.baseUrl) : null;
    if (abs) imagem_url = abs;
  }

  return { titulo, texto, imagem_url };
}

// ----------------- HTTP Handler -----------------
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 405,
      });
    }

    const body = await req.json().catch(() => ({}));
    const portalId = (body?.portalId || "").trim() as PortalId;
    const max = Number(body?.max ?? 8);

    if (!portalId || !(portalId in PORTAIS_CONFIG)) {
      return new Response(JSON.stringify({ error: "portalId inválido" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const cfg = PORTAIS_CONFIG[portalId];
    const links = await collectArticleLinks(cfg, Math.min(Math.max(1, max), 15));

    const supabase = getSupabaseAdmin();
    const results: any[] = [];

    for (const url of links) {
      try {
        const { titulo, texto, imagem_url } = await extractArticle(cfg, url);

        // pré-checagem: muito curto?
        if (countWords(texto) < 150) {
          results.push({ url, status: "ignorado_curto" });

          // ainda assim salva rastro mínimo opcional (com status)
          await supabase.from("noticias_scraped").insert({
            titulo_original: titulo || "Sem título",
            titulo_reescrito: "CONTEÚDO IGNORADO",
            conteudo_reescrito: "CONTEÚDO IGNORADO",
            url_original: url,
            fonte: cfg.name,
            imagem_url,
            categoria: cfg.category,
            status: "ignorado",
            data_coleta: new Date().toISOString(),
            data_publicacao: null,
          } as NoticiaRecord);

          continue;
        }

        const re = await rewriteWithGroq(titulo, texto);

        const status = re.conteudo === "CONTEÚDO IGNORADO" ? "ignorado" : "gerado";
        const conteudo_final = re.conteudo;
        const titulo_final = re.titulo || titulo || "Sem título";

        await supabase.from("noticias_scraped").insert({
          titulo_original: titulo || "Sem título",
          titulo_reescrito: titulo_final,
          conteudo_reescrito: conteudo_final,
          url_original: url,
          fonte: cfg.name,
          imagem_url,
          categoria: cfg.category,
          status,
          data_coleta: new Date().toISOString(),
          data_publicacao: null,
        } as NoticiaRecord);

        results.push({ url, status });
      } catch (e) {
        results.push({ url, status: "erro", error: String(e?.message || e) });
      }
    }

    return new Response(JSON.stringify({
      portal: cfg.name,
      processed: results.length,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
