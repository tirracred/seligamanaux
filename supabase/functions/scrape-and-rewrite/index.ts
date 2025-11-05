// Importa o 'edge-runtime' para tipos Deno
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

// Importa o createClient da biblioteca supabase-js v2
import { createClient } from 'npm:@supabase/supabase-js@2';
import Parser from 'npm:rss-parser@3.13.0';

/* =========================
TIPOS
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
  slug?: string;
  canonical_path?: string;
}

interface GroqResponse {
  titulo: string;
  conteudo: string;
}

/* =========================
CONFIGURAÇÃO DE FEEDS RSS
========================= */

const RSS_FEEDS = [
  {
    name: 'G1 Amazonas',
    url: 'https://g1.globo.com/dynamo/am/amazonas/rss2.xml',
    category: 'Amazonas',
  },
  {
    name: 'D24AM',
    url: 'https://d24am.com/amazonas/feed/',
    category: 'Amazonas',
  },
  {
    name: 'Portal O Fato',
    url: 'https://portalofato.com.br/category/amazonas/feed/',
    category: 'Amazonas',
  },
];

/* =========================
FILTROS ANTI-PROMO/INSTITUCIONAL
========================= */

// Mantido para filtrar conteúdo promocional no título ou resumo do RSS
function looksPromotional(text: string): boolean {
  const x = (text || '').toLowerCase();
  return /publieditorial|publicidade|assessoria de imprensa|assine|clique aqui|programação|assista ao|patrocinado|publipost|oferecimento|oferecido por|parceria/i.test(x);
}

/* =========================
NORMALIZAÇÃO / HIGIENE DE TEXTO
========================= */

