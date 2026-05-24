import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Supercluster from 'supercluster'
import { MapPin, ArrowUpRight, Image as ImageIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { getSignedUrls } from '@/features/acompanhamento/hooks/fotos'

interface PinFoto {
  id: string
  lat: number | null
  lng: number | null
  captured_at: string | null
  servico_display_nome: string | null
  siga_servico_nome: string | null
  equipe_display_cor: string | null
  storage_bucket: string | null
  storage_key: string | null
}

interface Props {
  fotos: PinFoto[]
  altura?: number
}

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
  fotoId?: string
  cor?: string
}

interface HoverState { id: string; x: number; y: number }

export function MapaFotosDashboard({ fotos, altura = 300 }: Props): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const supRef = useRef<Supercluster<ClusterPointProps> | null>(null)
  const navigate = useNavigate()
  const [hover, setHover] = useState<HoverState | null>(null)
  const [hoverUrl, setHoverUrl] = useState<string | null>(null)

  type FotoValida = Omit<PinFoto, 'lat' | 'lng'> & { lat: number; lng: number }
  const validas = useMemo<FotoValida[]>(
    () => fotos.flatMap((f) => (f.lat != null && f.lng != null ? [{ ...f, lat: f.lat, lng: f.lng }] : [])),
    [fotos]
  )

  // Mapa por ID para resolver hover
  const fotoById = useMemo(() => {
    const m = new Map<string, PinFoto>()
    for (const f of fotos) m.set(f.id, f)
    return m
  }, [fotos])

  // Pré-carrega URL ao detectar hover (debounce implícito do supercluster)
  useEffect(() => {
    if (!hover) { setHoverUrl(null); return }
    let canceled = false
    void getSignedUrls([hover.id]).then((u) => { if (!canceled) setHoverUrl(u[hover.id] ?? null) })
    return () => { canceled = true }
  }, [hover])

  useEffect(() => {
    let canceled = false
    void (async () => {
      if (!ref.current) return
      const L = await loadLeaflet()
      if (canceled || !ref.current) return
      if (!mapRef.current) {
        const map = L.map(ref.current, { preferCanvas: true, maxZoom: 18, worldCopyJump: true })
          .setView([-15.78, -47.93], 4)
        L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { maxZoom: 18, maxNativeZoom: 18, attribution: 'Tiles © Esri' }
        ).addTo(map)
        mapRef.current = map
      }
      const map = mapRef.current!

      const sup = new Supercluster<ClusterPointProps>({ radius: 60, maxZoom: 18 })
      sup.load(
        validas.map((v) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
          properties: { cluster: false, fotoId: v.id, cor: v.equipe_display_cor ?? '#67e8f9' }
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
            m.on('click', () => {
              const z = Math.min(sup.getClusterExpansionZoom(c.id as number), 18)
              map.setView([lat, lng], z, { animate: true })
            })
            m.addTo(lay)
          } else {
            const cor = c.properties.cor ?? '#67e8f9'
            const fid = c.properties.fotoId
            const icon = L.divIcon({
              className: '',
              html: `<div style="width:14px;height:14px;border-radius:50%;background:${cor};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7]
            })
            const m = L.marker([lat, lng], { icon })
            if (fid) {
              m.on('mouseover', (ev) => {
                const me = ev as unknown as { originalEvent: MouseEvent }
                setHover({ id: fid, x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 })
              })
              m.on('mousemove', (ev) => {
                const me = ev as unknown as { originalEvent: MouseEvent }
                setHover({ id: fid, x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 })
              })
              m.on('mouseout', () => setHover(null))
              m.on('click', () => {
                navigate({ to: '/acompanhamento/fotos' })
              })
            }
            m.addTo(lay)
          }
        }
      }
      map.off('moveend zoomend')
      map.on('moveend zoomend', render)

      // Auto-fit
      if (validas.length > 0) {
        const lats = validas.map((v) => v.lat); const lngs = validas.map((v) => v.lng)
        const south = Math.min(...lats); const north = Math.max(...lats)
        const west = Math.min(...lngs); const east = Math.max(...lngs)
        if ((north - south) < 0.001 && (east - west) < 0.001) {
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
  }, [validas, navigate])

  useEffect(() => () => {
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
  }, [])

  // ResizeObserver + window resize
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fire = (): void => {
      const tryInvalidate = (n: number): void => {
        const m = mapRef.current
        if (m) { try { m.invalidateSize(false) } catch { /* */ } return }
        if (n > 0) setTimeout(() => tryInvalidate(n - 1), 80)
      }
      tryInvalidate(5)
    }
    const ro = new ResizeObserver(fire)
    ro.observe(el)
    window.addEventListener('resize', fire)
    const t = setTimeout(fire, 50)
    return () => { ro.disconnect(); window.removeEventListener('resize', fire); clearTimeout(t) }
  }, [])

  const fotoHover = hover ? fotoById.get(hover.id) ?? null : null

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
        <div ref={ref} className="absolute inset-0" />
        {validas.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-text-dim text-2xs font-mono pointer-events-none">
            Nenhuma foto com GPS
          </div>
        )}
        <div className="absolute bottom-1 right-2 text-[9px] text-white/70 font-mono pointer-events-none">
          Esri Satélite
        </div>
      </div>

      {hover && fotoHover && createPortal(
        <div
          className="fixed z-[200] pointer-events-none rounded border border-border-strong shadow-2xl bg-bg-elevated overflow-hidden animate-fade-in"
          style={{
            left: Math.min(hover.x, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 280),
            top: Math.min(hover.y, (typeof window !== 'undefined' ? window.innerHeight : 9999) - 240),
            width: 260
          }}
        >
          {hoverUrl ? (
            <img src={hoverUrl} alt="" className="w-full block" style={{ maxHeight: 180, objectFit: 'cover' }} />
          ) : (
            <div className="w-full h-[150px] flex items-center justify-center text-text-dim">
              <ImageIcon size={24} />
            </div>
          )}
          <div className="p-2 space-y-0.5">
            <div className="text-2xs font-mono text-text truncate" title={fotoHover.servico_display_nome ?? ''}>
              {fotoHover.servico_display_nome ?? fotoHover.siga_servico_nome ?? '—'}
            </div>
            <div className="text-2xs font-mono text-text-dim">
              {fotoHover.captured_at ? new Date(fotoHover.captured_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
