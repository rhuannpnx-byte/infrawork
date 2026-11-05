/** Formulário dos parâmetros do indireto e o jsonb das RPCs criar/atualizar_tarefa_indireta. */
import type { IndiretoConfigInput } from '@/features/planejamento/hooks/indireto-config'
import type { IndiretoConfig } from '../motor/tipos'
import { lerNumero } from './campos-util'

export interface FormIndireto {
  periodicidade: 'dia' | 'mes' | 'ano'
  receitaModo: 'mesma_logica_custo' | 'percentual_dos_servicos'
  receitaPct: string
  antes: string
  depois: string
  extrapola: boolean
  aplicaTaxas: boolean
  regimeId: string
}

export const FORM_INDIRETO_PADRAO: FormIndireto = {
  periodicidade: 'mes',
  receitaModo: 'mesma_logica_custo',
  receitaPct: '',
  antes: '0',
  depois: '0',
  extrapola: true,
  aplicaTaxas: false,
  regimeId: ''
}

export function formDoConfig(c: IndiretoConfig | null): FormIndireto {
  if (!c) return FORM_INDIRETO_PADRAO
  return {
    periodicidade: c.custo_periodicidade,
    receitaModo: c.receita_modo,
    receitaPct: c.receita_percentual !== null ? String(c.receita_percentual).replace('.', ',') : '',
    antes: String(c.offset_dias_antes),
    depois: String(c.offset_dias_depois),
    extrapola: c.receita_extrapola,
    aplicaTaxas: c.aplica_taxas,
    regimeId: c.taxa_regime_id ?? ''
  }
}

/** jsonb das RPCs criar/atualizar_tarefa_indireta (chave com '' grava nulo), ou a mensagem de erro. */
export function configDoForm(f: FormIndireto): Record<string, unknown> | string {
  const antes = lerNumero(f.antes) ?? 0
  const depois = lerNumero(f.depois) ?? 0
  if (!Number.isInteger(antes) || antes < 0 || !Number.isInteger(depois) || depois < 0)
    return 'As folgas do indireto são dias úteis inteiros, a partir de zero.'
  let pct: number | null = null
  if (f.receitaModo === 'percentual_dos_servicos') {
    pct = lerNumero(f.receitaPct)
    if (pct === null || pct < 0 || pct > 100)
      return 'Informe o percentual da receita do indireto (0 a 100).'
  }
  if (f.aplicaTaxas && !f.regimeId) return 'Escolha o regime de taxas do indireto.'
  return {
    custo_periodicidade: f.periodicidade,
    receita_modo: f.receitaModo,
    receita_unitaria: '',
    receita_percentual: pct === null ? '' : String(pct),
    offset_dias_antes: antes,
    offset_dias_depois: depois,
    receita_extrapola: f.extrapola,
    aplica_taxas: f.aplicaTaxas,
    taxa_regime_id: f.aplicaTaxas ? f.regimeId : ''
  }
}

export function mesmoForm(a: FormIndireto, b: FormIndireto): boolean {
  return JSON.stringify(configDoForm(a)) === JSON.stringify(configDoForm(b))
}

/** Mesmo conteúdo no formato do hook de criação. */
export function inputDoForm(f: FormIndireto): IndiretoConfigInput | string {
  const c = configDoForm(f)
  if (typeof c === 'string') return c
  return {
    custo_periodicidade: f.periodicidade,
    receita_modo: f.receitaModo,
    receita_percentual: c.receita_percentual === '' ? null : Number(c.receita_percentual),
    offset_dias_antes: c.offset_dias_antes as number,
    offset_dias_depois: c.offset_dias_depois as number,
    receita_extrapola: f.extrapola,
    aplica_taxas: f.aplicaTaxas,
    taxa_regime_id: f.aplicaTaxas ? f.regimeId : null
  }
}
