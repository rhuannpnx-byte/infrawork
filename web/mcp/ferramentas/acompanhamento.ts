import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ctxAtual, fn, rpc } from '../contexto'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { contar, eq, gravar, ler } from '../lib/banco'
import { ARQUIVO, abrirPlanilha, resumoParse, validas } from '../lib/planilha'
import { parseProducao, producaoToInputs } from '@/lib/xlsx/templates/producao'
import { normalizeTxt } from '@/lib/xlsx/parse-sheet'

const OBRA = z.string().uuid().describe('id da obra')
const DATA = z.string().describe('AAAA-MM-DD')

const MATERIAL = z.object({
  nome: z.string(),
  quantidade: z.number().nullable(),
  unidade: z.string().nullable(),
  recurso_id: z.string().uuid().nullable().optional()
})

const LANCAMENTO = z.object({
  data: DATA,
  item_orcamentario_id: z.string().uuid().describe('serviço (agrupador) lançado'),
  quantidade: z.number(),
  equipe_id: z.string().uuid().nullable().optional(),
  encarregado_id: z.string().uuid().nullable().optional(),
  frente: z.string().nullable().optional(),
  estaca_inicial: z.string().nullable().optional(),
  estaca_final: z.string().nullable().optional(),
  trecho_id: z.string().uuid().nullable().optional(),
  posicao_inicio_m: z.number().nullable().optional(),
  posicao_fim_m: z.number().nullable().optional(),
  obs: z.string().nullable().optional(),
  materiais: z.array(MATERIAL).optional()
})
type Lancamento = z.infer<typeof LANCAMENTO>

function linha(obra: string, l: Lancamento) {
  return {
    obra_id: obra,
    data: l.data,
    item_orcamentario_id: l.item_orcamentario_id,
    equipe_id: l.equipe_id ?? null,
    encarregado_id: l.encarregado_id ?? null,
    quantidade: l.quantidade,
    frente: l.frente?.trim() || null,
    estaca_inicial: l.estaca_inicial?.trim() || null,
    estaca_final: l.estaca_final?.trim() || null,
    trecho_id: l.trecho_id ?? null,
    posicao_inicio_m: l.trecho_id ? (l.posicao_inicio_m ?? null) : null,
    posicao_fim_m: l.trecho_id ? (l.posicao_fim_m ?? null) : null,
    obs: l.obs?.trim() || null
  }
}

const materiaisDe = (id: string, l: Lancamento) =>
  (l.materiais ?? [])
    .filter((m) => m.nome.trim() || m.recurso_id)
    .map((m) => ({
      producao_id: id,
      nome: m.nome.trim(),
      quantidade: m.quantidade,
      unidade: m.unidade?.trim() || null,
      recurso_id: m.recurso_id ?? null
    }))

