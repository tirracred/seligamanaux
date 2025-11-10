import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===========================================================================
// CONFIGURAÇÃO CORS
// ===========================================================================
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// ===========================================================================
// FEEDS RSS CONFIGURADOS
// ===========================================================================
const DEFAULT_FEEDS = [
  "https://g1.globo.com/rss/g1/am/amazonas/",
  "https://d24am.com/feed/",
  "https://g1.globo.com/rss/g1/am/",
  "https://nossoshowam.com/feed/29/amazonas/",
  "https://nossoshowam.com/feed/26/manaus/",
  "https://nossoshowam.com/feed/3/politica/",
  "https://nossoshowam.com/feed/27/brasil/",
  "https://nossoshowam.com/feed/7/economia/",
  "https://nossoshowam.com/feed/13/educacao/",
  "https://www.portaldoholanda.com.br/feed/rss",
];

// ===========================================================================
// FUNÇÕES AUXILIARES
// ===========================================================================

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, data || '');
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return "";
  
  let content = match[1].trim();
  content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gs, "$1");
  content = content.replace(/<[^>]+>/g, "");
  return content.trim();
}

function extractImage(xml: string): string {
  const encMatch = xml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i);
  if (encMatch) return encMatch[1];
  
  const mediaMatch = xml.match(/<(?:media:content|content)[^>]+url=["']([^"']+)["'][^>]*>/i);
  if (mediaMatch) return mediaMatch[1];
  
  const thumbMatch = xml.match(/<(?:media:thumbnail|thumbnail)[^>]+url=["']([^"']+)["'][^>]*>/i);
  if (thumbMatch) return thumbMatch[1];
  
  const imgMatch = xml.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (imgMatch) return imgMatch[1];
  
  return "";
}

// NOVA FUNÇÃO: Extrair vídeos do XML RSS
function extractVideo(xml: string): string {
  // Procura por vídeos em tags comuns de RSS (media:content com type video, enclosure type video)
  const mediaVideoMatch = xml.match(/<(?:media:content|content)[^>]+type=["']video\/[^"']+["'][^>]+url=["']([^"']+)["'][^>]*>/i);
  if (mediaVideoMatch) return mediaVideoMatch[1];
  
  const enclosureVideoMatch = xml.match(/<enclosure[^>]+type=["']video\/[^"']+["'][^>]+url=["']([^"']+)["'][^>]*>/i);
  if (enclosureVideoMatch) return enclosureVideoMatch[1];
  
  // Também tenta ordem inversa (url antes de type)
  const mediaVideoMatch2 = xml.match(/<(?:media:content|content)[^>]+url=["']([^"']+)["'][^>]+type=["']video\/[^"']+["'][^>]*>/i);
  if (mediaVideoMatch2) return mediaVideoMatch2[1];
  
  return "";
}

function extractImageCredit(link: string): string {
  try {
    const url = new URL(link);
    return `Fonte: ${url.hostname}`;
  } catch {
    return "";
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

// ===========================================================================
// VALIDAÇÃO E EXTRAÇÃO DE JSON ROBUSTA (ATUALIZADA PARA 4 CAMPOS)
// ===========================================================================
function extractJsonFromText(text: string): { 
  titulo: string; 
  legenda: string; 
  cor_titulo: string; 
  conteudo: string 
} | null {
  try {
    // Tenta parse direto
    const parsed = JSON.parse(text);
    if (parsed.titulo && parsed.legenda && parsed.cor_titulo && parsed.conteudo) {
      return { 
        titulo: parsed.titulo, 
        legenda: parsed.legenda,
        cor_titulo: parsed.cor_titulo,
        conteudo: parsed.conteudo 
      };
    }
  } catch (e) {
    log("Parse direto falhou, tentando extrair JSON do texto");
  }
  
  // Tenta encontrar JSON no meio do texto
  const jsonMatch = text.match(/\{[\s\S]*"titulo"[\s\S]*"legenda"[\s\S]*"cor_titulo"[\s\S]*"conteudo"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.titulo && parsed.legenda && parsed.cor_titulo && parsed.conteudo) {
        return { 
          titulo: parsed.titulo, 
          legenda: parsed.legenda,
          cor_titulo: parsed.cor_titulo,
          conteudo: parsed.conteudo 
        };
      }
    } catch (e) {
      log("Parse de JSON extraído falhou");
    }
  }
  
  // Última tentativa: extração manual com regex
  const tituloMatch = text.match(/"titulo"\s*:\s*"([^"]+)"/);
  const legendaMatch = text.match(/"legenda"\s*:\s*"([^"]+)"/);
  const corMatch = text.match(/"cor_titulo"\s*:\s*"([^"]+)"/);
  const conteudoMatch = text.match(/"conteudo"\s*:\s*"([\s\S]+?)"\s*\}/);
  
  if (tituloMatch && legendaMatch && corMatch && conteudoMatch) {
    return {
      titulo: tituloMatch[1],
      legenda: legendaMatch[1],
      cor_titulo: corMatch[1],
      conteudo: conteudoMatch[1].replace(/\\n/g, '\n')
    };
  }
  
  return null;
}

