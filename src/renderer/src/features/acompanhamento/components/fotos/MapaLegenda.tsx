import { type ReactNode, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { CorPorMapa } from '../../stores/mapa-prefs'

export interface LegendaItem { label: string; cor: string }

interface Props {
  corPor: CorPorMapa
  mostrarFotos: boolean
  mostrarKmz: boolean
  mostrarSeq: boolean
  fotos: LegendaItem[]
  trechos: LegendaItem[]
}

/**
 * Legenda flutuante (canto inferior esquerdo) que se adapta às camadas ativas:
 * cor dos pins (equipe/serviço), cores dos trechos e a seta da sequência.
 */
export function MapaLegenda({ corPor, mostrarFotos, mostrarKmz, mostrarSeq, fotos, trechos }: Props): ReactNode {
  const [aberto, setAberto] = useState(true)

  const temFotos = mostrarFotos && fotos.length > 0
  const temTrechos = mostrarKmz && trechos.length > 0
  if (!temFotos && !temTrechos && !mostrarSeq) return null

  return (
    <div className="rounded-md border border-border-strong bg-bg-elevated/95 backdrop-blur-sm shadow-2xl overflow-hidden w-[210px]">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-bg-panel hover:bg-bg-hover"
      >
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wide text-text">Legenda</span>
        {aberto ? <ChevronDown size={12} className="text-text-dim" /> : <ChevronUp size={12} className="text-text-dim" />}
      </button>

      {aberto && (
        <div className="max-h-[260px] overflow-auto divide-y divide-border">
          {temFotos && (
            <Secao titulo={`Fotos · por ${corPor === 'servico' ? 'serviço' : 'equipe'}`}>
              {fotos.map((it, i) => (
                <Linha key={`f${i}`} label={it.label}>
                  <span className="size-2.5 rounded-full border border-white/70 shrink-0" style={{ background: it.cor }} />
                </Linha>
              ))}
            </Secao>
          )}

          {temTrechos && (
            <Secao titulo="Trechos">
              {trechos.map((it, i) => (
                <Linha key={`t${i}`} label={it.label}>
                  <span className="w-4 h-[3px] rounded-full shrink-0" style={{ background: it.cor }} />
                </Linha>
              ))}
              <Linha label="Início / Fim">
                <span className="flex items-center gap-1 shrink-0">
                  <span className="size-2.5 rounded-full" style={{ background: '#22c55e' }} />
                  <span className="size-2.5 rounded-full" style={{ background: '#ef4444' }} />
                </span>
              </Linha>
            </Secao>
          )}

          {mostrarSeq && (
            <Secao titulo="Sequência de ataque">
              <Linha label="Seta (cor por serviço)">
                <span className="relative w-5 h-2 shrink-0">
                  <span className="absolute top-1/2 left-0 -translate-y-1/2 w-4 h-[3px] rounded-full bg-text" />
                  <span
                    className="absolute top-1/2 right-0 -translate-y-1/2"
                    style={{
                      width: 0, height: 0,
                      borderTop: '4px solid transparent',
                      borderBottom: '4px solid transparent',
                      borderLeft: '7px solid var(--color-text, #e5e7eb)'
                    }}
                  />
                </span>
              </Linha>
            </Secao>
          )}
        </div>
      )}
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }): ReactNode {
  return (
    <div className="px-2.5 py-1.5">
      <div className="text-[10px] font-mono font-semibold uppercase tracking-wide text-text/90 mb-1">{titulo}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Linha({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-2">
      {children}
      <span className="text-2xs font-mono text-text truncate" title={label}>{label}</span>
    </div>
  )
}
