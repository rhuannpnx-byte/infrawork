/**
 * Tarefas de indireto (InfraWork; o ApeX não tem): ficam fora do motor e cobrem a janela das tarefas diretas,
 * estendida pelas folgas "antes" e "depois" em dias úteis do calendário padrão do plano. Custo e receita por
 * período (dia útil, mês ou ano, fracionados), receita própria ou % do faturamento das diretas na janela, taxas
 * sobre o faturamento total da janela.
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
  const out: ResultadoIndireto[] = []
  for (const t of indiretas) {
    const cfg = t.indireto!
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
        : cfg.custo_periodicidade === 'mes'
          ? meses(inicio, fim)
          : anos(inicio, fim)
    const custoUnit = cfg.custo_unitario ?? Number(t.custo_unitario_item ?? 0)
    const custoTotal = custoUnit * periodos
    // faturamento das diretas dentro da janela, pela fração do tempo de cada uma que cai nela
    let vendaDiretas = 0
    for (const [id, d] of diretas) {
      const a = Math.max(d.inicio, inicio),
        b = Math.min(d.fim, fim)
      const tot = d.fim - d.inicio
      const frac = tot > 0 ? Math.max(0, b - a) / tot : a <= b ? 1 : 0
      if (frac <= 0) continue
      const td = porId.get(id)
      vendaDiretas += Number(td?.quantidade ?? 0) * Number(td?.venda_unitaria ?? 0) * frac
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
      receita = vendaDiretas * ((Number(cfg.receita_percentual) || 0) / 100)
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
