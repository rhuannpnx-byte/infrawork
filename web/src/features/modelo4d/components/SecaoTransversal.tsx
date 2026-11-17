import { useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { Segmentado } from '@/components/ui/segmentado'
import { formatNumber } from '@/lib/format'
import type { SecaoDesenho } from '../lib/secao'

const L = 640
const A = 200
const MARGEM = 22

/**
 * Seção transversal da obra numa estaca: o terreno natural, o perfil acabado, as camadas com a espessura e os
 * dispositivos que passam por ali. O que ainda não foi feito na data aparece esmaecido.
 */
export function SecaoTransversal({
  secao,
  rotulo,
  feito,
  aoAndar,
  aoFechar
}: {
  secao: SecaoDesenho | null
  /** Estaca no formato do local da obra. */
  rotulo: string
  /** Diz se a peça já existe na data mostrada; `null` quando a cena está no modo Projeto. */
  feito: ((peca: number) => boolean) | null
  aoAndar: (metros: number) => void
  aoFechar: () => void
}): ReactNode {
  const [exagero, setExagero] = useState<'1' | '2' | '5'>('2')

  const d = useMemo(() => {
    if (!secao) return null
    const { o0, o1, z0, z1 } = secao.caixa
    const alto = Math.max(0.5, z1 - z0)
    // o exagero vale sempre: se a seção não couber na altura do painel, ela encolhe nas duas direções
    const cabe = Math.min(
      1,
      (A - 2 * MARGEM) / (alto * ((L - 2 * MARGEM) / (o1 - o0 || 1)) * Number(exagero))
    )
    const sx = ((L - 2 * MARGEM) / (o1 - o0 || 1)) * cabe
    const sy = sx * Number(exagero)
    const folga = (A - 2 * MARGEM - alto * sy) / 2
    const sobra = (L - 2 * MARGEM - (o1 - o0) * sx) / 2
    const X = (o: number): number => MARGEM + sobra + (o - o0) * sx
    const Y = (z: number): number => MARGEM + folga + (z1 - z) * sy
    const linha = (pts: [number, number][]): string =>
      pts.map(([o, z]) => `${X(o).toFixed(1)},${Y(z).toFixed(1)}`).join(' ')
    const eixo = secao.perfil.reduce((m, p) => (Math.abs(p[0]) < Math.abs(m[0]) ? p : m))
    const natural = secao.natural.filter(([o]) => o >= o0 && o <= o1)
    const noEixo = natural.length
      ? natural.reduce((m, p) => (Math.abs(p[0]) < Math.abs(m[0]) ? p : m))
      : null
    return { X, Y, linha, eixo, natural, noEixo }
  }, [secao, exagero])

  const legenda = useMemo(() => {
    if (!secao) return []
    const vistos = new Map<string, { nome: string; material: string; espessura: number | null }>()
    for (const f of secao.formas)
      if (!vistos.has(f.nome))
        vistos.set(f.nome, { nome: f.nome, material: f.material, espessura: f.espessura })
    for (const m of secao.marcas)
      if (!vistos.has(m.nome))
        vistos.set(m.nome, { nome: m.nome, material: m.material, espessura: null })
    return [...vistos.values()]
  }, [secao])

  const opaco = (peca: number | null): number => (feito && peca != null && !feito(peca) ? 0.28 : 1)
  const m = (v: number, casas = 2): string => formatNumber(v, casas)

  return (
    <section
      aria-label="Seção transversal"
      className="flex h-72 shrink-0 flex-col border-t border-border bg-bg-panel"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <h3 className="text-sm font-semibold text-text">Seção transversal · {rotulo}</h3>
        <IconButton aria-label="Recuar 20 metros" onClick={() => aoAndar(-20)}>
          <ChevronLeft size={14} />
        </IconButton>
        <IconButton aria-label="Avançar 20 metros" onClick={() => aoAndar(20)}>
          <ChevronRight size={14} />
        </IconButton>
        <Segmentado
          rotulo="Exagero vertical"
          valor={exagero}
          aoMudar={setExagero}
          tamanho="sm"
          opcoes={[
            { valor: '1', rotulo: '1×', titulo: 'Sem exagero vertical' },
            { valor: '2', rotulo: '2×', titulo: 'Altura em dobro' },
            { valor: '5', rotulo: '5×', titulo: 'Altura cinco vezes maior' }
          ]}
        />
        <IconButton aria-label="Fechar a seção" className="ml-auto" onClick={aoFechar}>
          <X size={14} />
        </IconButton>
      </div>
      {!secao || !d ? (
        <p className="p-4 text-sm text-text-muted">
          Não há seção do projeto nesta estaca. Use as setas para andar pelo eixo.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <svg
            role="img"
            aria-label={`Seção na ${rotulo}: do afastamento ${m(secao.perfil[0][0], 1)} m ao ${m(secao.perfil[secao.perfil.length - 1][0], 1)} m, cota do eixo ${m(d.eixo[1])} m${d.noEixo ? `, terreno natural ${m(d.noEixo[1])} m` : ''}`}
            viewBox={`0 0 ${L} ${A}`}
            preserveAspectRatio="xMidYMid meet"
            className="h-full min-w-0 flex-1"
          >
            {secao.formas
              .filter((f) => f.fechada)
              .map((f, i) => (
                <polygon
                  key={`p${i}`}
                  points={d.linha(f.pontos)}
                  fill={`var(--m4d-${f.material})`}
                  fillRule="evenodd"
                  stroke="var(--border-strong)"
                  strokeWidth="0.6"
                  opacity={opaco(f.peca)}
                />
              ))}
            {secao.formas
              .filter((f) => !f.fechada)
              .map((f, i) => (
                <polyline
                  key={`l${i}`}
                  points={d.linha(f.pontos)}
                  fill="none"
                  stroke={`var(--m4d-${f.material})`}
                  strokeWidth="2.2"
                  opacity={opaco(f.peca)}
                />
              ))}
            {d.natural.length >= 2 ? (
              <polyline
                points={d.linha(d.natural)}
                fill="none"
                stroke="var(--text-muted)"
                strokeWidth="1.2"
                strokeDasharray="6 4"
              />
            ) : null}
            <polyline
              points={d.linha(secao.perfil)}
              fill="none"
              stroke="var(--text)"
              strokeWidth="1"
            />
            <line
              x1={d.X(0)}
              x2={d.X(0)}
              y1={MARGEM - 14}
              y2={A - MARGEM + 6}
              stroke="var(--accent)"
              strokeWidth="0.8"
              strokeDasharray="2 4"
            />
            {secao.marcas
              .filter((x) => x.o >= secao.caixa.o0 && x.o <= secao.caixa.o1)
              .map((x, i) => (
                <rect
                  key={`m${i}`}
                  x={d.X(x.o) - 4}
                  y={d.Y(x.z) - 4}
                  width="8"
                  height="8"
                  fill={`var(--m4d-${x.material})`}
                  stroke="var(--text)"
                  strokeWidth="0.8"
                  opacity={opaco(x.peca)}
                >
                  <title>
                    {x.nome} · {m(Math.abs(x.o), 1)} m à {x.o < 0 ? 'esquerda' : 'direita'}
                  </title>
                </rect>
              ))}
            <g fill="var(--text)" fontSize="11">
              <text x={d.X(0) + 5} y={MARGEM - 6}>
                eixo {m(d.eixo[1])} m
              </text>
              <text x={d.X(secao.perfil[0][0])} y={A - 6} textAnchor="middle">
                {m(secao.perfil[0][0], 1)} m
              </text>
              <text x={d.X(secao.perfil[secao.perfil.length - 1][0])} y={A - 6} textAnchor="middle">
                {m(secao.perfil[secao.perfil.length - 1][0], 1)} m
              </text>
              <text x={d.X(0)} y={A - 6} textAnchor="middle">
                0
              </text>
            </g>
            {d.noEixo ? (
              <text x={d.X(0) + 5} y={d.Y(d.noEixo[1]) + 14} fill="var(--text-muted)" fontSize="11">
                terreno {m(d.noEixo[1])} m
              </text>
            ) : null}
          </svg>
          <ul
            aria-label="O que a seção mostra"
            tabIndex={0}
            className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-l border-border px-3 py-2 text-xs text-text lg:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            {legenda.map((x) => (
              <li key={x.nome} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-sm border border-border-strong"
                  style={{ background: `var(--m4d-${x.material})` }}
                />
                <span className="min-w-0 flex-1 truncate" title={x.nome}>
                  {x.nome}
                </span>
                {x.espessura ? (
                  <span className="tabular text-text-muted">{m(x.espessura * 100, 1)} cm</span>
                ) : null}
              </li>
            ))}
            {d.natural.length >= 2 ? (
              <li className="flex items-center gap-1.5 text-text-muted">
                <span aria-hidden className="w-2.5 border-t border-dashed border-text-muted" />
                Terreno natural
              </li>
            ) : null}
          </ul>
        </div>
      )}
    </section>
  )
}
