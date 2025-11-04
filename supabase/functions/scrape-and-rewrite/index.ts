import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { DOMParser, Element } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import Groq from "npm:groq-sdk";

// --- HEADERS CORS ---
// ESTE BLOCO É A SOLUÇÃO PARA O SEU ERRO
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Permite seu site
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', // Permite os métodos POST e OPTIONS
  'Access-Control-Max-Age': '86400',
};

// --- INTERFACES DE DADOS ---

interface ArticleData {
  titulo_original: string;
  url_original: string;
  imagem_url: string | null;
  conteudo_original_bruto: string; // Texto bruto extraído
}

interface GroqResponseOutput {
  titulo_reescrito: string;
  artigo_reescrito: string;
  resumo_reescrito: string;
  tags_sugeridas: string[];
}

interface PortalConfig {
  idPortal: string;
  baseURL: string;
  linkSelector: string; // Seletor para os links <a> na página inicial
  articleSelectors: {
    content: string; // Seletor para o CONTAINER do artigo
    title: string;   // Seletor para o H1 do título
    image?: string;  // Seletor opcional para a imagem <img>
  };
  linkFilter?: (url: string) => boolean; // Filtro para descartar links indesejados
}

// --- CONFIGURAÇÃO MESTRA DOS PORTAIS (O "PAINEL DE CONTROLE") ---
const PORTAIS_CONFIG: Record<string, PortalConfig> = {
  'g1-am': {
    idPortal: 'g1-am',
    baseURL: 'https://g1.globo.com/am/amazonas/',
    linkSelector: 'a.feed-post-link', // Seletor rigoroso
    articleSelectors: {
      content: 'div[itemprop="articleBody"], div.mc-article-body',
      title: 'h1.content-head__title, h1.content-post__title',
      image: 'img.content-media-image__image',
    },
    linkFilter: (url: string) => url.includes('/am/amazonas/'),
  },
  'a-critica': {
    idPortal: 'a-critica',
    baseURL: 'https://www.acritica.com/',
    linkSelector: 'a.m-feed-item__link, a[href*="/manaus/"], a[href*="/geral/"]',
    articleSelectors: {
      content: 'div.article-content__body, div.article__body',
      title: 'h1.article-content__title, h1.article__title',
      image: 'div.article-content__featured-image img',
    },
    linkFilter: (url: string) => (url.includes('/noticia/') || url.includes('/geral/')) && !url.includes('/tags/'),
  },
  'portal-holanda': {
    idPortal: 'portal-holanda',
    baseURL: 'https://www.portaldoholanda.com.br/',
    linkSelector: 'a[href*="/manaus/"], a[href*="/amazonas/"], a[href*="/policial/"]',
    articleSelectors: {
      content: 'div.article-full__content, div.node-content',
      title: 'h1.article-full__title, h1.page-title',
      image: 'div.article-full__image img',
    },
    linkFilter: (url: string) => !url.includes('/tags/'),
  },
  'em-tempo': {
    idPortal: 'em-tempo',
    baseURL: 'https://emtempo.com.br/',
    linkSelector: 'a.card-post__title__link, a.slider-post__title__link, h3.title-post > a',
    articleSelectors: {
      content: 'div.post-content__entry, div.content-post',
      title: 'h1.post-title, h1.title-post',
      image: 'div.post-featured-image img',
    },
    linkFilter: (url: string) => /\/\d{6,}\//.test(url),
  },
  'amazonas-atual': {
    idPortal: 'amazonas-atual',
    baseURL: 'https://amazonasatual.com.br/',
    linkSelector: 'a.post-title-link, h3.entry-title > a',
    articleSelectors: {
      content: 'div.td-post-content, div.entry-content',
      title: 'h1.td-post-title, h1.entry-title',
      image: 'div.td-post-featured-image img',
    },
    linkFilter: (url: string) => !url.includes('/colunista/'),
  },
  'radar-amazonico': {
    idPortal: 'radar-amazonico',
    baseURL: 'https://radaramazonico.com.br/',
    linkSelector: 'h2.post-title > a, a.post-link',
    articleSelectors: {
      content: 'div.entry-content, div.single-post-content',
      title: 'h1.entry-title, h1.post-title',
      image: 'div.post-image img',
    },
    linkFilter: (url: string) => !url.includes('/assunto/'),
  },
  'portal-amazonia': {
    idPortal: 'portal-amazonia',
    baseURL: 'https://portalamazonia.com/',
    linkSelector: 'div.recent-post-item a, a.title-link, a.post-title',
    articleSelectors: {
      content: 'div.post-content, div.entry-content, article.post-text',
      title: 'h1.post-title, h1.entry-title, h1.post-name',
      image: 'div.post-image img, div.post-thumb img',
    },
    linkFilter: (url: string) => (url.includes('/noticias/') || url.includes('/materias/')) && !url.includes('/tags/'),
  }
};

