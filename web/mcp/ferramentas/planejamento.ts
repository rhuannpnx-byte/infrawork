import { z } from 'zod'
import { rpc } from '../contexto'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { contar, eq, gravar, ler } from '../lib/banco'
import { calcularSemGravar, recalcularPlano } from '../lib/motor'
import { aplicarComando } from '@/features/cronograma/motor/edicao'
import { isoParaSeg } from '@/features/cronograma/motor/tempo'

const OBRA = z.string().uuid().describe('id da obra')
const PLANO = z.string().uuid().describe('id do plano (planejamento)')
const RECALCULAR = z
  .boolean()
  .optional()
  .describe('recalcular o cronograma depois (padrão true; em lote, passe false e calcule no fim)')

/** Recalcula e grava (como o web faz ao abrir o cronograma); devolve um resumo. */
export async function depois(planId: string, recalcular = true) {
  if (!recalcular) return { recalculado: false }
  const r = await recalcularPlano(planId)
  const t = [...r.resultado.tarefas.values()]
  return {
    recalculado: r.gravado,
    tarefas: t.length,
    fim_do_plano: t.reduce<string | null>((m, x) => {
      const d = new Date(x.fim * 1000).toISOString().slice(0, 10)
      return !m || d > m ? d : m
    }, null),
    avisos: r.resultado.avisos.slice(0, 20)
  }
}

