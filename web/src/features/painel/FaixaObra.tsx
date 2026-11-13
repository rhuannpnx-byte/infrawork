import { useMemo, useState, type ReactNode } from 'react'
import { formatNumber } from '@/lib/format'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'
import type { ObraTrecho } from '@/types/gerencial'
import type { FaixaPrevista } from './faixas-previstas'

interface LinhaFaixa {
  codigo: string
  nome: string
  trechos: Array<[number, number]>
  executado: number
  /** Onde o serviço está previsto neste eixo (linha de base); vazio quando não há linha de base. */
  previstos: Array<[number, number]>
  previsto: number
}

const soma = (partes: Array<[number, number]>): number =>
  partes.reduce((s, [a, b]) => s + (b - a), 0)

/** Comprimento de `a` que cai dentro de `b` (as duas listas já unidas e em ordem). */
function sobreposicao(a: Array<[number, number]>, b: Array<[number, number]>): number {
  let total = 0
  for (const [a0, a1] of a)
    for (const [b0, b1] of b) total += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
  return total
}

/** Une intervalos que se tocam ou se sobrepõem. */
function unir(intervalos: Array<[number, number]>): Array<[number, number]> {
  const ord = [...intervalos].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const [ini, fim] of ord) {
    const ult = out[out.length - 1]
    if (ult && ini <= ult[1]) ult[1] = Math.max(ult[1], fim)
    else out.push([ini, fim])
  }
  return out
}

const km = (m: number): string => formatNumber(m / 1000, 1)

// Em tela larga: nome, faixa e executado na mesma linha. Em tela estreita: nome e executado em cima, faixa embaixo.
const LINHA =
  'grid items-center gap-x-3 gap-y-1 grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(140px,240px)_minmax(0,1fr)_190px]'

/**
 * Faixa da obra: os trechos do eixo já executados por serviço, pelos locais e estacas da produção lançada, sobre
 * a faixa em que o serviço está previsto na linha de base. É o desenho da obra em linha: onde cada serviço passou
 * e onde ainda falta.
 */
