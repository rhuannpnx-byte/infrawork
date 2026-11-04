// POST /functions/v1/import-orcamento
// Body: { obra_id, itens: ItemLinha[], alocacoes?: AlocacaoLinha[], servicos?: ServicoLinha[],
//         opcoes?: { existentes?: 'pular'|'atualizar', tudo_ou_nada?: boolean } }
//
// Importa a planilha orçamentária a partir do MODELO PADRÃO do sistema (v4):
//   RPC importar_orcamento (transacional) grava a planilha de venda como está
//   (etapas + receitas) e as alocações de cada receita aos serviços (criados
//   pelo nome), com rateio quando há mais de um destino. Serviços novos nascem
//   sem composição — o vínculo com a CPU é feito no sistema.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface ItemLinha {
  row: number
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
}

interface AlocacaoLinha {
  row: number
  /** Código da receita. */
  codigo: string
  criterio: 'percentual' | 'peso' | 'venda'
  compoe: boolean
  destinos: Array<{ servico: string; valor: number | null }>
}

/** Quantidade manual do serviço (colunas "Qtd. manual do serviço" / "Unidade do serviço"). */
interface ServicoLinha {
  servico: string
  quantidade: number
  unidade: string | null
}

interface RpcResult {
  ok: boolean
  stats: Record<string, number>
  erros: Array<{ row: number; msg: string; codigo?: string }>
  duracao_ms: number
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr

  let body: {
    obra_id?: string
    itens?: ItemLinha[]
    alocacoes?: AlocacaoLinha[]
    servicos?: ServicoLinha[]
    opcoes?: { existentes?: 'pular' | 'atualizar'; tudo_ou_nada?: boolean }
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const obra_id = body.obra_id?.trim()
  const itens = body.itens ?? []
  if (!obra_id) return json({ error: 'obra_id obrigatório' }, 400)
  if (!Array.isArray(itens) || itens.length === 0) {
    return json({ error: 'Nenhum item para importar' }, 400)
  }
  if (itens.length > 5000) return json({ error: 'Limite de 5000 linhas por importação' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const t0 = Date.now()

  const { data, error } = await admin.rpc('importar_orcamento', {
    _obra_id: obra_id,
    _itens: itens,
    _alocacoes: body.alocacoes ?? [],
    _servicos: body.servicos ?? [],
    _opcoes: {
      existentes: body.opcoes?.existentes ?? 'pular',
      tudo_ou_nada: body.opcoes?.tudo_ou_nada ?? true
    }
  })
  if (error) return json({ error: error.message }, 400)
  const rpc = data as RpcResult

  return json({
    ok: rpc.ok,
    stats: rpc.stats,
    avisos: [],
    erros: (rpc.erros ?? []).map((e) => `linha ${e.row}${e.codigo ? ` (${e.codigo})` : ''}: ${e.msg}`),
    duracao_ms: Date.now() - t0
  })
})