export const planos = ferramenta({
  nome: 'planos',
  titulo: 'Planos e linhas de base',
  descricao:
    'Planos de planejamento da obra. Só existe um plano em edição por obra; linhas de base (LB) são travadas e ' +
    'uma delas pode ser a vigente (referência do previsto). acao: listar | criar (nome, data_referencia_inicio) | ' +
    'editar (nome, início, prazo, calendário, modo programacao|controle, data de controle) | excluir | copiar ' +
    '(nova cópia em edição) | promover (trava como LB; recusa se o cálculo estiver desatualizado — calcule ' +
    'antes) | vigente (marca uma LB como vigente) | desmarcar_vigente | restaurar (copia uma LB, calcula com as ' +
    'premissas atuais e trava como nova LB) | premissas_diff (o que mudou desde a LB) | trava (por que o ' +
    'orçamento/cadeia está travado).',
  entrada: {
    acao: z.enum([
      'listar',
      'criar',
      'editar',
      'excluir',
      'copiar',
      'promover',
      'vigente',
      'desmarcar_vigente',
      'restaurar',
      'premissas_diff',
      'trava'
    ]),
    obra_id: OBRA.optional(),
    planejamento_id: PLANO.optional(),
    nome: z.string().optional(),
    descricao: z.string().nullable().optional(),
    data_referencia_inicio: z.string().optional().describe('AAAA-MM-DD'),
    prazo: z.string().nullable().optional(),
    calendario_id: z.string().uuid().nullable().optional(),
    modo: z.enum(['programacao', 'controle']).optional(),
    data_date: z.string().nullable().optional().describe('data de controle (null = hoje)'),
    marcar_vigente: z.boolean().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    // a promoção congela as premissas da LB em planejamento_lb_premissa
    tabelas: ['planejamento', 'planejamento_lb_premissa'],
    rpcs: [
      'planejamento_copiar',
      'planejamento_promover',
      'marcar_vigente',
      'desmarcar_vigente',
      'lb_premissas_diff',
      'cadeia_trava_motivo',
      'planejamento_referencia'
    ]
  },
  async executar(a) {
    const plano = () => exigir(a.planejamento_id, 'planejamento_id', a.acao)
    switch (a.acao) {
      case 'listar': {
        const obra = exigir(a.obra_id, 'obra_id', a.acao)
        const lista = await ler('planejamento', {
          colunas:
            'id, nome, descricao, is_baseline, vigente, status, data_referencia_inicio, prazo, modo, ' +
            'data_date, travada_em, dados_rev, calculo_rev, recalculo_pendente, calculado_em, calculo_aviso',
          filtros: [eq('obra_id', obra)],
          ordem: [{ coluna: 'created_at' }]
        })
        const referencia = await rpc('planejamento_referencia', { _obra_id: obra })
        return { referencia_do_previsto: referencia, planos: lista }
      }
      case 'criar': {
        const [p] = await gravar<{ id: string }>('planejamento', 'insert', {
          obra_id: exigir(a.obra_id, 'obra_id', a.acao),
          nome: exigir(a.nome, 'nome', a.acao).trim(),
          descricao: a.descricao?.trim() || null,
          data_referencia_inicio: exigir(
            a.data_referencia_inicio,
            'data_referencia_inicio',
            a.acao
          ),
          status: 'ativo'
        })
        return p
      }
      case 'editar': {
        const patch: Record<string, unknown> = {}
        for (const k of [
          'nome',
          'descricao',
          'data_referencia_inicio',
          'prazo',
          'calendario_id',
          'modo',
          'data_date'
        ] as const)
          if (a[k] !== undefined) patch[k] = a[k]
        await gravar('planejamento', 'update', patch, [eq('id', plano())])
        return { ok: true, calculo: await depois(plano()) }
      }
      case 'excluir': {
        const [p] = await ler('planejamento', {
          colunas: 'id, nome, is_baseline, vigente',
          filtros: [eq('id', plano())]
        })
        if (!p) throw new Error('Plano não encontrado.')
        const tarefas = await contar('planejamento_tarefa', [eq('planejamento_id', plano())])
        const pedido = pedirConfirmacao(a.confirmar, 'excluir plano', { plano: p, tarefas })
        if (pedido) return pedido
        await gravar('planejamento', 'delete', null, [eq('id', plano())])
        return { excluido: p }
      }
      case 'copiar':
        return rpc('planejamento_copiar', {
          _origem_id: plano(),
          _nome: exigir(a.nome, 'nome', a.acao),
          _inicio: a.data_referencia_inicio ?? null
        })
      case 'promover': {
        const pedido = pedirConfirmacao(a.confirmar, 'promover a linha de base (trava o plano)', {
          planejamento_id: plano(),
          marcar_vigente: a.marcar_vigente ?? null
        })
        if (pedido) return pedido
        await recalcularPlano(plano())
        return rpc('planejamento_promover', {
          _planejamento_id: plano(),
          _marcar_vigente: a.marcar_vigente ?? null
        })
      }
      case 'vigente':
        await rpc('marcar_vigente', { _planejamento_id: plano() })
        return { ok: true }
      case 'desmarcar_vigente':
        await rpc('desmarcar_vigente', { _obra_id: exigir(a.obra_id, 'obra_id', a.acao) })
        return { ok: true }
      case 'restaurar': {
        const pedido = pedirConfirmacao(a.confirmar, 'restaurar como nova linha de base', {
          de: plano(),
          nome: a.nome
        })
        if (pedido) return pedido
        const c = await rpc<{ novo_id: string }>('planejamento_copiar', {
          _origem_id: plano(),
          _nome: exigir(a.nome, 'nome', a.acao),
          _inicio: null
        })
        try {
          await recalcularPlano(c.novo_id)
          const r = await rpc('planejamento_promover', {
            _planejamento_id: c.novo_id,
            _marcar_vigente: a.marcar_vigente ?? false
          })
          return { novo_id: c.novo_id, ...(r as object) }
        } catch (e) {
          throw new Error(
            `${e instanceof Error ? e.message : String(e)} — a cópia ${c.novo_id} ficou como plano em edição.`
          )
        }
      }
      case 'premissas_diff':
        return rpc('lb_premissas_diff', { _planejamento_id: plano() })
      case 'trava':
        return rpc('cadeia_trava_motivo', { _obra_id: exigir(a.obra_id, 'obra_id', a.acao) })
    }
  }
})

const LOCAL = z.object({
  id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe('local existente (mantém as datas calculadas)'),
  trecho_id: z.string().uuid().nullable(),
  inicio_m: z.number().nullable().describe('posição inicial em metros internos (área: null)'),
  fim_m: z.number().nullable(),
  quantidade: z.number(),
  qtd_origem: z.enum(['manual', 'trecho'])
})

