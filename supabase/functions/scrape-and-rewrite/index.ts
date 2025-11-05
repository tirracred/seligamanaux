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

interface linkConfig {
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

  "d24am.com": {
  name: "D24AM",
  baseUrl: "https://d24am.com/amazonas",
  linkSelectors: [
    'a[href*="/amazonas/"]',
    'a[href*="/manaus/"]',
    'a[href*="/noticias/"]',
    "article a",
    "h2 a",
    "h3 a"
  ],
  titleSelectors: [
    "h1.entry-title",
    "h1.post-title",
    "h1",
    ".article-title"
  ],
  contentSelectors: [
    ".entry-content",
    ".post-content",
    "article .content",
    'div[itemprop="articleBody"]'
  ],
  imageSelectors: [
    'meta[property="og:image"]',
    ".post-thumbnail img",
    "article img"
  ],
  category: "Amazonas"
},
};



/* =========================
   Filtros anti-promo/institucional
   ========================= */
const URL_BLACKLIST = [
  "/sobre", "/institucional", "/anuncie", "/publicidade", "/assine", "/assinante",
  "/trabalhe-", "/faq", "/politica-de-privacidade", "/termos", "/contato", "/equipe", "/comercial",
  "/videos/", "/podcast/", "/tag/", "/tags/", "/ao-vivo/", "/galeria/", "/classificados/",
  "/redacao", "/nossa-equipe", "/quem-somos", "/menu", "/globonews", "/programacao"
];


const TITLE_BLACKLIST = [
  "menu","nossa equipe","equipe","redação","siga a globonews nas redes sociais",
  "conheça a história do globo repórter","programação","assista"
];

function isBlacklistedUrl(u: string) {
  const x = (u||"").toLowerCase();
  return URL_BLACKLIST.some(b => x.includes(b));
}
function isBlacklistedTitle(t: string) {
  const x = (t||"").toLowerCase().trim();
  return x.length < 8 || TITLE_BLACKLIST.some(b => x.includes(b));
}
// ÚNICA definição desta função no arquivo!
function looksPromotional(text: string) {
  const x = (text||"").toLowerCase();
  return /publieditorial|publicidade|assessoria de imprensa|assine|clique aqui|programação|assista ao|patrocinado|publipost|oferecimento|oferecido por|parceria/i.test(x);
}


