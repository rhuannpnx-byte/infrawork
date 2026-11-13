import { type ReactNode, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Popover } from '@/components/ui/popover'
import { Segmentado } from '@/components/ui/segmentado'
import { useMapaPrefsStore, type MapaPrefs, type CorPorMapa } from '../../stores/mapa-prefs'
import { cn } from '@/lib/utils'

/**
 * Botão sobre o mapa que abre o painel de camadas e preferências. Lê e grava no store persistente: as
 * escolhas valem na página de fotos e no mapa do dashboard.
 */
export function MapaConfigPopover(): ReactNode {
  const [open, setOpen] = useState(false)
  const prefs = useMapaPrefsStore()

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[250px] p-0"
      trigger={
        // sobre o mapa de satélite: cor fixa
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Camadas e exibição do mapa"
          className={cn(
            'inline-flex items-center gap-1.5 h-8 px-2.5 rounded border text-xs font-semibold shadow-lg',
            'bg-[#0b1726] border-white/25 text-white hover:bg-[#13243a] hover:border-white/60',
            open && 'border-white/70'
          )}
        >
          <Settings2 size={14} />
          Camadas
        </button>
      }
    >
      <div className="text-sm">
        <Grupo titulo="Camadas base">
          <Toggle k="camadaSatelite" label="Satélite" prefs={prefs} />
          <Toggle k="camadaFronteiras" label="Fronteiras e lugares" prefs={prefs} />
          <Toggle k="camadaRodovias" label="Rodovias" prefs={prefs} />
        </Grupo>
        <Grupo titulo="Dados">
          <Toggle k="mostrarFotos" label="Fotos" prefs={prefs} />
          <Toggle k="mostrarSequenciaAtaque" label="Sequência de ataque" prefs={prefs} />
          <Toggle k="mostrarLegenda" label="Legenda" prefs={prefs} />
        </Grupo>
        <Grupo titulo="Cor dos marcadores">
          <Segmentado<CorPorMapa>
            rotulo="Cor dos marcadores"
            tamanho="sm"
            valor={prefs.corPor}
            aoMudar={(v) => prefs.set('corPor', v)}
            opcoes={[
              { valor: 'equipe', rotulo: 'Por equipe' },
              { valor: 'servico', rotulo: 'Por serviço' }
            ]}
          />
        </Grupo>
      </div>
    </Popover>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }): ReactNode {
  return (
    <div className="px-3 py-2.5 border-b border-border last:border-b-0">
      <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim mb-1.5">
        {titulo}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

type ToggleKey = keyof Omit<MapaPrefs, 'corPor'>

function Toggle({
  k,
  label,
  prefs
}: {
  k: ToggleKey
  label: string
  prefs: ReturnType<typeof useMapaPrefsStore.getState>
}): ReactNode {
  const checked = prefs[k]
  return (
    <label className="flex items-center gap-2 min-h-7 px-1 rounded hover:bg-bg-hover cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => prefs.toggle(k)}
        className="size-4 accent-[color:var(--accent)]"
      />
      <span className="text-text">{label}</span>
    </label>
  )
}
