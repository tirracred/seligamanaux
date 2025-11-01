/* =======================
   1. CONFIGURAÇÃO DO SUPABASE
   ======================== */

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
    supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.error("Erro ao inicializar Supabase:", e);
    alert("Erro: Não foi possível conectar ao Supabase.");
}


/* =======================
   2. JAVASCRIPT: Menu Toggle
   ======================== */
document.addEventListener('DOMContentLoaded', function() {
    const navToggle = document.querySelector('.nav-toggle');
    const navPrincipal = document.querySelector('.nav-principal');

    if (navToggle && navPrincipal) {
        navToggle.addEventListener('click', function() {
            // Alterna a classe 'ativo' na navegação
            navPrincipal.classList.toggle('ativo');

            // Animação do Hamburger para "X" (opcional)
            const hamburger = navToggle.querySelector('.hamburger');
            hamburger.classList.toggle('ativo');
        });
    }

    // Adiciona a classe 'ativo' ao link da página atual
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    let activeLink;

    if (currentPath === 'index.html') {
        activeLink = document.querySelector('.nav-principal a[href="/"]');
    } else {
        activeLink = document.querySelector(`.nav-principal a[href="${currentPath}"]`);
    }

    if (activeLink) {
        activeLink.classList.add('ativo');
    }
});