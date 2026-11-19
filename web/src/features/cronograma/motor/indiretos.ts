/**
 * Tarefas de indireto (InfraWork; o ApeX não tem): ficam fora do motor e cobrem a janela das tarefas diretas,
 * estendida pelas folgas "antes" e "depois" em dias úteis do calendário padrão do plano. Custo e receita por
 * período (dia útil, mês ou ano, fracionados); a receita é própria por período ou a orçada do item repartida pelo
 * faturamento das diretas (a parte delas que cai na janela); taxas sobre o faturamento total da janela.
 *
 * Parcela (canteiro, mobilização/desmobilização): o percentual do valor total orçado do item (custo e receita) nos
 * primeiros ou nos últimos N dias úteis da janela das diretas (sem as folgas), repartido por igual no tempo.
 *
 * Correções em relação ao motor antigo (avaliação do cronograma): a folga "antes" era ignorada (somava dias úteis
 * negativos como zero) e a contagem de dias úteis ficava um dia curta; aqui a janela recua e avança pelo
 * `addWorkDays` do calendário do ApeX e os dias úteis vêm de `getWorkDaysBetween` sobre o intervalo [início, fim).
 */
import { getWorkDaysBetween, type Calendar } from '@apex/calendar'
import { DIA } from './tempo'
import type { PlanoEntrada } from './tipos'

export interface ResultadoIndireto {
  tarefa_id: string
  inicio: number
  fim: number
  dias_uteis: number
  periodos: number
  custo_total: number
  receita_total: number
  custo_taxas: number
}

interface DiretaDatada {
  inicio: number
  fim: number
}

/** Meses fracionados entre dois instantes (como o motor antigo: meses inteiros + fração do mês final). */
function meses(de: number, ate: number): number {
  if (ate <= de) return 0
  const a = new Date(de * 1000),
    b = new Date(ate * 1000)
  const inteiros =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  const diasMesB = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0)).getUTCDate()
  const frac =
    (b.getUTCDate() - a.getUTCDate() + (b.getUTCHours() - a.getUTCHours()) / 24) / diasMesB
  return inteiros + frac
}

/** Anos fracionados (dias corridos ÷ dias do ano final), como o motor antigo. */
function anos(de: number, ate: number): number {
  if (ate <= de) return 0
  const ano = new Date(ate * 1000).getUTCFullYear()
  const dias = (Date.UTC(ano + 1, 0, 1) - Date.UTC(ano, 0, 1)) / 86400000
  return (ate - de) / DIA / dias
}

/** Períodos de uma janela na periodicidade do item: dias úteis, meses ou anos (fracionados). */
export function periodosDaJanela(
  periodicidade: 'dia' | 'mes' | 'ano',
  inicio: number,
  fim: number,
  cal: Calendar
): number {
  if (!(fim > inicio)) return 0
  return periodicidade === 'dia'
    ? Math.max(0, getWorkDaysBetween(cal, inicio, fim))
    : periodicidade === 'mes'
      ? meses(inicio, fim)
      : anos(inicio, fim)
}

export interface PrevisaoIndireto {
  tarefa_id: string
  /** término do indireto se a obra terminar no término previsto (com a folga "depois") */
  fim_previsto: number
  periodicidade: 'dia' | 'mes' | 'ano'
  /** períodos a mais em relação ao planejado */
  periodos_extra: number
  /** custo a mais: custo unitário × períodos a mais */
  custo_extra: number
}

/**
 * Obra atrasada (modo controle): o indireto contínuo (administração: custo por período) segue correndo até o novo
 * término. Projeta, para cada um, os períodos e o custo a mais. O pontual e o parcelado têm valor fechado: não
 * mudam com o atraso.
 */
export function projetarIndiretos(
  e: PlanoEntrada,
  planejados: readonly ResultadoIndireto[],
  fimPlanejadoDiretas: number,
  fimPrevistoDiretas: number,
  cal: Calendar
): PrevisaoIndireto[] {
  // menos de uma hora de diferença não é atraso
  if (!(fimPrevistoDiretas > fimPlanejadoDiretas + 3600)) return []
  const porId = new Map(e.tarefas.map((t) => [t.id, t]))
  const out: PrevisaoIndireto[] = []
  for (const r of planejados) {
    const t = porId.get(r.tarefa_id)
    const cfg = t?.indireto
    if (!t || !cfg || cfg.distribuicao === 'parcela') continue
    const fim =
      cfg.offset_dias_depois > 0
        ? cal.addWorkDays(fimPrevistoDiretas, cfg.offset_dias_depois, false)
        : fimPrevistoDiretas
    const extra = periodosDaJanela(cfg.custo_periodicidade, r.inicio, fim, cal) - r.periodos
    if (!(extra > 0)) continue
    const custoUnit = cfg.custo_unitario ?? Number(t.custo_unitario_item ?? 0)
    out.push({
      tarefa_id: r.tarefa_id,
      fim_previsto: fim,
      periodicidade: cfg.custo_periodicidade,
      periodos_extra: Math.round(extra * 1e6) / 1e6,
      custo_extra: Math.round(custoUnit * extra * 100) / 100
    })
  }
  return out
}