const CAMPOS_TAREFA = {
  nome_custom: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  quantidade_alocada: z.number().nullable().optional(),
  prioridade: z.number().int().optional(),
  asap: z.boolean().optional(),
  inicio_dia: z.boolean().optional(),
  sentido: z.enum(['crescente', 'decrescente']).optional(),
  restricao_inicio: z.enum(['nao_antes', 'exato']).nullable().optional(),
  restricao_inicio_em: z.string().nullable().optional(),
  restricao_fim: z.enum(['nao_depois', 'exato']).nullable().optional(),
  restricao_fim_em: z.string().nullable().optional(),
  coef_producao: z.number().optional(),
  qtd_equipes: z.number().optional(),
  calendario_id: z.string().uuid().nullable().optional(),
  derivar_predecessoras: z.boolean().optional(),
  inicio_em: z
    .string()
    .nullable()
    .optional()
    .describe('início desejado (timestamp ISO) com asap=false'),
  item_orcamentario_id: z.string().uuid().nullable().optional()
}
const CHAVES_CAMPOS = Object.keys(CAMPOS_TAREFA) as (keyof typeof CAMPOS_TAREFA)[]

export const tarefas = ferramenta({
  nome: 'tarefas',
  titulo: 'Tarefas do cronograma',
  descricao:
    'Tarefas do plano em edição (lógica DynaRoad: serviço × locais × quantidades → tarefas). acao: listar | ' +
    'criar (item_orcamentario_id do serviço, quantidade sem locais ou locais [{trecho_id, inicio_m, fim_m, ' +
    'quantidade, qtd_origem}]) | criar_grupo (resumo) | editar (campos; arrastar o término muda nº de equipes, ' +
    'nunca o coef_producao) | editar_varias (mesmos campos em várias) | mover (ids, pai, antes) | excluir | ' +
    'locais (substitui os locais da tarefa) | dividir_estaca | dividir_quantidade | combinar | renomear_auto | ' +
    'mudar_trecho | equipes (substitui as equipes) | indireta (cria tarefa de indireto) | indireta_config. ' +
    '"não antes de" (restricao_inicio) só alerta; para fixar o início use asap=false + inicio_em. Depois de ' +
    'cada mudança o cronograma é recalculado e gravado.',
  entrada: {
    acao: z.enum([
      'listar',
      'criar',
      'criar_grupo',
      'editar',
      'editar_varias',
      'mover',
      'excluir',
      'locais',
      'dividir_estaca',
      'dividir_quantidade',
      'combinar',
      'renomear_auto',
      'mudar_trecho',
      'equipes',
      'indireta',
      'indireta_config'
    ]),
    planejamento_id: PLANO,
    id: z.string().uuid().optional().describe('tarefa'),
    ids: z.array(z.string().uuid()).optional(),
    item_orcamentario_id: z.string().uuid().optional(),
    quantidade: z.number().nullable().optional(),
    nome: z.string().optional(),
    parent_id: z.string().uuid().nullable().optional(),
    nivel: z.number().int().optional(),
    ordem: z.number().int().optional(),
    antes: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .describe('mover: antes de qual tarefa (null = fim)'),
    locais: z.array(LOCAL).optional(),
    campos: z.object(CAMPOS_TAREFA).optional(),
    itens: z
      .array(z.object({ id: z.string().uuid() }).extend(CAMPOS_TAREFA))
      .optional()
      .describe('editar_varias'),
    trecho_id: z.string().uuid().nullable().optional(),
    estaca_m: z.number().optional().describe('dividir_estaca: posição em metros internos'),
    partes: z
      .array(z.object({ local_id: z.string().uuid().nullable(), quantidade: z.number() }))
      .optional(),
    equipes: z.array(z.string().uuid()).optional(),
    indireto_config: z.record(z.string(), z.any()).optional(),
    notas: z.string().nullable().optional(),
    filtro_servico: z.string().uuid().optional().describe('listar: só um serviço'),
    recalcular: RECALCULAR,
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['planejamento_tarefa', 'planejamento_tarefa_local', 'planejamento_tarefa_equipe'],
    rpcs: [
      'planejamento_tarefa_criar',
      'planejamento_tarefas_atualizar',
      'planejamento_mover_tarefas',
      'planejamento_excluir_tarefas',
      'planejamento_tarefa_locais_salvar',
      'planejamento_tarefa_dividir_estaca',
      'planejamento_tarefa_dividir_quantidade',
      'planejamento_tarefas_combinar',
      'planejamento_tarefas_renomear_auto',
      'planejamento_tarefa_mudar_trecho',
      'planejamento_tarefa_equipes_salvar',
      'criar_tarefa_indireta',
      'atualizar_tarefa_indireta'
    ]
  },
  async executar(a) {
    const plan = a.planejamento_id
    const id = () => exigir(a.id, 'id', a.acao)
    const fim = async (r: unknown) => ({
      resultado: r ?? null,
      calculo: await depois(plan, a.recalcular)
    })
    switch (a.acao) {
      case 'listar':
        return ler('vw_planejamento_tarefa_completa', {
          colunas:
            'id, parent_id, tipo_no, nivel, ordem, codigo_eap, nome_custom, item_orcamentario_id, ' +
            'servico_grupo_codigo, servico_grupo_descricao, unidade_referencia_item, quantidade_alocada, ' +
            'producao_diaria_efetiva, qtd_equipes, coef_producao, asap, inicio_em, fim_em, data_inicio, ' +
            'data_fim, duracao_dias_uteis_calc, folga_total_h, is_critico, sentido, restricao_inicio, ' +
            'restricao_inicio_em, restricao_fim, restricao_fim_em, equipes, predecessoras, sucessoras, ' +
            'is_indireto, violacoes, locais',
          filtros: [
            eq('planejamento_id', plan),
            ...(a.filtro_servico ? [eq('item_orcamentario_id', a.filtro_servico)] : [])
          ],
          ordem: [{ coluna: 'ordem' }]
        })
      case 'criar': {
        const nova = await rpc<string>('planejamento_tarefa_criar', {
          _planejamento_id: plan,
          _campos: {
            item_orcamentario_id: exigir(a.item_orcamentario_id, 'item_orcamentario_id', a.acao),
            quantidade: a.quantidade && a.quantidade > 0 ? a.quantidade : null,
            nome_custom: a.nome ?? null,
            parent_id: a.parent_id ?? null,
            ordem: a.ordem ?? (await contar('planejamento_tarefa', [eq('planejamento_id', plan)])),
            sentido: a.campos?.sentido ?? 'crescente'
          },
          _locais: a.locais ?? []
        })
        if (a.campos && Object.keys(a.campos).length)
          await gravar('planejamento_tarefa', 'update', a.campos, [eq('id', nova)])
        return fim({ id: nova })
      }
      case 'criar_grupo': {
        const [g] = await gravar('planejamento_tarefa', 'insert', {
          planejamento_id: plan,
          tipo_no: 'grupo',
          nome_custom: exigir(a.nome, 'nome', a.acao),
          parent_id: a.parent_id ?? null,
          nivel: a.nivel ?? 1,
          ordem: a.ordem ?? 0
        })
        return fim(g)
      }
      case 'editar': {
        const campos = exigir(a.campos, 'campos', a.acao)
        const patch: Record<string, unknown> = {}
        for (const k of CHAVES_CAMPOS) if (campos[k] !== undefined) patch[k] = campos[k]
        await gravar('planejamento_tarefa', 'update', patch, [eq('id', id())])
        return fim({ id: id() })
      }
      case 'editar_varias':
        await rpc('planejamento_tarefas_atualizar', {
          _planejamento_id: plan,
          _itens: exigir(a.itens, 'itens', a.acao)
        })
        return fim(null)
      case 'mover':
        await rpc('planejamento_mover_tarefas', {
          _planejamento_id: plan,
          _ids: exigir(a.ids, 'ids', a.acao),
          _pai: a.parent_id ?? null,
          _antes: a.antes ?? null
        })
        return fim(null)
      case 'excluir': {
        const ids = exigir(a.ids, 'ids', a.acao)
        const pedido = pedirConfirmacao(a.confirmar, 'excluir tarefas', { tarefas: ids.length })
        if (pedido) return pedido
        return fim({
          excluidas: await rpc('planejamento_excluir_tarefas', {
            _planejamento_id: plan,
            _ids: ids
          })
        })
      }
      case 'locais':
        await rpc('planejamento_tarefa_locais_salvar', {
          _tarefa_id: id(),
          _locais: exigir(a.locais, 'locais', a.acao)
        })
        return fim(null)
      case 'dividir_estaca':
        return fim({
          nova: await rpc('planejamento_tarefa_dividir_estaca', {
            _tarefa_id: id(),
            _trecho_id: exigir(a.trecho_id, 'trecho_id', a.acao),
            _estaca_m: exigir(a.estaca_m, 'estaca_m', a.acao)
          })
        })
      case 'dividir_quantidade':
        return fim({
          nova: await rpc('planejamento_tarefa_dividir_quantidade', {
            _tarefa_id: id(),
            _partes: exigir(a.partes, 'partes', a.acao)
          })
        })
      case 'combinar':
        return fim({
          fica: await rpc('planejamento_tarefas_combinar', { _ids: exigir(a.ids, 'ids', a.acao) })
        })
      case 'renomear_auto':
        return fim({
          renomeadas: await rpc('planejamento_tarefas_renomear_auto', {
            _planejamento_id: plan,
            _ids: a.ids ?? null
          })
        })
      case 'mudar_trecho':
        return fim(
          await rpc('planejamento_tarefa_mudar_trecho', {
            _tarefa_id: id(),
            _trecho_id: a.trecho_id ?? null
          })
        )
      case 'equipes':
        await rpc('planejamento_tarefa_equipes_salvar', {
          _tarefa_id: id(),
          _equipes: exigir(a.equipes, 'equipes', a.acao)
        })
        return fim(null)
      case 'indireta':
        return fim({
          id: await rpc('criar_tarefa_indireta', {
            p_planejamento_id: plan,
            p_item_orcamentario_id: exigir(a.item_orcamentario_id, 'item_orcamentario_id', a.acao),
            p_indireto_config: exigir(a.indireto_config, 'indireto_config', a.acao),
            p_parent_id: a.parent_id ?? null,
            p_nome_custom: a.nome ?? null,
            p_ordem: a.ordem ?? 0,
            p_notas: a.notas ?? null
          })
        })
      case 'indireta_config':
        await rpc('atualizar_tarefa_indireta', {
          p_tarefa_id: id(),
          p_indireto_config: exigir(a.indireto_config, 'indireto_config', a.acao)
        })
        await gravar('planejamento_tarefa', 'update', { updated_at: new Date().toISOString() }, [
          eq('id', id())
        ])
        return fim(null)
    }
  }
})

