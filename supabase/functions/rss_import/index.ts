import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * This Edge Function imports articles from a handful of RSS feeds, rewrites
 * them with Groq’s Llama‑3.1‑8B‑Instant model, then persists the rewritten
 * result into your Supabase database.  The goal is to automatically
 * populate your news portal with fresh, unique content sourced from
 * established news providers without scraping their web pages.  See
 * README.md for instructions on deploying this function.
 *
 * Configuration is driven by environment variables.  The function expects
 * the following secrets to be defined in your Supabase project:
 *
 *   SUPABASE_URL               – the URL of your Supabase project
 *   SUPABASE_SERVICE_ROLE_KEY  – a service role key used to insert rows
 *   GROQ_API_KEY_2             – API key for the Groq API (gsk_…)
 *
 * You can optionally override the default RSS feeds by defining a
 * comma‑separated list in RSS_FEEDS.  For example:
 *   RSS_FEEDS="https://example.com/feed.xml,https://other.com/rss"
 *
 * The function uses a simple RegExp based parser to extract information
 * from RSS items.  It is intentionally limited in scope to keep the
 * runtime lean – you may replace it with a proper XML parser if your
 * feeds require more complex parsing.  Each item is processed one at a
 * time to avoid saturating the Groq API.
 */

// Helper to extract the first occurrence of a tag from an RSS item.  It
// strips CDATA wrappers and HTML tags from the result.
function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return "";
  // Remove CDATA and HTML tags
  let content = match[1].trim();
  content = content.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1");
  content = content.replace(/<[^>]+>/g, "");
  return content.trim();
}

// Helper to extract an image URL from common RSS/Atom image fields.
function extractImage(xml: string): string {
  // enclosure tag with url attribute
  const encMatch = xml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i);
  if (encMatch) return encMatch[1];
  // media:content or content tag with url attribute
  const mediaMatch = xml.match(/<(?:media:content|content)[^>]+url=["']([^"']+)["'][^>]*>/i);
  if (mediaMatch) return mediaMatch[1];
  // media:thumbnail or thumbnail tag
  const thumbMatch = xml.match(/<(?:media:thumbnail|thumbnail)[^>]+url=["']([^"']+)["'][^>]*>/i);
  if (thumbMatch) return thumbMatch[1];
  // fallback: try to find an <img src="..."> inside description
  const imgMatch = xml.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (imgMatch) return imgMatch[1];
  return "";
}

// Helper to slugify a string for use as a canonical path.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

// Default list of RSS feeds.  You can override this via the RSS_FEEDS
// environment variable (comma separated).
const DEFAULT_FEEDS = [
  // Portal do Holanda
  "https://www.portaldoholanda.com.br/feed", // removed tracking params
  // Globo G1 Amazonas
  "https://g1.globo.com/rss/g1/am/amazonas/rss2.xml",
  // Nosso Show AM – Manaus
  "https://nossoshowam.com/feed/26/manaus/",
  // Nosso Show AM – Famosos e Entretenimento
  "https://nossoshowam.com/feed/2/famosos-e-entretenimento/",
];

