import { type ReactNode, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { contar } from '@/lib/rotulos'
import type { DiaSemFoto } from '../../lib/sequencia-ataque'

interface Props {
  avisos: DiaSemFoto[]
}

function fmtDia(s: string): string {
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR')
  } catch {
    return s
  }
}

/**
 * Aviso ao lado do botão de camadas quando há produção lançada sem foto, que por isso não vira seta na
 * sequência de ataque. Ao passar o mouse, focar ou clicar, lista os dias, frentes e serviços afetados.
 */
export function AvisoProducaoSemFoto({ avisos }: Props): ReactNode {
  const [open, setOpen] = useState(false)
  if (avisos.length === 0) return null
  const resumo = contar(avisos.length, 'produção sem foto', 'produções sem foto')

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      {/* sobre o mapa de satélite: cor fixa */}
      <button
        type="button"
        title={resumo}
        aria-label={resumo}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        className="inline-flex items-center gap-1 h-8 px-2 rounded border border-amber-400/60 bg-[#0b1726] text-amber-300 shadow-lg hover:border-amber-300"
      >
        <AlertTriangle size={14} />
        <span className="text-xs font-semibold tabular">{avisos.length}</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-[320px] rounded border border-border-strong bg-[color:var(--popover)] shadow-[var(--sombra-flutuante)] z-[60]">
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <AlertTriangle size={14} className="text-warn shrink-0" />
            <span className="text-sm font-semibold text-text">{resumo}</span>
          </div>
          <ul
            tabIndex={0}
            aria-label="Produções sem foto"
            className="max-h-[320px] overflow-auto divide-y divide-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            {avisos.map((a, i) => (
              <li key={i} className="px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-text">{a.servico ?? 'Serviço não informado'}</span>
                  <span className="text-text-muted tabular shrink-0">{fmtDia(a.dia)}</span>
                </div>
                {(a.frente || a.encarregado) && (
                  <div className="text-text-muted truncate">
                    {[a.frente, a.encarregado].filter(Boolean).join(' · ')}
                  </div>
                )}
                <div className="text-text-muted tabular">
                  Quantidade:{' '}
                  {a.qtd > 0 ? a.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
