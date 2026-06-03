import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { MapPin, ArrowUpRight } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'
import { addBaseMapEsri } from '@/lib/leaflet/tiles'
import { useTabVisible } from '@/app/tab-visible'

interface PinFoto {
  id: string
  lat: number | null
  lng: number | null
  equipe_display_cor: string | null
}

interface Props {
  fotos: PinFoto[]
  altura?: number
}

// Lazy load do Leaflet
let LeafletModule: typeof import('leaflet') | null = null
async function loadLeaflet(): Promise<typeof import('leaflet')> {
  if (LeafletModule) return LeafletModule
  const m = await import('leaflet')
  await import('leaflet/dist/leaflet.css')
  LeafletModule = m
  return m
}

export function MiniMapaSatelite({ fotos, altura = 200 }: Props): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const navigate = useNavigate()

  type FotoValida = Omit<PinFoto, 'lat' | 'lng'> & { lat: number; lng: number }
  const validos = useMemo<FotoValida[]>(
    () =>
      fotos.flatMap((f) =>
        f.lat != null && f.lng != null ? [{ ...f, lat: f.lat, lng: f.lng }] : []
      ),
    [fotos]
  )

  useEffect(() => {
    let canceled = false
    void (async () => {
      if (!ref.current) return
      const L = await loadLeaflet()
      if (canceled || !ref.current) return
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      const map = L.map(ref.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        keyboard: false,
        touchZoom: false,
        maxZoom: 16
      })
      addBaseMapEsri(map, L)
      mapRef.current = map

      if (validos.length === 0) {
        map.setView([-15.78, -47.93], 4)
        return
      }

      const lats = validos.map((v) => v.lat)
      const lngs = validos.map((v) => v.lng)
      const south = Math.min(...lats)
      const north = Math.max(...lats)
      const west = Math.min(...lngs)
      const east = Math.max(...lngs)
      const distLat = north - south
      const distLng = east - west
      if (distLat < 0.001 && distLng < 0.001) {
        map.setView([lats[0], lngs[0]], 15, { animate: false })
      } else {
        map.fitBounds(
          [
            [south, west],
            [north, east]
          ],
          { padding: [20, 20], maxZoom: 15, animate: false }
        )
      }

      // Limita a 80 marcadores no minimap pra não pesar
      for (const v of validos.slice(0, 80)) {
        const cor = v.equipe_display_cor || '#67e8f9'
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:8px;height:8px;border-radius:50%;background:${cor};border:1px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.5)"></div>`,
          iconSize: [8, 8],
          iconAnchor: [4, 4]
        })
        L.marker([v.lat, v.lng], { icon }).addTo(map)
      }
    })()
    return () => {
      canceled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [validos])

  // Keep-alive: revalida o tamanho ao reaparecer (vinha de display:none).
  const tabVisible = useTabVisible()
  useEffect(() => {
    if (!tabVisible) return
    const id = requestAnimationFrame(() => {
      try {
        mapRef.current?.invalidateSize(false)
      } catch {
        /* */
      }
    })
    return () => cancelAnimationFrame(id)
  }, [tabVisible])

  return (
    <div
      className="rounded border border-border bg-bg-panel overflow-hidden flex flex-col"
      style={{ height: altura }}
    >
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
        <div ref={ref} className="absolute inset-0" />
        {validos.length === 0 && <ChartEmptyState overlay message="Sem fotos com GPS" />}
        <div className="absolute bottom-1 right-2 text-[9px] text-text/60 font-mono pointer-events-none">
          Esri Satélite
        </div>
      </div>
    </div>
  )
}