export const dependencias = ferramenta({
  nome: 'dependencias_marcos',
  titulo: 'Dependências, marcos, limites de recurso e regras entre serviços',
  descricao:
    'acao: dependencias (lista) | dependencia (cria/edita: predecessora_id, sucessora_id, tipo FS|SS|FF|SF|EST, ' +
    'atraso_min/atraso_max em dias, dias_uteis) | excluir_dependencias | marcos | marco (cria/edita) | ' +
    'excluir_marco | limites | limite (recurso_id, maximo de equipes/recursos simultâneos) | excluir_limite | ' +
    'regras (regras entre serviços da obra: o sucessor segue o predecessor em cada estaca com atraso_dias) | ' +
    'regra | excluir_regra. Recalcula o cronograma ao final.',
  entrada: {
    acao: z.enum([
      'dependencias',
      'dependencia',
      'excluir_dependencias',
      'marcos',
      'marco',
      'excluir_marco',
      'limites',
      'limite',
      'excluir_limite',
      'regras',
      'regra',
      'excluir_regra'
    ]),
    planejamento_id: PLANO,
    id: z.string().uuid().optional(),
    ids: z.array(z.string().uuid()).optional(),
    predecessora_id: z.string().uuid().optional(),
    sucessora_id: z.string().uuid().optional(),
    tipo: z.enum(['FS', 'SS', 'FF', 'SF', 'EST']).optional(),
    atraso_min: z
      .number()
      .nullable()
      .optional()
      .describe('atraso mínimo em dias (padrão 0; null = sem mínimo)'),
    atraso_max: z
      .number()
      .nullable()
      .optional()
      .describe('atraso máximo em dias (null = sem máximo)'),
    dias_uteis: z.boolean().optional(),
    marco: z
      .object({
        nome: z.string(),
        descricao: z.string().nullable().optional(),
        inicio: z.string().nullable(),
        fim: z.string().nullable(),
        filtro_servicos: z.boolean(),
        servicos: z.array(z.string().uuid()),
        filtro_recursos: z.boolean(),
        recursos: z.array(z.string().uuid()),
        filtro_estacas: z.boolean(),
        faixas: z.array(
          z.object({ trecho_id: z.string().uuid(), inicio_m: z.number(), fim_m: z.number() })
        ),
        incluidas: z.array(z.string().uuid()),
        excluidas: z.array(z.string().uuid())
      })
      .optional(),
    recurso_id: z.string().uuid().optional(),
    grupo_id: z.string().uuid().nullable().optional(),
    maximo: z.number().optional(),
    predecessor_id: z
      .string()
      .uuid()
      .optional()
      .describe('regra: serviço (item_orcamentario) predecessor'),
    sucessor_id: z.string().uuid().optional(),
    atraso_dias: z.number().optional(),
    recalcular: RECALCULAR
  },
  cobre: {
    tabelas: [
      'planejamento_dependencia',
      'planejamento_marco',
      'planejamento_recurso_limite',
      'servico_dependencia'
    ]
  },
  async executar(a) {
    const plan = a.planejamento_id
    const fim = async (r: unknown) => ({
      resultado: r ?? null,
      calculo: await depois(plan, a.recalcular)
    })
    switch (a.acao) {
      case 'dependencias':
        return ler('planejamento_dependencia', { filtros: [eq('planejamento_id', plan)] })
      case 'dependencia': {
        const campos = {
          tipo: a.tipo ?? 'FS',
          atraso_min: a.atraso_min ?? 0,
          atraso_max: a.atraso_max ?? null,
          dias_uteis: a.dias_uteis ?? true
        }
        if (a.id)
          return fim(
            (await gravar('planejamento_dependencia', 'update', campos, [eq('id', a.id)]))[0]
          )
        return fim(
          (
            await gravar('planejamento_dependencia', 'insert', {
              planejamento_id: plan,
              predecessora_id: exigir(a.predecessora_id, 'predecessora_id', a.acao),
              sucessora_id: exigir(a.sucessora_id, 'sucessora_id', a.acao),
              ...campos
            })
          )[0]
        )
      }
      case 'excluir_dependencias':
        await gravar('planejamento_dependencia', 'delete', null, [
          { coluna: 'id', op: 'in', valor: exigir(a.ids, 'ids', a.acao) }
        ])
        return fim(null)
      case 'marcos':
        return ler('planejamento_marco', { filtros: [eq('planejamento_id', plan)] })
      case 'marco': {
        const m = exigir(a.marco, 'marco', a.acao)
        if (a.id) return fim((await gravar('planejamento_marco', 'update', m, [eq('id', a.id)]))[0])
        return fim(
          (await gravar('planejamento_marco', 'insert', { planejamento_id: plan, ...m }))[0]
        )
      }
      case 'excluir_marco':
        await gravar('planejamento_marco', 'delete', null, [eq('id', exigir(a.id, 'id', a.acao))])
        return fim(null)
      case 'limites':
        return ler('planejamento_recurso_limite', { filtros: [eq('planejamento_id', plan)] })
      case 'limite': {
        const campos = {
          recurso_id: exigir(a.recurso_id, 'recurso_id', a.acao),
          grupo_id: a.grupo_id ?? null,
          maximo: exigir(a.maximo, 'maximo', a.acao)
        }
        if (a.id)
          return fim(
            (await gravar('planejamento_recurso_limite', 'update', campos, [eq('id', a.id)]))[0]
          )
        return fim(
          (
            await gravar('planejamento_recurso_limite', 'insert', {
              planejamento_id: plan,
              ...campos
            })
          )[0]
        )
      }
      case 'excluir_limite':
        await gravar('planejamento_recurso_limite', 'delete', null, [
          eq('id', exigir(a.id, 'id', a.acao))
        ])
        return fim(null)
      case 'regras': {
        const [p] = await ler<{ obra_id: string }>('planejamento', {
          colunas: 'obra_id',
          filtros: [eq('id', plan)]
        })
        return ler('servico_dependencia', { filtros: [eq('obra_id', p!.obra_id)] })
      }
      case 'regra': {
        const [p] = await ler<{ obra_id: string }>('planejamento', {
          colunas: 'obra_id',
          filtros: [eq('id', plan)]
        })
        await gravar(
          'servico_dependencia',
          'upsert',
          {
            obra_id: p!.obra_id,
            predecessor_id: exigir(a.predecessor_id, 'predecessor_id', a.acao),
            sucessor_id: exigir(a.sucessor_id, 'sucessor_id', a.acao),
            atraso_dias: a.atraso_dias ?? 0
          },
          [],
          { onConflict: 'predecessor_id,sucessor_id' }
        )
        return fim(null)
      }
      case 'excluir_regra':
        await gravar('servico_dependencia', 'delete', null, [
          eq('predecessor_id', exigir(a.predecessor_id, 'predecessor_id', a.acao)),
          eq('sucessor_id', exigir(a.sucessor_id, 'sucessor_id', a.acao))
        ])
        return fim(null)
    }
  }
})

