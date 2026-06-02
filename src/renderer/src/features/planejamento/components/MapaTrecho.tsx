// MapaTrecho — render reusavel de UMA polilinha em Leaflet.
//
// Lazy-load do Leaflet (pattern de MiniMapaSatelite). Tile layer: Esri Satellite.
// Marcadores INICIO/FIM sempre desenhados. Marcadores de referencia (km/estaca/etc)
// opcionais via prop `marcadores`.
//
// Anima seta percorrendo a linha quando `animarSeta=true` (commit separado).

import { type ReactNode, useEffect, useRef } from 'react'
import along from '@turf/along'
import length from '@turf/length'
import { lineString as turfLineString } from '@turf/helpers'
import { addBaseMapEsri } from '@/lib/leaflet/tiles'

// Lazy-load — pattern compartilhado com MiniMapaSatelite.tsx
let LeafletModule: typeof import('leaflet') | null = null
async function loadLeaflet(): Promise<typeof import('leaflet')> {
  if (LeafletModule) return LeafletModule
  const m = await import('leaflet')
  await import('leaflet/dist/leaflet.css')
  LeafletModule = m
  return m
}

export interface MapaTrechoMarcador {
  /** Posicao em metros ao longo da polilinha (do inicio). */
  posicaoM: number
  /** Label exibido como tooltip permanente. Ex: "km 5", "EST 12". */
  label: string
}

interface Props {
  /** GeoJSON LineString. Coordenadas em [lng, lat]. Ordem ja "aplicada" pelo caller. */
  geometry: GeoJSON.LineString
  /** Cor da polilinha (hex). */
  cor: string
  /** Marcadores intermediarios (km/estaca/etc). Inicio e fim sao sempre desenhados separadamente. */
  marcadores?: MapaTrechoMarcador[]
  /** True = ativa animacao de seta (rAF + interpolacao). Default false. */
  animarSeta?: boolean
  /** True = permite zoom/pan/scroll. False (default) = mapa estatico fitted aos bounds. */
  interactive?: boolean
  /** Altura em pixels. Default 400. */
  altura?: number
  className?: string
}

