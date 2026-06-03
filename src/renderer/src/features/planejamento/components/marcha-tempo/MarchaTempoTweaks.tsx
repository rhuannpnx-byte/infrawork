// MarchaTempoTweaks — 3 controles expressivos que reformulam o "caráter" do
// painel: Densidade (Compacto/Médio/Amplo), Trajetórias (Técnico/Encorpado/
// Fluido) e Ambiente (Carbono/Blueprint/Vanta). Port do design Claude Design.
//
// Cada controle altera presets que cascateiam pelos componentes filhos do
// painel via opcoes.densidade / opcoes.trajetoria / opcoes.ambiente.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sliders } from 'lucide-react'
import type { MarchaTempoOpcoes } from '@/types/planejamento'

interface MarchaTempoTweaksProps {
  opcoes: MarchaTempoOpcoes
  onChange: (opcoes: MarchaTempoOpcoes) => void
}

const DENSIDADES = ['Compacto', 'Médio', 'Amplo'] as const
const TRAJETORIAS = ['Técnico', 'Encorpado', 'Fluido'] as const
const AMBIENTES = ['Carbono', 'Blueprint', 'Vanta'] as const

export function MarchaTempoTweaks({ opcoes, onChange }: MarchaTempoTweaksProps): ReactNode {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const h = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false)
    }
    window.addEventListener('mousedown', h)
    return (): void => window.removeEventListener('mousedown', h)
  }, [aberto])

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setAberto((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-2xs font-mono uppercase tracking-wider rounded border transition-colors ${
          aberto
            ? 'border-border-accent bg-accent/10 text-accent-hover'
            : 'border-border bg-bg text-text-dim hover:bg-bg-hover'
        }`}
        title="Tweaks: densidade, trajetórias, ambiente"
      >
        <Sliders size={11} />
        Tweaks
      </button>
      {aberto && (
        <div className="absolute top-full right-0 mt-2 z-50 w-72 p-3 rounded-md border border-border-strong bg-bg-menu shadow-2xl font-mono">
          <Secao titulo="Leitura">
            <Radio
              label="Densidade"
              value={opcoes.densidade}
              options={DENSIDADES as unknown as readonly string[]}
              onChange={(v) =>
                onChange({ ...opcoes, densidade: v as MarchaTempoOpcoes['densidade'] })
              }
            />
          </Secao>
          <Secao titulo="Trajetórias">
            <Radio
              label="Caráter"
              value={opcoes.trajetoria}
              options={TRAJETORIAS as unknown as readonly string[]}
              onChange={(v) =>
                onChange({ ...opcoes, trajetoria: v as MarchaTempoOpcoes['trajetoria'] })
              }
            />
          </Secao>
          <Secao titulo="Ambiente">
            <Radio
              label="Profundidade"
              value={opcoes.ambiente}
              options={AMBIENTES as unknown as readonly string[]}
              onChange={(v) =>
                onChange({ ...opcoes, ambiente: v as MarchaTempoOpcoes['ambiente'] })
              }
            />
          </Secao>
        </div>
      )}
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }): ReactNode {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-2xs uppercase tracking-wider text-text-dim mb-1.5">{titulo}</div>
      {children}
    </div>
  )
}

function Radio({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
}): ReactNode {
  return (
    <div>
      <div className="text-2xs text-text-faint mb-1">{label}</div>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`flex-1 px-2 py-1 text-2xs rounded border transition-colors ${
              value === o
                ? 'border-border-accent bg-accent/10 text-accent-hover'
                : 'border-border bg-bg text-text-dim hover:bg-bg-hover'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}
