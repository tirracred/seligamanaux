import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // 1. Handle CORS (para requisições do navegador)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const reqUrl = new URL(req.url);
    const articleId = reqUrl.searchParams.get("id");

    // 2. Se não tiver ID, retorna 404 ou redireciona para home
    if (!articleId) {
      return new Response("Artigo não especificado.", { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // 3. Conectar ao Supabase
    // OBS: Garanta que estas variáveis estão definidas no seu .env ou nos secrets do Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // Use Service Role para garantir leitura sem RLS atrapalhar
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 4. Buscar os dados do artigo
    const { data: post, error } = await supabase
      .from("noticias")
      .select("title, content, category, image_url, created_at")
      .eq("id", articleId)
      .single();

    if (error || !post) {
       return new Response("<h1>Artigo não encontrado</h1>", { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // 5. Preparar dados para injeção
    // Cria um resumo simples removendo HTML
    const cleanDescription = (post.content || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 150) + "...";
    
    // Escapa aspas duplas para não quebrar as meta tags
    const safeTitle = (post.title || "").replace(/"/g, '&quot;');
    const safeDescription = cleanDescription.replace(/"/g, '&quot;');
    const imageUrl = post.image_url || "https://seligamanaux.com.br/public/favicon.png";
    
    // A URL que vai aparecer no compartilhamento
    const shareUrl = `https://seligamanaux.com.br/artigo.html?id=${articleId}`;

    // 6. INJETAR DADOS NO TEMPLATE HTML
    let finalHtml = HTML_TEMPLATE
      .replace(/{{TITLE}}/g, safeTitle)
      .replace(/{{DESCRIPTION}}/g, safeDescription)
      .replace(/{{IMAGE_URL}}/g, imageUrl)
      .replace(/{{SHARE_URL}}/g, shareUrl)
      .replace(/{{CATEGORY}}/g, post.category || 'Geral')
      .replace(/{{ARTICLE_ID}}/g, articleId);

    // 7. Retornar HTML
    return new Response(finalHtml, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        // Cache de 1 minuto no CDN, 10 minutos no navegador
        "Cache-Control": "public, s-maxage=60, max-age=600", 
      },
    });

  } catch (error) {
    return new Response(`Erro interno: ${error.message}`, { status: 500 });
  }
});

// ====================================================================
// TEMPLATE HTML BASEADO NO SEU ARTIGO.HTML
// ====================================================================
const HTML_TEMPLATE = `
<!DOCTYPE html>
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
                <a href="https://seligamanaux.com.br/">
                    <img src="https://seligamanaux.com.br/public/favicon.png" alt="Logo SLM" style="height: 4em; display: inline-block; vertical-align: middle; margin: 0;">
                </a>
            </div>
            <button class="nav-toggle" aria-label="Abrir menu"><span class="hamburger"></span></button>
            <nav class="nav-principal">
                <ul>
                    <li><a href="https://seligamanaux.com.br/ultimasnoticias.html">Últimas Notícias</a></li>
                    <li><a href="https://seligamanaux.com.br/manauseregião.html">Manaus e Região</a></li>
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
            <div id="server-content" style="opacity: 0.7;">
                <span class="categoria-tag">{{CATEGORY}}</span>
                <h1 class="page-title" style="border-bottom: none; margin: 0.5rem 0; line-height: 1.2;">{{TITLE}}</h1>
            </div>
            
            <div id="loading-message" style="text-align: center; padding: 4rem 0;">
                <p style="font-size: 1.2rem; color: var(--texto-secundario);">Carregando conteúdo completo...</p>
            </div>
        </article>
    </main>

    <footer class="site-footer">
        <p>&copy; 2025 SeligaManaux. Grupo Tirracred.</p>
    </footer>

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="https://seligamanaux.com.br/main.js"></script>
    
    <script>
        // Injeta o ID vindo do servidor se disponível, senão pega da URL
        const SERVER_ARTICLE_ID = "{{ARTICLE_ID}}"; 
        
        document.addEventListener('DOMContentLoaded', () => {
            const articleContainer = document.getElementById('article-container');
            const loadingMessage = document.getElementById('loading-message');

            // ... (Resto da sua função formatTimestamp igual ao original) ...
            function formatTimestamp(dateString) {
                const date = new Date(dateString);
                return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            }

            async function loadArticle() {
                // Prioriza o ID que já veio do servidor
                const articleId = SERVER_ARTICLE_ID || new URLSearchParams(window.location.search).get('id');

                if (!articleId || articleId === "{{ARTICLE_ID}}") { // Validação extra caso a replace falhe
                     loadingMessage.innerHTML = '<p>Artigo não especificado.</p>'; return;
                }
                
                if (!supabase) { console.error("Supabase off"); return; }

                try {
                    // Busca o artigo completo (com vídeos, conteúdo HTML, etc)
                    const { data: post, error } = await supabase
                        .from(DB_TABLE)
                        .select('id, title, content, category, image_url, headline_colo, videos, created_at')
                        .eq('id', articleId) 
                        .single();

                    if (error) throw error;
                    if (post) renderArticle(post);

                } catch (err) {
                    console.error("Erro ao carregar completo:", err);
                    loadingMessage.innerHTML = '<p>Erro ao carregar conteúdo completo.</p>';
                }
            }

            function renderArticle(post) {
                document.title = \`\${post.title} - SeligaManaux\`;
                loadingMessage.style.display = 'none';
                
                // Remove o conteúdo pré-renderizado pelo servidor para não duplicar
                const serverContent = document.getElementById('server-content');
                if (serverContent) serverContent.remove();

                const formattedContent = post.content.split('\\n').filter(p => p.trim() !== '').map(p => \`<p>\${p}</p>\`).join(''); 
                const titleColor = post.headline_colo || '#059669';

                articleContainer.innerHTML = \`
                    <span class="categoria-tag">\${post.category || 'Geral'}</span>
                    <h1 class="page-title" style="color: \${titleColor}; border-bottom: none; margin: 0.5rem 0 0.5rem 0; line-height: 1.2;">\${post.title}</h1>
                    <p class="article-meta">Publicado em \${formatTimestamp(post.created_at)}</p>
                    \${post.image_url ? \`<img src="\${post.image_url}" alt="\${post.title}" class="article-image">\` : ''}
                    \${post.videos ? \`<div style="margin: 20px 0;"><video controls style="width: 100%; max-width: 800px; border-radius: 8px;"><source src="\${post.videos}" type="video/mp4"></video></div>\` : ''}
                    <div class="article-body">\${formattedContent}</div>
                \`;
            }

            loadArticle();
        });
    </script>
</body>
</html>
`;
