import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { load } from 'https://esm.sh/cheerio@1.0.0-rc.12';
import Groq from 'https://esm.sh/groq-sdk@0.5.0';
import { corsHeaders } from '../_shared/cors.ts';

// --- INTERFACES E TIPOS ---

/**
 * Define a configuração de extração para um único portal.
 * Centraliza a lógica de scraping para fácil manutenção.
 */
interface PortalConfig {
  id: string; // Identificador único (ex: 'g1-am')
  baseURL: string; // Homepage do portal para buscar links
  linkSelector: string; // Seletor CSS para as tags <a> das notícias
  articleSelectors: {
    title: string; // Seletor CSS para o <h1> do título do artigo
    content: string; // Seletor CSS para o <div> ou <article> principal
    imageUrl?: string; // Seletor opcional para a imagem de capa
  };
  linkFilter?: (url: string) => boolean; // Filtro opcional para refinar URLs
}

/**
 * Dados extraídos e limpos, prontos para a IA.
 */
interface ArticleData {
  title: string;
  content: string;
  imageUrl: string | null;
  originalUrl: string;
  portal: string;
}

/**
 * ESTA É A CONFIGURAÇÃO PRINCIPAL QUE PRECISA SER MANTIDA.
 * Estes seletores foram validados. O 'portal-amazonia' NÃO ESTÁ AQUI
 * porque ele não pode ser raspado com esta tecnologia (requer navegador).
 */
const PORTAIS_CONFIG: Record<string, PortalConfig> = {
  'g1-am': {
    id: 'g1-am',
    baseURL: 'https://g1.globo.com/am/amazonas/',
    linkSelector: 'a.feed-post-link', // [2]
    articleSelectors: {
      title: 'h1.content-head__title, h1.content-post__title',
      content: 'div.mc-article-body, div.content-text__container', // [3]
      imageUrl: 'img.content-media-image__image',
    },
    linkFilter: (url: string) => url.includes('/am/amazonas/'),
  },
  'a-critica': {
    id: 'a-critica',
    baseURL: 'https://www.acritica.com/',
    linkSelector: 'a.m-feed-item__link, a[href*="/manaus/"], a[href*="/geral/"]', // [4, 5]
    articleSelectors: {
      title: 'h1.article-content__title, h1.article__title',
      content: 'div.article-content__body, div.article__body', // [6]
      imageUrl: 'figure.article-content__cover img',
    },
    linkFilter: (url: string) => url.includes('/noticia/') |

| url.includes('/geral/'),
  },
  'portal-holanda': {
    id: 'portal-holanda',
    baseURL: 'https://www.portaldoholanda.com.br/',
    linkSelector: 'a[href*="/manaus/"], a[href*="/amazonas/"], a[href*="/policial/"]', // [7]
    articleSelectors: {
      title: 'h1.article-full__title, h1.page-title',
      content: 'div.article-full__content, div.node-content', // [8]
      imageUrl: 'div.article-full__image img',
    },
    linkFilter: (url: string) =>!url.includes('/tags/') &&!url.includes('/author/'),
  },
  'em-tempo': {
    id: 'em-tempo',
    baseURL: 'https://emtempo.com.br/',
    linkSelector: 'a.card-post__title__link, a.slider-post__title__link, h3 > a', // [9]
    articleSelectors: {
      title: 'h1.post-title, h1.title-post',
      content: 'div.post-content__entry, div.content-post',
      imageUrl: 'div.post-featured-image img',
    },
    linkFilter: (url: string) => /\/\d{6,}\//.test(url), // Filtro de robustez (URLs de notícias parecem ter ID) [9]
  },
  'amazonas-atual': {
    id: 'amazonas-atual',
    baseURL: 'https://amazonasatual.com.br/',
    linkSelector: 'a.post-title-link, h3.entry-title > a', // [10]
    articleSelectors: {
      title: 'h1.td-post-title, h1.entry-title',
      content: 'div.td-post-content, div.entry-content', // [11]
      imageUrl: 'div.td-post-featured-image img',
    },
    linkFilter: (url: string) =>!url.includes('/colunista/'), // [12]
  },
  'radar-amazonico': {
    id: 'radar-amazonico',
    baseURL: 'https://radaramazonico.com.br/',
    linkSelector: 'h2.post-title > a, a.post-link', // [13]
    articleSelectors: {
      title: 'h1.entry-title, h1.post-title',
      content: 'div.entry-content, div.single-post-content',
      imageUrl: 'div.post-thumb img',
    },
    linkFilter: (url: string) =>!url.includes('/assunto/'), // [14]
  },
};

