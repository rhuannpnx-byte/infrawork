/** Formulário dos parâmetros do indireto e o jsonb das RPCs criar/atualizar_tarefa_indireta. */
import type { IndiretoConfigInput } from '@/features/planejamento/hooks/indireto-config'
import { numeroParaCampo } from '@/lib/mascara/numero'
import type { IndiretoConfig } from '../motor/tipos'
import { lerNumero } from './campos-util'

/**
 * continuo: administração (custo unitário × períodos, enquanto durar a obra);
 * pontual: o valor total do item num período só (canteiro);
 * parcelado: o valor total em parcelas, cada uma no seu período (mobilização/desmobilização).
 * Pontual e parcelado gravam uma tarefa por parcela (distribuicao = 'parcela' no banco).
 */
export type DistribuicaoIndireto = 'continuo' | 'pontual' | 'parcelado'

export interface ParcelaForm {
  /** percentual do valor total do item, como digitado (ex.: "50") */
  pct: string
  ancora: 'inicio' | 'fim'
  /** dias úteis */
  dias: string
}

export interface FormIndireto {
  distribuicao: DistribuicaoIndireto
  parcelas: ParcelaForm[]
  periodicidade: 'dia' | 'mes' | 'ano'
  receitaModo: 'mesma_logica_custo' | 'percentual_dos_servicos'
  antes: string
  depois: string
  extrapola: boolean
  aplicaTaxas: boolean
  regimeId: string
}

export const PARCELAS_PADRAO: Record<'pontual' | 'parcelado', ParcelaForm[]> = {
  pontual: [{ pct: '100', ancora: 'inicio', dias: '30' }],
  parcelado: [
    { pct: '50', ancora: 'inicio', dias: '30' },
    { pct: '50', ancora: 'fim', dias: '30' }
  ]
}

export const FORM_INDIRETO_PADRAO: FormIndireto = {
  distribuicao: 'continuo',
  parcelas: PARCELAS_PADRAO.pontual,
  periodicidade: 'mes',
  receitaModo: 'mesma_logica_custo',
  antes: '0',
  depois: '0',
  extrapola: true,
  aplicaTaxas: false,
  regimeId: ''
}

export function formDoConfig(c: IndiretoConfig | null): FormIndireto {
  if (!c) return FORM_INDIRETO_PADRAO
  const parcela = c.distribuicao === 'parcela'
  const pct = Number(c.parcela_percentual ?? 1)
  return {
    // a tarefa guarda só a sua parcela: 100% é pontual; menos, uma parcela de um parcelado
    distribuicao: !parcela ? 'continuo' : pct >= 0.99995 ? 'pontual' : 'parcelado',
    parcelas: parcela
      ? [
          {
            pct: numeroParaCampo(pct * 100, 2),
            ancora: c.parcela_ancora === 'fim' ? 'fim' : 'inicio',
            dias: String(c.parcela_dias ?? 30)
          }
        ]
      : PARCELAS_PADRAO.pontual,
    periodicidade: c.custo_periodicidade,
    receitaModo: c.receita_modo,
    antes: String(c.offset_dias_antes),
    depois: String(c.offset_dias_depois),
    extrapola: c.receita_extrapola,
    aplicaTaxas: c.aplica_taxas,
    regimeId: c.taxa_regime_id ?? ''
  }
}

/** Parcelas validadas (fração e dias), ou a mensagem de erro. `somaExata`: a criação exige fechar 100%. */
export function parcelasDoForm(
  f: FormIndireto,
  somaExata: boolean
): { pct: number; ancora: 'inicio' | 'fim'; dias: number }[] | string {
  if (f.parcelas.length === 0) return 'Inclua ao menos uma parcela.'
  const out: { pct: number; ancora: 'inicio' | 'fim'; dias: number }[] = []
  for (const [k, p] of f.parcelas.entries()) {
    const pct = f.distribuicao === 'pontual' ? 100 : lerNumero(p.pct)
    const dias = lerNumero(p.dias)
    const nome = f.parcelas.length > 1 ? `Parcela ${k + 1}: ` : ''
    if (pct === null || !(pct > 0) || pct > 100) return `${nome}o percentual vai de 0,01 a 100.`
    if (dias === null || !Number.isInteger(dias) || dias < 1)
      return `${nome}informe os dias úteis (número inteiro a partir de 1).`
    out.push({ pct: pct / 100, ancora: p.ancora, dias })
  }
  const soma = out.reduce((a, p) => a + p.pct, 0)
  if (soma > 1.00005) return `As parcelas somam ${fmtPct(soma)}; o máximo é 100%.`
  if (somaExata && Math.abs(soma - 1) > 0.00005)
    return `As parcelas somam ${fmtPct(soma)}; precisam fechar 100% do valor do item.`
  return out
}

const fmtPct = (f: number): string => `${numeroParaCampo(f * 100, 2)}%`

function comum(f: FormIndireto): Record<string, unknown> | string {
  if (f.aplicaTaxas && !f.regimeId) return 'Escolha o regime de taxas do indireto.'
  return { aplica_taxas: f.aplicaTaxas, taxa_regime_id: f.aplicaTaxas ? f.regimeId : '' }
}

