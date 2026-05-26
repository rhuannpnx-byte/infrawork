import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Supercluster from 'supercluster'
import type { FotoEnriquecida } from '@/types/acompanhamento'
import { FotoMapHoverCard, type PinFoto } from './FotoMapHoverCard'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'

interface Props {
  fotos: FotoEnriquecida[]
  onPickFoto: (idx: number) => void
  /** Quando muda, força invalidateSize do mapa (útil quando container resize). */
  layoutKey?: string
}

interface HoverState { pos: { x: number; y: number }; fotos: PinFoto[] }

let LeafletModule: typeof import('leaflet') | null = null
async function loadLeaflet(): Promise<typeof import('leaflet')> {
  if (LeafletModule) return LeafletModule
  const m = await import('leaflet')
  await import('leaflet/dist/leaflet.css')
  LeafletModule = m
  return m
}

interface ClusterPointProps {
  cluster: boolean
  point_count?: number
  fotoIdx?: number
  cor?: string
}

export function MapaFotosSatelite({ fotos, onPickFoto, layoutKey }: Props): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const supRef = useRef<Supercluster<ClusterPointProps> | null>(null)
  const onPickRef = useRef(onPickFoto)
  onPickRef.current = onPickFoto
  const [hover, setHover] = useState<HoverState | null>(null)

  // Mapa por idx para resolver hover (single pin)
  const fotosByIdx = useMemo(() => {
    const m = new Map<number, FotoEnriquecida>()
    for (let i = 0; i < fotos.length; i++) m.set(i, fotos[i])
    return m
  }, [fotos])
  const toPinFoto = (f: FotoEnriquecida): PinFoto => ({
    id: f.id,
    captured_at: f.captured_at,
    servico_display_nome: f.servico_display_nome,
    siga_servico_nome: f.siga_servico_nome
  })

  type Valida = Omit<FotoEnriquecida, 'lat' | 'lng'> & { lat: number; lng: number; _idx: number }
  const validas = useMemo<Valida[]>(
    () =>
      fotos.flatMap((f, idx) =>
        f.lat != null && f.lng != null ? [{ ...f, lat: f.lat, lng: f.lng, _idx: idx }] : []
      ),
    [fotos]
  )

  useEffect(() => {
    let canceled = false
    void (async () => {
      if (!ref.current) return
      const L = await loadLeaflet()
      if (canceled || !ref.current) return
      if (!mapRef.current) {
        const map = L.map(ref.current, {
          preferCanvas: true,
          maxZoom: 18,
          worldCopyJump: true
        }).setView([-15.78, -47.93], 4)
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          {
            maxZoom: 18,           // limite real de cobertura global Esri
            maxNativeZoom: 18,
            attribution: 'Tiles © Esri — Source: Esri, Earthstar Geographics'
          }
        ).addTo(map)
        mapRef.current = map
      }
      const map = mapRef.current!

      // Cria supercluster
      const sup = new Supercluster<ClusterPointProps>({ radius: 60, maxZoom: 18 })
      sup.load(
        validas.map((v) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
          properties: {
            cluster: false,
            fotoIdx: v._idx,
            cor: v.equipe_display_cor ?? '#67e8f9'
          }
        }))
      )
      supRef.current = sup

      if (layerRef.current) layerRef.current.remove()
      layerRef.current = L.layerGroup().addTo(map)

      function render(): void {
        const sup = supRef.current
        const lay = layerRef.current
        if (!sup || !lay) return
        lay.clearLayers()
        const b = map.getBounds()
        const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
        const clusters = sup.getClusters(bbox, Math.round(map.getZoom()))
        for (const c of clusters) {
          const [lng, lat] = c.geometry.coordinates
          if (c.properties.cluster) {
            const count = c.properties.point_count ?? 0
            const tam = count >= 100 ? 36 : count >= 10 ? 30 : 24
            const icon = L.divIcon({
              className: '',
              html: `<div style="width:${tam}px;height:${tam}px;border-radius:50%;background:rgba(45,212,191,.9);color:#0b1726;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.4)">${count}</div>`,
              iconSize: [tam, tam],
              iconAnchor: [tam / 2, tam / 2]
            })
            const m = L.marker([lat, lng], { icon })
            const clusterId = c.id as number
            m.on('mouseover', (ev) => {
              const me = ev as unknown as { originalEvent: MouseEvent }
              // Pega ate 30 leaves do cluster (offset 0)
              const leaves = sup.getLeaves(clusterId, 30, 0)
              const fotosCluster: PinFoto[] = leaves.flatMap((l) => {
                const idx = (l.properties as ClusterPointProps).fotoIdx
                if (idx == null) return []
                const f = fotosByIdx.get(idx)
                return f ? [toPinFoto(f)] : []
              })
              if (fotosCluster.length > 0) {
                setHover({ pos: { x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 }, fotos: fotosCluster })
              }
            })
            m.on('mousemove', (ev) => {
              const me = ev as unknown as { originalEvent: MouseEvent }
              setHover((prev) => prev ? { ...prev, pos: { x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 } } : prev)
            })
            m.on('mouseout', () => setHover(null))
            m.on('click', () => {
              setHover(null)
              const expansionZoom = Math.min(sup.getClusterExpansionZoom(clusterId), 18)
              map.setView([lat, lng], expansionZoom, { animate: true })
            })
            m.addTo(lay)
          } else {
            const cor = c.properties.cor ?? '#67e8f9'
            const icon = L.divIcon({
              className: '',
              html: `<div style="width:14px;height:14px;border-radius:50%;background:${cor};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7]
            })
            const m = L.marker([lat, lng], { icon })
            const idxFoto = c.properties.fotoIdx
            m.on('mouseover', (ev) => {
              const me = ev as unknown as { originalEvent: MouseEvent }
              if (idxFoto == null) return
              const f = fotosByIdx.get(idxFoto)
              if (!f) return
              setHover({ pos: { x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 }, fotos: [toPinFoto(f)] })
            })
            m.on('mousemove', (ev) => {
              const me = ev as unknown as { originalEvent: MouseEvent }
              setHover((prev) => prev ? { ...prev, pos: { x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 } } : prev)
            })
            m.on('mouseout', () => setHover(null))
            m.on('click', () => {
              setHover(null)
              if (idxFoto != null) onPickRef.current(idxFoto)
            })
            m.addTo(lay)
          }
        }
      }
      map.off('moveend zoomend')
      map.on('moveend zoomend', render)

      // Auto-fit: re-enquadra sempre que o conjunto de pontos muda
      if (validas.length > 0) {
        const lats = validas.map((v) => v.lat); const lngs = validas.map((v) => v.lng)
        const south = Math.min(...lats); const north = Math.max(...lats)
        const west = Math.min(...lngs); const east = Math.max(...lngs)
        if ((north - south) < 0.001 && (east - west) < 0.001) {
          // todos no mesmo ponto: zoom alto mas dentro do limite
          map.setView([lats[0], lngs[0]], 16, { animate: false })
        } else {
          map.fitBounds([[south, west], [north, east]], { padding: [40, 40], maxZoom: 16, animate: false })
        }
      } else {
        map.setView([-15.78, -47.93], 4, { animate: false })
      }
      render()
    })()
    return () => { canceled = true }
  }, [validas])

  // Force recompute do tamanho quando container muda (resize do window OU
  // troca de view-mode no container parent). ResizeObserver no ref do div.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fire = (): void => {
      // mapRef pode estar null no primeiro disparo; tentamos em alguns ticks
      const tryInvalidate = (n: number): void => {
        const m = mapRef.current
        if (m) {
          try { m.invalidateSize(false) } catch { /* */ }
          return
        }
        if (n > 0) setTimeout(() => tryInvalidate(n - 1), 80)
      }
      tryInvalidate(5)
    }
    const ro = new ResizeObserver(fire)
    ro.observe(el)
    window.addEventListener('resize', fire)
    // dispara um invalidate logo após o mount (cobre transições de layout)
    const t = setTimeout(fire, 50)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fire)
      clearTimeout(t)
    }
  }, [])

  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
  }, [])

  // Quando layoutKey muda (troca de view-mode), força invalidateSize
  useEffect(() => {
    if (!mapRef.current) return
    const t1 = setTimeout(() => { try { mapRef.current?.invalidateSize(false) } catch { /* */ } }, 50)
    const t2 = setTimeout(() => { try { mapRef.current?.invalidateSize(false) } catch { /* */ } }, 250)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [layoutKey])

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="absolute inset-0" />
      {validas.length === 0 && (
        <ChartEmptyState overlay message="Nenhuma foto com GPS no filtro atual" />
      )}
      {hover && hover.fotos.length > 0 && (
        <FotoMapHoverCard fotos={hover.fotos} position={hover.pos} />
      )}
    </div>
  )
}
