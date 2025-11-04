// Importa o 'edge-runtime' para tipos Deno (Supabase Edge Functions)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Deno-DOM: parser de HTML no ambiente Deno
// Import via jsr
// deno-lint-ignore no-explicit-any
const { DOMParser } = await import("jsr:@b-fuze/deno-dom");

type PortalId = "g1-am" | "holanda" | "acritica" | "portalamazonia";

interface PortalConfig {
  id: PortalId;
  name: string;
  host: string;
  baseUrl: string;
  // Seletor(es) onde ficam os links de notícias na listagem/home do portal
  listLinkSelectors: string[];
  // Padrões permitidos / negados para links de artigo
  articleLinkAllowPatterns: RegExp[];
  articleLinkDenyPatterns: RegExp[];
  // Seletor(es) do título dentro da página do artigo
  titleSelectors: string[];
  // Seletor(es) do conteúdo do artigo
  contentSelectors: string[];
  // Seletor(es) de imagem de destaque
  imageSelectors: string[];
  // Limite de links a visitar por portal (proteção)
  maxLinks?: number;
  // Identificador de categoria
  category: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const PORTAIS_CONFIG: Record<PortalId, PortalConfig> = {
  "g1-am": {
    id: "g1-am",
    name: "G1 Amazonas",
    host: "g1.globo.com",
    baseUrl: "https://g1.globo.com/am/amazonas/",
    listLinkSelectors: [
      "a.feed-post-link",
      'a[href*="/am/amazonas/noticia/"]',
      'a[href*="/amazonas/noticia/"]',
    ],
    articleLinkAllowPatterns: [
      /\/am\/amazonas\/noticia\//i,
      /\/amazonas\/noticia\//i,
      /\/noticia\//i,
    ],
    articleLinkDenyPatterns: [
      /\/sobre/i,
      /\/termos/i,
      /\/politica-de-privacidade/i,
      /\/anuncie/i,
      /\/globoid/i,
      /\/quem-somos/i,
      /\/ajuda/i,
      /\/contato/i,
      /\/promocao/i,
      /\/parceiro/i,
      /\/gshow\//i,
      /\/esportes\//i, // opcional
    ],
    titleSelectors: [
      "h1.content-head__title",
      "h1.gui-color-primary",
      "article h1",
      "h1",
    ],
    contentSelectors: [
      ".content-text__container",
      "article .mc-article-body",
      "article .content",
      "article",
    ],
    imageSelectors: [
      ".content-media__image img",
      ".progressive-img img",
      "figure img",
      ".content-head__image img",
    ],
    maxLinks: 12,
    category: "Amazonas",
  },

  holanda: {
    id: "holanda",
    name: "Portal do Holanda",
    host: "portaldoholanda.com.br",
    baseUrl: "https://portaldoholanda.com.br/",
    listLinkSelectors: [
      "h2 a",
      "h3 a",
      ".post-link",
      'a[href*="/noticia/"]',
      'a[href*="/noticias/"]',
    ],
    articleLinkAllowPatterns: [/\/noticia\//i, /\/noticias\//i],
    articleLinkDenyPatterns: [
      /\/sobre/i,
      /\/termos/i,
      /\/quem-somos/i,
      /\/institucional/i,
      /\/anuncie/i,
      /\/privacidade/i,
      /\/contato/i,
      /\/classificados/i,
    ],
    titleSelectors: ["h1.entry-title", "h1.post-title", "article h1", "h1"],
    contentSelectors: [
      ".entry-content",
      ".post-content",
      "article .text",
      "article",
    ],
    imageSelectors: [
      ".featured-image img",
      ".post-thumbnail img",
      "article img",
      ".wp-post-image",
    ],
    maxLinks: 12,
    category: "Amazonas",
  },

  acrítica: undefined as never, // apenas para evitar typo

  acritica: {
    id: "acritica",
    name: "A Crítica",
    host: "www.acritica.com",
    baseUrl: "https://www.acritica.com/",
    listLinkSelectors: [
      "h2 a",
      "h3 a",
      ".post-item a",
      'a[href*="/noticia/"]',
      'a[href*="/noticias/"]',
    ],
    articleLinkAllowPatterns: [/\/noticia\//i, /\/noticias\//i],
    articleLinkDenyPatterns: [
      /\/sobre/i,
      /\/termos/i,
      /\/anuncie/i,
      /\/contato/i,
      /\/institucional/i,
      /\/privacidade/i,
      /\/classificados/i,
    ],
    titleSelectors: ["h1.post-title", "h1.entry-title", ".article-title", "h1"],
    contentSelectors: [
      ".post-content",
      ".entry-content",
      ".article-content",
      "article .content",
      "article",
    ],
    imageSelectors: [
      ".featured-image img",
      ".post-image img",
      "article img",
      ".thumbnail img",
    ],
    maxLinks: 12,
    category: "Amazonas",
  },

  portalamazonia: {
    id: "portalamazonia",
    name: "Portal Amazônia",
    host: "portalamazonia.com",
    baseUrl: "https://portalamazonia.com/",
    listLinkSelectors: [
      "h2 a",
      "h3 a",
      ".post-link",
      'a[href*="/noticia/"]',
      'a[href*="/noticias/"]',
    ],
    articleLinkAllowPatterns: [/\/noticia\//i, /\/noticias\//i],
    articleLinkDenyPatterns: [
      /\/sobre/i,
      /\/termos/i,
      /\/anuncie/i,
      /\/contato/i,
      /\/institucional/i,
      /\/privacidade/i,
    ],
    titleSelectors: ["h1.entry-title", "h1.post-title", ".article-title", "h1"],
    contentSelectors: [
      ".entry-content",
      ".post-content",
      ".article-body",
      "article .content",
      "article",
    ],
    imageSelectors: [
      ".featured-image img",
      ".post-thumbnail img",
      "article img",
      ".wp-post-image",
    ],
    maxLinks: 12,
    category: "Amazônia",
  },
};

// Helpers

function normalizeUrl(base: string, href: string): string | null {
  try {
    if (!href) return null;
    // evita anchors e mailto/tel
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return null;
    }
    const url = href.startsWith("http")
      ? new URL(href)
      : new URL(href, base);
    return url.toString();
  } catch {
    return null;
  }
}

function isLikelyArticleLink(
  urlStr: string,
  cfg: PortalConfig,
): boolean {
  try {
    const url = new URL(urlStr);
    if (!url.hostname.includes(cfg.host)) return false;

    for (const deny of cfg.articleLinkDenyPatterns) {
      if (deny.test(url.pathname)) return false;
    }
    for (const allow of cfg.articleLinkAllowPatterns) {
      if (allow.test(url.pathname)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function cleanDom(root: any) {
  // remove lixo típico que polui textContent
  const toRemove = root.querySelectorAll(
    [
      "script",
      "style",
      "noscript",
      "template",
      "iframe",
      "link",
      "form",
      "header nav",
      "footer",
      ".ads",
      ".ad",
      ".advertising",
      "[class*='ad-']",
      ".sponsor",
      ".sponsored",
      ".sharing",
      ".share",
      ".breadcrumbs",
      ".cookie",
      ".newsletter",
      ".related",
      ".recommendations",
      ".comments",
      ".author-box",
      ".bio",
      ".widget",
      ".sidebar",
      ".menu",
      ".nav",
      ".pagination",
    ].join(","),
  );
  toRemove.forEach((n: any) => n.remove());
}

function extractFirstMatchText(doc: any, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const txt = el.textContent?.trim();
      if (txt) return txt;
    }
  }
  return "";
}

function extractFirstImage(doc: any, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const src = el.getAttribute("src") || el.getAttribute("data-src");
      if (src && !src.startsWith("data:")) return src;
    }
  }
  return "";
}

function concatContent(doc: any, selectors: string[]): string {
  for (const sel of selectors) {
    const container = doc.querySelector(sel);
    if (container) {
      // clona para limpar sem afetar o doc principal
      const clone = container.cloneNode(true);
      cleanDom(clone);
      const text = clone.textContent ?? "";
      // normalização
      const normalized = text
        .replace(/\u00A0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n\s*\n+/g, "\n\n")
        .trim();
      if (normalized.length > 120) return normalized;
    }
  }
  // fallback: tenta no article inteiro
  const article = doc.querySelector("article");
  if (article) {
    const clone = article.cloneNode(true);
    cleanDom(clone);
    return (clone.textContent ?? "").replace(/[ \t]+/g, " ").trim();
  }
  return "";
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SeligaManauxBot/1.0; +https://seligamanaux)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao carregar ${url}`);
  }
  return await res.text();
}

async function listArticleLinks(cfg: PortalConfig): Promise<string[]> {
  const html = await fetchHtml(cfg.baseUrl);
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return [];
  cleanDom(doc);

  const linksSet = new Set<string>();
  for (const sel of cfg.listLinkSelectors) {
    doc.querySelectorAll(sel).forEach((a: any) => {
      const href = a.getAttribute("href") || "";
      const url = normalizeUrl(cfg.baseUrl, href);
      if (!url) return;
      if (isLikelyArticleLink(url, cfg)) {
        linksSet.add(url);
      }
    });
  }

  // fallback: pega qualquer link de noticia permitido no dom
  if (linksSet.size < 4) {
    doc.querySelectorAll("a[href]").forEach((a: any) => {
      const href = a.getAttribute("href") || "";
      const url = normalizeUrl(cfg.baseUrl, href);
      if (!url) return;
      if (isLikelyArticleLink(url, cfg)) {
        linksSet.add(url);
      }
    });
  }

  const links = Array.from(linksSet).slice(0, cfg.maxLinks ?? 10);
  return links;
}

function wordCount(text: string): number {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words.length;
}

async function extractArticle(url: string, cfg: PortalConfig) {
  const html = await fetchHtml(url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) {
    throw new Error("Falha ao parsear DOM");
  }
  cleanDom(doc);

  const tituloOriginal = extractFirstMatchText(doc, cfg.titleSelectors);
  let conteudoOriginal = concatContent(doc, cfg.contentSelectors);
  const imagem = extractFirstImage(doc, cfg.imageSelectors);

  // sanity filters
  conteudoOriginal = conteudoOriginal
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    tituloOriginal: tituloOriginal || "(sem título)",
    conteudoOriginal,
    imagem,
    url,
    fonte: cfg.name,
    categoria: cfg.category,
  };
}

// Reescrita com Groq – ajusta para o seu modelo
async function rewriteWithGroq(
  titulo: string,
  texto: string,
  fonte: string,
): Promise<{ titulo: string; conteudo: string }> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY ausente");

