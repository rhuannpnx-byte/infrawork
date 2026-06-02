import { type ReactNode, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { DiaSemFoto } from '../../lib/sequencia-ataque'

interface Props {
  avisos: DiaSemFoto[]
}

function fmtDia(s: string): string {
  try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') } catch { return s }
}

/**
 * Ícone de alerta (âmbar) exibido ao lado do botão de camadas quando há grupos
 * de produção lançada SEM foto — que portanto não viram seta na sequência de
 * ataque. No hover, lista os dias/frentes/serviços afetados.
 */
export function AvisoProducaoSemFoto({ avisos }: Props): ReactNode {
  const [open, setOpen] = useState(false)
  if (avisos.length === 0) return null

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        title="Produção sem foto"
        className="inline-flex items-center gap-1 h-8 px-2 rounded-md border border-amber-400/60 bg-[#0b1726] text-amber-300 shadow-lg hover:border-amber-300"
      >
        <AlertTriangle size={14} />
        <span className="text-2xs font-mono font-semibold">{avisos.length}</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-[300px] max-h-[320px] overflow-auto rounded-md border border-border-strong bg-bg-elevated shadow-2xl z-[60]">
          <div className="px-2.5 py-1.5 border-b border-border bg-bg-panel flex items-center gap-1.5">
            <AlertTriangle size={11} className="text-amber-300" />
            <span className="text-2xs font-mono uppercase text-text-dim">
              {avisos.length} {avisos.length === 1 ? 'produção sem foto' : 'produções sem foto'}
            </span>
          </div>
          <div className="divide-y divide-border">
            {avisos.map((a, i) => (
              <div key={i} className="px-2.5 py-1.5 text-2xs font-mono">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text">{a.servico ?? 'Serviço —'}</span>
                  <span className="text-text-dim shrink-0">{fmtDia(a.dia)}</span>
                </div>
                {(a.frente || a.encarregado) && (
                  <div className="text-text-dim truncate">
                    {[a.frente, a.encarregado].filter(Boolean).join(' · ')}
                  </div>
                )}
                <div className="text-amber-300/90">
                  Qtd {a.qtd > 0 ? a.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
