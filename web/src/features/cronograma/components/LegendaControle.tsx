/**
 * Legenda do modo controle na barra de ferramentas (a legenda do Control do ApeX: "Planned", "Actuals", "Forecast"),
 * com a data de controle. No Gantt, o executado é a faixa dentro da barra; no tempo-caminho, a série pontilhada.
 */
import type { ReactNode } from 'react'
import { fmtData } from '../visoes/formato'

function Amostra({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg width={22} height={10} className="shrink-0" aria-hidden>
      {children}
    </svg>
  )
}

export function LegendaControle({
  visao,
  data,
  previsao = true
}: {
  visao: 'gantt' | 'tempo-caminho'
  /** fim do dia de controle (segundos) */
  data: number
  previsao?: boolean
}): ReactNode {
  const cor = 'var(--text-muted)'
  return (
    <div className="flex items-center gap-2.5 rounded border border-border px-2 py-0.5 text-2xs text-text-dim">
      {visao === 'gantt' ? (
        <span className="flex items-center gap-1">
          <Amostra>
            <rect x={1} y={0.5} width={20} height={9} rx={2} fill="var(--accent)" />
            <rect x={1} y={3} width={12} height={4} rx={1} fill="var(--bg)" fillOpacity={0.75} />
          </Amostra>
          Executado
        </span>
      ) : (
        <>
          <span className="flex items-center gap-1">
            <Amostra>
              <line
                x1={1}
                x2={21}
                y1={5}
                y2={5}
                stroke={cor}
                strokeOpacity={0.45}
                strokeWidth={2.25}
              />
            </Amostra>
            Planejado
          </span>
          <span className="flex items-center gap-1">
            <Amostra>
              <line
                x1={2}
                x2={21}
                y1={5}
                y2={5}
                stroke={cor}
                strokeWidth={3.25}
                strokeDasharray="0.1 4.5"
                strokeLinecap="round"
              />
            </Amostra>
            Realizado
          </span>
        </>
      )}
      {previsao && visao === 'gantt' ? (
        <span
          className="flex items-center gap-1"
          title="Laranja: termina depois do planejado; verde: antes"
        >
          <Amostra>
            <line
              x1={1}
              x2={16}
              y1={5}
              y2={5}
              stroke="var(--warn)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <path d="M 17 1 l 4 4 l -4 4 l -4 -4 z" fill="var(--warn)" />
          </Amostra>
          Término previsto
        </span>
      ) : previsao ? (
        <span className="flex items-center gap-1">
          <Amostra>
            <line
              x1={1}
              x2={21}
              y1={5}
              y2={5}
              stroke={cor}
              strokeWidth={2.25}
              strokeDasharray="6 4"
            />
          </Amostra>
          Previsão
        </span>
      ) : null}
      <span className="flex items-center gap-1">
        <Amostra>
          <line x1={1} x2={21} y1={5} y2={5} stroke="var(--danger)" strokeWidth={1.5} />
        </Amostra>
        Controle em <span className="font-mono text-text-muted">{fmtData(data - 1)}</span>
      </span>
    </div>
  )
}