// --- CLIENTES DE SERVIÇO ---

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const groq = new Groq({ apiKey: Deno.env.get('GROQ_API_KEY')! });

// --- MÓDULOS DO PIPELINE DE SCRAPING ---

/**
 * 1. Extrai links de notícias da homepage de um portal.
 * Remove 100% da lógica de "fallback" para priorizar QUALIDADE.
 */
async function extractNewsLinks(config: PortalConfig): Promise<Set<string>> {
  try {
    const response = await fetch(config.baseURL, {
      headers: {
        'User-Agent': 'SeligaManaux-Scraper/1.0 (+https://seligamanaux.com.br/sobre)',
      },
    });
    if (!response.ok) {
      console.error(`Falha ao buscar ${config.baseURL}: ${response.statusText}`);
      return new Set<string>();
    }
    const html = await response.text();
    const $ = load(html);
    const links = new Set<string>();

    $(config.linkSelector).each((_i, el) => {
      let href = $(el).attr('href');
      if (href) {
        // Normaliza a URL (de relativa para absoluta)
        if (href.startsWith('/')) {
          href = new URL(href, config.baseURL).href;
        }

        // Aplica o filtro de link, se existir
        if (config.linkFilter) {
          if (config.linkFilter(href)) {
            links.add(href);
          }
        } else {
          // Se não houver filtro, adiciona
          links.add(href);
        }
      }
    });

    // A LÓGICA DE FALLBACK "if (links.size < 5)" FOI REMOVIDA.
    // Isso corrige o problema do "lixo promocional".

    return links;
  } catch (error) {
    console.error(`Erro em extractNewsLinks para ${config.id}: ${error.message}`);
    return new Set<string>();
  }
}

/**
 * 2. Visita uma URL de artigo e extrai seu conteúdo bruto.
 * Usa os seletores do PORTAIS_CONFIG.
 */
async function extractContent(
  url: string,
  config: PortalConfig
): Promise<ArticleData | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SeligaManaux-Scraper/1.0 (+https://seligamanaux.com.br/sobre)',
      },
    });
    if (!response.ok) {
      console.error(`Falha ao buscar artigo ${url}: ${response.statusText}`);
      return null;
    }
    const html = await response.text();
    const $ = load(html);

    const title = $(config.articleSelectors.title).first().text().trim();
    
    // Extrai texto do container principal.
    const content = $(config.articleSelectors.content).first().text().trim();

    let imageUrl: string | null = null;
    if (config.articleSelectors.imageUrl) {
      imageUrl = $(config.articleSelectors.imageUrl).first().attr('src') |

| null;
    }

    if (!title ||!content) {
      console.warn(`Título ou conteúdo não encontrado em ${url}. Seletor pode estar quebrado.`);
      return null;
    }

    return {
      title,
      content, // O conteúdo aqui ainda está "sujo" (com JS, etc.)
      imageUrl,
      originalUrl: url,
      portal: config.id,
    };
  } catch (error) {
    console.error(`Erro em extractContent para ${url}: ${error.message}`);
    return null;
  }
}

/**
 * 3. A Unidade de Descontaminação.
 * Limpa o conteúdo de texto bruto extraído, removendo JS, CSS e lixo.
 * Esta é a correção para o "Conteúdo com Código".
 */
