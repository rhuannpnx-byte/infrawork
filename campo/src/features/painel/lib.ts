import type { PainelDto, PainelEquipeDto, PainelServicoDto, StatusServico } from '@/types/dtos'

/** Regras de exibição da visão estratégica (funções puras — testadas em lib.test.ts). */

export type Tom = 'ok' | 'warn' | 'bad' | 'info' | 'accent' | 'muted'

export const STATUS_INFO: Record<StatusServico, { label: string; tom: Tom; ordem: number }> = {
  atrasado: { label: 'Atrasado', tom: 'bad', ordem: 0 },
  em_risco: { label: 'Em risco', tom: 'warn', ordem: 1 },
  em_andamento: { label: 'Em andamento', tom: 'info', ordem: 2 },
  no_prazo: { label: 'No prazo', tom: 'ok', ordem: 3 },
  adiantado: { label: 'Adiantado', tom: 'accent', ordem: 4 },
  nao_iniciado: { label: 'Não iniciado', tom: 'muted', ordem: 5 },
  concluido: { label: 'Concluído', tom: 'ok', ordem: 6 },
  sem_plano: { label: 'Sem plano', tom: 'muted', ordem: 7 },
}

export const TOM_TEXTO: Record<Tom, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  accent: 'text-accent',
  muted: 'text-on-surface-muted',
}
export const TOM_FUNDO: Record<Tom, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
  accent: 'bg-accent',
  muted: 'bg-on-surface-muted',
}

export function statusInfo(s: string | null | undefined) {
  return STATUS_INFO[(s ?? 'sem_plano') as StatusServico] ?? STATUS_INFO.sem_plano
}

const n = (v: unknown): number => (v == null || v === '' ? 0 : Number(v))

/** Fração (0–1) → "12,3%". */
export function pct(v: number | null | undefined, casas = 1): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${(Number(v) * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`
}

/** Valor em reais, curto para caber no celular: R$ 140,78 mi · R$ 53,6 mil · R$ 5.358,04. */
export function moeda(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const x = Number(v)
  const abs = Math.abs(x)
  const fmt = (d: number, casas: number) =>
    (x / d).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
  if (abs >= 1e9) return `R$ ${fmt(1e9, 2)} bi`
  if (abs >= 1e6) return `R$ ${fmt(1e6, 2)} mi`
  if (abs >= 1e4) return `R$ ${fmt(1e3, 1)} mil`
  return `R$ ${fmt(1, 2)}`
}

export function moedaCheia(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Quantidade enxuta (produção no celular não precisa de 4 casas). */
export function qtd(v: number | null | undefined, unidade?: string | null): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const x = Number(v)
  const s = x.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(x) >= 100 ? 0 : 2 })
  return unidade ? `${s} ${unidade}` : s
}

/** Desvio em dias (fim planejado − fim estimado no ritmo atual): positivo = folga, negativo = atraso. */
export function textoDesvio(d: number | null | undefined): { texto: string; tom: Tom } | null {
  if (d == null) return null
  if (d === 0) return { texto: 'no limite do prazo', tom: 'warn' }
  return d > 0
    ? { texto: `${d} d de folga`, tom: 'ok' }
    : { texto: `${-d} d de atraso`, tom: 'bad' }
}

/** Serviços na ordem de atenção: atrasados e em risco primeiro, depois a maior distância do esperado. */
export function ordenarServicos(servicos: PainelServicoDto[]): PainelServicoDto[] {
  const gap = (s: PainelServicoDto) => n(s.pct_esperado) - n(s.pct_avanco)
  return [...servicos].sort(
    (a, b) =>
      statusInfo(a.status).ordem - statusInfo(b.status).ordem ||
      gap(b) - gap(a) ||
      a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }),
  )
}

/** Contagem por status (chips da lista). */
export function contarStatus(servicos: PainelServicoDto[]): Partial<Record<StatusServico, number>> {
  const out: Partial<Record<StatusServico, number>> = {}
  for (const s of servicos) out[s.status] = (out[s.status] ?? 0) + 1
  return out
}

/** Quem trabalhou na semana e ainda não lançou hoje (é a quem o supervisor cobra). "Sem equipe" não entra. */
export function semLancamentoHoje(lista: PainelEquipeDto[]): PainelEquipeDto[] {
  return lista
    .filter((e) => e.id != null && e.ativa_semana && !e.lancou_hoje)
    .sort(
      (a, b) =>
        (b.ultimo ?? '').localeCompare(a.ultimo ?? '') || a.nome.localeCompare(b.nome, 'pt-BR'),
    )
}

export const PRAZO_ANTIGO_MS = 24 * 60 * 60_000

/** "04/11 14:32" e se o retrato passou de 24 h. */
export function idadeDados(
  fetchedAt: number,
  agora = Date.now(),
): { texto: string; antigo: boolean } {
  const texto = new Date(fetchedAt)
    .toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', '')
  return { texto, antigo: agora - fetchedAt > PRAZO_ANTIGO_MS }
}

/** Curva-S semanal acumulada: o realizado só vai até a semana de hoje (depois é futuro, não zero). */
export function serieCurva(curva: PainelDto['curva'], hoje: string) {
  const pontos = curva.map((c) => ({
    s: c.s,
    p: c.p == null ? null : n(c.p),
    r: c.s <= hoje && c.r != null ? n(c.r) : null,
  }))
  let idxHoje = -1
  pontos.forEach((p, i) => {
    if (p.s <= hoje) idxHoje = i
  })
  return { pontos, idxHoje }
}

/** % financeiro: executado sobre o valor dos serviços (o que o avanço físico pode agregar). */
export function pctFinanceiro(f: PainelDto['financeiro']): number | null {
  const base = n(f.servicos) || n(f.contrato)
  return base > 0 ? n(f.executado) / base : null
}