export function FaixaObra({
  producao,
  trechos,
  previsto = []
}: {
  producao: ProducaoEnriquecida[]
  trechos: ObraTrecho[]
  previsto?: FaixaPrevista[]
}): ReactNode {
  const eixos = useMemo(
    () => trechos.filter((t) => t.tipo === 'eixo' && Number(t.comprimento_m ?? 0) > 0),
    [trechos]
  )
  const porEixo = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of producao) {
      if (p.trecho_id && p.posicao_inicio_m != null && p.posicao_fim_m != null)
        m.set(p.trecho_id, (m.get(p.trecho_id) ?? 0) + 1)
    }
    return m
  }, [producao])
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const eixo =
    eixos.find((t) => t.id === escolhido) ??
    [...eixos].sort((a, b) => (porEixo.get(b.id) ?? 0) - (porEixo.get(a.id) ?? 0))[0] ??
    null

  const linhas = useMemo((): LinhaFaixa[] => {
    if (!eixo) return []
    const grupos = new Map<
      string,
      { nome: string; brutos: Array<[number, number]>; itens: Set<string> }
    >()
    for (const p of producao) {
      if (p.trecho_id !== eixo.id || p.posicao_inicio_m == null || p.posicao_fim_m == null) continue
      const codigo = p.servico_grupo_codigo ?? p.servico_codigo ?? '—'
      const g = grupos.get(codigo) ?? {
        nome: p.servico_grupo_descricao ?? p.servico_display_nome,
        brutos: [],
        itens: new Set<string>()
      }
      const a = Math.min(Number(p.posicao_inicio_m), Number(p.posicao_fim_m))
      const b = Math.max(Number(p.posicao_inicio_m), Number(p.posicao_fim_m))
      if (b > a) g.brutos.push([a, b])
      if (p.item_orcamentario_id) g.itens.add(p.item_orcamentario_id)
      grupos.set(codigo, g)
    }
    return [...grupos.entries()]
      .map(([codigo, g]) => {
        const partes = unir(g.brutos)
        const previstos = unir(
          previsto
            .filter((f) => f.trecho_id === eixo.id && g.itens.has(f.item_orcamentario_id))
            .map((f): [number, number] => [f.inicio_m, f.fim_m])
            .filter(([a, b]) => b > a)
        )
        return {
          codigo,
          nome: g.nome,
          trechos: partes,
          executado: previstos.length ? sobreposicao(partes, previstos) : soma(partes),
          previstos,
          previsto: soma(previstos)
        }
      })
      .filter((l) => l.trechos.length > 0)
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  }, [producao, eixo, previsto])

  if (!eixo) return null
  const comprimento = Number(eixo.comprimento_m)
  const passo = comprimento > 40000 ? 10000 : comprimento > 12000 ? 5000 : 1000
  const marcas: number[] = []
  for (let m = 0; m <= comprimento; m += passo) marcas.push(m)
  const pct = (m: number): string => `${(m / comprimento) * 100}%`

  return (
    <section
      aria-label="Faixa da obra"
      className="bg-bg-panel border border-border rounded px-4 pt-3 pb-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-lg font-semibold text-text">Faixa da obra</h2>
          <span className="text-sm text-text-muted">
            {previsto.length
              ? 'onde cada serviço já foi executado, sobre a faixa prevista na linha de base'
              : 'onde cada serviço já foi executado ao longo do eixo'}
          </span>
        </div>
        {eixos.length > 1 ? (
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Eixo
            <select
              value={eixo.id}
              onChange={(e) => setEscolhido(e.target.value)}
              className="h-8 rounded border border-border-strong bg-bg-panel px-2 text-sm text-text"
            >
              {eixos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-sm text-text-muted">
            {eixo.nome} · {km(comprimento)} km
          </span>
        )}
      </div>

      {linhas.length === 0 ? (
        <p className="text-sm text-text-muted py-4">
          Ainda não há produção com local e estacas neste eixo. Lance a produção informando o local
          para ver o avanço ao longo do traçado.
        </p>
      ) : (
        <div className="flex flex-col gap-y-2 sm:gap-y-1.5">
          <div className={LINHA}>
            <span className="hidden sm:block" />
            <div className="relative col-span-2 h-5 border-b border-border-strong sm:col-span-1">
              {marcas.map((m) => (
                <span
                  key={m}
                  className="absolute bottom-0.5 -translate-x-1/2 text-2xs tabular text-text-dim whitespace-nowrap first:translate-x-0"
                  style={{ left: pct(m) }}
                >
                  km {formatNumber(m / 1000, 0)}
                </span>
              ))}
            </div>
            <span className="hidden text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim text-right sm:block">
              Executado
            </span>
          </div>
          {linhas.map((l) => (
            <FaixaLinha key={l.codigo} linha={l} comprimento={comprimento} />
          ))}
        </div>
      )}
    </section>
  )
}

function FaixaLinha({ linha, comprimento }: { linha: LinhaFaixa; comprimento: number }): ReactNode {
  const base = linha.previsto > 0 ? linha.previsto : comprimento
  const fracao = linha.executado / base
  return (
    <div className={LINHA}>
      <span className="order-1 flex gap-2 min-w-0 text-sm">
        <span className="tabular text-text-dim shrink-0">{linha.codigo}</span>
        <span className="truncate text-text" title={linha.nome}>
          {linha.nome}
        </span>
      </span>
      <div
        className="relative order-3 col-span-2 h-3.5 bg-bg-elevated border border-border sm:order-2 sm:col-span-1"
        role="img"
        aria-label={`${linha.nome}: ${km(linha.executado)} km executados de ${km(base)} km ${linha.previsto > 0 ? 'previstos' : 'do eixo'}`}
      >
        {linha.previstos.map(([a, b]) => (
          <span
            key={`p${a}`}
            className="absolute inset-y-0 bg-bg-active border-x border-border-strong"
            style={{
              left: `${(a / comprimento) * 100}%`,
              width: `${((b - a) / comprimento) * 100}%`
            }}
          />
        ))}
        {linha.trechos.map(([a, b]) => (
          <span
            key={a}
            className="absolute inset-y-0 bg-accent"
            style={{
              left: `${(a / comprimento) * 100}%`,
              width: `max(2px, ${((b - a) / comprimento) * 100}%)`
            }}
          />
        ))}
      </div>
      <span className="order-2 text-sm tabular text-right text-text whitespace-nowrap sm:order-3">
        {km(linha.executado)} km
        <span className="text-text-muted">
          {' '}
          de {km(base)} km · {formatNumber(Math.min(fracao, 1) * 100, 0)}%
        </span>
      </span>
    </div>
  )
}