export const producao = ferramenta({
  nome: 'producao',
  titulo: 'Produção (lançamentos diários)',
  descricao:
    'Produção executada por dia, serviço, equipe, encarregado e local. acao: listar (período) | lancar | ' +
    'editar | excluir | lote (várias linhas; origem importacao com importacao_id para desfazer) | importar ' +
    '(planilha do modelo; prévia sem confirmar) | desfazer_importacao. Regras do banco: sem data futura; ' +
    'serviço sem composição não recebe produção; serviço lançado por viagens recusa produção manual (use ' +
    'viagens); serviço com exige_local pede trecho e faixa em metros; material controlado pela parametrização.',
  entrada: {
    acao: z.enum([
      'listar',
      'lancar',
      'editar',
      'excluir',
      'lote',
      'importar',
      'desfazer_importacao'
    ]),
    obra_id: OBRA,
    id: z.string().uuid().optional(),
    lancamento: LANCAMENTO.optional(),
    linhas: z.array(LANCAMENTO).optional(),
    de: DATA.optional(),
    ate: DATA.optional(),
    item_orcamentario_id: z.string().uuid().optional().describe('listar: filtra o serviço'),
    importacao_id: z.string().uuid().optional(),
    ...ARQUIVO,
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: { tabelas: ['acompanhamento_producao', 'acompanhamento_producao_material'] },
  async executar(a) {
    switch (a.acao) {
      case 'listar':
        return ler('vw_acompanhamento_producao_enriquecida', {
          filtros: [
            eq('obra_id', a.obra_id),
            ...(a.de ? [{ coluna: 'data', op: 'gte' as const, valor: a.de }] : []),
            ...(a.ate ? [{ coluna: 'data', op: 'lte' as const, valor: a.ate }] : []),
            ...(a.item_orcamentario_id ? [eq('item_orcamentario_id', a.item_orcamentario_id)] : [])
          ],
          ordem: [{ coluna: 'data' }],
          limite: 20_000
        })
      case 'lancar': {
        const l = exigir(a.lancamento, 'lancamento', a.acao)
        const [r] = await gravar<{ id: string }>('acompanhamento_producao', 'insert', {
          ...linha(a.obra_id, l),
          origem: 'app'
        })
        const mats = materiaisDe(r!.id, l)
        if (mats.length) await gravar('acompanhamento_producao_material', 'insert', mats)
        return r
      }
      case 'editar': {
        const id = exigir(a.id, 'id', a.acao)
        const l = exigir(a.lancamento, 'lancamento', a.acao)
        await gravar('acompanhamento_producao', 'update', linha(a.obra_id, l), [eq('id', id)])
        if (l.materiais) {
          await gravar('acompanhamento_producao_material', 'delete', null, [eq('producao_id', id)])
          const mats = materiaisDe(id, l)
          if (mats.length) await gravar('acompanhamento_producao_material', 'insert', mats)
        }
        return { id }
      }
      case 'excluir': {
        const id = exigir(a.id, 'id', a.acao)
        const pedido = pedirConfirmacao(a.confirmar, 'excluir lançamento', { id })
        if (pedido) return pedido
        await gravar('acompanhamento_producao', 'delete', null, [eq('id', id)])
        return { excluido: id }
      }
      case 'lote':
      case 'importar': {
        let linhas: Lancamento[]
        let previa: unknown
        if (a.acao === 'importar') {
          const wb = await abrirPlanilha(a)
          if (!wb) throw new Error('Mande arquivo_base64 ou url.')
          const [itens, real, eqs, encs, trechos] = await Promise.all([
            ler<{
              id: string
              codigo: string
              descricao: string
              quantidade_referencia: number | null
              unidade_referencia: string | null
              servico: { codigo: string; nome: string; unidade: string | null } | null
            }>('item_orcamentario', {
              colunas:
                'id, codigo, descricao, quantidade_referencia, unidade_referencia, servico:servico_id(codigo, nome, unidade)',
              filtros: [
                eq('obra_id', a.obra_id),
                eq('tipo', 'servico_grupo'),
                { coluna: 'indireto_id', op: 'is', valor: null }
              ]
            }),
            ler<{ item_orcamentario_id: string; qtd_real: number }>(
              'vw_acompanhamento_previsto_x_realizado',
              { colunas: 'item_orcamentario_id, qtd_real', filtros: [eq('obra_id', a.obra_id)] }
            ),
            ler<{ id: string; nome: string }>('equipe', {
              colunas: 'id, nome',
              filtros: [eq('obra_id', a.obra_id)]
            }),
            ler<{ id: string; nome: string; apelido: string | null }>('encarregado', {
              filtros: [eq('obra_id', a.obra_id)]
            }),
            ler('obra_trecho', { filtros: [eq('obra_id', a.obra_id)] })
          ])
          const qtdReal = new Map(
            real.map((r) => [r.item_orcamentario_id, Number(r.qtd_real ?? 0)])
          )
          const lancaveis = itens
            .filter((i) => i.servico)
            .map((i) => ({
              id: i.id,
              codigo: i.codigo,
              descricao: i.descricao,
              quantidade_referencia: i.quantidade_referencia,
              unidade_referencia: i.unidade_referencia,
              servico_codigo: i.servico?.codigo ?? null,
              servico_nome: i.servico?.nome ?? null,
              servico_unidade: i.servico?.unidade ?? null,
              qtd_real: qtdReal.get(i.id) ?? 0
            }))
          const p = parseProducao(wb, {
            itens: lancaveis,
            equipes: eqs,
            encarregados: encs as never,
            trechos: trechos as never,
            hojeISO: new Date().toISOString().slice(0, 10)
          })
          previa = resumoParse(p)
          const idPorNome = new Map<string, string>()
          for (const e of encs) {
            idPorNome.set(normalizeTxt(e.nome), e.id)
            if (e.apelido) idPorNome.set(normalizeTxt(e.apelido), e.id)
          }
          linhas = producaoToInputs(validas(p), a.obra_id, idPorNome) as unknown as Lancamento[]
        } else {
          linhas = exigir(a.linhas, 'linhas', a.acao)
          previa = { linhas: linhas.length }
        }
        const pedido = pedirConfirmacao(a.confirmar, 'lançar produção em lote', previa)
        if (pedido) return pedido
        const importacao_id = randomUUID()
        let inseridos = 0
        for (let i = 0; i < linhas.length; i += 500) {
          const parte = linhas.slice(i, i + 500)
          const ids = await gravar<{ id: string }>(
            'acompanhamento_producao',
            'insert',
            parte.map((l) => ({ ...linha(a.obra_id, l), origem: 'importacao', importacao_id }))
          )
          inseridos += ids.length
          const mats = parte.flatMap((l, k) => (ids[k] ? materiaisDe(ids[k]!.id, l) : []))
          if (mats.length) await gravar('acompanhamento_producao_material', 'insert', mats)
        }
        return { inseridos, importacao_id }
      }
      case 'desfazer_importacao': {
        const imp = exigir(a.importacao_id, 'importacao_id', a.acao)
        const n = await contar('acompanhamento_producao', [eq('importacao_id', imp)])
        const pedido = pedirConfirmacao(a.confirmar, 'desfazer importação', { lancamentos: n })
        if (pedido) return pedido
        await gravar('acompanhamento_producao', 'delete', null, [eq('importacao_id', imp)])
        return { removidos: n }
      }
    }
  }
})

export const parametrosServico = ferramenta({
  nome: 'parametros_servico',
  titulo: 'Parametrização dos serviços para o campo',
  descricao:
    'Como cada serviço é lançado no app de campo e no web: modo_lancamento quantidade | viagens (a produção ' +
    'vem das fichas de viagem), controle de material (recurso, unidade, obrigatório), observação e se exige ' +
    'local (trecho + estacas). Nas viagens: medicao_viagem volume | peso (peso exige o ticket da balança); a ' +
    'quantidade da viagem é lançada na unidade do serviço (empolamento e densidade ficam com quem lança). ' +
    'acao: listar | salvar (um serviço por vez).',
  entrada: {
    acao: z.enum(['listar', 'salvar']),
    obra_id: OBRA,
    item_orcamentario_id: z.string().uuid().optional(),
    modo_lancamento: z.enum(['quantidade', 'viagens']).optional(),
    controla_material: z.boolean().optional(),
    material_recurso_id: z.string().uuid().nullable().optional(),
    material_unidade: z.string().nullable().optional(),
    material_obrigatorio: z.boolean().optional(),
    habilita_obs: z.boolean().optional(),
    exige_local: z.boolean().optional(),
    medicao_viagem: z.enum(['volume', 'peso']).optional()
  },
  cobre: { tabelas: ['servico_parametro'] },
  async executar(a) {
    if (a.acao === 'listar')
      return ler('servico_parametro', { filtros: [eq('obra_id', a.obra_id)] })
    const id = exigir(a.item_orcamentario_id, 'item_orcamentario_id', a.acao)
    const [atual] = await ler<Record<string, unknown>>('servico_parametro', {
      filtros: [eq('item_orcamentario_id', id)]
    })
    const p = {
      modo_lancamento: 'quantidade',
      controla_material: false,
      material_recurso_id: null,
      material_unidade: null,
      material_obrigatorio: true,
      habilita_obs: true,
      exige_local: false,
      medicao_viagem: 'volume',
      ...(atual ?? {}),
      item_orcamentario_id: id,
      obra_id: a.obra_id
    } as Record<string, unknown>
    for (const k of [
      'modo_lancamento',
      'controla_material',
      'material_recurso_id',
      'material_unidade',
      'material_obrigatorio',
      'habilita_obs',
      'exige_local',
      'medicao_viagem'
    ] as const)
      if (a[k] !== undefined) p[k] = a[k]
    if (!p.controla_material) {
      p.material_recurso_id = null
      p.material_unidade = null
    }
    delete p.updated_at
    delete p.updated_by
    return (
      await gravar('servico_parametro', 'upsert', p, [], { onConflict: 'item_orcamentario_id' })
    )[0]
  }
})

export const transporte = ferramenta({
  nome: 'transporte',
  titulo: 'Locais de carga e descarga e distâncias fixas (DMT)',
  descricao:
    'Origens e destinos das viagens (jazida, caixa_emprestimo, usina, central, bota_fora, deposito, pista, ' +
    'outro). DMT da viagem = acesso(origem) + |estaca de carga - estaca de descarga| + acesso(destino), pelo ' +
    'eixo do trecho. Local pista: só o trecho (eixo ou área); a viagem informa a estaca. Demais locais: ' +
    'trecho (eixo) + estaca_acesso_m (onde o acesso encontra o eixo, em metros no trecho) + ' +
    'distancia_acesso_km (do local ao eixo). Par que não se liga pelo eixo (usina distante, outro trecho): ' +
    'distância fixa (acao rota), que prevalece sobre o cálculo. acao: listar | salvar_local (cria sem id, ' +
    'edita com id) | excluir_local | rota (origem_id, destino_id, dmt_km; dmt_km null apaga).',
  entrada: {
    acao: z.enum(['listar', 'salvar_local', 'excluir_local', 'rota']),
    obra_id: OBRA,
    id: z.string().uuid().optional(),
    nome: z.string().optional(),
    tipo: z
      .enum([
        'jazida',
        'caixa_emprestimo',
        'usina',
        'central',
        'bota_fora',
        'deposito',
        'pista',
        'outro'
      ])
      .optional(),
    trecho_id: z.string().uuid().nullable().optional(),
    estaca_acesso_m: z
      .number()
      .min(0)
      .nullable()
      .optional()
      .describe('metros no trecho (eixo) onde o acesso encontra o eixo; não vale para pista'),
    distancia_acesso_km: z.number().min(0).optional().describe('do local até o eixo'),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    ativo: z.boolean().optional(),
    origem_id: z.string().uuid().optional(),
    destino_id: z.string().uuid().optional(),
    dmt_km: z.number().nullable().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: { tabelas: ['transporte_local', 'transporte_rota'] },
  async executar(a) {
    switch (a.acao) {
      case 'listar': {
        const [locais, rotas] = await Promise.all([
          ler('transporte_local', {
            filtros: [eq('obra_id', a.obra_id)],
            ordem: [{ coluna: 'nome' }]
          }),
          ler('transporte_rota', { filtros: [eq('obra_id', a.obra_id)] })
        ])
        return { locais, rotas }
      }
      case 'salvar_local': {
        const campos: Record<string, unknown> = {}
        for (const k of [
          'nome',
          'tipo',
          'trecho_id',
          'estaca_acesso_m',
          'distancia_acesso_km',
          'lat',
          'lng',
          'ativo'
        ] as const)
          if (a[k] !== undefined) campos[k] = a[k]
        if (a.id) return (await gravar('transporte_local', 'update', campos, [eq('id', a.id)]))[0]
        return (
          await gravar('transporte_local', 'insert', {
            ...campos,
            obra_id: a.obra_id,
            nome: exigir(a.nome, 'nome', a.acao)
          })
        )[0]
      }
      case 'excluir_local': {
        const id = exigir(a.id, 'id', a.acao)
        const usos =
          (await contar('viagem', [eq('origem_id', id)])) +
          (await contar('viagem', [eq('destino_id', id)]))
        const pedido = pedirConfirmacao(a.confirmar, 'excluir local', {
          id,
          viagens_que_perdem_o_local: usos
        })
        if (pedido) return pedido
        await gravar('transporte_local', 'delete', null, [eq('id', id)])
        return { excluido: id }
      }
      case 'rota': {
        const origem = exigir(a.origem_id, 'origem_id', a.acao)
        const destino = exigir(a.destino_id, 'destino_id', a.acao)
        if (a.dmt_km == null) {
          await gravar('transporte_rota', 'delete', null, [
            eq('origem_id', origem),
            eq('destino_id', destino)
          ])
          return { removida: true }
        }
        return (
          await gravar(
            'transporte_rota',
            'upsert',
            { obra_id: a.obra_id, origem_id: origem, destino_id: destino, dmt_km: a.dmt_km },
            [],
            { onConflict: 'origem_id,destino_id' }
          )
        )[0]
      }
    }
  }
})

const VIAGEM = z.object({
  id: z.string().uuid().optional().describe('viagem existente (mantém)'),
  item_orcamentario_id: z.string().uuid().describe('serviço parametrizado por viagens'),
  origem_id: z.string().uuid().describe('local de carga'),
  destino_id: z.string().uuid().describe('local de descarga'),
  estaca_carga_m: z
    .number()
    .nullable()
    .optional()
    .describe('metros no trecho; obrigatória quando a origem é pista (eixo)'),
  estaca_descarga_m: z
    .number()
    .nullable()
    .optional()
    .describe('metros no trecho; obrigatória quando o destino é pista (eixo)'),
  quantidade: z
    .number()
    .positive()
    .describe('na unidade do serviço, já com o empolamento/densidade que o usuário aplica'),
  material_qtd: z.number().nullable().optional(),
  dmt_manual: z
    .boolean()
    .optional()
    .describe('true = usa dmt_km informado (fica marcada como ajustada)'),
  dmt_km: z.number().nullable().optional().describe('só com dmt_manual; senão o banco calcula'),
  hora_carga: z.string().nullable().optional(),
  hora_descarga: z.string().nullable().optional(),
  nf_ticket: z.string().nullable().optional(),
  carregador_id: z.string().uuid().nullable().optional(),
  obs: z.string().nullable().optional()
})

export const viagens = ferramenta({
  nome: 'viagens',
  titulo: 'Fichas de viagem (transporte)',
  descricao:
    'Ficha diária de um veículo com as viagens. Cada viagem: origem e destino (obrigatórios), estaca de carga ' +
    'e/ou descarga quando a ponta é pista e a quantidade na unidade do serviço (por peso, o ticket é ' +
    'obrigatório). O banco calcula a DMT (distância fixa do par; senão pelo eixo: acessos + ' +
    'diferença das estacas; dmt_origem rota | geometria | manual) e recusa a viagem sem DMT possível. A ' +
    'produção dos serviços por viagens é recomposta: uma por dia, serviço, local (a ponta na pista), equipe e ' +
    'encarregado (da ficha). acao: listar (período) | salvar (cria ou substitui a ficha inteira; id novo = ' +
    'ficha nova) | excluir | veiculos (veículos que a obra enxerga, com a capacidade em m³).',
  entrada: {
    acao: z.enum(['listar', 'salvar', 'excluir', 'veiculos']),
    obra_id: OBRA,
    id: z.string().uuid().optional().describe('ficha (salvar: omita para criar)'),
    data: DATA.optional(),
    de: DATA.optional(),
    ate: DATA.optional(),
    veiculo_id: z.string().uuid().nullable().optional(),
    motorista: z.string().nullable().optional(),
    equipe_id: z.string().uuid().nullable().optional(),
    encarregado_id: z.string().uuid().nullable().optional(),
    obs: z.string().nullable().optional(),
    viagens: z.array(VIAGEM).optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['viagem_ficha', 'viagem'],
    rpcs: ['campo_sync_ficha', 'veiculos_da_obra']
  },
  async executar(a) {
    switch (a.acao) {
      case 'listar':
        return ler('viagem_ficha', {
          colunas: '*, viagens:viagem(*)',
          filtros: [
            eq('obra_id', a.obra_id),
            ...(a.de ? [{ coluna: 'data', op: 'gte' as const, valor: a.de }] : []),
            ...(a.ate ? [{ coluna: 'data', op: 'lte' as const, valor: a.ate }] : [])
          ],
          ordem: [{ coluna: 'data', asc: false }]
        })
      case 'salvar': {
        const id = a.id ?? randomUUID()
        await rpc('campo_sync_ficha', {
          _ficha: {
            id,
            obra_id: a.obra_id,
            data: exigir(a.data, 'data', a.acao),
            veiculo_id: a.veiculo_id ?? null,
            motorista: a.motorista ?? null,
            equipe_id: a.equipe_id ?? null,
            encarregado_id: a.encarregado_id ?? null,
            obs: a.obs ?? null,
            origem: 'web',
            viagens: exigir(a.viagens, 'viagens', a.acao).map((v) => ({
              id: v.id ?? randomUUID(),
              ...v
            }))
          }
        })
        return { id }
      }
      case 'excluir': {
        const id = exigir(a.id, 'id', a.acao)
        const n = await contar('viagem', [eq('ficha_id', id)])
        const pedido = pedirConfirmacao(a.confirmar, 'excluir ficha de viagens', { id, viagens: n })
        if (pedido) return pedido
        await gravar('viagem_ficha', 'delete', null, [eq('id', id)])
        return { excluida: id }
      }
      case 'veiculos':
        return rpc('veiculos_da_obra', { _obra_id: a.obra_id })
    }
  }
})

export const frota = ferramenta({
  nome: 'frota',
  titulo: 'Frota (veículos) e FleetHub',
  descricao:
    'Veículos da empresa (caminhões etc.) com capacidade em m³/t; os sincronizados da FleetHub têm os dados de ' +
    'lá só leitura. acao: listar | salvar (manual: cria/edita) | excluir | capacidade_modelo (aplica a capacidade ' +
    'a todos do mesmo modelo, menos os que a FleetHub informa) | obras_fleethub (obras da FleetHub e vínculos da ' +
    'obra) | vincular / desvincular (obra InfraWork ↔ obra FleetHub) | sincronizar (roda a sincronização) | ' +
    'status (última sincronização e se há credencial). A credencial da FleetHub só é cadastrada na tela do web.',
  entrada: {
    acao: z.enum([
      'listar',
      'salvar',
      'excluir',
      'capacidade_modelo',
      'obras_fleethub',
      'vincular',
      'desvincular',
      'sincronizar',
      'status'
    ]),
    empresa_id: z.string().uuid().optional(),
    obra_id: OBRA.optional(),
    id: z.string().uuid().optional(),
    prefixo: z.string().optional(),
    placa: z.string().nullable().optional(),
    tipo: z.string().optional(),
    modelo: z.string().nullable().optional(),
    proprietario: z.string().nullable().optional(),
    fornecedor: z.string().nullable().optional(),
    capacidade_m3: z.number().nullable().optional(),
    capacidade_t: z.number().nullable().optional(),
    ativo: z.boolean().optional(),
    fleet_obra_id: z.string().uuid().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['frota_veiculo', 'obra_fleet_obra', 'fleet_obra', 'fleet_sync_execucao'],
    funcoes: ['fleethub-sync']
  },
  async executar(a) {
    const empresa = () => exigir(a.empresa_id, 'empresa_id', a.acao)
    switch (a.acao) {
      case 'listar':
        return ler('frota_veiculo', {
          filtros: [eq('empresa_id', empresa())],
          ordem: [{ coluna: 'prefixo' }]
        })
      case 'salvar': {
        const campos: Record<string, unknown> = {}
        for (const k of [
          'prefixo',
          'placa',
          'tipo',
          'modelo',
          'proprietario',
          'fornecedor',
          'capacidade_m3',
          'capacidade_t',
          'ativo'
        ] as const)
          if (a[k] !== undefined) campos[k] = a[k]
        if (a.id) return (await gravar('frota_veiculo', 'update', campos, [eq('id', a.id)]))[0]
        return (
          await gravar('frota_veiculo', 'insert', {
            ...campos,
            empresa_id: empresa(),
            prefixo: exigir(a.prefixo, 'prefixo', a.acao)
          })
        )[0]
      }
      case 'excluir': {
        const id = exigir(a.id, 'id', a.acao)
        const pedido = pedirConfirmacao(a.confirmar, 'excluir veículo', { id })
        if (pedido) return pedido
        await gravar('frota_veiculo', 'delete', null, [eq('id', id)])
        return { excluido: id }
      }
      case 'capacidade_modelo': {
        const r = await gravar(
          'frota_veiculo',
          'update',
          { capacidade_m3: a.capacidade_m3 ?? null },
          [
            eq('empresa_id', empresa()),
            eq('modelo', exigir(a.modelo, 'modelo', a.acao)),
            eq('capacidade_fleethub', false)
          ]
        )
        return { atualizados: r.length }
      }
      case 'obras_fleethub': {
        const obras = await ler('fleet_obra', {
          colunas: 'id, fleet_id, nome',
          filtros: [eq('empresa_id', empresa())],
          ordem: [{ coluna: 'nome' }]
        })
        const vinc = a.obra_id
          ? await ler('obra_fleet_obra', { filtros: [eq('obra_id', a.obra_id)] })
          : []
        return { obras_fleethub: obras, vinculadas_a_obra: vinc }
      }
      case 'vincular':
        return (
          await gravar('obra_fleet_obra', 'insert', {
            obra_id: exigir(a.obra_id, 'obra_id', a.acao),
            fleet_obra_id: exigir(a.fleet_obra_id, 'fleet_obra_id', a.acao)
          })
        )[0]
      case 'desvincular':
        await gravar('obra_fleet_obra', 'delete', null, [
          eq('obra_id', exigir(a.obra_id, 'obra_id', a.acao)),
          eq('fleet_obra_id', exigir(a.fleet_obra_id, 'fleet_obra_id', a.acao))
        ])
        return { ok: true }
      case 'sincronizar': {
        const pedido = pedirConfirmacao(a.confirmar, 'sincronizar a frota com a FleetHub', {
          empresa_id: empresa()
        })
        if (pedido) return pedido
        return fn('fleethub-sync', { acao: 'sincronizar', empresa_id: empresa() })
      }
      case 'status': {
        const [ult] = await ler('fleet_sync_execucao', {
          colunas:
            'iniciado_em, terminado_em, ok, mensagem, novos, atualizados, inativados, capacidades',
          filtros: [eq('empresa_id', empresa())],
          ordem: [{ coluna: 'iniciado_em', asc: false }],
          limite: 1
        })
        return { ultima_sincronizacao: ult ?? null }
      }
    }
  }
})

export const alertas = ferramenta({
  nome: 'alertas',
  titulo: 'Alertas da obra',
  descricao:
    'Alertas automáticos (atraso, produtividade, sem lançamento, sem foto…). acao: listar (status aberto|' +
    'silenciado|resolvido; resolvido_automaticamente=true quando a condição sumiu) | silenciar (até uma data) | ' +
    'resolver | reabrir | recalcular (roda as regras agora; também roda de hora em hora). Silenciado ou resolvido ' +
    'à mão não volta a abrir com a mesma chave (tipo + tarefa/serviço/equipe + período).',
  entrada: {
    acao: z.enum(['listar', 'silenciar', 'resolver', 'reabrir', 'recalcular']),
    obra_id: OBRA,
    id: z.string().uuid().optional(),
    status: z.enum(['aberto', 'silenciado', 'resolvido']).optional(),
    ate: z.string().optional().describe('silenciar até (ISO)')
  },
  cobre: {
    tabelas: ['acompanhamento_alerta'],
    rpcs: ['acompanhamento_alertas_sincronizar'],
    funcoes: ['acompanhamento-alertas-recalcular']
  },
  async executar(a) {
    const id = () => exigir(a.id, 'id', a.acao)
    switch (a.acao) {
      case 'listar':
        return ler('acompanhamento_alerta', {
          filtros: [eq('obra_id', a.obra_id), ...(a.status ? [eq('status', a.status)] : [])],
          ordem: [{ coluna: 'criado_em', asc: false }]
        })
      case 'silenciar':
        return (
          await gravar(
            'acompanhamento_alerta',
            'update',
            { status: 'silenciado', silenciado_ate: exigir(a.ate, 'ate', a.acao) },
            [eq('id', id())]
          )
        )[0]
      case 'resolver':
        return (
          await gravar(
            'acompanhamento_alerta',
            'update',
            {
              status: 'resolvido',
              resolvido_em: new Date().toISOString(),
              resolvido_automaticamente: false
            },
            [eq('id', id())]
          )
        )[0]
      case 'reabrir':
        return (
          await gravar(
            'acompanhamento_alerta',
            'update',
            {
              status: 'aberto',
              silenciado_ate: null,
              resolvido_em: null,
              resolvido_automaticamente: false
            },
            [eq('id', id())]
          )
        )[0]
      case 'recalcular':
        return fn('acompanhamento-alertas-recalcular', { obra_id: a.obra_id })
    }
  }
})

export const fotos = ferramenta({
  nome: 'fotos',
  titulo: 'Fotos da obra',
  descricao:
    'Relatório fotográfico. acao: listar (filtros de data, serviço, equipe, encarregado, produção, só com GPS; ' +
    'com links assinados de 1 h) | links (por ids) | enviar (JPEG em base64, ligado a uma produção ou avulso, ' +
    'com GPS opcional) | excluir.',
  entrada: {
    acao: z.enum(['listar', 'links', 'enviar', 'excluir']),
    obra_id: OBRA,
    data_de: DATA.optional(),
    data_ate: DATA.optional(),
    item_ids: z.array(z.string().uuid()).optional(),
    equipe_ids: z.array(z.string().uuid()).optional(),
    encarregado_ids: z.array(z.string().uuid()).optional(),
    producao_id: z.string().uuid().nullable().optional(),
    somente_geo: z.boolean().optional(),
    pagina: z.number().int().min(0).optional(),
    por_pagina: z.number().int().min(1).max(100).optional(),
    foto_ids: z.array(z.string().uuid()).optional(),
    arquivo_base64: z.string().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    capturada_em: z.string().nullable().optional(),
    largura: z.number().int().optional(),
    altura: z.number().int().optional(),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['acompanhamento_foto'],
    funcoes: [
      'acompanhamento-fotos-listar',
      'acompanhamento-foto-signed-urls-batch',
      'acompanhamento-foto-signed-url',
      'acompanhamento-foto-delete'
    ]
  },
  async executar(a) {
    switch (a.acao) {
      case 'listar':
        return fn('acompanhamento-fotos-listar', {
          obra_id: a.obra_id,
          filtros: {
            data_de: a.data_de,
            data_ate: a.data_ate,
            item_ids: a.item_ids,
            equipe_ids: a.equipe_ids,
            encarregado_ids: a.encarregado_ids,
            producao_id: a.producao_id ?? undefined,
            somente_geo: a.somente_geo
          },
          page: a.pagina ?? 0,
          page_size: a.por_pagina ?? 30,
          with_urls: true,
          url_transform: { width: 1280, quality: 80, resize: 'contain' }
        })
      case 'links':
        return fn('acompanhamento-foto-signed-urls-batch', {
          foto_ids: exigir(a.foto_ids, 'foto_ids', a.acao)
        })
      case 'enviar': {
        const c = ctxAtual()
        const bytes = Buffer.from(
          exigir(a.arquivo_base64, 'arquivo_base64', a.acao).replace(/^data:[^,]*,/, ''),
          'base64'
        )
        if (bytes.length > 15 * 1024 * 1024) throw new Error('Foto acima de 15 MB.')
        const [o] = await ler<{ empresa_id: string }>('obras', {
          colunas: 'empresa_id',
          filtros: [eq('id', a.obra_id)]
        })
        const key = `${o?.empresa_id ?? 'sem-empresa'}/${a.obra_id}/${a.producao_id ?? 'avulsa'}/${randomUUID()}.jpg`
        const up = await c.sb.storage
          .from('acompanhamento-fotos')
          .upload(key, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' })
        if (up.error) throw new Error(up.error.message)
        return (
          await gravar('acompanhamento_foto', 'insert', {
            obra_id: a.obra_id,
            producao_id: a.producao_id ?? null,
            lat: a.lat ?? null,
            lng: a.lng ?? null,
            captured_at: a.capturada_em ?? null,
            storage_bucket: 'acompanhamento-fotos',
            storage_key: key,
            mime: 'image/jpeg',
            size_bytes: bytes.length,
            width: a.largura ?? null,
            height: a.altura ?? null
          })
        )[0]
      }
      case 'excluir': {
        const ids = exigir(a.foto_ids, 'foto_ids', a.acao)
        const pedido = pedirConfirmacao(a.confirmar, 'excluir fotos', { fotos: ids.length })
        if (pedido) return pedido
        return fn('acompanhamento-foto-delete', { foto_ids: ids })
      }
    }
  }
})
