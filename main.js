

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