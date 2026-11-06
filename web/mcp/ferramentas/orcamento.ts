import { z } from 'zod'
import { fn, rpc } from '../contexto'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { contar, eq, gravar, ler } from '../lib/banco'
import { ARQUIVO, abrirPlanilha, blobBase64, resumoParse, validas } from '../lib/planilha'
import {
  gerarModeloOrcamento,
  orcamentoToPayload,
  parseOrcamento
} from '@/lib/xlsx/templates/orcamento'

const OBRA = z.string().uuid().describe('id da obra (veja quem_sou)')
const ITEM_COLS =
  'id, parent_id, nivel, codigo, descricao, tipo, unidade, quantidade, venda_unitaria, venda_total_calc, ' +
  'servico_id, indireto_id, quantidade_referencia, unidade_referencia, qtd_ref_modo, ordem, ' +
  'custo_unitario_calc, custo_total_calc, lucratividade_perc_calc, aditivo_id'

async function obraTemplate(obraId: string) {
  const [o] = await ler<{ codigo: string; nome: string; empresa_id: string }>('obras', {
    colunas: 'codigo, nome, empresa_id',
    filtros: [eq('id', obraId)]
  })
  if (!o) throw new Error('Obra não encontrada ou sem acesso.')
  const [e] = await ler<{ nome: string }>('empresas', {
    colunas: 'nome',
    filtros: [eq('id', o.empresa_id)]
  })
  return { empresaNome: e?.nome ?? '', obraCodigo: o.codigo, obraNome: o.nome }
}

export const orcamentoImportar = ferramenta({
  nome: 'orcamento_importar',
  titulo: 'Importar planilha orçamentária',
  descricao:
    'Sobe a planilha de venda da obra (etapas, receitas e o agrupamento das receitas em serviços com rateio), ' +
    'no modelo do InfraWork. acao "modelo" devolve o .xlsx do modelo em base64 (abas Orçamento/Agrupamentos). ' +
    'acao "importar": mande o .xlsx (base64 ou url) ou as linhas em JSON (itens/alocacoes/servicos no formato ' +
    'da RPC importar_orcamento). Sem confirmar=true devolve só a prévia (linhas válidas e erros); com ' +
    'confirmar=true grava tudo ou nada. existentes: "pular" mantém o que já existe, "atualizar" sobrescreve ' +
    'descrição, quantidade, preço e serviços. Regras: com linha de base vigente o orçamento fica travado; depois ' +
    'do 1º aditivo a planilha de venda só muda por aditivo.',
  entrada: {
    acao: z.enum(['modelo', 'importar']),
    obra_id: OBRA,
    ...ARQUIVO,
    itens: z
      .array(z.record(z.string(), z.any()))
      .optional()
      .describe(
        '[{row, codigo, descricao, unidade, quantidade, venda_unitaria}] — sem unidade = etapa'
      ),
    alocacoes: z
      .array(z.record(z.string(), z.any()))
      .optional()
      .describe(
        '[{row, codigo (da receita), criterio: percentual|peso|venda, compoe, destinos:[{servico, valor}]}]'
      ),
    servicos: z
      .array(z.record(z.string(), z.any()))
      .optional()
      .describe('quantidade/unidade manual de serviços: [{servico, quantidade, unidade}]'),
    existentes: z.enum(['pular', 'atualizar']).optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    funcoes: ['import-orcamento'],
    rpcs: ['importar_orcamento'],
    tabelas: ['item_orcamentario']
  },
  async executar(a) {
    if (a.acao === 'modelo')
      return {
        arquivo: 'modelo-orcamento.xlsx',
        base64: await blobBase64(gerarModeloOrcamento(await obraTemplate(a.obra_id)))
      }
    let payload: { itens: unknown[]; alocacoes: unknown[]; servicos: unknown[] }
    let previa: unknown
    const wb = await abrirPlanilha(a)
    if (wb) {
      const itens = await ler<{ codigo: string; tipo: string; descricao: string }>(
        'item_orcamentario',
        { colunas: 'codigo, tipo, descricao', filtros: [eq('obra_id', a.obra_id)] }
      )
      const p = parseOrcamento(wb, { itens: itens as never })
      previa = resumoParse(p)
      payload = orcamentoToPayload(validas(p))
    } else {
      payload = {
        itens: exigir(a.itens, 'itens (ou arquivo_base64/url)', a.acao),
        alocacoes: a.alocacoes ?? [],
        servicos: a.servicos ?? []
      }
      previa = {
        itens: payload.itens.length,
        alocacoes: payload.alocacoes.length,
        servicos: payload.servicos.length
      }
    }
    const pedido = pedirConfirmacao(a.confirmar, 'importar orçamento', {
      ...(previa as object),
      existentes: a.existentes ?? 'pular'
    })
    if (pedido) return pedido
    return fn('import-orcamento', {
      obra_id: a.obra_id,
      ...payload,
      opcoes: { existentes: a.existentes ?? 'pular', tudo_ou_nada: true }
    })
  }
})

const TIPO_ITEM = z.enum(['etapa', 'receita'])

