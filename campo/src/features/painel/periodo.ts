import { create } from 'zustand'

/**
 * Período da Visão estratégica: um só para as telas que somam produção (Produção diária, Equipes e "Quem produziu"
 * do serviço), escolhido por atalho ou por datas. Vale dentro do que o servidor entrega (`desde` até hoje).
 */
export interface Periodo {
  de: string
  ate: string
}

export type AtalhoPeriodo = '7d' | '30d' | 'mes' | 'mes-anterior' | 'tudo'
export type EscolhaPeriodo = AtalhoPeriodo | 'livre'

const DIA_MS = 86_400_000
const utc = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}
const iso = (t: number): string => new Date(t).toISOString().slice(0, 10)

export const somarDias = (dia: string, n: number): string => iso(utc(dia) + n * DIA_MS)
const primeiroDoMes = (dia: string): string => `${dia.slice(0, 7)}-01`

/** O período do atalho, sem cortar (pode começar antes do que o servidor entrega). */
function bruto(atalho: AtalhoPeriodo, hoje: string, desde: string): Periodo {
  switch (atalho) {
    case '7d':
      return { de: somarDias(hoje, -6), ate: hoje }
    case '30d':
      return { de: somarDias(hoje, -29), ate: hoje }
    case 'mes':
      return { de: primeiroDoMes(hoje), ate: hoje }
    case 'mes-anterior': {
      const fim = somarDias(primeiroDoMes(hoje), -1)
      return { de: primeiroDoMes(fim), ate: fim }
    }
    case 'tudo':
      return { de: desde, ate: hoje }
  }
}

/** Corta o período ao que existe: de `desde` (o dia mais antigo entregue pelo servidor) até hoje. */
export function cortar(p: Periodo, hoje: string, desde: string): Periodo {
  const [a, b] = p.de <= p.ate ? [p.de, p.ate] : [p.ate, p.de]
  const ate = b > hoje ? hoje : b < desde ? desde : b
  const de = a < desde ? desde : a > ate ? ate : a
  return { de, ate }
}

/** O atalho tem algum dia dentro do que o servidor entrega? (Mês passado some quando a produção começa neste mês.) */
export function atalhoDisponivel(atalho: AtalhoPeriodo, hoje: string, desde: string): boolean {
  return bruto(atalho, hoje, desde).ate >= desde
}

export function periodoDoAtalho(atalho: AtalhoPeriodo, hoje: string, desde: string): Periodo {
  return cortar(bruto(atalho, hoje, desde), hoje, desde)
}

/** Meses ("AAAA-MM") tocados pelo período, do mais antigo ao mais recente. */
export function mesesDoPeriodo(p: Periodo): string[] {
  const out: string[] = []
  let [y, m] = p.de.slice(0, 7).split('-').map(Number) as [number, number]
  const fim = p.ate.slice(0, 7)
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`
    if (ym > fim) break
    out.push(ym)
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/** Todos os dias do mês de calendário ("AAAA-MM"), em ordem. */
export function diasDoMes(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)
}

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** "novembro de 2026". */
export function nomeDoMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  return `${MESES[m - 1]} de ${y}`
}

const curto = (dia: string): string => dia.split('-').reverse().join('/').slice(0, 5)

/** "24/10 a 23/11" (um dia só: "23/11"). */
export function rotuloPeriodo(p: Periodo): string {
  return p.de === p.ate ? curto(p.de) : `${curto(p.de)} a ${curto(p.ate)}`
}

interface PeriodoStore {
  escolha: EscolhaPeriodo
  /** as datas digitadas, quando a escolha é "livre" */
  livre: Periodo | null
  setAtalho: (a: AtalhoPeriodo) => void
  setLivre: (p: Periodo) => void
}

/** A escolha vale enquanto o app está aberto e acompanha o usuário de uma tela para a outra. */
export const usePeriodoPainel = create<PeriodoStore>((set) => ({
  escolha: '30d',
  livre: null,
  setAtalho: (a) => set({ escolha: a }),
  setLivre: (p) => set({ escolha: 'livre', livre: p }),
}))

/** O período em vigor, já cortado ao que o servidor entrega. */
export function periodoEmVigor(
  escolha: EscolhaPeriodo,
  livre: Periodo | null,
  hoje: string,
  desde: string,
): Periodo {
  if (escolha === 'livre') return cortar(livre ?? { de: desde, ate: hoje }, hoje, desde)
  return periodoDoAtalho(atalhoDisponivel(escolha, hoje, desde) ? escolha : 'tudo', hoje, desde)
}

export function usePeriodo(hoje: string, desde: string): Periodo {
  const escolha = usePeriodoPainel((s) => s.escolha)
  const livre = usePeriodoPainel((s) => s.livre)
  return periodoEmVigor(escolha, livre, hoje, desde)
}
