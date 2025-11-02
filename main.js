

// URL e Chave Pública (ANON) do seu projeto Supabase
const SUPABASE_URL = 'https://xtnqypmezntjcidglblc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0bnF5cG1lem50amNpZGdsYmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5ODEwMDksImV4cCI6MjA3NzU1NzAwOX0.fz__YKaMuEWjoXVansGZnLgUhsdsg7J1tLCriMhV8Ls';

// Nome da sua tabela
const DB_TABLE = 'noticias';
// Nome do seu bucket no Storage
const STORAGE_BUCKET = 'midia';

// Inicializa o cliente Supabase

let supabase;
try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.error("Erro ao inicializar Supabase:", e);

}


/* =======================
   2. JAVASCRIPT: Menu Toggle
   ======================== */
document.addEventListener('DOMContentLoaded', function() {
    const navToggle = document.querySelector('.nav-toggle');
    const navPrincipal = document.querySelector('.nav-principal');

    if (navToggle && navPrincipal) {
        navToggle.addEventListener('click', function() {

            navPrincipal.classList.toggle('ativo');


            const hamburger = navToggle.querySelector('.hamburger');
            hamburger.classList.toggle('ativo');
        });
    }

    // Adiciona a classe 'ativo' ao link da página atual


    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    let activeLink;

    // Corrigido para lidar com nomes de arquivo com hífens
    if (currentPath === 'index.html' || currentPath === '') {
        activeLink = document.querySelector('.nav-principal a[href="/"]');
    } else if (currentPath === 'ultimasnoticias.html') {
         // Correção para o nome de arquivo antigo
        activeLink = document.querySelector('.nav-principal a[href="ultimas-noticias.html"]');
    }
    else {
        activeLink = document.querySelector(`.nav-principal a[href*="${currentPath}"]`);
    }

    if (activeLink) {
        activeLink.classList.add('ativo');
    }
});
// A CHAVE FECHADA FALTANDO ESTAVA AQUI


/* =======================
   3. LÓGICA DO DARK MODE
   ======================== */

// Seleciona os elementos
const themeToggle = document.getElementById('theme-toggle');
const body = document.body;

// Função para aplicar o tema
function applyTheme(theme) {
    if (theme === 'dark') {
        body.classList.add('dark-mode');
        if (themeToggle) themeToggle.checked = true;
    } else {
        body.classList.remove('dark-mode');
        if (themeToggle) themeToggle.checked = false;
    }
}

// Função para salvar a preferência
function saveTheme(theme) {
    localStorage.setItem('theme', theme);
}

// Adiciona o Event Listener para o botão
if (themeToggle) {
    themeToggle.addEventListener('change', () => {
        if (themeToggle.checked) {
            applyTheme('dark');
            saveTheme('dark');
        } else {
            applyTheme('light');
            saveTheme('light');
        }
    });
}

// Verifica o tema salvo no localStorage ou a preferência do sistema
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme) {
        applyTheme(savedTheme);
    } else {
        // Padrão é Dark Mode (Gemini/Seu pedido)
        applyTheme('dark');
    }
});

/* ============================================================
   SCRAPING COM GROQ - SOLUÇÃO SIMPLIFICADA SEM ERROS SQL
   Adicione apenas 2 funções ao seu main.js
   ============================================================ */

// 1️⃣ FUNÇÃO PARA REESCREVER COM GROQ (Simples e Direta)
async function reescreverComGroq(texto) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer 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",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-32768",
        messages: [{
          role: "user",
          content: `Reescreva este texto mantendo significado mas mudando palavras. Seja breve:\n\n${texto.substring(0, 500)}`
        }],
        temperature: 0.6,
        max_tokens: 250
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Erro Groq:", error);
    return texto;
  }
}

// 2️⃣ FUNÇÃO PARA SCRAPING DO RSS DO G1 (Simples e Direta)
async function scrapingG1Direto() {
  try {
    alert("⏳ Buscando notícias do G1... Aguarde...");
    
    // Fetch RSS do G1
    const response = await fetch("https://g1.globo.com/feed.rss");
    const rssText = await response.text();
    
    // Parse simples
    const articles = [];
    const itemRegex = /<item>(.*?)<\/item>/gs;
    for (const match of rssText.matchAll(itemRegex)) {
      const item = match[1];
      
      const titleMatch = item.match(/<title>(.*?)<\/title>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      const descMatch = item.match(/<description>(.*?)<\/description>/);
      
      if (titleMatch && linkMatch) {
        articles.push({
          title: titleMatch[1].replace(/<[^>]*>/g, ""),
          link: linkMatch[1],
          description: descMatch ? descMatch[1].replace(/<[^>]*>/g, "") : ""
        });
      }
    }
    
    if (articles.length === 0) {
      alert("❌ Nenhum artigo encontrado");
      return;
    }
    
    alert(`✓ Encontrados ${articles.length} artigos. Reescrevendo...`);
    
    // Reescrever primeiros 5 artigos
    let adicionados = 0;
    for (let i = 0; i < Math.min(5, articles.length); i++) {
      const article = articles[i];
      
      // Reescrever
      const novoTitulo = await reescreverComGroq(article.title);
      const novoResumo = await reescreverComGroq(article.description.substring(0, 300));
      
      // Inserir na tabela noticias
      const { error } = await supabase.from('noticias').insert({
        titulo: novoTitulo,
        resumo: novoResumo,
        conteudo: novoResumo,
        categoria: "Notícias",
        data_publicacao: new Date().toISOString()
      });
      
      if (!error) {
        adicionados++;
        console.log(`✓ Publicado: ${novoTitulo.substring(0, 50)}`);
      }
    }
    
    alert(`✅ ${adicionados} notícias publicadas com sucesso!`);
    location.reload();
    
  } catch (error) {
    alert("❌ Erro: " + error.message);
    console.error(error);
  }
}