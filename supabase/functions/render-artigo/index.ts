// supabase/functions/render-artigo/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =========================
// HEADERS (sem sandbox)
// =========================
const RESPONSE_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  // CSP alinhada com seu front: scripts/estilos inline, Supabase CDN, Google Ads e Google Fonts
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://pagead2.googlesyndication.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src * data: blob:",
    "connect-src *",
    "font-src 'self' https://fonts.gstatic.com",
    "frame-src *"
  ].join("; ")
};

// =========================
// BOT DETECTION (UA)
// =========================
function isBot(ua: string) {
  return /(facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|Google-Structured-Data|pinterest|bingbot|googlebot)/i
    .test(ua);
}

// =========================
// HELPERS
// =========================
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
}

function summarize(text: string, max = 160): string {
  const t = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "..." : t;
}

// HTML mínimo só para bots (OG tags + corpo simples, sem JS)
function botHtml(
  { title, desc, imageUrl, shareUrl }: { title: string; desc: string; imageUrl: string; shareUrl: string; }
): string {
  const safeTitle = escapeAttr(title);
  const safeDesc  = escapeAttr(desc);
  const safeImg   = escapeAttr(imageUrl);
  const safeUrl   = escapeAttr(shareUrl);

  return (
`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${safeTitle} - SeligaManaux</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <meta name="description" content="${safeDesc}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${safeUrl}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:image" content="${safeImg}">
  <meta property="og:site_name" content="SeligaManaux">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="${safeImg}">

  <link rel="icon" type="image/png" href="https://seligamanaux.com.br/public/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
  <style>
    body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;line-height:1.6;color:#111}
    .wrap{max-width:780px;margin:0 auto}
    .title{font-size:1.75rem;font-weight:800;margin:0 0 8px}
    .desc{color:#4b5563;margin:0 0 16px}
    img{max-width:100%;border-radius:8px}
    .note{margin-top:16px;color:#6b7280}
  </style>
</head>
<body>
  <div class="wrap">
    <h1 class="title">${safeTitle}</h1>
    <p class="desc">${safeDesc}</p>
    <img src="${safeImg}" alt="${safeTitle}">
    <p class="note">Prévia para compartilhamento. Abra <a href="${safeUrl}">${safeUrl}</a> no navegador para ler o conteúdo completo.</p>
  </div>
</body>
</html>`
  );
}

// =========================
// EDGE FUNCTION
// =========================
serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: RESPONSE_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const articleId = url.searchParams.get("id");

    if (!articleId) {
      return new Response("Artigo não especificado.", { status: 400, headers: RESPONSE_HEADERS });
    }

    // Supabase client (service role)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Busca a notícia
    const { data: post, error } = await supabase
      .from("noticias")
      .select("id, title, content, category, image_url, headline_colo, videos, created_at")
      .eq("id", articleId)
      .single();

    if (error || !post) {
      return new Response("<h1>Artigo não encontrado</h1>", { status: 404, headers: RESPONSE_HEADERS });
    }

    const shareUrl = `https://seligamanaux.com.br/noticia/${articleId}`;
    const imageUrl = post.image_url || "https://seligamanaux.com.br/public/favicon.png";
    const title    = post.title || "SeligaManaux";
    const desc     = summarize(post.content || "");

    const ua = req.headers.get("user-agent") || "";

    // =========================
    // Navegador → REDIRECT 302 para o estático (artigo.html?id=...)
    // Bot (WhatsApp/FB/Twitter/Telegram etc.) → HTML com OG tags
    // =========================
    if (!isBot(ua)) {
      const target = `https://seligamanaux.com.br/artigo.html?id=${articleId}`;
      return Response.redirect(target, 302);
    }

    // Resposta para bots (OG tags + corpo simples, sem JS)
    const html = botHtml({
      title,
      desc,
      imageUrl,
      shareUrl
    });

    return new Response(html, {
      headers: {
        ...RESPONSE_HEADERS,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Erro interno: ${msg}`, { status: 500, headers: RESPONSE_HEADERS });
  }
});
