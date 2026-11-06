import { z } from 'zod'
import { rpc } from '../contexto'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { eq, gravar, ler } from '../lib/banco'
import { ARQUIVO, abrirPlanilha } from '../lib/planilha'
import { lerPlanilhaQuantidades } from '@/lib/quantidades/boq-xlsx'
import { depois } from './planejamento'

const OBRA = z.string().uuid().describe('id da obra')

/** Recalcula o plano em edição da obra (calendário, quantidades e orçamento mudam a entrada do motor). */
export async function recalcularEmEdicao(obraId: string, recalcular = true) {
  if (!recalcular) return { recalculado: false }
  const [p] = await ler<{ id: string }>('planejamento', {
    colunas: 'id',
    filtros: [eq('obra_id', obraId), eq('is_baseline', false)]
  })
  return p
    ? { plano: p.id, ...(await depois(p.id)) }
    : { recalculado: false, motivo: 'sem plano em edição' }
}

const RECALCULAR = z
  .boolean()
  .optional()
  .describe('recalcular o plano em edição depois (padrão true)')

const SEGMENTO = z.object({
  ini: z.number().describe('início em metros internos (área: 0)'),
  fim: z.number().describe('fim em metros internos (área: 1)'),
  label_ini: z.string().describe('rótulo do início, ex.: "50+0" ou "km 2,5" ou "área"'),
  label_fim: z.string(),
  valores: z.record(z.string(), z.number()).describe('item_orcamentario_id do serviço → quantidade')
})

