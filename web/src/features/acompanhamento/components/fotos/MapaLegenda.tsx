import { type ReactNode, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { CorPorMapa } from '../../stores/mapa-prefs'

export interface LegendaItem {
  label: string
  cor: string
}

interface Props {
  corPor: CorPorMapa
  mostrarFotos: boolean
  mostrarSeq: boolean
  fotos: LegendaItem[]
  trechos?: LegendaItem[]
}

/**
 * Legenda flutuante (canto inferior esquerdo) que acompanha as camadas ativas: a cor dos marcadores (por equipe
 * ou por serviço), os trechos da obra e a seta da sequência de ataque.
 */
export function MapaLegenda({
  corPor,
  mostrarFotos,
  mostrarSeq,
  fotos,
  trechos = []
}: Props): ReactNode {
  const [aberto, setAberto] = useState(true)

  const temFotos = mostrarFotos && fotos.length > 0
  if (!temFotos && !mostrarSeq && trechos.length === 0) return null

  return (
    <div className="rounded border border-border-strong bg-[color:var(--popover)] shadow-[var(--sombra-flutuante)] overflow-hidden w-[220px]">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between min-h-8 px-3 py-1.5 hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span className="text-sm font-semibold text-text">Legenda</span>
        {aberto ? (
          <ChevronDown size={14} className="text-text-muted" />
        ) : (
          <ChevronUp size={14} className="text-text-muted" />
        )}
      </button>

      {aberto && (
        <div
          tabIndex={0}
          role="region"
          aria-label="Itens da legenda"
          className="max-h-[260px] overflow-auto divide-y divide-border border-t border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          {temFotos && (
            <Grupo titulo={corPor === 'servico' ? 'Fotos por serviço' : 'Fotos por equipe'}>
              {fotos.map((it, i) => (
                <Linha key={`f${i}`} label={it.label}>
                  <span
                    className="size-2.5 rounded-full border border-border-strong shrink-0"
                    style={{ background: it.cor }}
                  />
                </Linha>
              ))}
            </Grupo>
          )}

          {trechos.length > 0 && (
            <Grupo titulo="Trechos">
              {trechos.map((it, i) => (
                <Linha key={`t${i}`} label={it.label}>
                  <span
                    className="w-4 h-[3px] rounded-sm shrink-0"
                    style={{ background: it.cor }}
                  />
                </Linha>
              ))}
            </Grupo>
          )}

          {mostrarSeq && (
            <Grupo titulo="Sequência de ataque">
              <Linha label="Seta com a cor do serviço">
                <span className="relative w-5 h-2 shrink-0">
                  <span className="absolute top-1/2 left-0 -translate-y-1/2 w-4 h-[3px] bg-text" />
                  <span
                    className="absolute top-1/2 right-0 -translate-y-1/2"
                    style={{
                      width: 0,
                      height: 0,
                      borderTop: '4px solid transparent',
                      borderBottom: '4px solid transparent',
                      borderLeft: '7px solid var(--text)'
                    }}
                  />
                </span>
              </Linha>
            </Grupo>
          )}
        </div>
      )}
    </div>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }): ReactNode {
  return (
    <div className="px-3 py-2">
      <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim mb-1.5">
        {titulo}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Linha({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-2">
      {children}
      <span className="text-xs text-text truncate" title={label}>
        {label}
      </span>
    </div>
  )
}
