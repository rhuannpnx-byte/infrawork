import { type ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { MapaFotosSatelite } from '../fotos/MapaFotosSatelite'
import type { FotoEnriquecida, SequenciaAtaque } from '@/types/acompanhamento'
import type { DiaSemFoto } from '../../lib/sequencia-ataque'

interface Props {
  fotos: FotoEnriquecida[]
  sequencias?: SequenciaAtaque[]
  avisosSemFoto?: DiaSemFoto[]
  altura?: number
}

/**
 * Mini-mapa do dashboard — delega ao componente unificado MapaFotosSatelite,
 * herdando as mesmas preferências (camadas, fotos on/off, cor por serviço e
 * sequência de ataque) da engrenagem. Mantém o "chrome" do card
 * (cabeçalho + ver tudo).
 */
export function MapaFotosDashboard({
  fotos,
  sequencias = [],
  avisosSemFoto = [],
  altura = 300
}: Props): ReactNode {
  const navigate = useNavigate()
  return (
    <div
      className="rounded border border-border bg-bg-panel overflow-hidden flex flex-col"
      style={{ height: altura }}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3 shrink-0">
        <h4 className="text-md font-semibold text-text flex items-center gap-1.5">Mapa de fotos</h4>
        <button
          onClick={() => navigate({ to: '/acompanhamento/fotos' })}
          className="text-sm font-semibold text-accent hover:underline inline-flex items-center gap-1"
        >
          Abrir fotos e mapa <ArrowUpRight size={12} />
        </button>
      </div>
      <div className="relative flex-1">
        <MapaFotosSatelite
          fotos={fotos}
          sequencias={sequencias}
          avisosSemFoto={avisosSemFoto}
          onPickFoto={() => navigate({ to: '/acompanhamento/fotos' })}
        />
      </div>
    </div>
  )
}