export const quantidadesLocais = ferramenta({
  nome: 'quantidades_locais',
  titulo: 'Quantidades por local (trechos)',
  descricao:
    'Quantidades de cada serviço distribuídas ao longo dos locais (eixos por estaca e áreas), como no DynaRoad. ' +
    'acao: ler (versão atual do trecho: segmentos × serviços) | versoes | salvar (substitui ou cria nova versão: ' +
    'servicos = ids dos agrupadores, segmentos [{ini, fim, label_ini, label_fim, valores}] em metros internos; o ' +
    'banco recusa total acima do orçamento) | restaurar (versão antiga) | totais (quanto de cada serviço já foi ' +
    'distribuído nos trechos) | ler_planilha (lê uma planilha de quantidades no padrão DynaRoad e devolve as ' +
    'abas/colunas/linhas para você montar os segmentos) | mapeamento (colunas da planilha → serviço) | ' +
    'salvar_mapeamento | criar_tarefas (gera tarefas do plano a partir das quantidades: modo sequencia|local|' +
    'janela, janela_m, sentido) | disponivel (quanto do serviço está no trecho e quanto ainda cabe) | ' +
    'qtd_faixa (quantidade do serviço entre ini_m e fim_m no trecho).',
  entrada: {
    acao: z.enum([
      'ler',
      'versoes',
      'salvar',
      'restaurar',
      'totais',
      'ler_planilha',
      'mapeamento',
      'salvar_mapeamento',
      'criar_tarefas',
      'disponivel',
      'qtd_faixa'
    ]),
    obra_id: OBRA.optional(),
    trecho_id: z.string().uuid().optional(),
    modo: z.enum(['analitico', 'simplificado']).optional(),
    servicos: z.array(z.string().uuid()).optional(),
    segmentos: z.array(SEGMENTO).optional(),
    nova_versao: z.boolean().optional(),
    comentario: z.string().optional(),
    versao_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional().describe('disponivel/qtd_faixa: serviço (agrupador)'),
    ini_m: z.number().optional(),
    fim_m: z.number().optional(),
    ...ARQUIVO,
    mapeamento: z
      .array(z.object({ chave: z.string(), item_orcamentario_id: z.string().uuid().nullable() }))
      .optional(),
    planejamento_id: z.string().uuid().optional(),
    parent_id: z.string().uuid().nullable().optional(),
    trechos: z.array(z.string().uuid()).optional(),
    itens: z.array(z.string().uuid()).optional().describe('criar_tarefas: serviços'),
    modo_tarefas: z.enum(['sequencia', 'local', 'janela']).optional(),
    janela_m: z.number().nullable().optional(),
    sentido: z.enum(['crescente', 'decrescente']).optional(),
    recalcular: RECALCULAR,
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: [
      'trecho_quantidade_template',
      'trecho_quantidade_versao',
      'trecho_quantidade_segmento',
      'trecho_quantidade_coluna',
      'trecho_quantidade_celula',
      'trecho_quantidade_mapeamento'
    ],
    rpcs: [
      'trecho_salvar_quantidades',
      'trecho_restaurar_versao',
      'trechos_servico_total',
      'trecho_servico_total',
      'trecho_servico_disponivel',
      'trecho_qtd_faixa',
      'planejamento_tarefas_criar_das_quantidades'
    ]
  },
  async executar(a) {
    const trecho = () => exigir(a.trecho_id, 'trecho_id', a.acao)
    switch (a.acao) {
      case 'versoes': {
        const [t] = await ler<{ id: string }>('trecho_quantidade_template', {
          colunas: 'id, modo',
          filtros: [eq('trecho_id', trecho())]
        })
        if (!t) return []
        return ler('trecho_quantidade_versao', {
          filtros: [eq('template_id', t.id)],
          ordem: [{ coluna: 'numero', asc: false }]
        })
      }
      case 'ler': {
        const [t] = await ler<{ id: string; modo: string }>('trecho_quantidade_template', {
          colunas: 'id, modo',
          filtros: [eq('trecho_id', trecho())]
        })
        if (!t) return { modo: null, segmentos: [] }
        const [v] = await ler<{ id: string; numero: number }>('trecho_quantidade_versao', {
          colunas: 'id, numero, comentario, created_at',
          filtros: [eq('template_id', t.id), eq('is_atual', true)]
        })
        if (!v) return { modo: t.modo, segmentos: [] }
        const [segs, cols] = await Promise.all([
          ler<{
            id: string
            posicao_inicio_m: number
            posicao_fim_m: number
            unidade_inicio_label: string
            unidade_fim_label: string
          }>('trecho_quantidade_segmento', {
            filtros: [eq('versao_id', v.id)],
            ordem: [{ coluna: 'ordem' }]
          }),
          ler<{ id: string; item_orcamentario_id: string }>('trecho_quantidade_coluna', {
            filtros: [eq('versao_id', v.id)]
          })
        ])
        const cel = segs.length
          ? await ler<{ segmento_id: string; coluna_id: string; valor: number }>(
              'trecho_quantidade_celula',
              { filtros: [{ coluna: 'segmento_id', op: 'in', valor: segs.map((s) => s.id) }] }
            )
          : []
        const itemDaCol = new Map(cols.map((c) => [c.id, c.item_orcamentario_id]))
        return {
          modo: t.modo,
          versao: v,
          servicos: cols.map((c) => c.item_orcamentario_id),
          segmentos: segs.map((s) => ({
            ini: Number(s.posicao_inicio_m),
            fim: Number(s.posicao_fim_m),
            label_ini: s.unidade_inicio_label,
            label_fim: s.unidade_fim_label,
            valores: Object.fromEntries(
              cel
                .filter((c) => c.segmento_id === s.id)
                .map((c) => [itemDaCol.get(c.coluna_id), Number(c.valor)])
            )
          }))
        }
      }
      case 'salvar': {
        const segmentos = exigir(a.segmentos, 'segmentos', a.acao)
        const pedido = pedirConfirmacao(a.confirmar, 'salvar quantidades do trecho', {
          trecho: trecho(),
          segmentos: segmentos.length,
          servicos: a.servicos?.length ?? 0,
          nova_versao: a.nova_versao ?? true
        })
        if (pedido) return pedido
        const r = await rpc('trecho_salvar_quantidades', {
          _trecho_id: trecho(),
          _dados: {
            modo: a.modo ?? 'analitico',
            servicos: exigir(a.servicos, 'servicos', a.acao),
            segmentos,
            nova_versao: a.nova_versao ?? true,
            comentario: a.comentario ?? ''
          }
        })
        const [t] = await ler<{ obra_id: string }>('obra_trecho', {
          colunas: 'obra_id',
          filtros: [eq('id', trecho())]
        })
        return { resultado: r, calculo: await recalcularEmEdicao(t!.obra_id, a.recalcular) }
      }
      case 'restaurar':
        await rpc('trecho_restaurar_versao', {
          _versao_id: exigir(a.versao_id, 'versao_id', a.acao)
        })
        return { ok: true }
      case 'totais': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const servicos = await ler<{
          id: string
          codigo: string
          descricao: string
          quantidade_referencia: number
        }>('item_orcamentario', {
          colunas: 'id, codigo, descricao, unidade_referencia, quantidade_referencia',
          filtros: [eq('obra_id', obra), eq('tipo', 'servico_grupo')],
          ordem: [{ coluna: 'codigo' }]
        })
        return Promise.all(
          servicos.map(async (s) => ({
            ...s,
            distribuido_nos_trechos: await rpc('trechos_servico_total', { _item_id: s.id })
          }))
        )
      }
      case 'ler_planilha': {
        const wb = await abrirPlanilha(a)
        if (!wb) throw new Error('Mande arquivo_base64 ou url.')
        return lerPlanilhaQuantidades(wb)
      }
      case 'mapeamento':
        return ler('trecho_quantidade_mapeamento', {
          filtros: [eq('obra_id', exigir(a.obra_id, 'obra_id', a.acao))]
        })
      case 'salvar_mapeamento': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        await gravar(
          'trecho_quantidade_mapeamento',
          'upsert',
          exigir(a.mapeamento, 'mapeamento', a.acao).map((m) => ({ obra_id: obra, ...m })),
          [],
          { onConflict: 'obra_id,chave' }
        )
        return { ok: true }
      }
      case 'disponivel': {
        const item = exigir(a.item_id, 'item_id', a.acao)
        const [total, disponivel] = await Promise.all([
          rpc('trecho_servico_total', { _trecho_id: trecho(), _item_id: item }),
          rpc('trecho_servico_disponivel', { _trecho_id: trecho(), _item_id: item })
        ])
        return { no_trecho: total, ainda_cabe: disponivel }
      }
      case 'qtd_faixa':
        return {
          quantidade: await rpc('trecho_qtd_faixa', {
            _trecho_id: trecho(),
            _item_id: exigir(a.item_id, 'item_id', a.acao),
            _ini: exigir(a.ini_m, 'ini_m', a.acao),
            _fim: exigir(a.fim_m, 'fim_m', a.acao)
          })
        }
      case 'criar_tarefas': {
        const plan = exigir(a.planejamento_id, 'planejamento_id', a.acao)
        const ids = await rpc<string[]>('planejamento_tarefas_criar_das_quantidades', {
          _planejamento_id: plan,
          _parent_id: a.parent_id ?? null,
          _trechos: exigir(a.trechos, 'trechos', a.acao),
          _itens: exigir(a.itens, 'itens', a.acao),
          _opcoes: {
            modo: a.modo_tarefas ?? 'sequencia',
            janela_m: a.janela_m ?? null,
            sentido: a.sentido ?? 'crescente'
          }
        })
        return { criadas: ids?.length ?? 0, ids, calculo: await depois(plan, a.recalcular) }
      }
    }
  }
})

