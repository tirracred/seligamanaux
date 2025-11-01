/* ===================================================
   DARKMODE TOGGLE - SCRIPT SIMPLES
   =================================================== */

document.addEventListener('DOMContentLoaded', function() {
  // Verificar preferência salva
  const prefersDark = localStorage.getItem('darkMode');
  
  if (prefersDark === null) {
    // Primeira vez: ativa dark mode
    document.body.classList.remove('light-mode');
    localStorage.setItem('darkMode', 'true');
  } else if (prefersDark === 'false') {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }
  
  updateToggleButton();
});

// Botão de Dark Mode Toggle
const darkModeBtn = document.querySelector('.dark-mode-toggle');

if (darkModeBtn) {
  darkModeBtn.addEventListener('click', function() {
    document.body.classList.toggle('light-mode');
    
    const isDarkMode = !document.body.classList.contains('light-mode');
    localStorage.setItem('darkMode', isDarkMode ? 'true' : 'false');
    
    updateToggleButton();
  });
}

function updateToggleButton() {
  const darkModeBtn = document.querySelector('.dark-mode-toggle');
  if (!darkModeBtn) return;
  
  const isDarkMode = !document.body.classList.contains('light-mode');
  
  if (isDarkMode) {
    darkModeBtn.innerHTML = '🌙 Dark';
  } else {
    darkModeBtn.innerHTML = '☀️ Light';
  }
}

// Menu Mobile Toggle
const navToggle = document.querySelector('.nav-toggle');
const navPrincipal = document.querySelector('.nav-principal ul');

if (navToggle) {
  navToggle.addEventListener('click', function() {
    navPrincipal.classList.toggle('active');
  });
}

// Fechar menu ao clicar em um link
const navLinks = document.querySelectorAll('.nav-principal a');
navLinks.forEach(link => {
  link.addEventListener('click', function() {
    navPrincipal.classList.remove('active');
  });
});