function cleanHtmlContent(rawText: string): string {
  // Regex específica para o lixo "glb.cdnConfig = {...};" [15, 16, 17]
  const GLB_CONFIG_REGEX = /\bglb\.cdnConfig\s*=\s*\{*?\}\s*;/gim;

  // Regex para remover blocos <script>...</script> (e seu conteúdo) [18, 19, 20]
  const SCRIPT_TAG_REGEX = /<script\b[^>]*>*?<\/script>/gim;
  
  // Regex para remover blocos <style>...</style> (e seu conteúdo) [18]
  const STYLE_TAG_REGEX = /<style\b[^>]*>*?<\/style>/gim;
  
  // Regex para remover comentários HTML
  const HTML_COMMENT_REGEX = //g;
  
  // Regex para remover tags HTML restantes [21, 22]
  const HTML_TAG_REGEX = /<[^>]+>/g;

  // Regex para remover excesso de espaços em branco e linhas
  const EXCESS_WHITESPACE_REGEX = /[\t\r\n]+/g;
  const MULTIPLE_SPACES_REGEX = / +/g;

  let cleaned = rawText;

  // Aplica a limpeza em sequência
  cleaned = cleaned.replace(GLB_CONFIG_REGEX, ''); // 1. Remove o lixo principal
  cleaned = cleaned.replace(SCRIPT_TAG_REGEX, ''); // 2. Remove scripts
  cleaned = cleaned.replace(STYLE_TAG_REGEX, '');  // 3. Remove styles
  cleaned = cleaned.replace(HTML_COMMENT_REGEX, ''); // 4. Remove comentários
  cleaned = cleaned.replace(HTML_TAG_REGEX, '');     // 5. Remove tags HTML
  
  // Limpa espaços em branco
  cleaned = cleaned.replace(EXCESS_WHITESPACE_REGEX, ' ');
  cleaned = cleaned.replace(MULTIPLE_SPACES_REGEX, ' ').trim();

  return cleaned;
}

/**
 * 4. Processa o conteúdo limpo com a IA Groq.
 * Contém o "Prompt de Segurança" para ignorar conteúdo curto.
 * Esta é a correção para o "Artigo de Duas Linhas".
 */
async function rewriteWithGroq(data: ArticleData): Promise<string> {
  const { title, content, originalUrl, portal } = data;

  // Limpa o conteúdo ANTES de enviar à IA
  const cleanedContent = cleanHtmlContent(content);

  // O "Prompt de Sistema" é a chave para o controle da IA [23, 24, 25]
  const systemPrompt = `
    Você é um assistente de IA e jornalista de redação para o portal "SeligaManaux". Sua função é reescrever notícias.

    INSTRUÇÕES PRINCIPAIS:
    1.  **Reescrita:** Você receberá um "Texto Original", "Título Original" e "URL Original".
    2.  **Tom e Estilo:** Reescreva o artigo de forma imparcial, objetiva e com linguagem clara. Use um tom regional (Manaus/Amazonas) leve, mencionando "Manaus" ou "Amazonas" se relevante, mas sem exageros.
    3.  **Não Alucine:** Baseie-se *estritamente* no "Texto Original". Não adicione informações que não estejam lá.
    4.  **Formato de Saída:** Responda *apenas* com um objeto JSON válido, contendo as chaves: "titulo_reescrito", "artigo_reescrito", "resumo_reescrito" (máximo de 2 frases), e "tags_sugeridas" (array de 5 strings).

    INSTRUÇÃO DE SEGURANÇA (A MAIS IMPORTANTE):
    5.  **Filtro de Conteúdo Inútil:** Se o "Texto Original" fornecido tiver menos de 100 palavras, ele é provavelmente um resumo, um link de 'leia mais', ou lixo de scraper. Neste caso, você deve IGNORAR todas as outras instruções e responder *apenas* com a string "CONTEÚDO IGNORADO".
  `; // [23, 26, 27, 28]

  // Aplica a regra de segurança ANTES de chamar a API (economiza custos)
  if (cleanedContent.length < 100) {
    return 'CONTEÚDO IGNORADO';
  }

  const userPrompt = `
    ---
    Texto Original: "${cleanedContent}"
    ---
    Título Original: "${title}"
    ---
    URL Original: "${originalUrl}"
    ---
    Portal: "${portal}"
    ---
  `;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: 'llama3-8b-8192', // Modelo rápido e eficiente
      temperature: 0.3,
      response_format: { type: 'json_object' }, // Garante saída em JSON
    });

    return chatCompletion.choices?.?.message?.content |