// --- FUNÇÃO PRINCIPAL (EDGE FUNCTION) ---

Deno.serve(async (req) => {
  // Trata a requisição OPTIONS (preflight) - É ISSO QUE CORRIGE O ERRO
  // O navegador envia um 'OPTIONS' antes do 'POST'. Temos que responder 'ok'.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 1. INICIALIZAÇÃO DOS CLIENTES
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const groq = new Groq({
    apiKey: Deno.env.get("GROQ_API_KEY"),
  });

  // 2. VALIDAÇÃO DO BODY (ESPERA UM "portalId")
  let portalId: string;
  try {
    const body = await req.json();
    portalId = body.portalId;
    if (!portalId) {
      throw new Error("portalId é obrigatório no body");
    }
  } catch (error) {
    // Se der erro no Body, também envia o header CORS
    return new Response(JSON.stringify({ error: `Body inválido: ${error.message}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const portalConfig = PORTAIS_CONFIG[portalId];
  if (!portalConfig) {
    return new Response(JSON.stringify({ error: `Portal '${portalId}' não suportado` }), {
      status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[${portalConfig.idPortal}] Iniciando scraper...`);

  // 3. BUSCAR URLs JÁ PROCESSADAS (EVITAR DUPLICIDADE)
  const { data: existingUrlsData, error: dbError } = await supabaseAdmin
    .from('noticias_scraped')
    .select('url_original')
    .eq('fonte', portalConfig.idPortal) // Usando 'fonte' (o nome correto da sua coluna)
    .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()); // 3 dias

  if (dbError) {
     console.error(`[${portalConfig.idPortal}] Erro ao buscar URLs existentes: ${dbError.message}`);
     // Não fatal, continua mesmo assim
  }
  
  const existingUrlsSet = new Set(existingUrlsData?.map(item => item.url_original) || []);
  console.log(`[${portalConfig.idPortal}] ${existingUrlsSet.size} URLs já processadas nos últimos 3 dias.`);

  // 4. EXTRAIR NOVOS LINKS (Função Corrigida)
  const newLinks = await extractNewsLinks(portalConfig, existingUrlsSet);
  if (newLinks.length === 0) {
    return new Response(JSON.stringify({ message: `[${portalConfig.idPortal}] Nenhuma notícia nova encontrada.` }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`[${portalConfig.idPortal}] Processando ${newLinks.length} notícias novas...`);

  // 5. PROCESSAR CADA LINK EM PARALELO
  let successCount = 0;
  let ignoredCount = 0;
  let failedCount = 0;

  const processingPromises = newLinks.map(async (url) => {
    try {
      // 5.1. Extrair conteúdo do artigo (Função Corrigida)
      const originalArticle = await extractArticleContent(url, portalConfig);
      if (!originalArticle) {
        console.warn(`[${portalConfig.idPortal}] Conteúdo não extraído: ${url}`);
        ignoredCount++;
        return;
      }
      
      // 5.2. Limpar e Reescrever com IA (Função Corrigida)
      const groqResult = await rewriteWithGroq(groq, originalArticle);
      
      // 5.3. Salvar no Supabase (Função Corrigida)
      if (typeof groqResult === 'object') {
        await saveToSupabase(supabaseAdmin, groqResult, originalArticle, portalConfig.idPortal);
        successCount++;
      } else {
        // 'CONTEÚDO IGNORADO' (muito curto ou falha da IA)
        ignoredCount++;
      }
    } catch (error) {
      console.error(`[${portalConfig.idPortal}] Falha crítica ao processar ${url}: ${error.message}`);
      failedCount++;
    }
  });
  
  await Promise.allSettled(processingPromises);

  const summary = `[${portalConfig.idPortal}] Scraper finalizado. Salvas: ${successCount}. Ignoradas (curtas/sem conteúdo): ${ignoredCount}. Falhas: ${failedCount}.`;
  console.log(summary);
  
  // Resposta final de sucesso, TAMBÉM inclui o header CORS
  return new Response(JSON.stringify({ message: summary, saved: successCount, ignored: ignoredCount, failed: failedCount }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

// --- FUNÇÕES AUXILIARES (A LÓGICA DO ROBÔ) ---

/**
 * [CORRIGIDO]
 * Busca a página inicial do portal e extrai os links de notícias.
 * A LÓGICA DE FALLBACK FOI REMOVIDA.
 */
async function extractNewsLinks(portalConfig: PortalConfig, existingUrlsSet: Set<string>): Promise<string[]> {
  const { baseURL, linkSelector, linkFilter } = portalConfig;
  const userAgent = "SeligaManaux-Scraper/1.0 (+https://seligamanaux.com.br/sobre)";
  
  try {
    const response = await fetch(baseURL, { headers: { 'User-Agent': userAgent } });
    if (!response.ok) {
      console.error(`[${portalConfig.idPortal}] Falha ao buscar URL principal: ${response.status}`);
      return [];
    }
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return [];

    const links = new Set<string>();
    const elements = doc.querySelectorAll(linkSelector);

    elements.forEach((el) => {
      const element = el as Element;
      const href = element.getAttribute('href');
      if (!href || href === '#') return;

      // Normaliza a URL
      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(href, baseURL).href;
      } catch (e) {
        console.warn(`[${portalConfig.idPortal}] URL inválida encontrada: ${href}`);
        return;
      }
      
      // Remove parâmetros de tracking (comuns em portais)
      const urlSemTracking = absoluteUrl.split('?')[0].split('#')[0];

      // 1. Aplicar filtro de URL (se existir)
      if (linkFilter && !linkFilter(urlSemTracking)) {
        return;
      }

      // 2. Verificar se já existe no DB
      if (!existingUrlsSet.has(urlSemTracking)) {
        links.add(urlSemTracking);
      }
    });

    console.log(`[${portalConfig.idPortal}] Encontrados ${links.size} links novos (rigorosos).`);
    return Array.from(links);

  } catch (error) {
    console.error(`[${portalConfig.idPortal}] Erro ao extrair links: ${error.message}`);
    return [];
  }
}

/**
 * [CORRIGIDO]
 * Visita a página do artigo e extrai o conteúdo usando os seletores do PORTAIS_CONFIG.
 * Resolve o problema do "artigo de duas linhas".
 */
async function extractArticleContent(url: string, config: PortalConfig): Promise<ArticleData | null> {
  const { articleSelectors } = config;
  const userAgent = "SeligaManaux-Scraper/1.0 (+https://seligamanaux.com.br/sobre)";

  try {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
    if (!response.ok) {
      console.error(`[${config.idPortal}] Falha ao buscar artigo: ${url} (Status: ${response.status})`);
      return null;
    }
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return null;

    // Função interna para tentar múltiplos seletores
    const querySelector = (selectors: string): Element | null => {
      for (const selector of selectors.split(',')) {
        const el = doc.querySelector(selector.trim());
        if (el) return el as Element;
      }
      return null;
    };

    // Extrair Título
    const titleEl = querySelector(articleSelectors.title);
    const titulo_original = titleEl ? titleEl.textContent.trim() : 'Título não encontrado';

    // Extrair Imagem
    let imagem_url: string | null = null;
    if (articleSelectors.image) {
      const imgEl = querySelector(articleSelectors.image);
      if (imgEl) {
        // Prioriza 'data-src' (lazy loading) e depois 'src'
        const src = imgEl.getAttribute('data-src') || imgEl.getAttribute('src');
        if(src) {
           imagem_url = new URL(src, config.baseURL).href;
        }
      }
    }
    
    // Extrair Conteúdo (O Ponto Crítico)
    const contentEl = querySelector(articleSelectors.content);
    if (!contentEl) {
      console.warn(`[${config.idPortal}] SELETOR DE CONTEÚDO FALHOU para: ${url}`);
      return null;
    }
    
    // Usamos textContent para pegar o texto bruto, como instruído na sua análise
    const conteudo_original_bruto = contentEl.textContent;

    return {
      titulo_original,
      url_original: url,
      imagem_url,
      conteudo_original_bruto,
    };
  } catch (error) {
    console.error(`[${config.idPortal}] Erro ao extrair conteúdo de ${url}: ${error.message}`);
    return null;
  }
}

/**
 * [NOVO]
 * Unidade de descontaminação. Limpa o texto bruto antes de enviar à IA.
 * Resolve o problema do "glb.cdnConfig".
 */
function cleanHtmlContent(text: string): string {
  let cleanedText = text;

  // 1. Remover lixo específico (glb.cdnConfig e outros scripts comuns)
  // [sS] significa "qualquer caractere, incluindo novas linhas"
  cleanedText = cleanedText.replace(/\bglb\.cdnConfig\s*=\s*\{[\s\S]*?\}\s*;/gim, '');
  cleanedText = cleanedText.replace(/window\._*INITIAL_STATE_* = \{[\s\S]*?\}\s*;/gim, '');

  // 2. Remover scripts e styles (embora .textContent já ajude)
  cleanedText = cleanedText.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gim, '');
  cleanedText = cleanedText.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gim, '');

  // 3. Remover comentários HTML
  cleanedText = cleanedText.replace(/<!--[\s\S]*?-->/g, '');

  // 4. Remover tags HTML (se .textContent falhou e pegou innerHTML)
  cleanedText = cleanedText.replace(/<[^>]+>/g, ' ');

  // 5. Limpar espaçamento e normalizar parágrafos
  cleanedText = cleanedText.replace(/[\t\r\n]+/g, '\n'); // Troca tabs/breaks por \n
  cleanedText = cleanedText.replace(/ +/g, ' '); // Remove espaços múltiplos
  cleanedText = cleanedText.replace(/(\n ?)+/g, '\n\n'); // Normaliza parágrafos
  
  return cleanedText.trim();
}

/**
 * [CORRIGIDO]
 * Envia o texto limpo para a IA com o novo prompt de segurança.
 * Resolve o problema de salvar "artigos de duas linhas".
 */
async function rewriteWithGroq(groq: Groq, article: ArticleData): Promise<GroqResponseOutput | string> {
  const { titulo_original, url_original, conteudo_original_bruto } = article;
  
  // 1. Limpeza primeiro
  const textoLimpo = cleanHtmlContent(conteudo_original_bruto);

  // 2. TRAVA DE SEGURANÇA #1 (Economia de API)
  if (textoLimpo.length < 150) { // Aumentado para 150 para mais segurança
    console.warn(`[Groq] Texto ignorado (muito curto: ${textoLimpo.length} chars): ${url_original}`);
    return 'CONTEÚDO IGNORADO';
  }

  // 3. O Prompt de Sistema (Conforme sua análise)
  const systemPrompt = `Você é um assistente de IA e jornalista de redação para o portal "SeligaManaux". Sua função é reescrever notícias.

INSTRUÇÕES PRINCIPAIS:
1.  **Reescrita:** Você receberá um "Texto Original", "Título Original" e "URL Original".
2.  **Tom e Estilo:** Reescreva o artigo de forma imparcial, objetiva e com linguagem clara. Use um tom regional (Manaus/Amazonas) leve, mencionando "Manaus" ou "Amazonas" se relevante, mas sem exageros.
3.  **Não Alucine:** Baseie-se *estritamente* no "Texto Original". Não adicione informações que não estejam lá.
4.  **Formato de Saída:** Responda *apenas* com um objeto JSON válido, contendo as chaves: "titulo_reescrito", "artigo_reescrito", "resumo_reescrito" (máximo de 2 frases), e "tags_sugeridas" (array de 5 strings).

INSTRUÇÃO DE SEGURANÇA (A MAIS IMPORTANTE):
5.  **Filtro de Conteúdo Inútil:** Se o "Texto Original" fornecido tiver menos de 100 palavras, ele é provavelmente um resumo, um link de 'leia mais', ou lixo de scraper. Neste caso, você deve IGNORAR todas as outras instruções e responder *apenas* com a string "CONTEÚDO IGNORADO".`;

  const userPrompt = `
---
URL Original: "${url_original}"
---
Título Original: "${titulo_original}"
---
Texto Original:
"${textoLimpo}"
---
`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      model: "llama3-8b-8192", // Modelo mais rápido para processamento em lote
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const responseContent = chatCompletion.choices[0]?.message?.content;
    if (!responseContent) {
      throw new Error("Groq retornou resposta vazia.");
    }

    // 4. TRAVA DE SEGURANÇA #2 (Vindo da IA)
    if (responseContent.trim() === 'CONTEÚDO IGNORADO') {
      console.warn(`[Groq] IA ignorou conteúdo (regra < 100 palavras): ${url_original}`);
      return 'CONTEÚDO IGNORADO';
    }

    // Parse da resposta JSON
    const jsonResponse: GroqResponseOutput = JSON.parse(responseContent);
    return jsonResponse;

  } catch (error) {
    console.error(`[Groq] Erro ao reescrever ${url_original}: ${error.message}`);
    // Se a IA falhar (ex: JSON inválido), também ignoramos
    return 'CONTEÚDO IGNORADO'; 
  }
}

/**
 * [CORRIGIDO]
 * Salva a notícia processada no Supabase.
 * Usa 'fonte' em vez de 'fonte_portal'.
 */
async function saveToSupabase(supabase: SupabaseClient, data: GroqResponseOutput, originalArticle: ArticleData, portalId: string) {
  
  const insertData = {
    titulo_original: originalArticle.titulo_original,
    titulo_reescrito: data.titulo_reescrito,
    resumo_reescrito: data.resumo_reescrito,
    conteudo_reescrito: data.artigo_reescrito,
    url_original: originalArticle.url_original,
    imagem_url: originalArticle.imagem_url,
    tags: data.tags_sugeridas, // Sua tabela precisa de uma coluna 'tags' (tipo text[] ou jsonb)
    fonte: portalId, // <--- CORRIGIDO PARA 'fonte'
    status: 'pending_review',
    data_coleta: new Date().toISOString(),
    categoria: portalId, // Usando o idPortal como categoria inicial
  };
  
  const { data: inserted, error } = await supabase
    .from('noticias_scraped')
    .insert(insertData)
    .select('id'); // Apenas retorna o ID para economizar banda

  if (error) {
    console.error(`[Supabase] Erro ao salvar ${originalArticle.url_original}: ${error.message}`);
    // Dica para o usuário caso a coluna 'tags' não exista
    if (error.code === '42703' && error.message.includes('column "tags"')) {
         console.error(`[Supabase] DICA: A coluna 'tags' não existe. Crie-a na tabela 'noticias_scraped' (tipo 'text[]' ou 'jsonb').`);
    }
  } else {
    console.log(`[Supabase] Notícia salva com sucesso (ID: ${inserted[0].id}): ${data.titulo_reescrito}`);
  }
}


