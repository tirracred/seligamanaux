import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as rss from 'https://deno.land/x/rss@0.6.0/mod.ts'
import { corsHeaders } from '../_shared/cors.ts'

// Define os feeds de notícias que você quer
const FEEDS = {
  'g1_am': 'https://g1.globo.com/rss/g1/am/amazonas/',
  'holanda': 'https://www.portaldoholanda.com.br/rss',
  '18horas': 'https://18horas.com.br/feed/',
  'agencia_am': 'https://www.agenciaamazonas.am.gov.br/feed/'
}

// Interface para o que esperamos do Groq
interface GroqChoice {
  message: {
    content: string;
  };
}

// --- CORREÇÃO 1: Definindo a Interface da Notícia ---
// Define o "molde" do objeto que vamos salvar no banco
interface INoticiaParaSalvar {
  title: string;
  content: string;
  category: string;
  image_url: string | null;
  headline_color: string;
}

// Função para reescrever texto com a API Groq
async function reescreverComGroq(texto: string, groqApiKey: string): Promise<string> {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${groqApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mixtral-8x7b-32768",
        messages: [{
          role: "user",
          content: `Reescreva esta notícia de forma jornalística para um portal de Manaus. Mantenha o significado original, mas altere as palavras. Seja direto e profissional:\n\n${texto.substring(0, 1000)}`
        }],
        temperature: 0.7,
        max_tokens: 400
      })
    });
    
    if (!response.ok) {
      throw new Error(`Erro na API Groq: ${response.statusText}`);
    }

    const data: { choices: GroqChoice[] } = await response.json();
    return data.choices[0].message.content;

  } catch (error) {
    console.error("Erro ao reescrever com Groq:", error);
    return texto; // Retorna o texto original em caso de falha
  }
}

// A função principal da Edge Function
Deno.serve(async (req) => {
  // Trata a requisição OPTIONS (necessária para CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Pega os segredos do ambiente
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

    if (!GROQ_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Segredos não encontrados. Configure o Vault.');
    }

    // 2. Pega o 'source' do corpo da requisição
    const { source } = await req.json();
    if (!source || !FEEDS[source]) {
      throw new Error('Fonte de notícias inválida ou não fornecida.');
    }

    const feedUrl = FEEDS[source];

    // 3. Inicializa o cliente Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 4. Busca o Feed RSS
    const response = await fetch(feedUrl);
    if (!response.ok) {
      throw new Error(`Erro ao buscar RSS: ${response.statusText}`);
    }
    const xml = await response.text();
    const feed = await rss.parse(xml);

    let artigosProcessados = 0;
    
    // --- CORREÇÃO 2: Tipando o array ---
    const artigosParaSalvar: INoticiaParaSalvar[] = [];

    // Limita a 5 artigos por vez
    for (const item of feed.entries.slice(0, 5)) {
      const tituloOriginal = item.title?.value || 'Sem Título';
      const resumoOriginal = item.description?.value?.replace(/<[^>]*>/g, '') || 'Sem resumo';

      // 5. Reescreve com Groq
      const novoTitulo = await reescreverComGroq(`Título: ${tituloOriginal}`, GROQ_API_KEY);
      const novoResumo = await reescreverComGroq(`Resumo: ${resumoOriginal}`, GROQ_API_KEY);

      // 6. Prepara para salvar no Supabase
      artigosParaSalvar.push({
        title: novoTitulo,
        content: novoResumo,
        category: "Notícias",
        image_url: null,
        headline_color: 'red'
      });
      // (Agora os erros de squiggly vermelha daqui sumirão)
      
      artigosProcessados++;
    }

    // 7. Insere no banco de dados
    const { error } = await supabase.from('noticias').insert(artigosParaSalvar);

    if (error) {
      throw new Error(`Erro ao salvar no Supabase: ${error.message}`);
    }

    return new Response(
      JSON.stringify({ message: `${artigosProcessados} notícias de '${source}' reescritas e salvas!` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    // --- CORREÇÃO 3: Verificando o tipo do erro ---
    let errorMessage = 'Ocorreu um erro desconhecido.';
    if (err instanceof Error) {
      errorMessage = err.message;
    }
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});