// POST /functions/v1/copiar-bloco-de-obra — DEPRECATED
//
// Esta função existia quando os catálogos (Recurso/Serviço/CPU) eram por
// empresa e compartilhados entre obras da mesma empresa. Após a revisão
// que vedou 100% o conteúdo entre obras, copiar bloco de obra precisa
// também clonar Recursos/Serviços/CPUs referenciados — mecânica nova
// que vai ser implementada em iteração futura como "importar de obra".
//
// Mantida aqui apenas pra responder com 410 Gone caso o frontend antigo
// (cache) ainda tente chamar.

import { handlePreflight, json } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  return json(
    {
      error:
        'copiar-bloco-de-obra está temporariamente desativada. Catálogos agora são por obra; a cópia cross-obra precisa de redesenho (clonar Recursos/Serviços/CPUs também). Será reintroduzida como "importar de outra obra".'
    },
    410
  )
})