// --- NORMALIZAÇÃO / HIGIENE DE TEXTO ---
// remove créditos, "Foto:", "Com informações de...", "Leia mais", menções de rede, etc
function stripSourceArtifacts(t: string): string {
  return (t || "")
    .replace(/\s+—\s*Foto:.*?(?=\.|\n|$)/gi, "")
    .replace(/—\s*Foto.*?$/gim, "")
    .replace(/^\s*Foto:.*$/gim, "")
    .replace(/^\s*Crédito:.*$/gim, "")
    .replace(/^\s*Fonte:.*$/gim, "")
    .replace(/^\s*Com informações de.*$/gim, "")
    .replace(/^\s*Leia mais:.*$/gim, "")
    .replace(/\b(g1|globonews|rede amazônica|rede amaz\u00f4nica)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeText(t: string) {
  return (t || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// “barreira anti-cópia”: se estiver muito parecido, pedimos reescrita novamente
function tooSimilar(a: string, b: string): boolean {
  const A = new Set(normalizeText(a).split(" "));
  const B = new Set(normalizeText(b).split(" "));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const min = Math.max(1, Math.min(A.size, B.size));
  return inter / min > 0.80; // >80% das palavras em comum
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

function sanitizeHtml(html: string): string {
  return html
    // remove scripts e styles
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // remove blocos estruturais que só poluem (sem backreference)
    .replace(
      /<(?:nav|header|footer|aside|form|iframe|button|svg|noscript)[\s\S]*?<\/(?:nav|header|footer|aside|form|iframe|button|svg|noscript)>/gi,
      ""
    )
    // limpa elementos com classes/ids típicos de menu/ads
    .replace(
      /\b(?:class|id)="[^"]*(?:menu|newsletter|social|share|advert|ad-|banner|promo|sponsored)[^"]*"/gi,
      ""
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
        `<a[^>]+href=["']([^"']*${hrefPattern[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"']*)["'][^>]*>([\\s\\S]*?)<\\/a>`,
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
  fonte: string
): Promise<GroqResponse> {
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_API_KEY) {
    console.error("GROQ_API_KEY ausente no ambiente da Edge Function");
    // não devolva o original aqui: devolva sentinela para que o caller pule
    return { titulo: "", conteudo: "" };
  }

  // entrada higienizada
  const base = stripSourceArtifacts(conteudo);
  const MIN = 2000;
  const MAX = 4000;

  const system = [
    "Você é editor sênior do portal SeligaManaux.",
    "Reescreva em PT-BR jornalístico, SEM copiar frases do original.",
    "Proibido reproduzir 12+ palavras consecutivas do texto base.",
    "Mantenha fatos e dados, mude ordem/estrutura/vocabulário.",
    "Produza entre 2000 e 4000 caracteres em parágrafos (2–3 frases cada).",
    "Não incluir créditos de foto, programação de TV, 'leia mais', nem marcas de TV.",
  ].join(" ");

  function userPrompt(refaco = false) {
    const reforco = refaco
      ? "REFAÇA de outro jeito, altere ordem das informações, varie sintaxe e escolha lexical; garanta novidade textual."
      : "Abra com um lide forte (2–3 frases) e contextualize Manaus/AM quando fizer sentido.";
    return `FONTE: ${fonte}
TÍTULO ORIGINAL: ${titulo}

TEXTO BASE (limpo):
${base.slice(0, 8000)}

TAREFA:
${reforco}

Responda APENAS um JSON válido:
{
  "titulo": "título novo, diferente do original",
  "conteudo": "artigo final entre ${MIN} e ${MAX} caracteres, em parágrafos curtos; sem créditos de foto/TV."
}

Se perceber anúncio/publieditorial, responda exatamente:
{"titulo":"CONTEÚDO IGNORADO","conteudo":"publieditorial"}`;
  }

  async function callGroq(model: string, refaco = false, temperature = 0.3) {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt(refaco) }
        ]
      })
    });
    if (!resp.ok) throw new Error(`Groq ${resp.status}`);
    const data = await resp.json();
    let content = data?.choices?.[0]?.message?.content || "";
    if (!content.trim().startsWith("{")) {
      content = content.match(/{[\s\S]*}/)?.[0] || "{}";
    }
    return JSON.parse(content) as GroqResponse;
  }

  // util p/ medir similaridade (interseção de vocabulário)
  const sim = (a: string, b: string) => {
    const norm = (t: string) => (t||"").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
    const A = new Set(norm(a).split(" ")); const B = new Set(norm(b).split(" "));
    let inter = 0; for (const w of A) if (B.has(w)) inter++;
    const min = Math.max(1, Math.min(A.size, B.size));
    return inter / min; // 0..1
  };

  try {
    // 1ª tentativa
    let out = await callGroq("llama-3.1-70b-versatile", false, 0.28);
    if (out?.conteudo === "publieditorial") return out;

    let texto = stripSourceArtifacts(out?.conteudo || "");
    let ratio = sim(base, texto);
    let ok = out?.titulo && texto.length >= MIN && texto.length <= (MAX + 400) && ratio < 0.78;

    // 2ª tentativa (refação) se ficou curto/parecido
    if (!ok) {
      out = await callGroq("llama-3.1-70b-versatile", true, 0.35);
      texto = stripSourceArtifacts(out?.conteudo || "");
      ratio = sim(base, texto);
      ok = out?.titulo && texto.length >= MIN && texto.length <= (MAX + 400) && ratio < 0.78;
    }

    // 3ª tentativa (8b)
    if (!ok) {
      out = await callGroq("llama-3.1-8b-instant", true, 0.4);
      texto = stripSourceArtifacts(out?.conteudo || "");
      ratio = sim(base, texto);
      ok = out?.titulo && texto.length >= MIN && texto.length <= (MAX + 400) && ratio < 0.78;
    }

    if (!ok) {
      console.warn("Reescrita inválida: len=", texto.length, " sim=", ratio);
      return { titulo: "", conteudo: "" }; // devolve vazio para o caller pular
    }

    // corta teto com elegância em quebra de parágrafo
    if (texto.length > MAX + 50) {
      const cut = texto.slice(0, MAX);
      texto = cut.slice(0, cut.lastIndexOf("\n\n") > 0 ? cut.lastIndexOf("\n\n") : cut.length);
    }

    return { titulo: out.titulo, conteudo: texto };
  } catch (e) {
    console.error("Erro Groq:", e);
    return { titulo: "", conteudo: "" }; // força o caller a pular
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
    return new Response("Método não permitido", { status: 405, headers: corsHeaders });
  }

  try {
    // --- AUTH ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Sem autorização" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
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
      return new Response(JSON.stringify({ error: "Usuário não autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --- BODY ---
    const body = await req.json();
    const targetUrl = (body?.url || "").toString().trim();
    const requireLength = body?.requireLength || { min: 2000, max: 4000 };
    const ampPreferred  = !!body?.ampPreferred;
    const paginate      = body?.paginate || { start: 1, end: 1 };
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "URL obrigatória" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    console.log("Processando URL:", targetUrl);

    // --- DETECTA PORTAL CORRETAMENTE (SEM newsUrl!) ---
    const portalConfig = detectPortal(targetUrl);
    if (!portalConfig) {
      return new Response(JSON.stringify({ error: "Portal não suportado" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    console.log("Portal detectado:", portalConfig.name);

    // --- EVITAR DUPLICATAS (últimos 7 dias) ---
    const { data: existingUrls } = await supabaseAdmin
      .from("noticias_scraped")
      .select("url_original")
      .eq("fonte", portalConfig.name)
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    const existingUrlsSet = new Set(existingUrls?.map(x => x.url_original) || []);
    console.log(`URLs já processadas: ${existingUrlsSet.size}`);

    // --- BAIXA A LISTAGEM (TENTA targetUrl e, se vier magra, tenta baseUrl/editoria) ---
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    async function fetchListHtml(u: string) {
      const r = await fetch(u, {
        headers: { "User-Agent": userAgent, "Accept": "text/html", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
        signal: AbortSignal.timeout(30000)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return await r.text();
    }

    let htmlContent = "";
    try {
      htmlContent = await fetchListHtml(targetUrl);
      console.log("HTML recebido, tamanho:", htmlContent.length);
    } catch (e) {
      console.error("Erro no scraping da listagem:", e);
      return new Response(JSON.stringify({ error: `Erro ao acessar ${portalConfig.name}: ${e.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Fallback para editoria se a home vier com pouco conteúdo
    if (!htmlContent || htmlContent.length < 15000) {
      if (portalConfig.name === "Portal Amazônia" && !/\/noticias\/amazonas/.test(targetUrl)) {
        try {
          htmlContent = await fetchListHtml("https://portalamazonia.com/noticias/amazonas");
          console.log("Fallback editoria Portalamazonia OK:", htmlContent.length);
        } catch {}
      }
      if (portalConfig.name === "D24AM" && !/\/amazonas/.test(targetUrl)) {
        try {
          htmlContent = await fetchListHtml("https://d24am.com/amazonas/");
          console.log("Fallback editoria D24AM OK:", htmlContent.length);
        } catch {}
      }
    }

    // --- PAGINAÇÃO SIMPLES (2..4) QUANDO PRECISAR ---
    function buildPaginationUrls(config: typeof portalConfig): string[] {
      const origin = new URL(config.baseUrl).origin;
      const base   = config.baseUrl.replace(/\/+$/, "");
      const out: string[] = [];
      for (let i = Math.max(2, paginate.start || 2); i <= Math.max(2, paginate.end || 2); i++) {
        if (base.includes("portaldoholanda.com.br")) {
          out.push(`${origin}/amazonas?page=${i}`);
        } else if (base.includes("portalamazonia.com")) {
          out.push(`${origin}/noticias/amazonas?page=${i}`);
          out.push(`${origin}/noticias/amazonas/page/${i}`);
        } else if (base.includes("acritica.com")) {
          out.push(`${origin}/page/${i}`);
          out.push(`${origin}/noticias/page/${i}`);
        } else if (base.includes("d24am.com")) {
          out.push(`${origin}/amazonas/page/${i}`);
          out.push(`${origin}/page/${i}`);
        }
      }
      return out;
    }

    let newsLinks = extractNewsLinks(htmlContent, portalConfig, 20);
    if (newsLinks.length < 8) {
      for (const u of buildPaginationUrls(portalConfig)) {
        try {
          const html = await fetchListHtml(u);
          const extra = extractNewsLinks(html, portalConfig, 20);
          newsLinks = Array.from(new Set([...newsLinks, ...extra]));
          if (newsLinks.length >= 20) break;
        } catch { /* ignora */ }
      }
    }
    // remove duplicadas já salvas
    newsLinks = newsLinks.filter(u => !existingUrlsSet.has(u));
    if (newsLinks.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: `Todas as notícias recentes do ${portalConfig.name} já foram processadas.`,
        stats: { total_encontradas: 0, processadas_com_sucesso: 0, erros: 0, portal: portalConfig.name }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    console.log(`Processando ${newsLinks.length} notícias novas de ${portalConfig.name}`);

    // --- LOOP DE ARTIGOS ---
    const processedNews: Array<{ titulo: string; fonte: string; url: string; imagem: string }> = [];
    let successCount = 0, errorCount = 0;

    for (const newsUrl of newsLinks.slice(0, 12)) {
      try {
        console.log(`Processando: ${newsUrl}`);

        // Se link “saltar” de domínio (ex.: caderno específico), detecta novamente, mas mantêm portalConfig como fallback
        const articleConfig = detectPortal(newsUrl) || portalConfig;

        // Preferência de AMP (especialmente G1)
        const newsHtml = ampPreferred ? await fetchHtmlPreferAmp(newsUrl, userAgent)
                                      : await (await fetch(newsUrl, { headers: { "User-Agent": userAgent, "Accept": "text/html" }})).text();

        const { titulo, conteudo, resumo, imagem } = extractContentWithRegex(newsHtml, articleConfig);
        if (titulo === "Título não encontrado" || !conteudo || conteudo.length < 120) {
          console.log(`Conteúdo insuficiente: ${newsUrl}`);
          continue;
        }
        if (isBlacklistedTitle(titulo) || looksPromotional(conteudo)) {
          console.log(`Descartado (promo/institucional): ${newsUrl}`);
          continue;
        }

        // Reescrita robusta + antissimilaridade
        const re = await rewriteWithGroq(titulo, conteudo, portalConfig.name);

        // se IA marcou como publieditorial, descarte
        if (re.conteudo === "publieditorial") {
          console.log("IA marcou publieditorial:", newsUrl);
          continue;
        }

        // se veio vazio/curto/sem título, PULE (não salve original!)
        if (!re.titulo || !re.conteudo || re.conteudo.length < 1800) {
          console.warn("Reescrita ausente/insuficiente; pulando:", newsUrl);
          continue;
        }



        const resumoReescrito = re.conteudo.slice(0, 300) + (re.conteudo.length > 300 ? "..." : "");

        // SALVE **APENAS** a versão reescrita
        const noticiaData: NoticiaScrapedData = {
          titulo_original: titulo,
          titulo_reescrito: re.titulo,
          resumo_original: resumo || null,
          resumo_reescrito: resumoReescrito,
          conteudo_reescrito: re.conteudo,
          url_original: newsUrl,
          fonte: portalConfig.name,
          status: "processado",
          data_coleta: new Date().toISOString(),
          imagem_url: imagem || null,
          categoria: portalConfig.category
        };

        console.log("DEBUG_REWRITE", {
        url: newsUrl,
        in_len: conteudo.length,
        out_len: re?.conteudo?.length || 0,
        has_title: !!re?.titulo
      });

        const { error } = await supabaseAdmin.from("noticias_scraped").insert(noticiaData);
        if (error) {
          console.error("Erro ao salvar:", newsUrl, error);
          errorCount++; continue;
        }

        processedNews.push({
          titulo: rewritten?.titulo || titulo,
          fonte: articleConfig.name,
          url: newsUrl,
          imagem: imagem ? "Sim" : "Não",
        });
        successCount++;

        // pausa de cortesia
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        console.error(`Erro ao processar ${newsUrl}:`, err);
        errorCount++;
      }
    }

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

  } catch (error: any) {
    console.error("Erro geral:", error);
    return new Response(JSON.stringify({ error: `Erro interno: ${error.message}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
 

