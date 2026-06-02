import type { ReactNode } from 'react'
import { fmtQtd } from '@/lib/money'
import { corDoServico } from '@/features/planejamento/lib/marcha-tempo-pure'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

interface MarchaTempoFaixaQuantidadesProps {
  template: TrechoQuantidadeVersaoCompleta | null
  nomesColunas: string[]
  dominioPos: [number, number]
  innerH: number
  innerW: number
  /** true = caminho no Y (faixas à esquerda do plot, verticais). false = caminho no X (faixas em cima, horizontais). */
  eixoXTempo: boolean
  larguraFaixa?: number
  /** Espaço (px) disponível antes do eixo Y. Header horizontal entra aqui. */
  margemLeft: number
  /** Px acima do plot reservados pra essa faixa (header vertical quando
   *  eixoXTempo=true; altura total das faixas horizontais quando false). */
  topOffset: number
}

interface Grupo {
  ini: number
  fim: number
  valor: number
}

/**
 * Agrupa segmentos VIZINHOS DIRETOS (separação ≤ 0,5m) com valor > 0 na
 * coluna. Cada grupo vira 1 bloco contínuo no eixo posição.
 */
function agruparSegmentos(
  template: TrechoQuantidadeVersaoCompleta,
  colunaId: string,
  domLo: number,
  domHi: number
): Grupo[] {
  const segsOrdenados = [...template.segmentos]
    .map((s) => ({
      ini: Math.min(s.posicao_inicio_m, s.posicao_fim_m),
      fim: Math.max(s.posicao_inicio_m, s.posicao_fim_m),
      valor: typeof s.valores[colunaId] === 'number' ? Number(s.valores[colunaId]) : 0
    }))
    .filter((s) => s.fim > s.ini && s.valor > 0)
    .sort((a, b) => a.ini - b.ini)

  const grupos: Grupo[] = []
  const TOLERANCIA = 0.5

  for (const seg of segsOrdenados) {
    const interLo = Math.max(domLo, seg.ini)
    const interHi = Math.min(domHi, seg.fim)
    if (interHi <= interLo) continue
    const fracao = (interHi - interLo) / (seg.fim - seg.ini)
    const valorRecortado = seg.valor * fracao

    const ultimo = grupos[grupos.length - 1]
    if (ultimo && interLo - ultimo.fim <= TOLERANCIA) {
      ultimo.fim = interHi
      ultimo.valor += valorRecortado
    } else {
      grupos.push({ ini: interLo, fim: interHi, valor: valorRecortado })
    }
  }
  return grupos
}

/** Extrai o "código" do nome da coluna pra alinhar cor com servico_grupo_codigo
 *  (ex: "004 CBUQ (Aplicação)" → "004"). */
function extrairCodigo(nome: string): string {
  const m = nome.match(/^\s*([\w.-]+)/)
  return m?.[1] ?? nome
}

function fmtQtdCompact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `${(v / 1000).toFixed(0)}k`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  if (v >= 100) return `${Math.round(v)}`
  return fmtQtd(v)
}

