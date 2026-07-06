// Ferramentas (tool-calling estilo OpenAI) do Oráculo. Todas escopadas à obra
// FIXA da sessão (o LLM não escolhe obra) e revalidam a obra ∈ permitidas antes
// de qualquer query (defesa em profundidade).

import type { WASocket } from '@whiskeysockets/baileys'
import { supabase } from '../supabase.js'
import { logger } from '../logger.js'
import { enviarImagem, enviarTexto } from '../reply.js'
import type { ObraRef } from './identidade.js'
import { buscarFotos } from './fotos.js'
import { acharObra } from './conversa.js'
import { montarContexto } from './contexto.js'
import { buscarComposicao, listarComposicoes } from './composicao.js'
import { estimarConsumo } from './combustivel.js'

export interface ToolCtx {
  /** Obra ATIVA da sessão. Mutável: a tool mudar_obra reatribui em tempo real. */
  obra: ObraRef
  /** Todas as obras que o usuário pode acessar (para troca por nome/código). */
  obras: ObraRef[]
  obrasPermitidasIds: Set<string>
  sock: WASocket
  jid: string
  hoje: string // YYYY-MM-DD (data corrente no fuso do agente)
  /** Marcado true quando a obra foi trocada nesta interação (para persistir). */
  trocou: boolean
}