export const cronograma = ferramenta({
  nome: 'cronograma',
  titulo: 'Cronograma (motor de cálculo)',
  descricao:
    'Motor do cronograma (o mesmo do web). acao: calcular (calcula e grava datas, folgas, caminho crítico e ' +
    'perfis diário/semanal — necessário antes de promover a LB) | ler (resultado calculado: tarefas com início, ' +
    'fim, duração, folga e críticas; avisos) | comando (como arrastar no Gantt: inicio = fixa o início numa data; ' +
    'fim = término desejado → nº de equipes; dependencia = liga duas tarefas; compactar = puxa tudo para o mais ' +
    'cedo possível).',
  entrada: {
    acao: z.enum(['calcular', 'ler', 'comando']),
    planejamento_id: PLANO,
    comando: z.enum(['inicio', 'fim', 'dependencia', 'compactar']).optional(),
    tarefa_id: z.string().uuid().optional(),
    em: z.string().optional().describe('data/hora ISO (AAAA-MM-DD ou AAAA-MM-DDTHH:MM)'),
    predecessora: z.string().uuid().optional(),
    sucessora: z.string().uuid().optional(),
    tipo: z.enum(['FS', 'SS', 'FF', 'SF', 'EST']).optional(),
    atraso_min: z.number().nullable().optional(),
    atraso_max: z.number().nullable().optional(),
    dias_uteis: z.boolean().optional(),
    so_criticas: z.boolean().optional()
  },
  cobre: {
    // gravadas por planejamento_gravar_calculo com o resultado do motor
    tabelas: [
      'planejamento_tarefa_wp',
      'planejamento_tarefa_perfil_dia',
      'planejamento_tarefa_perfil_semana',
      'planejamento_tarefa_indireto'
    ],
    rpcs: ['planejamento_gravar_calculo', 'obra_equipes_vivas']
  },
  async executar(a) {
    const plan = a.planejamento_id
    if (a.acao === 'calcular') return depois(plan, true)
    if (a.acao === 'ler') {
      const { entrada, resultado } = await calcularSemGravar(plan)
      const nomes = new Map(entrada.tarefas.map((t) => [t.id, t.nome]))
      const lista = [...resultado.tarefas.values()]
        .map((t) => ({
          id: t.id,
          nome: nomes.get(t.id) ?? null,
          inicio: new Date(t.inicio * 1000).toISOString().slice(0, 16),
          fim: new Date(t.fim * 1000).toISOString().slice(0, 16),
          duracao_dias_uteis: Math.round(t.duracao_dias_uteis * 100) / 100,
          folga_total_dias: Math.floor(t.folga_total_h / 24 + 1e-9),
          critica: t.folga_total_h <= 1e-6
        }))
        .filter((t) => !a.so_criticas || t.critica)
        .sort((x, y) => x.inicio.localeCompare(y.inicio))
      return { tarefas: lista, avisos: resultado.avisos }
    }
    const { entrada, ...calc } = await calcularSemGravar(plan)
    const tipo = exigir(a.comando, 'comando', a.acao)
    const cmd =
      tipo === 'compactar'
        ? { tipo: 'compactar' as const }
        : tipo === 'dependencia'
          ? {
              tipo: 'dependencia' as const,
              predecessora: exigir(a.predecessora, 'predecessora', a.acao),
              sucessora: exigir(a.sucessora, 'sucessora', a.acao),
              dep: a.tipo ?? 'FS',
              atraso_min: a.atraso_min ?? 0,
              atraso_max: a.atraso_max ?? null,
              dias_uteis: a.dias_uteis ?? true
            }
          : {
              tipo,
              tarefaId: exigir(a.tarefa_id, 'tarefa_id', a.acao),
              em: isoParaSeg(exigir(a.em, 'em', a.acao))
            }
    const m = aplicarComando(entrada, calc as never, cmd)
    if (m.aviso) return { aviso: m.aviso, nada_mudou: true }
    if (m.tarefas.length)
      await rpc('planejamento_tarefas_atualizar', { _planejamento_id: plan, _itens: m.tarefas })
    if (m.dependencias.length)
      await gravar(
        'planejamento_dependencia',
        'insert',
        m.dependencias.map((d) => ({ planejamento_id: plan, ...d }))
      )
    return { mudancas: m, calculo: await depois(plan) }
  }
})