  // hard stop para textos curtos
  if (wordCount(texto) < 150) {
    return {
      titulo: "CONTEÚDO IGNORADO",
      conteudo: "CONTEÚDO IGNORADO",
    };
  }

  const prompt = `
Você é um editor jornalístico. Reescreva o texto a seguir em português brasileiro, formato jornalístico objetivo (pirâmide invertida), coeso e rico em detalhes, entre 1.800 e 4.000 caracteres. Mantenha neutralidade e evite adjetivação gratuita. Não invente fatos novos.

Restrições:
- Tamanho final obrigatório: 1.800–4.000 caracteres.
- Sem opinião, sem clichês, sem promoções.
- Mantenha a informação factual.
- Não inclua HTML nem tags.
- Se o texto original parecer incompleto, superficial ou menor que 150 palavras, responda apenas "CONTEÚDO IGNORADO".

Título original: ${titulo}

Texto original:
${texto}
`.trim();

  // Exemplo de chamada a Groq (ajuste para seu endpoint/model)
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-70b-versatile",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Você é um editor jornalístico brasileiro. Produza textos claros, objetivos e completos.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);

  const data = await res.json();
  const content =
    data?.choices?.[0]?.message?.content?.toString()?.trim() ?? "";

  if (!content) {
    throw new Error("Groq sem conteúdo");
  }