const DIA = z.object({ inicio: z.string().describe('HH:MM'), horas: z.number() })

export const calendarios = ferramenta({
  nome: 'calendarios',
  titulo: 'Calendários de trabalho e chuvas',
  descricao:
    'Calendários da obra (semana-tipo de 7 dias começando na segunda: [{inicio "HH:MM", horas}], horas 0 = folga) ' +
    'e exceções: feriado (data), pascoa (feriados móveis), folga_semana (dia da semana em todo ano), ' +
    'horario_excecao (outra semana-tipo num período). Fatores mensais de produtividade (chuva): ano_mes ' +
    'AAAA-MM-01 e fator 0–1. acao: listar | salvar (cria/edita; copiar_de traz as exceções) | excluir | ' +
    'definicao (cria/edita exceção) | excluir_definicao | fator | excluir_fator. Recalcula o plano em edição.',
  entrada: {
    acao: z.enum([
      'listar',
      'salvar',
      'excluir',
      'definicao',
      'excluir_definicao',
      'fator',
      'excluir_fator'
    ]),
    obra_id: OBRA,
    id: z.string().uuid().optional(),
    nome: z.string().optional(),
    semana: z.array(DIA).length(7).optional(),
    padrao: z.boolean().optional(),
    copiar_de: z.string().uuid().nullable().optional(),
    definicao: z
      .object({
        id: z.string().uuid().nullable().optional(),
        calendario_id: z.string().uuid(),
        tipo: z.enum(['feriado', 'pascoa', 'folga_semana', 'horario_excecao']),
        nome: z.string(),
        data_inicio: z.string().nullable(),
        data_fim: z.string().nullable(),
        todo_ano: z.boolean(),
        dia_semana: z.number().int().min(0).max(6).nullable(),
        semana: z.array(DIA).length(7).nullable(),
        ordem: z.number().int().optional()
      })
      .optional(),
    ano_mes: z.string().optional(),
    fator: z.number().optional(),
    motivo: z.string().nullable().optional(),
    recalcular: RECALCULAR
  },
  cobre: { tabelas: ['calendario', 'calendario_definicao', 'obra_produtividade_mes'] },
  async executar(a) {
    const fim = async (r: unknown) => ({
      resultado: r ?? null,
      calculo: await recalcularEmEdicao(a.obra_id, a.recalcular)
    })
    switch (a.acao) {
      case 'listar': {
        const cals = await ler<{ id: string }>('calendario', {
          filtros: [eq('obra_id', a.obra_id)],
          ordem: [{ coluna: 'ordem' }]
        })
        const defs = cals.length
          ? await ler('calendario_definicao', {
              filtros: [{ coluna: 'calendario_id', op: 'in', valor: cals.map((c) => c.id) }]
            })
          : []
        const fatores = await ler('obra_produtividade_mes', {
          filtros: [eq('obra_id', a.obra_id)],
          ordem: [{ coluna: 'ano_mes' }]
        })
        return { calendarios: cals, definicoes: defs, fatores }
      }
      case 'salvar': {
        if (a.id) {
          const campos: Record<string, unknown> = {}
          if (a.nome !== undefined) campos.nome = a.nome
          if (a.semana !== undefined) campos.semana = a.semana
          if (a.padrao !== undefined) campos.padrao = a.padrao
          await gravar('calendario', 'update', campos, [eq('id', a.id)])
          return fim({ id: a.id })
        }
        const [c] = await gravar<{ id: string }>('calendario', 'insert', {
          obra_id: a.obra_id,
          nome: exigir(a.nome, 'nome', a.acao),
          semana: exigir(a.semana, 'semana', a.acao),
          padrao: !!a.padrao
        })
        if (a.copiar_de) {
          const defs = await ler<Record<string, unknown>>('calendario_definicao', {
            colunas: 'tipo, nome, data_inicio, data_fim, todo_ano, dia_semana, semana, ordem',
            filtros: [eq('calendario_id', a.copiar_de)]
          })
          if (defs.length)
            await gravar(
              'calendario_definicao',
              'insert',
              defs.map((d) => ({ ...d, calendario_id: c!.id }))
            )
        }
        return fim(c)
      }
      case 'excluir':
        await gravar('calendario', 'delete', null, [eq('id', exigir(a.id, 'id', a.acao))])
        return fim(null)
      case 'definicao': {
        const { id, ...d } = exigir(a.definicao, 'definicao', a.acao)
        if (id) return fim((await gravar('calendario_definicao', 'update', d, [eq('id', id)]))[0])
        return fim((await gravar('calendario_definicao', 'insert', d))[0])
      }
      case 'excluir_definicao':
        await gravar('calendario_definicao', 'delete', null, [eq('id', exigir(a.id, 'id', a.acao))])
        return fim(null)
      case 'fator':
        await gravar(
          'obra_produtividade_mes',
          'upsert',
          {
            obra_id: a.obra_id,
            ano_mes: exigir(a.ano_mes, 'ano_mes', a.acao),
            fator: exigir(a.fator, 'fator', a.acao),
            motivo: a.motivo ?? null
          },
          [],
          { onConflict: 'obra_id,ano_mes' }
        )
        return fim(null)
      case 'excluir_fator':
        await gravar('obra_produtividade_mes', 'delete', null, [
          eq('obra_id', a.obra_id),
          eq('ano_mes', exigir(a.ano_mes, 'ano_mes', a.acao))
        ])
        return fim(null)
    }
  }
})