export function calcularIndiretos(
  e: PlanoEntrada,
  diretas: ReadonlyMap<string, DiretaDatada & { id?: string }>,
  cal: Calendar
): ResultadoIndireto[] {
  const indiretas = e.tarefas.filter((t) => t.tipo_no === 'tarefa' && t.is_indireto && t.indireto)
  if (indiretas.length === 0 || diretas.size === 0) return []
  const lista = [...diretas.values()]
  const inicioGlobal = Math.min(...lista.map((d) => d.inicio))
  const fimGlobal = Math.max(...lista.map((d) => d.fim))
  const porId = new Map(e.tarefas.map((t) => [t.id, t]))
  const vendaDe = (id: string): number => {
    const td = porId.get(id)
    return Number(td?.quantidade ?? 0) * Number(td?.venda_unitaria ?? 0)
  }
  let vendaTotal = 0
  for (const id of diretas.keys()) vendaTotal += vendaDe(id)
  const out: ResultadoIndireto[] = []
  for (const t of indiretas) {
    const cfg = t.indireto!
    if (cfg.distribuicao === 'parcela') {
      out.push(parcela(t, cfg, inicioGlobal, fimGlobal, cal, diretas, vendaDe))
      continue
    }
    const inicio =
      cfg.offset_dias_antes > 0
        ? cal.addWorkDays(inicioGlobal, -cfg.offset_dias_antes, true)
        : inicioGlobal
    const fim =
      cfg.offset_dias_depois > 0
        ? cal.addWorkDays(fimGlobal, cfg.offset_dias_depois, false)
        : fimGlobal
    const diasUteis = fim > inicio ? Math.max(0, getWorkDaysBetween(cal, inicio, fim)) : 0
    const periodos =
      cfg.custo_periodicidade === 'dia'
        ? diasUteis
        : periodosDaJanela(cfg.custo_periodicidade, inicio, fim, cal)
    const custoUnit = cfg.custo_unitario ?? Number(t.custo_unitario_item ?? 0)
    const custoTotal = custoUnit * periodos
    // faturamento das diretas dentro da janela, pela fração do tempo de cada uma que cai nela
    let vendaDiretas = 0
    for (const [id, d] of diretas) {
      const a = Math.max(d.inicio, inicio),
        b = Math.min(d.fim, fim)
      const tot = d.fim - d.inicio
      const frac = tot > 0 ? Math.max(0, b - a) / tot : a <= b ? 1 : 0
      if (frac > 0) vendaDiretas += vendaDe(id) * frac
    }
    let receita: number
    if (cfg.receita_modo === 'mesma_logica_custo') {
      const unit =
        cfg.receita_unitaria ??
        (Number(t.quantidade_referencia ?? 0) > 0
          ? Number(t.venda_total_item ?? 0) / Number(t.quantidade_referencia)
          : 0)
      receita = unit * periodos
    } else {
      // receita orçada × (faturamento das diretas na janela ÷ faturamento total das diretas)
      const orcada = Number(t.venda_total_item ?? 0)
      receita = vendaTotal > 0 ? (orcada * vendaDiretas) / vendaTotal : 0
    }
    if (!cfg.receita_extrapola) {
      const orcada = Number(t.venda_total_item ?? 0)
      if (orcada > 0 && receita > orcada) receita = orcada
    }
    const taxas =
      cfg.aplica_taxas && cfg.taxa_percentual ? (vendaDiretas + receita) * cfg.taxa_percentual : 0
    out.push({
      tarefa_id: t.id,
      inicio,
      fim,
      dias_uteis: diasUteis,
      periodos: Math.round(periodos * 1e6) / 1e6,
      custo_total: Math.round(custoTotal * 100) / 100,
      receita_total: Math.round(receita * 100) / 100,
      custo_taxas: Math.round(taxas * 100) / 100
    })
  }
  return out
}

type TarefaIndireta = PlanoEntrada['tarefas'][number]

function parcela(
  t: TarefaIndireta,
  cfg: NonNullable<TarefaIndireta['indireto']>,
  inicioGlobal: number,
  fimGlobal: number,
  cal: Calendar,
  diretas: ReadonlyMap<string, DiretaDatada>,
  vendaDe: (id: string) => number
): ResultadoIndireto {
  const pct = Math.max(0, Math.min(1, Number(cfg.parcela_percentual ?? 0)))
  const dias = Math.max(1, Math.round(Number(cfg.parcela_dias ?? 1)))
  // a parcela não sai da janela das diretas: N maior que a obra = a obra inteira
  let inicio: number, fim: number
  if (cfg.parcela_ancora === 'fim') {
    fim = fimGlobal
    inicio = Math.max(inicioGlobal, cal.addWorkDays(fimGlobal, -dias, true))
  } else {
    inicio = inicioGlobal
    fim = Math.min(fimGlobal, cal.addWorkDays(inicioGlobal, dias, false))
  }
  const diasUteis = fim > inicio ? Math.max(0, getWorkDaysBetween(cal, inicio, fim)) : 0
  const custoItem =
    Number(cfg.custo_unitario ?? t.custo_unitario_item ?? 0) * Number(t.quantidade_referencia ?? 0)
  const receita = Number(t.venda_total_item ?? 0) * pct
  let vendaDiretas = 0
  for (const [id, d] of diretas) {
    const a = Math.max(d.inicio, inicio),
      b = Math.min(d.fim, fim)
    const tot = d.fim - d.inicio
    const frac = tot > 0 ? Math.max(0, b - a) / tot : a <= b ? 1 : 0
    if (frac > 0) vendaDiretas += vendaDe(id) * frac
  }
  const taxas =
    cfg.aplica_taxas && cfg.taxa_percentual ? (vendaDiretas + receita) * cfg.taxa_percentual : 0
  return {
    tarefa_id: t.id,
    inicio,
    fim,
    dias_uteis: diasUteis,
    periodos: Math.round(diasUteis * 1e6) / 1e6,
    custo_total: Math.round(custoItem * pct * 100) / 100,
    receita_total: Math.round(receita * 100) / 100,
    custo_taxas: Math.round(taxas * 100) / 100
  }
}