/** Definições expostas ao LLM. Nenhuma recebe obra_id — a obra é fixa na sessão. */
export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'mudar_obra',
      description:
        'Troca a obra ativa da conversa quando o usuário pedir para falar de OUTRA obra (por nome ou código, ex.: "e na Anel Viário?", "muda pra 6.502"). SEMPRE chame esta ferramenta antes de responder sobre uma obra diferente da ativa. Se houver ambiguidade, ela retorna candidatos para você confirmar com o usuário.',
      parameters: {
        type: 'object',
        properties: {
          busca: { type: 'string', description: 'Nome ou código da obra desejada' }
        },
        required: ['busca']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'producao_periodo',
      description:
        'Soma a produção apontada da obra em um período. Por padrão agrupa por SERVIÇO, mas pode agrupar por ENCARREGADO ou por EQUIPE (parâmetro agrupar_por) — use agrupar_por="encarregado" para "detalhe/produção por encarregado", "quais os encarregados", e agrupar_por="equipe" para "por equipe". Para a produção de UM encarregado específico ("quanto o Emanoel produziu"), passe encarregado com o nome parcial. As quantidades JÁ vêm convertidas para a unidade do InfraWork — use sempre a "qtd"/"unidade" retornadas. Como serviços têm unidades diferentes, o detalhamento por encarregado/equipe lista a produção por serviço dentro de cada um (não some entre unidades diferentes). Use para "produção de ontem/da semana/do dia X". Datas YYYY-MM-DD; se omitidas, usa os últimos 7 dias.',
      parameters: {
        type: 'object',
        properties: {
          data_inicio: { type: 'string', description: 'YYYY-MM-DD' },
          data_fim: { type: 'string', description: 'YYYY-MM-DD' },
          agrupar_por: {
            type: 'string',
            enum: ['servico', 'encarregado', 'equipe'],
            description: 'Dimensão do agrupamento. Padrão "servico".'
          },
          encarregado: {
            type: 'string',
            description: 'Filtra por um encarregado específico (nome parcial, ex.: "Emanuel").'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'composicao_servico',
      description:
        'Composição de preço unitário (CPU) de um serviço da obra: produção diária, custo unitário e os insumos por grupo (equipamento, combustível, mão de obra, material) com quantidades/consumos e custos. Use para "composição/CPU/custo do serviço X", "o que entra no serviço Y".',
      parameters: {
        type: 'object',
        properties: {
          servico: { type: 'string', description: 'Nome ou código do serviço (ex.: "CBUQ", "micro revestimento")' }
        },
        required: ['servico']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_composicoes',
      description:
        'Lista TODOS os serviços da obra que têm composição (CPU) cadastrada, com código, unidade, produção diária e custo unitário. Use para "liste as composições/serviços da obra", "quais serviços têm CPU".',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consumo_estimado',
      description:
        'ESTIMATIVA de consumo de MATERIAIS e DIESEL no período, por serviço e total, cruzando a composição (CPU) com a produção apontada. Retorna diesel (litros) e cada material com sua quantidade e unidade. Use para "consumo de material/diesel/insumos", "quanto de CBUQ/emulsão/cimento/diesel gastamos". Deixe claro que é estimativa (não é medição de estoque/abastecimento). Datas YYYY-MM-DD; sem datas usa os últimos 30 dias.',
      parameters: {
        type: 'object',
        properties: {
          data_inicio: { type: 'string', description: 'YYYY-MM-DD' },
          data_fim: { type: 'string', description: 'YYYY-MM-DD' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'previsto_x_realizado',
      description:
        'Comparativo previsto × realizado por serviço da obra COM o planejamento da SEMANA, segundo a LINHA DE BASE do cronograma. Para cada serviço retorna: previsto_semana_baseline (quanto o cronograma prevê produzir na semana), necessario_semana (quanto precisa ser entregue na semana para manter o término planejado, já considerando o atraso), media_necessaria_dia, qtd_plan_total, qtd_real, qtd_restante, status, desvio_dias e adiantado. Use para "o que está previsto para esta semana", "quanto preciso fazer de X esta semana", andamento, atraso, risco. Sem datas usa a semana corrente (seg–dom).',
      parameters: {
        type: 'object',
        properties: {
          data_inicio: { type: 'string', description: 'Início da semana YYYY-MM-DD (opcional)' },
          data_fim: { type: 'string', description: 'Fim da semana YYYY-MM-DD (opcional)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_fotos',
      description:
        'Envia ao usuário as fotos georreferenciadas da obra que casem com o serviço, o encarregado/colaborador e/ou período. As imagens são enviadas automaticamente no WhatsApp. Datas YYYY-MM-DD.',
      parameters: {
        type: 'object',
        properties: {
          servico: { type: 'string', description: 'Texto do serviço (ex.: "CBUQ", "drenagem")' },
          encarregado: {
            type: 'string',
            description: 'Nome (parcial) do encarregado/colaborador (ex.: "Ailton")'
          },
          data_inicio: { type: 'string', description: 'YYYY-MM-DD' },
          data_fim: { type: 'string', description: 'YYYY-MM-DD' }
        }
      }
    }
  }
] as const

function diasAtras(hoje: string, n: number): string {
  const d = new Date(`${hoje}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Semana corrente (segunda a domingo) que contém `hoje`. */
function semanaDe(hoje: string): { inicio: string; fim: string } {
  const d = new Date(`${hoje}T00:00:00Z`)
  const dow = d.getUTCDay() // 0=dom .. 6=sáb
  const recuo = (dow + 6) % 7 // dias até a segunda anterior
  const seg = new Date(d)
  seg.setUTCDate(d.getUTCDate() - recuo)
  const dom = new Date(seg)
  dom.setUTCDate(seg.getUTCDate() + 6)
  return { inicio: seg.toISOString().slice(0, 10), fim: dom.toISOString().slice(0, 10) }
}

/** Dias corridos (inclusivos) entre duas datas YYYY-MM-DD. */
function diasEntre(inicio: string, fim: string): number {
  const a = new Date(`${inicio}T00:00:00Z`).getTime()
  const b = new Date(`${fim}T00:00:00Z`).getTime()
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1)
}

function arred2(n: number): number {
  return Math.round(n * 100) / 100
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()
}

/** Distância de edição (Levenshtein) — para casar grafias próximas de nomes
 *  (ex.: "Emanoel" ↔ "Emanuel"). */
function lev(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[n]
}

/** true se `nome` casa o texto buscado: substring (sem acento) ou primeiro token
 *  com grafia próxima (edição ≤ 1) — resolve "Emanoel" para "Emanuel Rocha…". */
function nomeCasa(nome: string, busca: string): boolean {
  const n = norm(nome)
  if (n.includes(busca)) return true
  const q = busca.split(/\s+/)[0]
  if (q.length < 4) return false
  return n.split(/\s+/).some((tok) => tok.length >= 4 && lev(tok, q) <= 1)
}

/** Executa uma tool e devolve um JSON-string com o resultado para o LLM. */
export async function executarTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCtx
): Promise<string> {
  // defesa em profundidade: a obra da sessão tem de estar entre as permitidas
  if (!ctx.obrasPermitidasIds.has(ctx.obra.id)) {
    return JSON.stringify({ erro: 'Sem permissão para esta obra.' })
  }
  const obraId = ctx.obra.id

  try {
    if (name === 'mudar_obra') {
      const busca = String(args.busca ?? '')
      const { match, candidatos } = acharObra(ctx.obras, busca)
      if (match) {
        ctx.obra = match // reatribui a obra ativa para o resto desta interação
        ctx.trocou = true
        await enviarTexto(ctx.sock, ctx.jid, `📍 Agora na obra *${match.codigo} - ${match.nome}*.`)
        // devolve o contexto novo já pronto para o modelo responder na hora
        const contexto = await montarContexto(match.id)
        return JSON.stringify({
          ok: true,
          obra: { codigo: match.codigo, nome: match.nome },
          contexto
        })
      }
      if (candidatos.length > 1) {
        return JSON.stringify({
          ambiguo: true,
          opcoes: candidatos.map((o) => `${o.codigo} - ${o.nome}`)
        })
      }
      return JSON.stringify({
        nao_encontrada: true,
        disponiveis: ctx.obras.slice(0, 15).map((o) => `${o.codigo} - ${o.nome}`)
      })
    }

    if (name === 'producao_periodo') {
      const dataFim = (args.data_fim as string) || ctx.hoje
      const dataInicio = (args.data_inicio as string) || diasAtras(dataFim, 7)
      const filtroEnc = args.encarregado ? norm(String(args.encarregado)) : null
      const agruparPor = ['encarregado', 'equipe', 'servico'].includes(String(args.agrupar_por))
        ? (String(args.agrupar_por) as 'encarregado' | 'equipe' | 'servico')
        : filtroEnc
          ? 'encarregado'
          : 'servico'
      // View enriquecida: aplica o vínculo SIGA→InfraWork (fator_conversao) e
      // traz a UNIDADE do InfraWork. Reportamos a qtd CONVERTIDA, não a bruta.
      const { data } = await supabase
        .from('vw_acompanhamento_producao_enriquecida')
        .select(
          'servico_display_nome, siga_servico_nome, servico_unidade, siga_unidade_nome, qtd, qtd_convertida, fator_conversao, equipe_display_nome, siga_equipe_nome, encarregado_display_nome'
        )
        .eq('obra_id', obraId)
        .gte('data', dataInicio)
        .lte('data', dataFim)
      const todas = data ?? []

      const nomeServico = (l: Record<string, unknown>): string =>
        (l.servico_display_nome as string) || (l.siga_servico_nome as string) || 'Serviço'
      const unidadeServico = (l: Record<string, unknown>): string =>
        (l.servico_unidade as string) || (l.siga_unidade_nome as string) || ''
      const nomeEquipe = (l: Record<string, unknown>): string =>
        (l.equipe_display_nome as string) || (l.siga_equipe_nome as string) || '(sem equipe)'
      const nomeEncarregado = (l: Record<string, unknown>): string =>
        (l.encarregado_display_nome as string) || '(sem encarregado)'

      // ── Agrupamento por SERVIÇO (padrão) ──────────────────────────────────
      if (agruparPor === 'servico') {
        const porServico = new Map<
          string,
          { qtd: number; unidade: string; fator: number | null; convertido: boolean }
        >()
        const equipes = new Set<string>()
        for (const l of todas) {
          const convertido = l.qtd_convertida != null
          const nome = nomeServico(l)
          const cur =
            porServico.get(nome) ??
            { qtd: 0, unidade: unidadeServico(l), fator: (l.fator_conversao as number) ?? null, convertido }
          cur.qtd += Number(l.qtd_convertida ?? l.qtd) || 0
          if (!convertido) cur.convertido = false
          porServico.set(nome, cur)
          const eq = (l.equipe_display_nome as string) || (l.siga_equipe_nome as string)
          if (eq) equipes.add(eq)
        }
        return JSON.stringify({
          periodo: { inicio: dataInicio, fim: dataFim },
          agrupado_por: 'servico',
          registros: todas.length,
          equipes: [...equipes],
          observacao:
            'Quantidades já na unidade do InfraWork (fator de conversão do vínculo aplicado). convertido=false indica serviço sem vínculo (valor bruto do SIGA).',
          por_servico: [...porServico.entries()].map(([servico, v]) => ({
            servico,
            qtd: arred2(v.qtd),
            unidade: v.unidade,
            fator_conversao: v.fator,
            convertido: v.convertido
          }))
        })
      }

      // ── Agrupamento por ENCARREGADO ou EQUIPE ─────────────────────────────
      const chaveDe = agruparPor === 'encarregado' ? nomeEncarregado : nomeEquipe

      // filtro opcional por encarregado (nome parcial, sem acento)
      let linhas = todas
      if (filtroEnc) {
        linhas = todas.filter((l) => nomeCasa(nomeEncarregado(l), filtroEnc))
        if (linhas.length === 0) {
          const disponiveis = [...new Set(todas.map((l) => nomeEncarregado(l)))].sort()
          return JSON.stringify({
            periodo: { inicio: dataInicio, fim: dataFim },
            encarregado_buscado: String(args.encarregado),
            nao_encontrado: true,
            encarregados_disponiveis: disponiveis,
            observacao:
              'Nenhum apontamento para esse encarregado no período. Ofereça ao usuário os nomes em encarregados_disponiveis (o nome pode estar grafado de forma diferente).'
          })
        }
      }

      // grupo → serviço → {qtd, unidade}
      const grupos = new Map<
        string,
        { registros: number; equipes: Set<string>; servicos: Map<string, { qtd: number; unidade: string }> }
      >()
      for (const l of linhas) {
        const k = chaveDe(l)
        const g = grupos.get(k) ?? { registros: 0, equipes: new Set<string>(), servicos: new Map() }
        g.registros += 1
        if (agruparPor === 'encarregado') g.equipes.add(nomeEquipe(l))
        const sv = nomeServico(l)
        const unid = unidadeServico(l)
        const sc = g.servicos.get(sv) ?? { qtd: 0, unidade: unid }
        sc.qtd += Number(l.qtd_convertida ?? l.qtd) || 0
        g.servicos.set(sv, sc)
        grupos.set(k, g)
      }

      const lista = [...grupos.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([nome, g]) => ({
          [agruparPor]: nome,
          registros: g.registros,
          ...(agruparPor === 'encarregado' ? { equipes: [...g.equipes] } : {}),
          servicos: [...g.servicos.entries()]
            .map(([servico, v]) => ({ servico, qtd: arred2(v.qtd), unidade: v.unidade }))
            .sort((a, b) => b.qtd - a.qtd)
        }))

      return JSON.stringify({
        periodo: { inicio: dataInicio, fim: dataFim },
        agrupado_por: agruparPor,
        registros: linhas.length,
        observacao:
          'Produção por ' +
          agruparPor +
          ', detalhada por serviço dentro de cada um (serviços têm unidades diferentes — NÃO some quantidades de unidades distintas). Quantidades já na unidade do InfraWork.',
        [agruparPor === 'encarregado' ? 'por_encarregado' : 'por_equipe']: lista
      })
    }

    if (name === 'composicao_servico') {
      const r = await buscarComposicao(obraId, String(args.servico ?? ''))
      return JSON.stringify(r)
    }

    if (name === 'listar_composicoes') {
      const servicos = await listarComposicoes(obraId)
      return JSON.stringify({ total: servicos.length, servicos })
    }

    if (name === 'consumo_estimado') {
      const dataFim = (args.data_fim as string) || ctx.hoje
      const dataInicio = (args.data_inicio as string) || diasAtras(dataFim, 30)
      const r = await estimarConsumo(obraId, dataInicio, dataFim)
      return JSON.stringify(r)
    }

    if (name === 'previsto_x_realizado') {
      const semana = args.data_inicio && args.data_fim
        ? { inicio: String(args.data_inicio), fim: String(args.data_fim) }
        : semanaDe(ctx.hoje)
      const diasSemana = diasEntre(semana.inicio, semana.fim)

      const { data } = await supabase
        .from('vw_acompanhamento_previsto_x_realizado')
        .select(
          'item_orcamentario_id, codigo, descricao, unidade, qtd_plan, qtd_real, pct_avanco, status, data_fim_plan'
        )
        .eq('obra_id', obraId)
        .limit(200)
      const linhas = data ?? []

      // Curva-S numa janela ampla: usada para (a) o previsto da semana pela LINHA
      // DE BASE (soma de planejado_dia na semana) e (b) o RITMO REALIZADO atual
      // (média dos últimos dias trabalhados), por item do orçamento.
      const desde = diasAtras(semana.inicio, 60)
      const { data: curva } = await supabase
        .from('vw_acompanhamento_curva_s')
        .select('item_orcamentario_id, data, planejado_dia, realizado_dia')
        .eq('obra_id', obraId)
        .gte('data', desde)
        .lte('data', semana.fim)
        .order('data')
        .limit(20000)
      const baselineSemanaPorItem = new Map<string, number>()
      const realizadoPorItem = new Map<string, number[]>()
      for (const c of curva ?? []) {
        const k = c.item_orcamentario_id as string | null
        if (!k) continue
        const d = c.data as string
        if (d >= semana.inicio && d <= semana.fim) {
          baselineSemanaPorItem.set(k, (baselineSemanaPorItem.get(k) ?? 0) + Number(c.planejado_dia ?? 0))
        }
        const rd = Number(c.realizado_dia ?? 0)
        if (rd > 0) {
          const arr = realizadoPorItem.get(k) ?? []
          arr.push(rd)
          realizadoPorItem.set(k, arr)
        }
      }
      // Ritmo realizado = média dos últimos 15 dias trabalhados (mesma lógica da UI).
      const mediaAtualPorItem = new Map<string, number | null>()
      for (const [k, arr] of realizadoPorItem) {
        if (arr.length < 2) { mediaAtualPorItem.set(k, null); continue }
        const ult = arr.slice(-15)
        mediaAtualPorItem.set(k, ult.reduce((a, b) => a + b, 0) / ult.length)
      }

      // prioriza o que está atrasado/em risco, depois em andamento
      const peso: Record<string, number> = {
        atrasado: 0,
        em_risco: 1,
        em_andamento: 2,
        no_prazo: 3,
        adiantado: 4,
        nao_iniciado: 5,
        concluido: 6,
        sem_plano: 7
      }
      linhas.sort((a, b) => (peso[a.status as string] ?? 9) - (peso[b.status as string] ?? 9))

      const itens = linhas.slice(0, 25).map((l) => {
        const item = l.item_orcamentario_id as string
        const qtdPlan = l.qtd_plan != null ? Number(l.qtd_plan) : null
        const qtdReal = Number(l.qtd_real ?? 0)
        const fimPlan = (l.data_fim_plan as string) ?? null
        const qtdRestante = qtdPlan != null ? Math.max(0, qtdPlan - qtdReal) : null

        // dias corridos de hoje até o fim planejado (mín. 1, igual à UI)
        let diasRestantes: number | null = null
        if (fimPlan) {
          const fim = new Date(`${fimPlan}T00:00:00Z`).getTime()
          const hoje = new Date(`${ctx.hoje}T00:00:00Z`).getTime()
          diasRestantes = Math.max(1, Math.round((fim - hoje) / 86_400_000))
        }
        // média necessária (/dia) para terminar no prazo, e o total da semana nesse ritmo
        const mediaNecDia =
          qtdRestante != null && diasRestantes != null ? qtdRestante / diasRestantes : null
        const mediaAtualDia = mediaAtualPorItem.get(item) ?? null
        let necessarioSemana = mediaNecDia != null ? mediaNecDia * diasSemana : null
        if (necessarioSemana != null && qtdRestante != null)
          necessarioSemana = Math.min(necessarioSemana, qtdRestante)

        // previsto da semana pela linha de base, limitado ao restante (obra
        // adiantada pode precisar de menos que o ritmo de base para fechar)
        let previstoSemana = baselineSemanaPorItem.get(item) ?? 0
        if (qtdRestante != null) previstoSemana = Math.min(previstoSemana, qtdRestante)

        // ATRASADO = ritmo realizado abaixo do necessário (mesma leitura do
        // relatório). NÃO usamos desvio_dias_estimado (sinal inconsistente).
        const status = l.status as string
        let atrasado: boolean | null
        if (mediaAtualDia != null && mediaNecDia != null) atrasado = mediaAtualDia < mediaNecDia
        else if (status === 'atrasado' || status === 'em_risco') atrasado = true
        else if (status === 'adiantado' || status === 'no_prazo' || status === 'em_andamento')
          atrasado = false
        else atrasado = null // nao_iniciado / concluido / sem_plano / sem ritmo

        return {
          codigo: l.codigo,
          descricao: l.descricao,
          unidade: l.unidade,
          status,
          atrasado,
          qtd_plan_total: qtdPlan,
          qtd_real: arred2(qtdReal),
          qtd_restante: qtdRestante != null ? arred2(qtdRestante) : null,
          pct_avanco: l.pct_avanco,
          fim_plan: fimPlan,
          media_atual_dia: mediaAtualDia != null ? arred2(mediaAtualDia) : null,
          media_necessaria_dia: mediaNecDia != null ? arred2(mediaNecDia) : null,
          previsto_semana_baseline: arred2(previstoSemana),
          necessario_semana: necessarioSemana != null ? arred2(necessarioSemana) : null
        }
      })

      return JSON.stringify({
        semana: { inicio: semana.inicio, fim: semana.fim, dias: diasSemana },
        observacao:
          'atrasado=true quando media_atual_dia (ritmo realizado) < media_necessaria_dia (ritmo p/ cumprir o prazo). atrasado=false = no ritmo/adiantado. atrasado=null = não iniciado/sem ritmo. previsto_semana_baseline = quanto a LINHA DE BASE prevê na semana. necessario_semana = ritmo necessário projetado para a semana; ambos limitados ao qtd_restante para não exceder o total. NÃO classifique adiantado/atrasado por conta própria: use o campo atrasado.',
        total_itens: linhas.length,
        itens
      })
    }

    if (name === 'buscar_fotos') {
      const r = await buscarFotos(obraId, {
        servico: (args.servico as string) ?? null,
        encarregado: (args.encarregado as string) ?? null,
        dataInicio: (args.data_inicio as string) ?? null,
        dataFim: (args.data_fim as string) ?? null
      })
      if (r.fotos.length === 0) {
        return JSON.stringify({ enviadas: 0, total: 0, mensagem: 'Nenhuma foto encontrada para esse filtro.' })
      }
      // efeito colateral: envia as imagens diretamente ao usuário
      for (const f of r.fotos) {
        await enviarImagem(ctx.sock, ctx.jid, f.buffer, f.caption)
      }
      if (r.hasMore) {
        await enviarTexto(
          ctx.sock,
          ctx.jid,
          `Enviei ${r.fotos.length} de ${r.total} fotos. Refine por serviço ou período para ver outras.`
        )
      }
      return JSON.stringify({ enviadas: r.fotos.length, total: r.total, hasMore: r.hasMore })
    }

    return JSON.stringify({ erro: `Ferramenta desconhecida: ${name}` })
  } catch (e) {
    logger.error({ err: e, tool: name }, 'erro ao executar tool do oráculo')
    return JSON.stringify({ erro: 'Falha ao consultar os dados.' })
  }
}
