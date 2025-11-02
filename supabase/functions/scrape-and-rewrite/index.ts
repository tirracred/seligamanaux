import { serve } from "https://deno.land/std/http/server.ts"

// Importe seus headers CORS de um arquivo compartilhado
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req: Request) => {
  // Responde imediatamente a requisições OPTIONS (pré-voo do CORS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // --- INÍCIO DA LÓGICA DA SUA FUNÇÃO ---
    // Ex: Tentar ler o JSON do corpo da requisição
    const { urlParaScrape } = await req.json()
    if (!urlParaScrape) {
      throw new Error("O parâmetro 'urlParaScrape' é obrigatório.")
    }

    // Ex: Lógica de scraping (ver causas prováveis abaixo)
    const respostaScrape = await fetch(urlParaScrape, {
      headers: {
        // ESSENCIAL: Muitos sites bloqueiam o User-Agent padrão do Deno
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.82 Safari/537.36'
      }
    })

    if (!respostaScrape.ok) {
      throw new Error(`Falha ao buscar a URL: ${respostaScrape.status}`)
    }

    const html = await respostaScrape.text()
    
    //... sua lógica de "rewrite"...
    const dadosReescritos = { content: "exemplo" };
    // --- FIM DA LÓGICA DA SUA FUNÇÃO ---

    // Retorna sucesso
    return new Response(JSON.stringify(dadosReescritos), {
      headers: {...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    // --- CAPTURA QUALQUER ERRO ---
    // Loga o erro real no seu painel para depuração
    console.error('Erro na Função:', error.message) 
    
    // Retorna uma resposta de erro controlada (NÃO um crash 500)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: {...corsHeaders, 'Content-Type': 'application/json' },
      status: 400, // ou 500, dependendo do erro
    })
  }
})