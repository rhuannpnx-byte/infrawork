import { type ReactNode, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Popover } from '@/components/ui/popover'
import { useMapaPrefsStore, type MapaPrefs, type CorPorMapa } from '../../stores/mapa-prefs'
import { cn } from '@/lib/utils'

/**
 * Engrenagem sobreposta ao mapa que abre o painel de camadas/preferências.
 * Lê/grava no store persistente — as escolhas valem na página dedicada e no
 * mini-mapa do dashboard.
 */
export function MapaConfigPopover(): ReactNode {
  const [open, setOpen] = useState(false)
  const prefs = useMapaPrefsStore()

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[230px] p-0"
      trigger={
        <button
          onClick={() => setOpen((o) => !o)}
          title="Camadas e exibição do mapa"
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-2xs font-mono font-medium shadow-lg',
            'bg-[#0b1726] border-white/25 text-white hover:bg-[#13243a] hover:border-accent',
            open && 'border-accent text-accent'
          )}
        >
          <Settings2 size={14} />
          <span className="uppercase tracking-wide">Camadas</span>
        </button>
      }
    >
      <div className="text-2xs font-mono">
        <Secao titulo="Camadas base">
          <Toggle k="camadaSatelite" label="Satélite" prefs={prefs} />
          <Toggle k="camadaFronteiras" label="Fronteiras e lugares" prefs={prefs} />
          <Toggle k="camadaRodovias" label="Rodovias" prefs={prefs} />
        </Secao>
        <Secao titulo="Dados">
          <Toggle k="mostrarFotos" label="Fotos" prefs={prefs} />
          <Toggle k="mostrarKmzTrechos" label="KMZ dos trechos" prefs={prefs} />
          <Toggle k="mostrarSequenciaAtaque" label="Sequência de ataque" prefs={prefs} />
          <Toggle k="mostrarLegenda" label="Legenda" prefs={prefs} />
        </Secao>
        <Secao titulo="Cor dos marcadores">
          <Segmented value={prefs.corPor} onChange={(v) => prefs.set('corPor', v)} />
        </Secao>
      </div>
    </Popover>
  )
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }): ReactNode {
  return (
    <div className="px-2 py-1.5 border-b border-border last:border-b-0">
      <div className="text-[9px] uppercase tracking-wide text-text-dim mb-1">{titulo}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

type ToggleKey = keyof Omit<MapaPrefs, 'corPor'>

function Toggle({
  k, label, prefs
}: { k: ToggleKey; label: string; prefs: ReturnType<typeof useMapaPrefsStore.getState> }): ReactNode {
  const checked = prefs[k]
  return (
    <label className="flex items-center gap-2 px-1 py-1 rounded hover:bg-bg-hover cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => prefs.toggle(k)}
        className="accent-accent"
      />
      <span className="text-text">{label}</span>
    </label>
  )
}

function Segmented({ value, onChange }: { value: CorPorMapa; onChange: (v: CorPorMapa) => void }): ReactNode {
  const opts: Array<{ v: CorPorMapa; label: string }> = [
    { v: 'equipe', label: 'Equipe' },
    { v: 'servico', label: 'Serviço' }
  ]
  return (
    <div className="inline-flex rounded border border-border overflow-hidden w-full">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'flex-1 px-2 py-1 transition-colors',
            value === o.v ? 'bg-accent/15 text-accent' : 'text-text-dim hover:text-text hover:bg-bg-hover'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
