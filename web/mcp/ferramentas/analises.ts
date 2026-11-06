import { z } from 'zod'
import { fn, rpc } from '../contexto'
import { exigir, ferramenta } from '../ferramenta'
import { eq, ler } from '../lib/banco'
import {
  carregarCurvaSDia,
  carregarEapGrupos,
  carregarHistoricoPrecos
} from '@/features/acompanhamento/hooks/valor-agregado'
import {
  criarValorizacao,
  montarComparativoPorServico,
  montarCurvaValorAgregado,
  montarMedicao
} from '@/features/acompanhamento/lib/valor-agregado-calc'
import {
  carregarFotosExport,
  carregarMateriaisProducao,
  carregarViagensExport,
  montarMemoriasFilhos
} from '@/features/acompanhamento/lib/valor-agregado-export'
import { gerarMedicaoXlsx } from '@/lib/excel/medicao-xlsx'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'

const OBRA = z.string().uuid().describe('id da obra')
const DATA = z.string().describe('AAAA-MM-DD')

const hoje = () => new Date().toISOString().slice(0, 10)
const inicioDoMes = () => `${hoje().slice(0, 8)}01`
const br = (iso: string) => iso.split('-').reverse().join('/')

/** Linha de base de referência do previsto (a vigente; sem vigente, a última que foi vigente). */
async function baseline(obraId: string) {
  const [p] = await ler<{ id: string; travada_em: string | null; vigente: boolean }>(
    'planejamento',
    {
      colunas: 'id, nome, travada_em, vigente, vigente_em',
      filtros: [
        eq('obra_id', obraId),
        eq('is_baseline', true),
        { coluna: 'vigente_em', op: 'not_is', valor: null }
      ],
      ordem: [
        { coluna: 'vigente', asc: false },
        { coluna: 'vigente_em', asc: false }
      ]
    }
  )
  return p ?? null
}

async function valorAgregado(obraId: string, de: string, ate: string, servico: string | null) {
  const lb = await baseline(obraId)
  const [tarefas, curvaSRows, grupos, hist] = await Promise.all([
    lb
      ? ler<PlanejamentoTarefaCompleta>('vw_planejamento_tarefa_completa', {
          filtros: [eq('planejamento_id', lb.id)],
          ordem: [{ coluna: 'ordem' }]
        })
      : Promise.resolve([] as PlanejamentoTarefaCompleta[]),
    carregarCurvaSDia(obraId),
    carregarEapGrupos(obraId),
    carregarHistoricoPrecos(obraId)
  ])
  const valorizacao = criarValorizacao(grupos, hist, lb?.travada_em?.slice(0, 10) ?? null)
  const tarefasF = servico
    ? tarefas.filter((t) => t.is_indireto || t.item_orcamentario_id === servico)
    : tarefas
  const curvaSF = servico
    ? curvaSRows.filter((r) => r.item_orcamentario_id === servico)
    : curvaSRows
  const gruposF = servico ? grupos.filter((g) => g.id === servico) : grupos
  return {
    lb,
    grupos,
    curvaSRows,
    curva: montarCurvaValorAgregado({
      tarefas: tarefasF,
      curvaSRows: curvaSF,
      hoje: hoje(),
      valorizacao
    }),
    comparativo: montarComparativoPorServico({
      tarefas: tarefasF,
      curvaSRows: curvaSF,
      de,
      ate,
      valorizacao
    }),
    medicao: montarMedicao({
      grupos: gruposF,
      tarefas: tarefasF,
      curvaSRows: curvaSF,
      de,
      ate,
      incluirIndireto: !servico,
      hist
    })
  }
}

