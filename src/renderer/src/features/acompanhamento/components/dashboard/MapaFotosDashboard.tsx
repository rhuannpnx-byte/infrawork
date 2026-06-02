import { type ReactNode } from 'react'
import { MapPin, ArrowUpRight } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { MapaFotosSatelite } from '../fotos/MapaFotosSatelite'
import type { FotoEnriquecida, SequenciaAtaque } from '@/types/acompanhamento'
import type { DiaSemFoto } from '../../lib/sequencia-ataque'
import type { ObraTrecho } from '@/types/gerencial'

interface Props {
  fotos: FotoEnriquecida[]
  trechos?: ObraTrecho[]
  sequencias?: SequenciaAtaque[]
  avisosSemFoto?: DiaSemFoto[]
  altura?: number
}

/**
 * Mini-mapa do dashboard — delega ao componente unificado MapaFotosSatelite,
 * herdando as mesmas preferências (camadas, fotos on/off, cor por serviço, KMZ
 * dos trechos e sequência de ataque) da engrenagem. Mantém o "chrome" do card
 * (cabeçalho + ver tudo).
 */
export function MapaFotosDashboard({ fotos, trechos = [], sequencias = [], avisosSemFoto = [], altura = 300 }: Props): ReactNode {
  const navigate = useNavigate()
  return (
    <div className="rounded border border-border bg-bg-panel overflow-hidden flex flex-col" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between shrink-0">
        <h4 className="text-xs font-semibold text-text flex items-center gap-1.5">
          <MapPin size={11} /> Mapa de fotos
        </h4>
        <button
          onClick={() => navigate({ to: '/acompanhamento/fotos' })}
          className="text-2xs font-mono text-text-dim hover:text-text inline-flex items-center gap-1"
        >
          ver tudo <ArrowUpRight size={9} />
        </button>
      </div>
      <div className="relative flex-1">
        <MapaFotosSatelite
          fotos={fotos}
          trechos={trechos}
          sequencias={sequencias}
          avisosSemFoto={avisosSemFoto}
          onPickFoto={() => navigate({ to: '/acompanhamento/fotos' })}
        />
      </div>
    </div>
  )
}
