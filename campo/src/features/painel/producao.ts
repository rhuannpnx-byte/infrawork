import type { PainelProducaoDto } from '@/types/dtos'

/** Chave de "sem equipe" / "sem encarregado" nos filtros (null = todos). */
export const SEM = 'sem'

export interface FiltroProducao {
  servico: string | null
  encarregado: string | null
  equipe: string | null
}

export interface OpcaoServico {
  id: string
  codigo: string | null
  descricao: string | null
  unidade: string | null
  total: number
  ultimo: string
}

export interface Opcao {
  id: string
  nome: string
  total: number
}

type Linha = PainelProducaoDto['dias'][number]

const chave = (v: string | null): string => v ?? SEM
const num = (v: unknown): number => Number(v ?? 0) || 0

/** Serviços com produção no período: o de produção mais recente primeiro. */
export function servicosComProducao(
  p: PainelProducaoDto,
  filtro: Pick<FiltroProducao, 'encarregado' | 'equipe'> = { encarregado: null, equipe: null },
): OpcaoServico[] {
  const m = new Map<string, OpcaoServico>()
  for (const l of p.dias) {
    if (filtro.encarregado != null && chave(l.n) !== filtro.encarregado) continue
    if (filtro.equipe != null && chave(l.e) !== filtro.equipe) continue
    const meta = p.servicos[l.s]
    const o = m.get(l.s) ?? {
      id: l.s,
      codigo: meta?.codigo ?? null,
      descricao: meta?.descricao ?? null,
      unidade: meta?.unidade ?? null,
      total: 0,
      ultimo: l.d,
    }
    o.total += num(l.q)
    if (l.d > o.ultimo) o.ultimo = l.d
    m.set(l.s, o)
  }
  return [...m.values()].sort(
    (a, b) =>
      b.ultimo.localeCompare(a.ultimo) ||
      b.total - a.total ||
      (a.codigo ?? '').localeCompare(b.codigo ?? '', 'pt-BR', { numeric: true }),
  )
}

function opcoes(
  linhas: Linha[],
  campo: 'e' | 'n',
  nomes: Record<string, string>,
  rotuloSem: string,
): Opcao[] {
  const m = new Map<string, Opcao>()
  for (const l of linhas) {
    const id = chave(l[campo])
    const o = m.get(id) ?? {
      id,
      nome: id === SEM ? rotuloSem : (nomes[id] ?? '(removido)'),
      total: 0,
    }
    o.total += num(l.q)
    m.set(id, o)
  }
  return [...m.values()].sort(
    (a, b) =>
      Number(a.id === SEM) - Number(b.id === SEM) ||
      b.total - a.total ||
      a.nome.localeCompare(b.nome, 'pt-BR'),
  )
}

/** Encarregados que produziram o serviço no período. */
export function encarregadosDoServico(p: PainelProducaoDto, servico: string | null): Opcao[] {
  return opcoes(
    p.dias.filter((l) => l.s === servico),
    'n',
    p.encarregados,
    'Sem encarregado',
  )
}

/** Equipes que produziram o serviço no período (só as do encarregado, quando ele está escolhido). */
export function equipesDoFiltro(
  p: PainelProducaoDto,
  servico: string | null,
  encarregado: string | null,
): Opcao[] {
  return opcoes(
    p.dias.filter((l) => l.s === servico && (encarregado == null || chave(l.n) === encarregado)),
    'e',
    p.equipes,
    'Sem equipe',
  )
}

function noFiltro(l: Linha, f: FiltroProducao): boolean {
  return (
    l.s === f.servico &&
    (f.encarregado == null || chave(l.n) === f.encarregado) &&
    (f.equipe == null || chave(l.e) === f.equipe)
  )
}

/** Produção por dia (ISO → quantidade) dentro do filtro. */
export function producaoPorDia(p: PainelProducaoDto, f: FiltroProducao): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of p.dias) if (noFiltro(l, f)) m.set(l.d, (m.get(l.d) ?? 0) + num(l.q))
  return m
}

/** Quem produziu num dia, por equipe (ou por encarregado, quando a equipe já está filtrada). */
export function detalheDoDia(p: PainelProducaoDto, f: FiltroProducao, dia: string): Opcao[] {
  const linhas = p.dias.filter((l) => l.d === dia && noFiltro(l, f))
  return f.equipe == null
    ? opcoes(linhas, 'e', p.equipes, 'Sem equipe')
    : opcoes(linhas, 'n', p.encarregados, 'Sem encarregado')
}

const isoUTC = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}
const DIA_MS = 86_400_000

/** Dias de `de` a `ate` (ISO), em ordem. */
export function eixoDias(de: string, ate: string): string[] {
  const out: string[] = []
  for (let t = isoUTC(de); t <= isoUTC(ate); t += DIA_MS)
    out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** Dia da semana (0 = domingo) de um ISO. */
export const diaDaSemana = (iso: string): number => new Date(isoUTC(iso)).getUTCDay()

export function resumoProducao(porDia: Map<string, number>, dias: string[]) {
  let total = 0
  let diasCom = 0
  let melhor: { d: string; q: number } | null = null
  for (const d of dias) {
    const q = porDia.get(d) ?? 0
    if (q <= 0) continue
    total += q
    diasCom++
    if (!melhor || q > melhor.q) melhor = { d, q }
  }
  return { total, diasCom, media: diasCom ? total / diasCom : 0, melhor }
}

/** Faixa de cor (0 = sem produção … 4 = perto do maior dia do período). */
export function nivelCalor(q: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (q <= 0 || max <= 0) return 0
  const r = q / max
  return r < 0.25 ? 1 : r < 0.5 ? 2 : r < 0.75 ? 3 : 4
}

/** Número curto para caber na célula: 7 · 12,5 · 640 · 6,2k · 18k. */
export function qtdCurta(v: number): string {
  const a = Math.abs(v)
  if (a >= 10_000) return `${Math.round(v / 1000)}k`
  if (a >= 1000) return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
  return v.toLocaleString('pt-BR', { maximumFractionDigits: a >= 10 ? 0 : 1 })
}