export const analises = ferramenta({
  nome: 'analises',
  titulo: 'Análises e relatórios da obra',
  descricao:
    'Leituras consolidadas. acao: resumo (resumo da obra e do dashboard) | previsto_realizado (por serviço: ' +
    'planejado, realizado, % avanço, status e desvio) | curva_s (dia a dia, planejado × realizado por serviço) | ' +
    'valor_agregado (medição do período, comparativo por serviço e curva de receita/custo projetados; a ' +
    'referência é a linha de base vigente) | medicao_xlsx (a planilha de medição do período em base64: aba ' +
    'Medição, memória por serviço — QDM de viagens nos serviços por viagens — e fotos) | performance (produção ' +
    'por equipe/encarregado e histórico de produtividade de outras obras para os códigos de serviço) | painel ' +
    '(retrato da visão estratégica do app, engenheiro/adm/god) | cliente (visões do papel cliente). Período ' +
    'padrão: mês atual.',
  entrada: {
    acao: z.enum([
      'resumo',
      'previsto_realizado',
      'curva_s',
      'valor_agregado',
      'medicao_xlsx',
      'performance',
      'painel',
      'cliente'
    ]),
    obra_id: OBRA,
    de: DATA.optional(),
    ate: DATA.optional(),
    servico_id: z.string().uuid().nullable().optional().describe('agrupador (item_orcamentario)'),
    codigos_servico: z.array(z.string()).optional().describe('performance: códigos da composição'),
    incluir_fotos: z.boolean().optional().describe('medicao_xlsx: embute as fotos (padrão true)')
  },
  leitura: true,
  cobre: {
    rpcs: [
      'acompanhamento_perf_historico',
      'campo_painel',
      'cliente_producao',
      'cliente_curva_s',
      'cliente_previsto_realizado'
    ],
    funcoes: ['acompanhamento-dashboard-resumo']
  },
  async executar(a) {
    const de = a.de ?? inicioDoMes()
    const ate = a.ate ?? hoje()
    switch (a.acao) {
      case 'resumo': {
        const [resumo] = await ler('vw_acompanhamento_obra_resumo', {
          filtros: [eq('obra_id', a.obra_id)]
        })
        const dashboard = await fn('acompanhamento-dashboard-resumo', {
          obra_id: a.obra_id,
          periodo_dias: 30
        }).catch((e) => ({ erro: String(e) }))
        return { resumo, dashboard }
      }
      case 'previsto_realizado':
        return ler('vw_acompanhamento_previsto_x_realizado', {
          filtros: [
            eq('obra_id', a.obra_id),
            ...(a.servico_id ? [eq('item_orcamentario_id', a.servico_id)] : [])
          ]
        })
      case 'curva_s':
        return ler('vw_acompanhamento_curva_s', {
          colunas: 'item_orcamentario_id, data, planejado_dia, realizado_dia',
          filtros: [
            eq('obra_id', a.obra_id),
            { coluna: 'data', op: 'gte', valor: de },
            { coluna: 'data', op: 'lte', valor: ate },
            ...(a.servico_id ? [eq('item_orcamentario_id', a.servico_id)] : [])
          ],
          ordem: [{ coluna: 'data' }]
        })
      case 'valor_agregado': {
        const r = await valorAgregado(a.obra_id, de, ate, a.servico_id ?? null)
        return {
          periodo: { de, ate },
          referencia: r.lb,
          medicao: r.medicao,
          total_medido: r.medicao.reduce((s, x) => s + x.medicao_valor, 0),
          comparativo: r.comparativo,
          curva: r.curva
        }
      }
      case 'medicao_xlsx': {
        const r = await valorAgregado(a.obra_id, de, ate, a.servico_id ?? null)
        if (r.medicao.length === 0) throw new Error('Sem medição no período.')
        const [producao, materiais, viagens, fotos, obra] = await Promise.all([
          ler<ProducaoEnriquecida>('vw_acompanhamento_producao_enriquecida', {
            filtros: [
              eq('obra_id', a.obra_id),
              { coluna: 'data', op: 'gte', valor: de },
              { coluna: 'data', op: 'lte', valor: ate }
            ]
          }),
          carregarMateriaisProducao(a.obra_id, de, ate),
          carregarViagensExport(a.obra_id, de, ate),
          a.incluir_fotos === false ? Promise.resolve([]) : carregarFotosExport(a.obra_id, de, ate),
          ler<{ nome: string }>('obras', { colunas: 'nome', filtros: [eq('id', a.obra_id)] })
        ])
        const memorias = montarMemoriasFilhos(
          r.grupos,
          r.curvaSRows,
          producao,
          materiais,
          a.servico_id ?? null,
          de,
          ate,
          viagens
        )
        const nome = obra[0]?.nome ?? 'Obra'
        const dmy = (s: string) => s.split('-').reverse().join('.')
        const blob = await gerarMedicaoXlsx({
          obraNome: nome,
          periodoLabel: `${br(de)} a ${br(ate)}`,
          periodoArquivo: `${dmy(de)} - ${dmy(ate)}`,
          medicao: r.medicao,
          memorias,
          fotos
        })
        return {
          arquivo: `Medição ${nome} ${dmy(de)} - ${dmy(ate)}.xlsx`,
          total_medido: r.medicao.reduce((s, x) => s + x.medicao_valor, 0),
          base64: Buffer.from(await blob.arrayBuffer()).toString('base64')
        }
      }
      case 'performance': {
        const prod = await ler('vw_acompanhamento_produtividade_equipe', {
          filtros: [eq('obra_id', a.obra_id)]
        })
        const historico = a.codigos_servico?.length
          ? await rpc('acompanhamento_perf_historico', {
              p_servico_codigos: a.codigos_servico,
              p_obra_atual: a.obra_id
            })
          : null
        return { produtividade_por_equipe: prod, historico_outras_obras: historico }
      }
      case 'painel':
        return rpc('campo_painel', { _obra_id: a.obra_id })
      case 'cliente': {
        const [producao, curva, pxr] = await Promise.all([
          rpc('cliente_producao', { _obra_id: a.obra_id }),
          rpc('cliente_curva_s', { _obra_id: a.obra_id }),
          rpc('cliente_previsto_realizado', { _obra_id: a.obra_id })
        ])
        return { producao, curva_s: curva, previsto_realizado: pxr }
      }
    }
    return exigir(null, 'acao', 'desconhecida')
  }
})