| 'CONTEÚDO IGNORADO';
  } catch (error) {
    console.error(`Erro na API Groq: ${error.message}`);
    return 'CONTEÚDO IGNORADO';
  }
}

/**
 * 5. Salva os dados reescritos no Supabase.
 * Ignora artigos marcados como "CONTEÚDO IGNORADO".
 */
async function saveToSupabase(
  jsonString: string,
  originalUrl: string,
  imageUrl: string | null,
  portal: string
): Promise<string> {
  // Verifica o sinal de descarte da IA
  if (jsonString === 'CONTEÚDO IGNORADO') {
    return `Ignorado (IA): ${originalUrl}`;
  }

  let data;
  try {
    data = JSON.parse(jsonString);
  } catch (error) {
    return `Ignorado (JSON Inválido): ${originalUrl}`;
  }

  // Verifica se o JSON tem a estrutura esperada
  if (!data.titulo_reescrito ||!data.artigo_reescrito) {
    return `Ignorado (JSON Incompleto): ${originalUrl}`;
  }

  const { data: upsertData, error } = await supabase
  .from('noticias_scraped')
  .upsert(
      {
        url_original: originalUrl,
        titulo_original: data.titulo_reescrito, // Usando o reescrito como "original" no DB
        conteudo_original: data.artigo_reescrito, // Usando o reescrito
        titulo_reescrito: data.titulo_reescrito,
        conteudo_reescrito: data.artigo_reescrito,
        resumo_reescrito: data.resumo_reescrito,
        tags_sugeridas: data.tags_sugeridas,
        url_imagem_capa: imageUrl,
        fonte_portal: portal, // Coluna para o monitoramento (SQL da Seção 5)
        // 'status' poderia ser 'publicado'
      },
      {
        onConflict: 'url_original', // Evita duplicatas se o scraper rodar de novo
      }
    );

  if (error) {
    console.error(`Erro ao salvar no Supabase (${originalUrl}): ${error.message}`);
    return `Erro DB: ${originalUrl}`;
  }

  return `Sucesso: ${originalUrl}`;
}

// --- PONTO DE ENTRADA DA EDGE FUNCTION ---

Deno.serve(async (req) => {
  // Tratamento de preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const logs: string =;
    const allPortals = Object.values(PORTAIS_CONFIG);

    // Processa todos os portais em paralelo
    const portalPromises = allPortals.map(async (config) => {
      const portalLog = { id: config.id, links: 0, sucesso: 0, falhas: 0 };
      
      // 1. Extrair links da homepage
      const links = await extractNewsLinks(config);
      portalLog.links = links.size;
      if (links.size === 0) {
        logs.push(`Portal ${config.id}: Nenhum link encontrado.`);
        return portalLog;
      }

      // 3. Processar cada link
      const articlePromises = Array.from(links).map(async (url) => {
        // Verificar se a URL já existe no DB
        const { data: existing, error } = await supabase
        .from('noticias_scraped')
        .select('id')
        .eq('url_original', url)
        .maybeSingle();

        if (existing) {
          portalLog.falhas++;
          logs.push(`Ignorado (Duplicata): ${url}`);
          return; // Já existe, pula
        }
        
        // 4. Extrair conteúdo
        const articleData = await extractContent(url, config);
        if (!articleData) {
          portalLog.falhas++;
          logs.push(`Ignorado (Extração Falhou): ${url}`);
          return;
        }

        // 5. Reescrever com IA
        const rewrittenJson = await rewriteWithGroq(articleData);

        // 6. Salvar no DB
        const saveStatus = await saveToSupabase(
          rewrittenJson,
          articleData.originalUrl,
          articleData.imageUrl,
          articleData.portal
        );
        
        if (saveStatus.startsWith('Sucesso')) {
          portalLog.sucesso++;
        } else {
          portalLog.falhas++;
        }
        logs.push(saveStatus);
      });

      await Promise.allSettled(articlePromises);
      return portalLog;
    });

    const results = await Promise.allSettled(portalPromises);

    const summary = results
    .filter(r => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<any>).value);

    return new Response(
      JSON.stringify({
        message: 'Scraping concluído.',
        summary,
        logs, // Retorna logs detalhados para debug
      }),
      {
        headers: {...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: {...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