// Main entry point.  Every invocation fetches all feeds and rewrites
// them.  Invoking this endpoint repeatedly could import duplicate
// articles if they have not yet been filtered out by title/link.
serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const groqKey = Deno.env.get("GROQ_API_KEY_2");
  const feedEnv = Deno.env.get("RSS_FEEDS");
  const feeds = feedEnv
    ? feedEnv.split(/\s*,\s*/).filter((v) => v)
    : DEFAULT_FEEDS;

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase configuration" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!groqKey) {
    return new Response(
      JSON.stringify({ error: "Missing GROQ API key" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const imported: any[] = [];
  let importedCount = 0;
  // Iterate through feeds sequentially
  for (const feedUrl of feeds) {
    try {
      const res = await fetch(feedUrl);
      if (!res.ok) {
        console.warn(`Failed to fetch feed ${feedUrl}: ${res.status}`);
        continue;
      }
      const text = await res.text();
      const items = [...text.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];
      for (const match of items) {
        const itemXml = match[1];
        const title = extractTag(itemXml, "title");
        const link = extractTag(itemXml, "link");
        const description = extractTag(itemXml, "description");
        const pubDate = extractTag(itemXml, "pubDate");
        const imageUrl = extractImage(itemXml);
        // Skip if required fields missing
        if (!title || !link || !description) continue;
        // Check if this link already exists in the database
        const { data: existing, error: existErr } = await supabase
          .from("noticias")
          .select("id")
          .eq("original_link", link)
          .maybeSingle();
        if (existErr) {
          console.error(`Error checking existing article: ${existErr.message}`);
        }
        if (existing) {
          // Article already imported
          continue;
        }
        // Prepare the prompt for Groq.  The prompt is designed
        // similarly to your Base44 implementation: it instructs the
        // model to rewrite the article in Portuguese, focusing on
        // Manaus/Amazonas when relevant, and to output JSON.
        const prompt = `Você é um jornalista profissional de Manaus/Amazonas.\n\nTAREFA: Reescrever completamente a notícia abaixo de forma original, mantendo os fatos mas mudando totalmente a redação.\n\nNOTÍCIA ORIGINAL:\nTítulo: ${title}\nConteúdo: ${description}\n\nINSTRUÇÕES:\n1. Reescreva o conteúdo de forma TOTALMENTE ORIGINAL (não copie frases)\n2. Use linguagem jornalística brasileira, clara e direta\n3. Foque em Manaus/Amazonas quando relevante\n4. Tamanho: entre 1500 e 3000 caracteres\n5. Organize em parágrafos bem estruturados\n6. Crie um título completamente novo e chamativo\n7. IMPORTANTE: Escreva em português brasileiro correto\n\nFORMATO DE RESPOSTA (JSON):\n{\n  \"titulo\": \"novo título aqui\",\n  \"conteudo\": \"texto completo reescrito aqui (com múltiplos parágrafos separados por\\n\\n)\"\n}`;
        // Call Groq API
        let newTitle = "";
        let newContent = "";
        try {
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
                messages: [
                  { role: "user", content: prompt },
                ],
                temperature: 0.7,
                max_tokens: 1024,
              }),
            },
          );
          if (!groqResponse.ok) {
            console.error(`Groq API error: ${groqResponse.status} ${await groqResponse.text()}`);
            continue;
          }
          const groqData = await groqResponse.json();
          const content = groqData?.choices?.[0]?.message?.content?.trim();
          if (!content) continue;
          // Attempt to parse JSON from the model output
          try {
            const parsed = JSON.parse(content);
            newTitle = parsed.titulo?.trim() || "";
            newContent = parsed.conteudo?.trim() || "";
          } catch (_jsonErr) {
            // Fallback: if the model didn't return JSON, treat the whole
            // string as content and reuse the original title.
            newTitle = title;
            newContent = content;
          }
        } catch (llmErr) {
          console.error(`Error calling Groq API: ${llmErr}`);
          continue;
        }
        if (!newTitle || !newContent) continue;
        // Create a slug for the canonical path
        const slug = slugify(newTitle);
        // Determine a category based on feed origin
        let category = "Geral";
        if (feedUrl.includes("/26/manaus")) category = "Manaus";
        else if (feedUrl.includes("famosos")) category = "Entretenimento";
        else if (feedUrl.includes("amazonas")) category = "Amazonas";
        // Derive a simple image credit from the source domain
        let imageCredit = "";
        try {
          const url = new URL(link);
          imageCredit = `Fonte: ${url.hostname}`;
        } catch {}
        // Insert the article into the database
        const { error: insertErr } = await supabase.from("noticias").insert({
          title: newTitle,
          original_title: title,
          content: newContent,
          original_content: description,
          canonical_path: slug,
          category,
          image_url: imageUrl || null,
          image_credit: imageCredit || null,
          original_link: link,
          pub_date: pubDate || null,
          created_at: new Date().toISOString(),
        });
        if (insertErr) {
          console.error(`Failed to insert article: ${insertErr.message}`);
          continue;
        }
        imported.push({ title: newTitle, slug });
        importedCount += 1;
        // Delay a little between requests to avoid hitting rate limits
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      console.error(`Error processing feed ${feedUrl}:`, err);
    }
  }
  return new Response(
    JSON.stringify({ imported: importedCount, articles: imported }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});