export const orcamentoItens = ferramenta({
  nome: 'orcamento_itens',
  titulo: 'Planilha de venda (itens do orçamento)',
  descricao:
    'Itens da planilha de venda: etapas (agrupam) e receitas (têm unidade, quantidade e preço de venda). ' +
    'acao: listar | criar | editar | excluir | mover. Os serviços (agrupadores de custo) ficam na ferramenta ' +
    'agrupadores. Totais e custos são recalculados no banco. Receita agrupada não pode ser excluída (remova a ' +
    'alocação antes).',
  entrada: {
    acao: z.enum(['listar', 'criar', 'editar', 'excluir', 'mover']),
    obra_id: OBRA.optional(),
    id: z.string().uuid().optional(),
    tipo: TIPO_ITEM.optional(),
    codigo: z.string().optional().describe('ex.: 01.02.03 (vazio = gerado)'),
    descricao: z.string().optional(),
    unidade: z.string().nullable().optional(),
    quantidade: z.number().nullable().optional(),
    venda_unitaria: z.number().nullable().optional(),
    parent_id: z.string().uuid().nullable().optional().describe('etapa pai (null = raiz)'),
    ordem: z.number().int().optional(),
    incluir_servicos: z.boolean().optional().describe('listar: incluir os agrupadores'),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: { tabelas: ['item_orcamentario'] },
  async executar(a) {
    switch (a.acao) {
      case 'listar': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const itens = await ler('item_orcamentario', {
          colunas: ITEM_COLS,
          filtros: [
            eq('obra_id', obra),
            ...(a.incluir_servicos
              ? []
              : [{ coluna: 'tipo', op: 'neq' as const, valor: 'servico_grupo' }])
          ],
          ordem: [{ coluna: 'codigo' }]
        })
        return { n: itens.length, itens }
      }
      case 'criar': {
        const [r] = await gravar('item_orcamentario', 'insert', {
          obra_id: exigir(a.obra_id, 'obra_id', a.acao),
          tipo: exigir(a.tipo, 'tipo', a.acao),
          codigo: a.codigo ?? null,
          descricao: exigir(a.descricao, 'descricao', a.acao),
          unidade: a.unidade ?? null,
          quantidade: a.quantidade ?? null,
          venda_unitaria: a.venda_unitaria ?? null,
          parent_id: a.parent_id ?? null,
          ordem: a.ordem ?? 0
        })
        return r
      }
      case 'editar': {
        const id = exigir(a.id, 'id', a.acao)
        const patch: Record<string, unknown> = {}
        for (const k of ['codigo', 'descricao', 'unidade', 'quantidade', 'venda_unitaria'] as const)
          if (a[k] !== undefined) patch[k] = a[k]
        if (Object.keys(patch).length === 0) throw new Error('Nada para editar.')
        return (await gravar('item_orcamentario', 'update', patch, [eq('id', id)]))[0]
      }
      case 'mover': {
        const id = exigir(a.id, 'id', a.acao)
        const patch: Record<string, unknown> = { parent_id: a.parent_id ?? null }
        if (a.ordem !== undefined) patch.ordem = a.ordem
        return (await gravar('item_orcamentario', 'update', patch, [eq('id', id)]))[0]
      }
      case 'excluir': {
        const id = exigir(a.id, 'id', a.acao)
        const [item] = await ler('item_orcamentario', {
          colunas: 'id, codigo, descricao, tipo',
          filtros: [eq('id', id)]
        })
        if (!item) throw new Error('Item não encontrado.')
        const filhos = await contar('item_orcamentario', [eq('parent_id', id)])
        const pedido = pedirConfirmacao(a.confirmar, 'excluir item', {
          item,
          filhos_que_saem_junto: filhos
        })
        if (pedido) return pedido
        await gravar('item_orcamentario', 'delete', null, [eq('id', id)])
        return { excluido: item }
      }
    }
  }
})

