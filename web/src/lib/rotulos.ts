import type { Role } from '@/types/auth'

/**
 * Rótulos em português para os códigos gravados no banco. A tela nunca mostra o código cru ("god", "critical",
 * "em_andamento"): passa por aqui.
 */

export const ROTULO_PAPEL: Record<Role, string> = {
  god: 'Administrador geral',
  adm: 'Administrador',
  engenheiro: 'Engenheiro',
  apoio: 'Apoio',
  cliente: 'Cliente',
  apontador: 'Apontador'
}

export const rotuloPapel = (papel: string | null | undefined): string =>
  papel ? (ROTULO_PAPEL[papel as Role] ?? papel) : '—'

const ROTULO_ALERTA_STATUS: Record<string, string> = {
  aberto: 'Aberto',
  silenciado: 'Silenciado',
  resolvido: 'Resolvido'
}
const ROTULO_ALERTA_STATUS_PLURAL: Record<string, string> = {
  aberto: 'abertos',
  silenciado: 'silenciados',
  resolvido: 'resolvidos'
}
export const rotuloAlertaStatus = (s: string): string => ROTULO_ALERTA_STATUS[s] ?? s
export const rotuloAlertaStatusPlural = (s: string): string => ROTULO_ALERTA_STATUS_PLURAL[s] ?? s

const ROTULO_REAJUSTE_STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  aplicado: 'Aplicado'
}
export const rotuloReajusteStatus = (s: string): string => ROTULO_REAJUSTE_STATUS[s] ?? s

/** "1 lançamento", "3 lançamentos". */
export const contar = (n: number, singular: string, plural: string): string =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : plural}`
