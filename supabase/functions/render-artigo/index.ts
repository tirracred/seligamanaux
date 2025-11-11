import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// === NOVOS CABEÇALHOS DE RESPOSTA ===
const RESPONSE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",

  // ESTA É A NOVA POLÍTICA DE SEGURANÇA
  // Ela diz que é permitido rodar scripts e estilos "inline"
  // e carregar conteúdo de qualquer lugar (*).
  "Content-Security-Policy": "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src *; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline';",
};
// ===================================

serve(async (req) => {
  // Trata requisições OPTIONS (CORS)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: RESPONSE_HEADERS });
  }

  try {
    const reqUrl = new URL(req.url);
    const articleId = reqUrl.searchParams.get("id");

    if (!articleId) {
      return new Response("Artigo não especificado.", { 
        status: 404, 
        headers: RESPONSE_HEADERS 
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: post, error } = await supabase
      .from("noticias")
      .select("id, title, content, category, image_url, headline_colo, videos, created_at")
      .eq("id", articleId)
      .single();

    if (error || !post) {
       return new Response("<h1>Artigo não encontrado</h1>", { 
         status: 404, 
         headers: RESPONSE_HEADERS 
       });
    }

    const cleanDesc = (post.content || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 160) + "...";
    
    const safeTitle = (post.title || "").replace(/"/g, '&quot;');
    const safeDesc = cleanDesc.replace(/"/g, '&quot;');
    const imageUrl = post.image_url || "https://seligamanaux.com.br/public/favicon.png";
    const shareUrl = `https://seligamanaux.com.br/noticia/${articleId}`;

    let finalHtml = HTML_TEMPLATE
      .replace(/{{TITLE}}/g, safeTitle)
      .replace(/{{DESCRIPTION}}/g, safeDesc)
      .replace(/{{IMAGE_URL}}/g, imageUrl)
      .replace(/{{SHARE_URL}}/g, shareUrl)
      .replace(/{{CATEGORY}}/g, post.category || 'Geral')
      .replace(/{{ARTICLE_ID}}/g, articleId)
      .replace('{{POST_DATA_JSON}}', JSON.stringify(post).replace(/</g, '\\u003c'));

    // Retorna o HTML final
    return new Response(finalHtml, {
      headers: {
        ...RESPONSE_HEADERS,
        // FORÇA O NAVEGADOR A NÃO USAR CACHE (para testes)
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });

  } catch (error) {
    return new Response(`Erro interno: ${error.message}`, { status: 500, headers: RESPONSE_HEADERS });
  }
});

// O TEMPLATE HTML (COLE O DA RESPOSTA ANTERIOR AQUI, ELE ESTAVA CORRETO)
const HTML_TEMPLATE = \`<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}} - SeligaManaux</title>
    <meta name="description" content="{{DESCRIPTION}}">

    <meta property="og:type" content="article">
    <meta property="og:url" content="{{SHARE_URL}}">
    <meta property="og:title" content="{{TITLE}}">
    <meta property="og:description" content="{{DESCRIPTION}}">
    <meta property="og:image" content="{{IMAGE_URL}}">
    <meta property="og:site_name" content="SeligaManaux">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{{TITLE}}">
    <meta name="twitter:description" content="{{DESCRIPTION}}">
    <meta name="twitter:image" content="{{IMAGE_URL}}">

    <link rel="icon" type="image/png" href="https://seligamanaux.com.br/public/favicon.png"/>
    <link rel="stylesheet" href="https://seligamanaux.com.br/style.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
    
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4935884639623224" crossorigin="anonymous"></script>
</head>
<body>
    <header class="site-header">
        <div class="header-container">
            <div class="logo">
                <a href="/">
                    <img src="https://seligamanaux.com.br/public/favicon.png" alt="Logo SLM" style="height: 4em; display: inline-block; vertical-align: middle; margin: 0;">
                </a>
            </div>
            <button class="nav-toggle" aria-label="Abrir menu"><span class="hamburger"></span></button>
            <nav class="nav-principal">
                <ul>
                    <li><a href="/ultimasnoticias.html">Últimas Notícias</a></li>
                    <li><a href="/manauseregião.html">Manaus e Região</a></li>
                    <li><a href="https://www.instagram.com/seligamanaux/" target="_blank">Instagram</a></li>
                </ul>
                <div class="theme-switch-wrapper">
                    <label class="theme-switch" for="theme-toggle">
                        <input type="checkbox" id="theme-toggle" />
                        <span class="slider"></span>
                    </label>
                </div>
            </nav>
        </div>
    </header>

    <div class="denuncia-banner" style="background: #ffe600; text-align: center; padding: 0.5rem 1rem;">
        <a href="https://wa.me/5516993003322" target="_blank" style="color: rgb(0, 0, 0); font-weight: 700; font-size: 1.1rem; display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none;">
            Quero fazer uma denúncia!
        </a>
    </div>

    <main class="container">
        <article id="article-container">
            <div id="server-content">
                <span class="categoria-tag">{{CATEGORY}}</span>
                <h1 class="page-title" style="border-bottom: none; margin: 0.5rem 0; line-height: 1.2;">{{TITLE}}</h1>
            </div>
            <div id="loading-message" style="text-align: center; padding: 2rem 0; color: gray;">
                Carregando matéria completa...
            </div>
        </article>
    </main>

    <footer class="site-footer">
        <p>&copy; 2025 SeligaManaux. Grupo Tirracred.</p>
    </footer>

    <script src="https://seligamanaux.com.br/main.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const postData = {{POST_DATA_JSON}};
            const container = document.getElementById('article-container');

            if (postData && container) {
                document.getElementById('loading-message').style.display = 'none';
                document.getElementById('server-content').remove();

                const date = new Date(postData.created_at);
                const formattedDate = date.toLocaleString('pt-BR');
                const formattedContent = (postData.content || '').split('\\n').filter(p => p.trim() !== '').map(p => \`<p>\${p}</p>\`).join(''); 

                container.innerHTML = \`
                    <span class="categoria-tag">\${postData.category || 'Geral'}</span>
                    <h1 class="page-title" style="color: \${postData.headline_colo || '#059669'}; border-bottom: none; margin: 0.5rem 0 0.5rem 0; line-height: 1.2;">
                        \${postData.title}
                    </h1>
                    <p class="article-meta">Publicado em \${formattedDate}</p>
                    \${postData.image_url ? \`<img src="\${postData.image_url}" alt="\${postData.title}" class="article-image">\` : ''}
                    \${postData.videos ? \`<div style="margin: 20px 0;"><video controls style="width: 100%; max-width: 800px; border-radius: 8px;"><source src="\${postData.videos}" type="video/mp4"></video></div>\` : ''}
                    <div class="article-body">\${formattedContent}</div>
                \`;
            }
                
        });

    </script>
</body>
</html>\`;