function continuo(f: FormIndireto): Record<string, unknown> | string {
  const antes = lerNumero(f.antes) ?? 0
  const depois = lerNumero(f.depois) ?? 0
  if (!Number.isInteger(antes) || antes < 0 || !Number.isInteger(depois) || depois < 0)
    return 'As folgas do indireto são dias úteis inteiros, a partir de zero.'
  // No ritmo das diretas a receita é a orçada inteira (100%), repartida pelo faturamento direto de cada período; o
  // banco ainda guarda o percentual nesse modo.
  const peloRitmo = f.receitaModo === 'percentual_dos_servicos'
  const c = comum(f)
  if (typeof c === 'string') return c
  return {
    custo_periodicidade: f.periodicidade,
    receita_modo: f.receitaModo,
    receita_unitaria: '',
    receita_percentual: peloRitmo ? '100' : '',
    offset_dias_antes: antes,
    offset_dias_depois: depois,
    receita_extrapola: peloRitmo || f.extrapola,
    ...c,
    distribuicao: 'continuo',
    parcela_percentual: '',
    parcela_ancora: '',
    parcela_dias: ''
  }
}

function daParcela(
  f: FormIndireto,
  p: { pct: number; ancora: 'inicio' | 'fim'; dias: number }
): Record<string, unknown> | string {
  const c = comum(f)
  if (typeof c === 'string') return c
  return {
    // o banco exige periodicidade e modo de receita; a parcela não os usa
    custo_periodicidade: f.periodicidade,
    receita_modo: 'mesma_logica_custo',
    receita_unitaria: '',
    receita_percentual: '',
    offset_dias_antes: 0,
    offset_dias_depois: 0,
    receita_extrapola: true,
    ...c,
    distribuicao: 'parcela',
    parcela_percentual: String(Math.round(p.pct * 1e6) / 1e6),
    parcela_ancora: p.ancora,
    parcela_dias: p.dias
  }
}

/** jsonb de UMA tarefa (edição): contínuo ou a parcela desta tarefa. Chave com '' grava nulo. */
export function configDoForm(f: FormIndireto): Record<string, unknown> | string {
  if (f.distribuicao === 'continuo') return continuo(f)
  const ps = parcelasDoForm({ ...f, parcelas: f.parcelas.slice(0, 1) }, false)
  if (typeof ps === 'string') return ps
  return daParcela(f, ps[0])
}

/** jsonb de cada tarefa a criar: uma para o contínuo, uma por parcela no pontual e no parcelado. */
export function configsParaCriar(f: FormIndireto): Record<string, unknown>[] | string {
  if (f.distribuicao === 'continuo') {
    const c = continuo(f)
    return typeof c === 'string' ? c : [c]
  }
  // o restante pode ficar para outra tarefa do mesmo item; o banco recusa passar de 100%
  const ps = parcelasDoForm(f, false)
  if (typeof ps === 'string') return ps
  const out: Record<string, unknown>[] = []
  for (const p of ps) {
    const c = daParcela(f, p)
    if (typeof c === 'string') return c
    out.push(c)
  }
  return out
}

/** Rótulo curto da parcela para o nome da tarefa: "50% · primeiros 30 dias". */
export function rotuloParcela(c: Record<string, unknown>): string | null {
  if (c.distribuicao !== 'parcela') return null
  const pct = numeroParaCampo(Number(c.parcela_percentual) * 100, 2)
  return `${pct}% · ${c.parcela_ancora === 'fim' ? 'últimos' : 'primeiros'} ${String(c.parcela_dias)} dias`
}

export function mesmoForm(a: FormIndireto, b: FormIndireto): boolean {
  return JSON.stringify(configDoForm(a)) === JSON.stringify(configDoForm(b))
}

/** Mesmo conteúdo no formato do hook de criação (uma tarefa). */
export function inputDoConfig(c: Record<string, unknown>): IndiretoConfigInput {
  return {
    custo_periodicidade: c.custo_periodicidade as IndiretoConfigInput['custo_periodicidade'],
    receita_modo: c.receita_modo as IndiretoConfigInput['receita_modo'],
    receita_percentual: c.receita_percentual === '' ? null : Number(c.receita_percentual),
    offset_dias_antes: c.offset_dias_antes as number,
    offset_dias_depois: c.offset_dias_depois as number,
    receita_extrapola: c.receita_extrapola as boolean,
    aplica_taxas: c.aplica_taxas as boolean,
    taxa_regime_id: c.taxa_regime_id === '' ? null : (c.taxa_regime_id as string),
    distribuicao: c.distribuicao as 'continuo' | 'parcela',
    parcela_percentual: c.parcela_percentual === '' ? null : Number(c.parcela_percentual),
    parcela_ancora: c.parcela_ancora === '' ? null : (c.parcela_ancora as 'inicio' | 'fim'),
    parcela_dias: c.parcela_dias === '' ? null : (c.parcela_dias as number)
  }
}