export const agrupadores = ferramenta({
  nome: 'agrupadores',
  titulo: 'Serviços (agrupadores) e rateio das receitas',
  descricao:
    'Serviços (servico_grupo) agrupam receitas da planilha de venda e ligam o custo a uma composição. ' +
    'acao: listar | criar | editar (descrição, composição servico_id ou indireto_id, unidade e modo da ' +
    'quantidade de referência: soma_filhos|heranca|manual) | excluir | alocar (receitas 100% ou o saldo ao ' +
    'serviço) | rateio (substitui o rateio de uma receita entre serviços: criterio percentual|peso|venda) | ' +
    'remover_alocacoes | compoe (a alocação compõe ou não a quantidade do serviço). Serviço sem composição ' +
    'não alimenta custo, planejamento nem produção.',
  entrada: {
    acao: z.enum([
      'listar',
      'criar',
      'editar',
      'excluir',
      'alocar',
      'rateio',
      'remover_alocacoes',
      'compoe'
    ]),
    obra_id: OBRA.optional(),
    id: z.string().uuid().optional().describe('serviço (agrupador)'),
    descricao: z.string().optional(),
    servico_id: z.string().uuid().nullable().optional().describe('composição (tabela servico)'),
    indireto_id: z.string().uuid().nullable().optional(),
    unidade_referencia: z.string().nullable().optional(),
    qtd_ref_modo: z.enum(['manual', 'heranca', 'soma_filhos']).optional(),
    quantidade_referencia: z.number().optional().describe('só no modo manual'),
    receita_ids: z.array(z.string().uuid()).optional(),
    receita_id: z.string().uuid().optional(),
    criterio: z.enum(['percentual', 'peso', 'venda']).optional(),
    destinos: z
      .array(
        z.object({
          grupo_id: z.string().uuid(),
          valor: z.number().nullable(),
          compoe_qtd: z.boolean()
        })
      )
      .optional()
      .describe('rateio: percentual em %, peso em quantidade física, venda = null'),
    alocacao_ids: z.array(z.string().uuid()).optional(),
    alocacao_id: z.string().uuid().optional(),
    compoe: z.boolean().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['item_orcamentario', 'item_orc_alocacao'],
    rpcs: ['alocar_receitas', 'salvar_rateio_receita', 'remover_alocacoes', 'set_alocacao_compoe']
  },
  async executar(a) {
    switch (a.acao) {
      case 'listar': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const [servicos, aloc] = await Promise.all([
          ler('item_orcamentario', {
            colunas: ITEM_COLS,
            filtros: [eq('obra_id', obra), eq('tipo', 'servico_grupo')],
            ordem: [{ coluna: 'codigo' }]
          }),
          ler('item_orc_alocacao', {
            colunas: 'id, grupo_id, receita_id, criterio, valor, compoe_qtd, fracao',
            filtros: [eq('obra_id', obra)]
          })
        ])
        return { servicos, alocacoes: aloc }
      }
      case 'criar': {
        const [r] = await gravar('item_orcamentario', 'insert', {
          obra_id: exigir(a.obra_id, 'obra_id', a.acao),
          tipo: 'servico_grupo',
          descricao: exigir(a.descricao, 'descricao', a.acao).trim(),
          qtd_ref_modo: a.qtd_ref_modo ?? 'soma_filhos',
          quantidade_referencia: a.quantidade_referencia ?? 0,
          unidade_referencia: a.unidade_referencia ?? null,
          servico_id: a.servico_id ?? null
        })
        return r
      }
      case 'editar': {
        const id = exigir(a.id, 'id', a.acao)
        const patch: Record<string, unknown> = {}
        for (const k of [
          'descricao',
          'servico_id',
          'indireto_id',
          'unidade_referencia',
          'qtd_ref_modo',
          'quantidade_referencia'
        ] as const)
          if (a[k] !== undefined) patch[k] = a[k]
        if (Object.keys(patch).length === 0) throw new Error('Nada para editar.')
        return (await gravar('item_orcamentario', 'update', patch, [eq('id', id)]))[0]
      }
      case 'excluir': {
        const id = exigir(a.id, 'id', a.acao)
        const n = await contar('item_orc_alocacao', [eq('grupo_id', id)])
        const pedido = pedirConfirmacao(a.confirmar, 'excluir serviço', {
          id,
          receitas_que_ficam_sem_agrupamento: n
        })
        if (pedido) return pedido
        await gravar('item_orcamentario', 'delete', null, [eq('id', id)])
        return { excluido: id }
      }
      case 'alocar':
        return rpc('alocar_receitas', {
          _grupo_id: exigir(a.id, 'id', a.acao),
          _receita_ids: exigir(a.receita_ids, 'receita_ids', a.acao)
        })
      case 'rateio':
        await rpc('salvar_rateio_receita', {
          _receita_id: exigir(a.receita_id, 'receita_id', a.acao),
          _criterio: exigir(a.criterio, 'criterio', a.acao),
          _destinos: exigir(a.destinos, 'destinos', a.acao)
        })
        return { ok: true }
      case 'remover_alocacoes':
        return {
          removidas: await rpc('remover_alocacoes', {
            _ids: exigir(a.alocacao_ids, 'alocacao_ids', a.acao)
          })
        }
      case 'compoe':
        await rpc('set_alocacao_compoe', {
          _id: exigir(a.alocacao_id, 'alocacao_id', a.acao),
          _compoe: exigir(a.compoe, 'compoe', a.acao)
        })
        return { ok: true }
    }
  }
})

export const orcamentoResumo = ferramenta({
  nome: 'orcamento_resumo',
  titulo: 'Resumo do orçamento (venda × custo)',
  descricao:
    'Consolidado do orçamento da obra: venda, custo e lucratividade por serviço (vw_orcamento_consolidado). acao: ler | recalcular (força o recálculo de custos do orçamento).',
  entrada: { acao: z.enum(['ler', 'recalcular']).optional(), obra_id: OBRA },
  cobre: { rpcs: ['recalcular_orcamento'] },
  async executar(a) {
    if (a.acao === 'recalcular') return rpc('recalcular_orcamento', { _obra_id: a.obra_id })
    return {
      linhas: await ler('vw_orcamento_consolidado', { filtros: [eq('obra_id', a.obra_id)] })
    }
  }
})