function stripSourceArtifacts(t: string): string {
  return (t || '')
    .replace(/\s+—\s*Foto:.*?(?=\.|$)/gi, '')
    .replace(/—\s*Foto.*?$/gim, '')
    .replace(/^\s*Foto:.*$/gim, '')
    .replace(/^\s*Crédito:.*$/gim, '')
    .replace(/^\s*Fonte:.*$/gim, '')
    .replace(/^\s*Com informações de.*$/gim, '')
    .replace(/^\s*Leia mais:.*$/gim, '')
    .replace(/\b(g1|globonews|rede amazônica)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeText(t: string): string {
  return (t || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tooSimilar(a: string, b: string): boolean {
  const A = new Set(normalizeText(a).split(' '));
  const B = new Set(normalizeText(b).split(' '));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const min = Math.max(1, Math.min(A.size, B.size));
  return inter / min > 0.8;
}

function has12ConsecutiveMatches(original: string, rewritten: string): boolean {
  const origWords = original.toLowerCase().split(/\s+/);
  const rewritWords = rewritten.toLowerCase().split(/\s+/);
  for (let i = 0; i <= origWords.length - 12; i++) {
    const window = origWords.slice(i, i + 12).join(' ');
    if (rewritWords.join(' ').includes(window)) {
      console.log(`[WARN_COPY] 12+ palavras consecutivas: "${window}"`);
      return true;
    }
  }
  return false;
}

/* =========================
HELPERS DE REPARO/FORMATAÇÃO
========================= */

// Normaliza aspas “inteligentes” para aspas ASCII
function normalizeAsciiQuotes(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

// Garante que o texto tenha parágrafos em HTML (<p>...</p>)
function ensureParagraphsHTML(text: string): string {
  const hasHtmlP = /<p[\s>]/i.test(text) || /<\/p>/i.test(text);
  if (hasHtmlP) return text;
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
  const parts = (blocks.length ? blocks : text.split(/(?<=[.!?])\s{2,}/))
    .map(x => x.trim()).filter(Boolean);
  return parts.map(p => `<p>${p}</p>`).join('');
}

/**
 * Repara respostas quase JSON retornadas pela LLM:
 * - Extrai apenas o primeiro objeto {...} do texto.
 * - Normaliza aspas inteligentes para ASCII.
 * - Se o valor de "conteudo" não estiver entre aspas, envolve em aspas e escapa.
 * - Converte aspas simples em chaves para aspas duplas.
 */
function repairGroqJsonString(raw: string): string {
  if (!raw) return raw;
  let s = normalizeAsciiQuotes(raw).trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  try { JSON.parse(s); return s; } catch {}
  const rxUnquotedConteudo = /("conteudo"\s*:\s*)(?!")(.*)\s*}\s*$/s;
  if (rxUnquotedConteudo.test(s)) {
    s = s.replace(rxUnquotedConteudo, (_: string, prefix: string, val: string) => {
      const cleaned = val.trim().replace(/\\|"/g, m => (m === '\\' ? '\\\\' : '\\"')).replace(/\n/g, "\\n");
      return `${prefix}"${cleaned}"}`;
    });
    try { JSON.parse(s); return s; } catch {}
  }
  const maybeJson5 = s.replace(/(['"])(titulo|conteudo)\1\s*:/g, '"$2":');
  try { JSON.parse(maybeJson5); return maybeJson5; } catch {}
  return s;
}

// Gera um slug a partir do título
function makeSlug(title: string): string {
  const base = title.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base}-${Date.now().toString(36)}`;
}

/* =========================
REESCRITA VIA GROQ
========================= */

async function rewriteWithGroq(
  title: string,
  content: string,
  apiKey: string,
  sourceName: string,
  imageUrl: string | null,
  retryCount: number = 0
): Promise<GroqResponse | null> {
  if (retryCount > 2) {
    console.log(`[REWRITE_ABORT] Máximo de tentativas atingido`);
    return null;
  }

  const temperature = retryCount === 0 ? 0.5 : retryCount === 1 ? 0.7 : 0.9;

  // Sanitiza entrada
  const cleanTitle = (title || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .trim()
    .slice(0, 300);

  const cleanContent = (content || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .trim()
    .slice(0, 5000);

  // Monta prompt com instrução para fonte da imagem
  const prompt = `Reescreva o seguinte título e conteúdo em português, garantindo:
1. Texto original (sem cópia acima de 80%)
2. Nenhuma sequência de 12+ palavras idênticas
3. Formatação em parágrafos (pode usar <p>...</p>)
4. Entre 2000 e 5000 caracteres
5. Tom jornalístico profissional 
6. Atue como o "Se Liga Manaus": um jornal com identidade única, focado em máximo impacto, que explora tragédias e usa IMPACTOS inteligentes. Mantenha um tom de alerta, incisivo e direto, focado 100% em Manaus. Use português padrão culto, sem gírias ou regionalismos.
7. IMPORTANTE: Se a notícia original tiver uma imagem (cuja URL é ${imageUrl || 'não fornecida'}), adicione uma linha NO FINAL do conteúdo reescrito, em uma nova linha, no formato: (Fonte da Imagem: ${sourceName})

TÍTULO: ${cleanTitle}

CONTEÚDO: ${cleanContent}

Responda APENAS em JSON:
{"titulo": "novo título", "conteudo": "novo conteúdo"}`;

  try {
    console.log(`[GROQ_DEBUG] Retry: ${retryCount} | Temp: ${temperature}`);
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content:
              'Responda ESTRITAMENTE com um único objeto JSON válido UTF-8, sem markdown, sem blocos de código, sem rótulos. ' +
              'Formato exato: {"titulo":"...","conteudo":"..."}. ' +
              'O "conteudo" deve ter entre 2000 e 5000 caracteres e estar em parágrafos (pode usar <p>...</p>). ' +
              'Não inclua nada além do objeto JSON.'
          },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: Math.max(0.2, temperature ?? 0.5),
        max_tokens: 3000,
      }),
    });

    console.log(`[GROQ_RESPONSE] Status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[GROQ_ERROR] HTTP ${response.status} | ${errorText.slice(0, 200)}`);
      if (response.status === 401) {
        console.log(`[GROQ_FATAL] 401 - API Key inválida!`);
        return null;
      }
      if (response.status === 404) {
        console.log(`[GROQ_FATAL] 404 - Modelo não encontrado!`);
        return null;
      }
      if (retryCount < 2) {
        console.log(`[GROQ_RETRY] Tentativa ${retryCount + 1}/3...`);
        await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
        return rewriteWithGroq(title, content, apiKey, sourceName, imageUrl, retryCount + 1);
      }
      return null;
    }

    const data = await response.json();
    const textContent = data.choices?.[0]?.message?.content || '';
    if (!textContent) {
      console.log(`[GROQ_EMPTY] Resposta vazia, retry...`);
      if (retryCount < 2) {
        return rewriteWithGroq(title, content, apiKey, sourceName, imageUrl, retryCount + 1);
      }
      return null;
    }

    console.log(`[GROQ_RAW] Resposta recebida: ${textContent.slice(0, 100)}...`);

    // Parseia JSON de forma robusta
    let parsed: { titulo?: string; conteudo?: string } | null = null;
    try {
      parsed = JSON.parse(textContent);
    } catch {
      const repaired = repairGroqJsonString(textContent);
      try {
        parsed = JSON.parse(repaired);
      } catch (e) {
        console.log(`[GROQ_JSON_ERROR] Não é JSON válido: ${textContent.slice(0, 120)}`);
        if (retryCount < 2) {
          return rewriteWithGroq(title, content, apiKey, sourceName, imageUrl, retryCount + 1);
        }
        return null;
      }
    }

    const novoTitulo = (parsed?.titulo || '').trim();
    let novoConteudo = (parsed?.conteudo || '').trim();
    novoConteudo = ensureParagraphsHTML(novoConteudo);

    console.log(`[REWRITE_OK] Título: ${novoTitulo.slice(0, 40)}... | Len: ${novoConteudo.length}`);

    // Validação anti-cópia
    if (
      novoConteudo.length < 1800 ||
      tooSimilar(content, novoConteudo) ||
      has12ConsecutiveMatches(content, novoConteudo)
    ) {
      console.log(`[REWRITE_REJECTED] Similar ou curto (${novoConteudo.length} chars), retry...`);
      if (retryCount < 2) {
        return rewriteWithGroq(title, content, apiKey, sourceName, imageUrl, retryCount + 1);
      }
      return null;
    }

    return { titulo: novoTitulo, conteudo: novoConteudo };
  } catch (err) {
    console.log(`[GROQ_EXCEPTION] ${err}`);
    if (retryCount < 2) {
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
      return rewriteWithGroq(title, content, apiKey, sourceName, imageUrl, retryCount + 1);
    }
    return null;
  }
}

/* =========================
MAIN HANDLER
========================= */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // Ignora o corpo JSON da requisição (chamadas agora acionam processamento de todos os feeds)
  try {
    await req.json();
    console.log('[DEBUG] Chamada recebida com corpo JSON (ignorado).');
  } catch {
    console.log('[DEBUG] Chamada recebida sem corpo JSON.');
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const groqApiKey = Deno.env.get('GROQ_API_KEY');

    if (!supabaseUrl || !supabaseKey || !groqApiKey) {
      return new Response(
        JSON.stringify({ error: 'Variáveis de ambiente incompletas' }),
        { status: 500, headers: corsHeaders },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const rssParser = new Parser({
      customFields: {
        item: [['media:content', 'mediaContent', { keepArray: true }]],
      },
    });

    console.log('[RSS_START] Iniciando processamento de feeds RSS...');
    const stats = {
      feedsProcessados: 0,
      noticiasEncontradas: 0,
      noticiasNovas: 0,
      noticiasReescritas: 0,
      erros: 0,
    };
    const recordsToInsert: NoticiaScrapedData[] = [];

    // Loop pelos feeds configurados
    for (const feed of RSS_FEEDS) {
      stats.feedsProcessados++;
      try {
        console.log(`[RSS_FETCH] Buscando feed: ${feed.name}`);
        const parsedFeed = await rssParser.parseURL(feed.url);
        if (!parsedFeed?.items?.length) {
          console.log(`[RSS_FETCH] Nenhum item encontrado para ${feed.name}`);
          continue;
        }

        for (const item of parsedFeed.items) {
          stats.noticiasEncontradas++;
          const originalUrl = item.link;
          if (!originalUrl) {
            console.log(`[RSS_SKIP] Item sem link: ${item.title}`);
            continue;
          }

          // 1. Verifica duplicata no banco
          const { data: existente, error: checkError } = await supabase
            .from('noticias_scraped')
            .select('id')
            .eq('url_original', originalUrl)
            .limit(1);
          if (checkError) {
            console.error(`[DB_ERROR] Erro ao checar DB (${originalUrl}):`, checkError.message);
            stats.erros++;
            continue;
          }
          if (existente && existente.length > 0) {
            // Notícia já existe, pula
            continue;
          }

          stats.noticiasNovas++;

          // 2. Extrai dados básicos do item
          const originalTitle = item.title ? item.title.trim() : 'Sem título';
          let rawContent = item.content || item.contentSnippet || '';
          // Remove tags HTML para evitar ruído
          rawContent = rawContent.replace(/<[^>]+>/g, ' ');
          const originalContent = stripSourceArtifacts(rawContent);

          // Filtra promoções
          if (looksPromotional(originalTitle) || looksPromotional(originalContent)) {
            console.log(`[RSS_SKIP] Conteúdo promocional: ${originalTitle}`);
            continue;
          }
          if (originalContent.length < 200) {
            console.log(`[RSS_SKIP] Conteúdo muito curto: ${originalTitle}`);
            continue;
          }

          // 3. Extrai URL da imagem, se houver
          let imageUrl: string | null = null;
          if (item.enclosure?.url && item.enclosure?.type?.startsWith('image')) {
            imageUrl = item.enclosure.url;
          } else if ((item as any).mediaContent?.length > 0) {
            // Suporte a <media:content> (ex: G1)
            const mediaImage = (item as any).mediaContent.find((m: any) =>
              m.$?.medium === 'image' || m.$?.type?.startsWith('image')
            );
            if (mediaImage) {
              imageUrl = mediaImage.$.url;
            }
          }
          // Fallback: tenta extrair de eventual HTML do conteúdo
          if (!imageUrl && item.content) {
            const imgMatch = item.content.match(/<img[^>]+src="([^">]+)"/);
            if (imgMatch && imgMatch[1]) {
              imageUrl = imgMatch[1];
            }
          }

          // 4. Reescreve título e conteúdo via Groq AI
          console.log(`[REWRITE_START] RSS: ${originalTitle.slice(0, 50)}...`);
          const rewritten = await rewriteWithGroq(originalTitle, originalContent, groqApiKey, feed.name, imageUrl);
          if (!rewritten || !rewritten.titulo || !rewritten.conteudo) {
            console.log(`[RSS_SKIP] Reescrita falhou para: ${originalTitle}`);
            stats.erros++;
            continue;
          }

          // 5. Gera slug e caminho canônico
          const slug = makeSlug(rewritten.titulo);
          const canonicalPath = `/artigo/${slug}`;

          // 6. Monta registro para inserir
          const newRecord: NoticiaScrapedData = {
            titulo_original: originalTitle.slice(0, 255),
            titulo_reescrito: rewritten.titulo.slice(0, 255),
            resumo_original: originalContent.slice(0, 500),
            resumo_reescrito: rewritten.conteudo
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 500),
            conteudo_reescrito: rewritten.conteudo,
            url_original: originalUrl,
            fonte: feed.name,
            status: 'pendente',
            data_coleta: new Date().toISOString(),
            data_publicacao: item.isoDate ? new Date(item.isoDate).toISOString() : new Date().toISOString(),
            imagem_url: imageUrl,
            categoria: feed.category || 'Geral',
            slug,
            canonical_path: canonicalPath,
          };

          recordsToInsert.push(newRecord);
          stats.noticiasReescritas++;
          console.log(`[INSERT_READY] ${rewritten.titulo.slice(0, 40)}...`);
        }
      } catch (err) {
        console.error(`[RSS_ERROR] Erro ao processar feed ${feed.name}:`, err.message);
        stats.erros++;
      }
    }

    // 7. Insere todos os novos registros de uma vez
    if (recordsToInsert.length > 0) {
      const { error } = await supabase
        .from('noticias_scraped')
        .insert(recordsToInsert);
      if (error) {
        console.error(`[INSERT_ERROR] ${error.message}`);
        return new Response(
          JSON.stringify({
            success: false,
            error: error.message,
            inserted: 0,
            stats,
          }),
          { status: 500, headers: corsHeaders },
        );
      }
      console.log(`[INSERT_SUCCESS] ${recordsToInsert.length} registros salvos`);
    } else {
      console.log('[INSERT_SKIP] Nenhuma notícia nova para inserir.');
    }

    // Retorna sucesso com estatísticas
    return new Response(
      JSON.stringify({
        success: true,
        processed: stats.noticiasReescritas,
        message: `${stats.noticiasReescritas} notícias processadas e salvas.`,
        stats,
      }),
      { headers: corsHeaders },
    );
  } catch (err) {
    console.error('[MAIN_ERROR]', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: corsHeaders },
    );
  }
});