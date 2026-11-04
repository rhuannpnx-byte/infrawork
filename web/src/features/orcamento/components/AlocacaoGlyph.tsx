import { type ReactNode } from 'react'
import { fmtPct2 } from '@/lib/money'
import { ALOC_STATUS_LABEL, type AlocInfo } from '@/types/orcamento'

/**
 * Mini-círculo de alocação da planilha de venda:
 *   ○ vazio = sem agrupamento · ● cheio = 100% em um serviço ·
 *   ◑ fatias = rateado (100%) · ◔ âmbar = com saldo (parcial).
 * Em etapas, o preenchimento é a fração da venda das receitas já alocada.
 */
export function AlocacaoGlyph({
  info,
  size = 12
}: {
  info: AlocInfo | undefined
  size?: number
}): ReactNode {
  const r = size / 2 - 1
  const c = size / 2
  const status = info?.status ?? 'sem'
  const fracao = info?.fracao ?? 0
  const accent = 'var(--accent)'
  const warn = 'var(--warn)'

  // fatias do rateio (receitas com vários destinos)
  const fatias = status === 'rateado' ? info!.destinos.map((d) => d.alocacao.fracao) : null

  let corpo: ReactNode = null
  if (status === 'unico') {
    corpo = <circle cx={c} cy={c} r={r} fill={accent} />
  } else if (fatias) {
    let ang = -Math.PI / 2
    corpo = fatias.map((f, i) => {
      const a0 = ang
      const a1 = ang + f * 2 * Math.PI
      ang = a1
      return (
        <path
          key={i}
          d={arco(c, r, a0, a1)}
          fill={accent}
          opacity={i % 2 === 0 ? 1 : 0.55}
          stroke="var(--bg-panel)"
          strokeWidth={0.6}
        />
      )
    })
  } else if (status === 'saldo') {
    corpo = <path d={arco(c, r, -Math.PI / 2, -Math.PI / 2 + fracao * 2 * Math.PI)} fill={warn} />
  }

  return (
    <span
      className="inline-flex shrink-0"
      title={tooltip(info)}
      aria-label={ALOC_STATUS_LABEL[status]}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={status === 'saldo' ? warn : status === 'sem' ? 'var(--text-faint)' : accent}
          strokeWidth={1}
        />
        {corpo}
      </svg>
    </span>
  )
}

function arco(c: number, r: number, a0: number, a1: number): string {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    return `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`
  }
  const x0 = c + r * Math.cos(a0)
  const y0 = c + r * Math.sin(a0)
  const x1 = c + r * Math.cos(a1)
  const y1 = c + r * Math.sin(a1)
  const grande = a1 - a0 > Math.PI ? 1 : 0
  return `M ${c} ${c} L ${x0} ${y0} A ${r} ${r} 0 ${grande} 1 ${x1} ${y1} Z`
}

function tooltip(info: AlocInfo | undefined): string {
  if (!info || info.status === 'sem') return ALOC_STATUS_LABEL.sem
  if (info.destinos.length === 0) return `${fmtPct2(info.fracao)} da venda agrupada`
  const linhas = info.destinos.map(
    (d) => `${d.servico.codigo} ${d.servico.descricao} — ${fmtPct2(d.alocacao.fracao)}`
  )
  if (info.status === 'saldo') linhas.push(`Saldo: ${fmtPct2(1 - info.fracao)}`)
  return linhas.join('\n')
}