export function MapaTrecho({
  geometry,
  cor,
  marcadores = [],
  animarSeta = false,
  interactive = false,
  altura = 400,
  className
}: Props): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const setaRef = useRef<import('leaflet').Marker | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    let canceled = false
    void (async () => {
      if (!ref.current) return
      const L = await loadLeaflet()
      if (canceled || !ref.current) return

      // Limpa instancia anterior (re-render por prop change).
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }

      const map = L.map(ref.current, {
        zoomControl: interactive,
        attributionControl: false,
        dragging: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        keyboard: interactive,
        touchZoom: interactive,
        maxZoom: 18
      })
      addBaseMapEsri(map, L)
      mapRef.current = map

      const coords = geometry.coordinates
      if (coords.length < 2) {
        map.setView([-15.78, -47.93], 4)
        return
      }

      // Leaflet usa [lat, lng]; GeoJSON usa [lng, lat]. Inverte.
      const latLngs: Array<[number, number]> = coords.map((c) => [c[1], c[0]])

      L.polyline(latLngs, { color: cor, weight: 4, opacity: 0.9 }).addTo(map)

      // Marcadores INICIO + FIM (sempre).
      const inicio = latLngs[0]
      const fim = latLngs[latLngs.length - 1]
      L.circleMarker(inicio, {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#22c55e',
        fillOpacity: 1
      })
        .bindTooltip('INÍCIO', { permanent: true, direction: 'top', className: 'leaflet-tooltip-inicio' })
        .addTo(map)
      L.circleMarker(fim, {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 1
      })
        .bindTooltip('FIM', { permanent: true, direction: 'top', className: 'leaflet-tooltip-fim' })
        .addTo(map)

      // Comprimento da linha (km) — usado em marcadores e animacao. Calcula uma vez.
      const lineFeature = turfLineString(coords)
      const comprimentoKm = length(lineFeature, { units: 'kilometers' })
      const comprimentoM = comprimentoKm * 1000

      // Cache de posicoes lat/lng pra cada marcador — evita recalcular @turf/along
      // em cada zoom-change.
      type MarcadorComPos = MapaTrechoMarcador & { lat: number; lng: number }
      const marcadoresComPos: MarcadorComPos[] = []
      for (const m of marcadores) {
        if (m.posicaoM <= 0.5 || m.posicaoM >= comprimentoM - 0.5) continue
        const pt = along(lineFeature, m.posicaoM, { units: 'meters' })
        marcadoresComPos.push({
          ...m,
          lat: pt.geometry.coordinates[1],
          lng: pt.geometry.coordinates[0]
        })
      }

      // Layer group dedicado pros marcadores intermediarios — permite limpar
      // e redesenhar em zoom-change sem mexer no polyline/inicio/fim/seta.
      const marcadoresLayer = L.layerGroup().addTo(map)
      const redesenharMarcadores = (): void => {
        marcadoresLayer.clearLayers()
        if (marcadoresComPos.length === 0) return
        const centerLat = map.getCenter().lat
        const visiveis = filtrarPorZoom(marcadoresComPos, map.getZoom(), centerLat)
        for (const m of visiveis) {
          L.circleMarker([m.lat, m.lng], {
            radius: 4,
            color: '#ffffff',
            weight: 1,
            fillColor: cor,
            fillOpacity: 0.9
          })
            .bindTooltip(m.label, {
              permanent: true,
              direction: 'top',
              offset: [0, -6],
              className: 'leaflet-tooltip-marker'
            })
            .addTo(marcadoresLayer)
        }
      }

      // Listener de zoom — redesenha conforme densidade visivel cabe.
      map.on('zoomend', redesenharMarcadores)
      // Primeiro render acontece depois do fit-bounds (zoom final ja definido).

      // Fit bounds aos coords.
      const lats = latLngs.map((c) => c[0])
      const lngs = latLngs.map((c) => c[1])
      map.fitBounds(
        [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)]
        ],
        { padding: [25, 25], maxZoom: 17, animate: false }
      )
      // Primeiro render dos marcadores ja com o zoom de fit-bounds aplicado.
      redesenharMarcadores()

      // Animacao de seta — desenha um L.marker com divIcon SVG triangle que
      // percorre a linha de 0 a comprimento em loop. Pausa quando animarSeta=false.
      if (animarSeta) {
        const duracaoCicloMs = 4000

        const setaIcon = L.divIcon({
          className: 'leaflet-seta-trecho',
          html: `<div style="
            width:0;height:0;
            border-left:8px solid transparent;
            border-right:8px solid transparent;
            border-bottom:14px solid ${cor};
            filter: drop-shadow(0 0 2px rgba(0,0,0,0.8));
            transform-origin:center 60%;
          " data-arrow></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })

        const startTime = performance.now()
        const seta = L.marker(inicio, { icon: setaIcon, interactive: false }).addTo(map)
        setaRef.current = seta

        const tick = (now: number): void => {
          const elapsed = (now - startTime) % duracaoCicloMs
          const progress = elapsed / duracaoCicloMs
          const distM = comprimentoM * progress

          const ptAtual = along(lineFeature, distM, { units: 'meters' })
          const [lngA, latA] = ptAtual.geometry.coordinates

          // Vetor de direcao: ponto a +10m vs atual (com clamp no fim).
          const distLookahead = Math.min(distM + 10, comprimentoM)
          const ptNext = along(lineFeature, distLookahead, { units: 'meters' })
          const [lngN, latN] = ptNext.geometry.coordinates
          const dx = lngN - lngA
          const dy = latN - latA
          // atan2 retorna em radianos; converte pra deg. Inverte sinal porque
          // o triangle aponta pra cima (norte) por default; rotaciona pra
          // alinhar com o vetor tangente.
          const angleRad = Math.atan2(dx, dy) // 0 = norte; cresce no sentido horario
          const angleDeg = (angleRad * 180) / Math.PI

          seta.setLatLng([latA, lngA])
          const el = seta.getElement()
          if (el) {
            const arrow = el.querySelector('[data-arrow]') as HTMLElement | null
            if (arrow) arrow.style.transform = `rotate(${angleDeg}deg)`
          }

          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      }
    })()

    return () => {
      canceled = true
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      setaRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, cor, animarSeta, interactive, JSON.stringify(marcadores)])

  return (
    <div
      ref={ref}
      className={className}
      style={{ height: altura, width: '100%', background: '#1a1a1a' }}
    />
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Decima marcadores conforme zoom — evita pile-up de tooltips quando o usuario
 * da zoom-out. Mantem o intervalo VISUAL entre marcadores >= MIN_PIXEL_SPACING.
 *
 * Web Mercator: 1 pixel ≈ 156543.03 × cos(lat) / 2^zoom metros (no equador,
 * x cos(lat) corrige pra latitudes maiores). Se 1 unidade no DB = X metros,
 * X / metros_por_pixel = pixels entre marcadores. Se < MIN, pula proporcional.
 */
const MIN_PIXEL_SPACING = 60

function filtrarPorZoom<T extends { posicaoM: number }>(
  todos: T[],
  zoom: number,
  centerLat: number
): T[] {
  if (todos.length <= 2) return todos

  // Distancia em metros entre dois marcadores consecutivos (assumindo grid uniforme).
  const passoMetros = todos.length > 1 ? todos[1].posicaoM - todos[0].posicaoM : 0
  if (passoMetros <= 0) return todos

  const metrosPorPixel =
    (156543.03 * Math.cos((centerLat * Math.PI) / 180)) / Math.pow(2, zoom)
  const passoPixels = passoMetros / metrosPorPixel

  // Se ja cabe (passo visual > spacing minimo), mostra todos.
  if (passoPixels >= MIN_PIXEL_SPACING) return todos

  // Calcula step: quantos marcadores pular pra cada um exibido.
  const step = Math.max(1, Math.ceil(MIN_PIXEL_SPACING / passoPixels))
  const out: T[] = []
  for (let i = 0; i < todos.length; i += step) {
    out.push(todos[i])
  }
  // Garante o ultimo se nao caiu na grade.
  if (out[out.length - 1] !== todos[todos.length - 1]) {
    out.push(todos[todos.length - 1])
  }
  return out
}