export function MarchaTempoFaixaQuantidades({
  template,
  nomesColunas,
  dominioPos,
  innerH,
  innerW,
  eixoXTempo,
  larguraFaixa = 30,
  margemLeft,
  topOffset
}: MarchaTempoFaixaQuantidadesProps): ReactNode {
  if (!template || nomesColunas.length === 0) return null

  const [lo, hi] = dominioPos
  const span = hi - lo
  if (span <= 0) return null

  const colunas = nomesColunas
    .map((nome) => template.colunas.find((c) => c.nome === nome))
    .filter((c): c is NonNullable<typeof c> => !!c)
  if (colunas.length === 0) return null

  function posToPxVertical(p: number): number {
    return innerH - ((p - lo) / span) * innerH
  }
  function posToPxHorizontal(p: number): number {
    return ((p - lo) / span) * innerW
  }

  // ─── eixoXTempo=false (caminho em X) — faixas HORIZONTAIS em cima ──────
  //
  // Layout por coluna:
  //   ┌── LINHA DE TEXTO (header com nome + Σ) ──────────────────────────┐
  //   │ 004 CBUQ (Aplicação) · Σ 33k T                                     │
  //   ├── FAIXA DE BLOCOS (altura larguraFaixa) ─────────────────────────┤
  //   │ █  █ █  ████  █████ █████ █████ █████                              │
  //   └────────────────────────────────────────────────────────────────────┘
  //   Total por coluna = HEADER_LINHA_H + larguraFaixa + GAP
  if (!eixoXTempo) {
    const HEADER_LINHA_H = 18
    const GAP = 6
    const unitTotalH = HEADER_LINHA_H + larguraFaixa + GAP
    return (
      <g>
        {colunas.map((col, i) => {
          // Primeira faixa começa em y = -topOffset (mais alta).
          // Cada faixa subsequente desloca por unitTotalH.
          const yUnit = -topOffset + i * unitTotalH
          const yHeader = yUnit
          const yBlocos = yUnit + HEADER_LINHA_H
          const totalCol = template.segmentos.reduce((s, seg) => {
            const v = seg.valores[col.id]
            return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0)
          }, 0)
          const grupos = agruparSegmentos(template, col.id, lo, hi)
          const cor = corDoServico(extrairCodigo(col.nome))

          return (
            <g key={col.id}>
              {/* Linha de texto larga acima dos blocos */}
              <rect
                x={-margemLeft + 4}
                y={yHeader}
                width={margemLeft + innerW - 4}
                height={HEADER_LINHA_H}
                fill="var(--bg-elevated)"
                stroke="var(--border-strong)"
                strokeWidth={0.6}
                rx={2}
              />
              <rect
                x={-margemLeft + 4}
                y={yHeader}
                width={4}
                height={HEADER_LINHA_H}
                fill={cor}
              />
              <text
                x={-margemLeft + 12}
                y={yHeader + 13}
                fontSize={11}
                fill="var(--text)"
                fontFamily="ui-monospace, monospace"
                fontWeight={600}
              >
                {col.nome}
                <tspan dx={8} fill="var(--text-dim)" fontWeight={400}>
                  Σ {fmtQtdCompact(totalCol)} {col.unidade}
                </tspan>
              </text>

              {/* Background da faixa de blocos (área do plot) */}
              <rect
                x={0}
                y={yBlocos}
                width={innerW}
                height={larguraFaixa}
                fill="var(--bg)"
                stroke="var(--border)"
                strokeWidth={0.5}
              />

              {/* Blocos agrupados */}
              {grupos.map((g, idx) => {
                const x1 = posToPxHorizontal(g.ini)
                const x2 = posToPxHorizontal(g.fim)
                const w = Math.max(2, x2 - x1)
                const cx = (x1 + x2) / 2
                const cy = yBlocos + larguraFaixa / 2
                // Valor SEMPRE rotacionado -90° (vertical, lê de baixo pra cima).
                // Threshold de exibição: blocos com w ≥ 10px renderizam texto.
                const showText = w >= 10
                const valorStr = fmtQtdCompact(g.valor)
                // Fonte adaptativa: cabe em w restrito.
                const fontSize = w >= 22 ? 11 : w >= 14 ? 10 : 9
                return (
                  <g key={idx}>
                    <rect
                      x={x1}
                      y={yBlocos + 2}
                      width={w}
                      height={larguraFaixa - 4}
                      fill={cor}
                      opacity={0.9}
                      stroke={cor}
                      strokeWidth={0.5}
                    />
                    {showText ? (
                      <text
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={fontSize}
                        fill="#0a0b0d"
                        fontFamily="ui-monospace, monospace"
                        fontWeight={700}
                        transform={`rotate(-90 ${cx} ${cy})`}
                      >
                        {valorStr}
                      </text>
                    ) : null}
                  </g>
                )
              })}
            </g>
          )
        })}
      </g>
    )
  }

  // ─── eixoXTempo=true (caminho em Y) — faixas VERTICAIS à esquerda ──────
  return (
    <g>
      {colunas.map((col, i) => {
        const xFaixa = -(margemLeft - 4) + i * (larguraFaixa + 4)
        const totalCol = template.segmentos.reduce((s, seg) => {
          const v = seg.valores[col.id]
          return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0)
        }, 0)
        const grupos = agruparSegmentos(template, col.id, lo, hi)
        const cor = corDoServico(extrairCodigo(col.nome))

        // Header: dentro do espaço topOffset (acima do plot)
        const headerY = -topOffset

        return (
          <g key={col.id}>
            {/* Header card (acima da faixa) */}
            <rect
              x={xFaixa}
              y={headerY}
              width={larguraFaixa}
              height={topOffset - 4}
              fill="var(--bg-elevated)"
              stroke="var(--border-strong)"
              strokeWidth={1}
              rx={2}
            />
            <rect x={xFaixa} y={headerY} width={larguraFaixa} height={4} fill={cor} />
            {/* Código grande, centralizado */}
            <text
              x={xFaixa + larguraFaixa / 2}
              y={headerY + 22}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text)"
              fontFamily="ui-monospace, monospace"
              fontWeight={700}
            >
              {extrairCodigo(col.nome)}
            </text>
            {/* Total */}
            <text
              x={xFaixa + larguraFaixa / 2}
              y={headerY + 35}
              textAnchor="middle"
              fontSize={9}
              fill="var(--text-dim)"
              fontFamily="ui-monospace, monospace"
            >
              {fmtQtdCompact(totalCol)}
            </text>
            <text
              x={xFaixa + larguraFaixa / 2}
              y={headerY + 46}
              textAnchor="middle"
              fontSize={8}
              fill="var(--text-faint)"
              fontFamily="ui-monospace, monospace"
            >
              {col.unidade}
            </text>

            {/* Background da faixa (área do plot vertical) */}
            <rect
              x={xFaixa}
              y={0}
              width={larguraFaixa}
              height={innerH}
              fill="var(--bg)"
              stroke="var(--border)"
              strokeWidth={0.5}
            />

            {/* Blocos agrupados */}
            {grupos.map((g, idx) => {
              const y1 = posToPxVertical(g.fim)
              const y2 = posToPxVertical(g.ini)
              const h = Math.max(2, y2 - y1)
              const fontSize = h >= 22 ? 10 : 8
              const showText = h >= 14
              return (
                <g key={idx}>
                  <rect
                    x={xFaixa + 2}
                    y={y1}
                    width={larguraFaixa - 4}
                    height={h}
                    fill={cor}
                    opacity={0.9}
                    stroke={cor}
                    strokeWidth={0.5}
                  />
                  {showText ? (
                    <text
                      x={xFaixa + larguraFaixa / 2}
                      y={(y1 + y2) / 2 + fontSize / 2 - 1}
                      textAnchor="middle"
                      fontSize={fontSize}
                      fill="#0a0b0d"
                      fontFamily="ui-monospace, monospace"
                      fontWeight={700}
                    >
                      {fmtQtdCompact(g.valor)}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </g>
        )
      })}
    </g>
  )
}