  if (content === "CONTEÚDO IGNORADO") {
    return { titulo: "CONTEÚDO IGNORADO", conteudo: "CONTEÚDO IGNORADO" };
  }

  // enforce length
  const len = content.length;
  if (len < 1700 || len > 4300) {
    // Segunda passada para ajuste fino de tamanho (pequeno truque)
    const adjustPrompt = `
Ajuste o texto para ficar estritamente entre 1.800 e 4.000 caracteres. Não mude fatos.

Texto:
${content}
`.trim();

    const res2 = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile",
        temperature: 0.2,
        messages: [
          { role: "system", content: "Ajuste de comprimento." },
          { role: "user", content: adjustPrompt },
        ],
      }),
    });
    if (res2.ok) {
      const data2 = await res2.json();
      const adjusted =
        data2?.choices?.[0]?.message?.content?.toString()?.trim() ?? content;
      return { titulo, conteudo: adjusted };
    }
  }

  return { titulo, conteudo: content };
}

async function saveToSupabase(rows: Array<{
  titulo_original: string;
  titulo_reescrito: string;
  conteudo_reescrito: string;
  url_original: string;
  fonte: string;
  imagem_url?: string;
  categoria: string;
}>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const client = createClient(supabaseUrl, supabaseKey);

  const enriched = rows.map((r) => ({
    ...r,
    status: "rascunho",
    data_coleta: new Date().toISOString(),
  }));

  const { error } = await client
    .from("noticias_scraped")
    .insert(enriched);

  if (error) throw new Error(`Supabase insert error: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response(JSON.stringify({ error: "JSON esperado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null) as {
      portalId?: PortalId;
    };

    if (!body?.portalId) {
      return new Response(
        JSON.stringify({ error: "Informe { portalId }" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const cfg = PORTAIS_CONFIG[body.portalId];
    if (!cfg) {
      return new Response(
        JSON.stringify({ error: `portalId inválido: ${body.portalId}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 1) Coleta links de artigos válidos
    const links = await listArticleLinks(cfg);

    // 2) Para cada link, extrai e reescreve
    const results: Array<{
      titulo_original: string;
      titulo_reescrito: string;
      conteudo_reescrito: string;
      url_original: string;
      fonte: string;
      imagem_url?: string;
      categoria: string;
      status: "OK" | "IGNORADO" | "ERRO";
      reason?: string;
    }> = [];

    for (const url of links) {
      try {
        const art = await extractArticle(url, cfg);
        const wc = wordCount(art.conteudoOriginal);

        if (wc < 150) {
          results.push({
            titulo_original: art.tituloOriginal,
            titulo_reescrito: "CONTEÚDO IGNORADO",
            conteudo_reescrito: "CONTEÚDO IGNORADO",
            url_original: art.url,
            fonte: art.fonte,
            imagem_url: art.imagem,
            categoria: art.categoria,
            status: "IGNORADO",
            reason: "Texto original curto",
          });
          continue;
        }

        const rewritten = await rewriteWithGroq(
          art.tituloOriginal,
          art.conteudoOriginal,
          art.fonte,
        );

        if (rewritten.conteudo === "CONTEÚDO IGNORADO") {
          results.push({
            titulo_original: art.tituloOriginal,
            titulo_reescrito: "CONTEÚDO IGNORADO",
            conteudo_reescrito: "CONTEÚDO IGNORADO",
            url_original: art.url,
            fonte: art.fonte,
            imagem_url: art.imagem,
            categoria: art.categoria,
            status: "IGNORADO",
            reason: "Groq recusou por conteúdo insuficiente",
          });
          continue;
        }

        // coerce título reescrito mínimo
        const tituloReescrito =
          rewritten.titulo && rewritten.titulo !== "CONTEÚDO IGNORADO"
            ? rewritten.titulo
            : art.tituloOriginal;

        results.push({
          titulo_original: art.tituloOriginal,
          titulo_reescrito: tituloReescrito,
          conteudo_reescrito: rewritten.conteudo,
          url_original: art.url,
          fonte: art.fonte,
          imagem_url: art.imagem,
          categoria: art.categoria,
          status: "OK",
        });
      } catch (e) {
        results.push({
          titulo_original: "(erro)",
          titulo_reescrito: "(erro)",
          conteudo_reescrito: "(erro)",
          url_original: url,
          fonte: cfg.name,
          categoria: cfg.category,
          status: "ERRO",
          reason: (e as Error).message,
        });
      }
    }

    // 3) Persistência: salva apenas os OK
    const toSave = results.filter((r) => r.status === "OK").map((r) => ({
      titulo_original: r.titulo_original,
      titulo_reescrito: r.titulo_reescrito,
      conteudo_reescrito: r.conteudo_reescrito,
      url_original: r.url_original,
      fonte: r.fonte,
      imagem_url: r.imagem_url,
      categoria: r.categoria,
    }));

    if (toSave.length > 0) {
      await saveToSupabase(toSave);
    }

    return new Response(JSON.stringify({
      portal: cfg.name,
      coletados: links.length,
      salvos: toSave.length,
      resultados: results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