export const equipes = ferramenta({
  nome: 'equipes',
  titulo: 'Equipes e encarregados',
  descricao:
    'Equipes (frentes de serviço) e encarregados da obra. Um encarregado pode ter N equipes (equipe.encarregado_id). ' +
    'acao: listar | criar_equipe | editar_equipe (nome, tipo, cor, ativo, encarregado_id) | excluir_equipe | ' +
    'ordenar_equipes (ids na ordem) | criar_encarregado | editar_encarregado (nome, apelido, telefone, ativo) | ' +
    'vincular (define exatamente quais equipes ativas são do encarregado). Produtividade de equipe por serviço ' +
    'fica em equipe_produtividade (consultar).',
  entrada: {
    acao: z.enum([
      'listar',
      'criar_equipe',
      'editar_equipe',
      'excluir_equipe',
      'ordenar_equipes',
      'criar_encarregado',
      'editar_encarregado',
      'vincular'
    ]),
    obra_id: OBRA,
    id: z.string().uuid().optional(),
    ids: z.array(z.string().uuid()).optional(),
    nome: z.string().optional(),
    tipo: z.string().optional(),
    cor: z.string().optional(),
    ativo: z.boolean().optional(),
    encarregado_id: z.string().uuid().nullable().optional(),
    apelido: z.string().nullable().optional(),
    telefone: z.string().nullable().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: { tabelas: ['equipe', 'encarregado'] },
  async executar(a) {
    const id = () => exigir(a.id, 'id', a.acao)
    switch (a.acao) {
      case 'listar': {
        const [eqs, encs] = await Promise.all([
          ler('equipe', { filtros: [eq('obra_id', a.obra_id)], ordem: [{ coluna: 'ordem' }] }),
          ler('encarregado', { filtros: [eq('obra_id', a.obra_id)], ordem: [{ coluna: 'nome' }] })
        ])
        return { equipes: eqs, encarregados: encs }
      }
      case 'criar_equipe':
        return (
          await gravar('equipe', 'insert', {
            obra_id: a.obra_id,
            nome: exigir(a.nome, 'nome', a.acao).trim(),
            tipo: a.tipo ?? 'Geral',
            cor: a.cor ?? '#3b82f6',
            encarregado_id: a.encarregado_id ?? null
          })
        )[0]
      case 'editar_equipe': {
        const p: Record<string, unknown> = {}
        for (const k of ['nome', 'tipo', 'cor', 'ativo', 'encarregado_id'] as const)
          if (a[k] !== undefined) p[k] = a[k]
        return (await gravar('equipe', 'update', p, [eq('id', id())]))[0]
      }
      case 'excluir_equipe': {
        const pedido = pedirConfirmacao(a.confirmar, 'excluir equipe', { id: id() })
        if (pedido) return pedido
        await gravar('equipe', 'delete', null, [eq('id', id())])
        return { excluida: id() }
      }
      case 'ordenar_equipes': {
        const ids = exigir(a.ids, 'ids', a.acao)
        for (const [i, e] of ids.entries())
          await gravar('equipe', 'update', { ordem: i }, [eq('id', e)])
        return { ok: true }
      }
      case 'criar_encarregado':
        return (
          await gravar('encarregado', 'insert', {
            obra_id: a.obra_id,
            nome: exigir(a.nome, 'nome', a.acao).trim(),
            apelido: a.apelido ?? null,
            telefone: a.telefone ?? null
          })
        )[0]
      case 'editar_encarregado': {
        const p: Record<string, unknown> = {}
        for (const k of ['nome', 'apelido', 'telefone', 'ativo'] as const)
          if (a[k] !== undefined) p[k] = a[k]
        return (await gravar('encarregado', 'update', p, [eq('id', id())]))[0]
      }
      case 'vincular': {
        const enc = exigir(a.encarregado_id, 'encarregado_id', a.acao)
        const ids = exigir(a.ids, 'ids', a.acao)
        const atuais = await ler<{ id: string }>('equipe', {
          colunas: 'id',
          filtros: [eq('obra_id', a.obra_id), eq('encarregado_id', enc), eq('ativo', true)]
        })
        const sair = atuais.map((e) => e.id).filter((x) => !ids.includes(x))
        if (sair.length)
          await gravar('equipe', 'update', { encarregado_id: null }, [
            { coluna: 'id', op: 'in', valor: sair }
          ])
        if (ids.length)
          await gravar('equipe', 'update', { encarregado_id: enc }, [
            { coluna: 'id', op: 'in', valor: ids }
          ])
        return { equipes_do_encarregado: ids.length, removidas: sair.length }
      }
    }
  }
})