// ===========================================================================
// FUNÇÃO PRINCIPAL DE REESCRITA COM GROQ (ATUALIZADA)
// ===========================================================================
async function rewriteWithGroq(
  title: string, 
  description: string, 
  groqKey: string,
  retries = 3
): Promise<{ 
  titulo: string; 
  legenda: string; 
  cor_titulo: string; 
  conteudo: string 
} | null> {
  
  const prompt = [
    'Você é um jornalista profissional de Manaus/Amazonas.',
    '',
    'TAREFA: Reescrever completamente a notícia abaixo de forma original.',
    '',
    'NOTÍCIA ORIGINAL:',
    `Título: ${title}`,
    `Conteúdo: ${description}`,
    '',
    'INSTRUÇÕES:',
    '1. Reescreva o conteúdo de forma TOTALMENTE ORIGINAL',
    '2. Use linguagem jornalística brasileira, clara e direta',
    '3. Foque em Manaus/Amazonas quando relevante',
    '4. Tamanho: MÁXIMO 2.500 palavras (não exceder)',
    '5. Organize em parágrafos bem estruturados',
    '6. Crie um título completamente novo e chamativo',
    '7. Crie uma LEGENDA curta e contextual (ex: "Terror", "Esporte", "Crime Brutal", "Política", "Economia")',
    '8. Escolha uma COR para o título:',
    '   - "#e53e3e" (vermelho) para notícias urgentes, graves, crimes, alertas',
    '   - "#059669" (azul) para notícias gerais, padrão, menos alarmantes',
    '9. IMPORTANTE: Escreva em português brasileiro correto',
    '',
    'FORMATO DE RESPOSTA (JSON ESTRITO):',
    '{',
    '  "titulo": "novo título aqui",',
    '  "legenda": "legenda contextual aqui",',
    '  "cor_titulo": "#e53e3e ou #059669",',
    '  "conteudo": "texto completo reescrito aqui"',
    '}',
    '',
    'ATENÇÃO: Retorne APENAS o JSON, sem texto adicional antes ou depois.'
  ].join('\n');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      log(`Tentativa ${attempt}/${retries} de reescrever: ${title.substring(0, 50)}...`);
      
      const groqResponse = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 4000, // ~2500 palavras
            response_format: { type: "json_object" },
          }),
        }
      );

      if (!groqResponse.ok) {
        const errorText = await groqResponse.text();
        log(`Erro Groq API (${groqResponse.status}): ${errorText}`);
        
        // Se for rate limit, espera mais tempo
        if (groqResponse.status === 429) {
          const waitTime = Math.pow(2, attempt) * 2000; // Backoff exponencial
          log(`Rate limit atingido. Aguardando ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        return null;
      }

      const groqData = await groqResponse.json();
      const contentOut = groqData?.choices?.[0]?.message?.content;
      
      if (!contentOut) {
        log("Groq retornou resposta vazia");
        continue;
      }

      log("Conteúdo recebido da Groq, tentando parsear...");
      
      // Validação robusta de JSON
      let parsed: any = null;
      
      if (typeof contentOut === "object") {
        parsed = contentOut;
      } else if (typeof contentOut === "string") {
        parsed = extractJsonFromText(contentOut);
      }
      
      if (parsed && parsed.titulo && parsed.legenda && parsed.cor_titulo && parsed.conteudo) {
        log("✓ Artigo reescrito com sucesso!");
        return {
          titulo: String(parsed.titulo).trim(),
          legenda: String(parsed.legenda).trim(),
          cor_titulo: String(parsed.cor_titulo).trim(),
          conteudo: String(parsed.conteudo).trim()
        };
      } else {
        log("JSON inválido recebido da Groq:", { contentOut: contentOut?.substring?.(0, 200) });
      }
      
    } catch (error) {
      log(`Erro na tentativa ${attempt}:`, error);
    }
    
    // Delay entre tentativas
    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return null;
}

// ===========================================================================
// FUNÇÃO PRINCIPAL
// ===========================================================================
serve(async (req) => {
  // Responder a CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const startTime = Date.now();
  log("=== INÍCIO DA EXECUÇÃO RSS IMPORT ===");

  // Validação de variáveis de ambiente
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const groqKey = Deno.env.get("GROQ_API_KEY_2");
  const feedEnv = Deno.env.get("RSS_FEEDS");
  const feeds = feedEnv ? feedEnv.split(/\s*,\s*/).filter(v => v) : DEFAULT_FEEDS;
  
  // NOVA FLAG: Modo automático (publicar direto) ou manual (status pendente)
  const isAuto = Deno.env.get("RSS_IMPORT_AUTO") === "true";
  log(`Modo de importação: ${isAuto ? "AUTOMÁTICO (publica direto)" : "MANUAL (status pendente)"}`);

  if (!supabaseUrl || !supabaseKey) {
    log("ERRO: Configuração Supabase ausente");
    return new Response(
      JSON.stringify({ 
        error: "Missing Supabase configuration",
        imported: 0,
        details: []
      }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  if (!groqKey) {
    log("ERRO: GROQ API key ausente");
    return new Response(
      JSON.stringify({ 
        error: "Missing GROQ API key",
        imported: 0,
        details: []
      }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const results: any[] = [];
  let importedCount = 0;
  let totalProcessed = 0;
  let totalErrors = 0;

  log(`Total de feeds a processar: ${feeds.length}`);

  // Processar cada feed individualmente
  for (const feedUrl of feeds) {
    const feedResult = {
      feed: feedUrl,
      status: "pending",
      articlesProcessed: 0,
      articlesImported: 0,
      errors: [] as string[]
    };

    try {
      log(`\n--- Processando feed: ${feedUrl} ---`);
      
      const res = await fetch(feedUrl, { 
        signal: AbortSignal.timeout(30000) // 30s timeout
      });
      
      if (!res.ok) {
        const error = `HTTP ${res.status}: ${res.statusText}`;
        log(`Erro ao buscar feed: ${error}`);
        feedResult.status = "error";
        feedResult.errors.push(error);
        results.push(feedResult);
        totalErrors++;
        continue;
      }

      const text = await res.text();
      const items = [...text.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];
      
      log(`Feed ${feedUrl}: ${items.length} itens encontrados`);
      
      if (items.length === 0) {
        feedResult.status = "empty";
        feedResult.errors.push("Nenhum item encontrado no feed");
        results.push(feedResult);
        continue;
      }

      // Processar cada item do feed
      for (const match of items) {
        totalProcessed++;
        feedResult.articlesProcessed++;
        
        try {
          const itemXml = match[1];
          const title = extractTag(itemXml, "title");
          const link = extractTag(itemXml, "link");
          const description = extractTag(itemXml, "description");
          const imageUrl = extractImage(itemXml);
          const videoUrl = extractVideo(itemXml); // NOVO: extrai vídeo
          const sourceCredit = extractImageCredit(link); // crédito da fonte

          if (!title || !link || !description) {
            log(`Item pulado: campos obrigatórios ausentes`);
            feedResult.errors.push(`Item sem título/link/descrição`);
            continue;
          }

          log(`Processando: ${title.substring(0, 60)}...`);

          // Verificar duplicata por título
          const { data: existingData } = await supabase
            .from("noticias")
            .select("id")
            .eq("title", title)
            .limit(1);

          if (existingData && existingData.length > 0) {
            log(`⊘ Artigo já existe: ${title.substring(0, 50)}...`);
            feedResult.errors.push(`Duplicado: ${title.substring(0, 50)}`);
            continue;
          }

          // Reescrever com IA (agora retorna 4 campos)
          const rewritten = await rewriteWithGroq(title, description, groqKey);
          
          if (!rewritten) {
            log(`✗ Falha ao reescrever: ${title.substring(0, 50)}...`);
            feedResult.errors.push(`Reescrita falhou: ${title.substring(0, 50)}`);
            continue;
          }

          // Inserir no banco com NOVOS CAMPOS
          const { error: insertErr } = await supabase.from("noticias").insert({
            title: rewritten.titulo,
            content: rewritten.conteudo,
            category: rewritten.legenda,        // LEGENDA DINÂMICA (não mais categoria fixa)
            headline_colo: rewritten.cor_titulo, // COR DINÂMICA DO TÍTULO
            image_url: imageUrl || null,
            videos: videoUrl || null,            // NOVO: campo de vídeos
            status: isAuto ? "publicado" : "pendente", // STATUS CONDICIONAL
          });

          if (insertErr) {
            log(`Erro ao inserir no banco: ${insertErr.message}`);
            feedResult.errors.push(`DB Error: ${insertErr.message}`);
            continue;
          }

          log(`✓ Artigo importado com sucesso! [${rewritten.legenda}] [${rewritten.cor_titulo}]`);
          importedCount++;
          feedResult.articlesImported++;

          // Delay para respeitar rate limits (2s entre artigos)
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (itemError) {
          log(`Erro ao processar item:`, itemError);
          feedResult.errors.push(`Item error: ${String(itemError).substring(0, 100)}`);
          totalErrors++;
        }
      }

      feedResult.status = feedResult.articlesImported > 0 ? "success" : "no_imports";
      results.push(feedResult);
      
      log(`Feed ${feedUrl} concluído: ${feedResult.articlesImported}/${feedResult.articlesProcessed} importados`);

    } catch (feedError) {
      log(`ERRO CRÍTICO no feed ${feedUrl}:`, feedError);
      feedResult.status = "critical_error";
      feedResult.errors.push(String(feedError).substring(0, 200));
      results.push(feedResult);
      totalErrors++;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  log("\n=== RESUMO FINAL ===");
  log(`Duração: ${duration}s`);
  log(`Feeds processados: ${feeds.length}`);
  log(`Artigos processados: ${totalProcessed}`);
  log(`Artigos importados: ${importedCount}`);
  log(`Erros totais: ${totalErrors}`);

  return new Response(
    JSON.stringify({
      success: true,
      imported: importedCount,
      processed: totalProcessed,
      errors: totalErrors,
      duration: `${duration}s`,
      mode: isAuto ? "automático" : "manual",
      feeds: results
    }, null, 2),
    { 
      status: 200, 
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" } 
    }
  );
});