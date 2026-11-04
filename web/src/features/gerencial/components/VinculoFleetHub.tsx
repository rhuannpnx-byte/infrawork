import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import {
  useFleetObras,
  useFrota,
  useObraFleetObras,
  useVincularFleetObra
} from '@/features/acompanhamento/hooks/viagens'

/** Obras da FleetHub ligadas a esta obra: as viagens passam a oferecer só os veículos delas (e os manuais). */
export function VinculoFleetHub({
  obraId,
  empresaId
}: {
  obraId: string
  empresaId: string
}): ReactNode {
  const { data: fleetObras = [] } = useFleetObras(empresaId)
  const { data: frota = [] } = useFrota(empresaId)
  const { data: vinculadas = [] } = useObraFleetObras(obraId)
  const vincular = useVincularFleetObra()
  const [todas, setTodas] = useState(false)
  // marcação otimista: muda no clique, o servidor confirma depois (erro desfaz)
  const [desejado, setDesejado] = useState<Record<string, boolean>>({})

  const qtd = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of frota)
      if (v.ativo && v.fleet_obra_id) m.set(v.fleet_obra_id, (m.get(v.fleet_obra_id) ?? 0) + 1)
    return m
  }, [frota])
  if (!fleetObras.length) return null
  const lista = fleetObras
    .filter((o) => todas || (qtd.get(o.id) ?? 0) > 0 || vinculadas.includes(o.id))
    .sort((a, b) => (qtd.get(b.id) ?? 0) - (qtd.get(a.id) ?? 0) || a.nome.localeCompare(b.nome))

  return (
    <div data-testid="vinculo-fleethub">
      <div className="flex items-center justify-between">
        <Label>Obras na FleetHub</Label>
        <button
          type="button"
          className="text-2xs text-text-muted hover:text-accent"
          onClick={() => setTodas((x) => !x)}
        >
          {todas ? 'Só com veículos' : `Mostrar todas (${fleetObras.length})`}
        </button>
      </div>
      <div className="mt-1 grid max-h-40 grid-cols-3 gap-x-3 gap-y-1 overflow-auto rounded border border-border p-2">
        {lista.map((o) => {
          const marcada = desejado[o.id] ?? vinculadas.includes(o.id)
          return (
            <label key={o.id} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={marcada}
                onChange={(e) => {
                  const v = e.target.checked
                  setDesejado((d) => ({ ...d, [o.id]: v }))
                  vincular.mutate(
                    { obra_id: obraId, fleet_obra_id: o.id, vincular: v },
                    {
                      onError: (err) => {
                        setDesejado((d) => ({ ...d, [o.id]: !v }))
                        toast.error(err.message)
                      }
                    }
                  )
                }}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span className="truncate">{o.nome}</span>
              <span className="font-mono text-2xs text-text-dim">{qtd.get(o.id) ?? 0}</span>
            </label>
          )
        })}
      </div>
      <p className="mt-1 text-2xs text-text-dim">
        {vinculadas.length
          ? 'As viagens desta obra mostram os veículos dessas obras e os cadastrados no InfraWork.'
          : 'Sem vínculo, as viagens mostram toda a frota da empresa.'}
      </p>
    </div>
  )
}
