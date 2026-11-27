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

// ── Estoque ──
const ROTULO_ESTOQUE_TIPO: Record<string, string> = { tanque: 'Tanque', deposito: 'Depósito' }
export const rotuloEstoqueTipo = (t: string): string => ROTULO_ESTOQUE_TIPO[t] ?? t

const ROTULO_ESTOQUE_STATUS: Record<string, string> = {
  normal: 'Normal',
  atencao: 'Perto do mínimo',
  baixo: 'Baixo',
  zerado: 'Zerado',
  negativo: 'Negativo',
  sem_saldo: 'Sem saldo'
}
export const rotuloEstoqueStatus = (s: string): string => ROTULO_ESTOQUE_STATUS[s] ?? s

const ROTULO_TANQUE_FORMA: Record<string, string> = {
  cilindrico_horizontal: 'Cilíndrico horizontal',
  cilindrico_vertical: 'Cilíndrico vertical',
  eliptico_horizontal: 'Elíptico horizontal',
  oval_horizontal: 'Oval horizontal',
  retangular: 'Retangular',
  tabela: 'Tabela do fabricante'
}
export const rotuloTanqueForma = (f: string): string => ROTULO_TANQUE_FORMA[f] ?? f

const ROTULO_TANQUE_TAMPO: Record<string, string> = {
  plano: 'Plano',
  abaulado: 'Abaulado',
  semieliptico: 'Semielíptico 2:1',
  hemisferico: 'Hemisférico',
  torisferico: 'Torisférico',
  conico: 'Cônico'
}
export const rotuloTanqueTampo = (t: string): string => ROTULO_TANQUE_TAMPO[t] ?? t

const ROTULO_ESTOQUE_MOVIMENTO: Record<string, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  leitura: 'Leitura'
}
export const rotuloEstoqueMovimento = (t: string): string => ROTULO_ESTOQUE_MOVIMENTO[t] ?? t

/** "1 lançamento", "3 lançamentos". */
export const contar = (n: number, singular: string, plural: string): string =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : plural}`
