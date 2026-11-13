// MapaTrecho — render reusavel de UMA polilinha em Leaflet.
//
// Leaflet carregado sob demanda. Tile layer: Esri Satellite.
// Marcadores INICIO/FIM sempre desenhados. Marcadores de referencia (km/estaca/etc)
// opcionais via prop `marcadores`.
//
// Anima seta percorrendo a linha quando `animarSeta=true` (commit separado).

import { type ReactNode, useEffect, useRef } from 'react'
import along from '@turf/along'
import length from '@turf/length'
import { lineString as turfLineString } from '@turf/helpers'
import { addBaseMapEsri } from '@/lib/leaflet/tiles'
import { loadLeaflet } from '@/lib/leaflet/carregar'
import { filtrarPorZoom } from '../lib/marcadores-mapa'

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
        zoomControl: false,
        attributionControl: false,
        dragging: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        keyboard: interactive,
        touchZoom: interactive,
        maxZoom: 18
      })
      if (interactive)
        L.control.zoom({ zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map)
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
        .bindTooltip('INÍCIO', {
          permanent: true,
          direction: 'top',
          className: 'leaflet-tooltip-inicio'
        })
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

        // um pouco antes do fim: no comprimento exato o `along` passa do último vértice e lança erro,
        // o que parava a animação no fim do primeiro ciclo
        const fimSeguro = Math.max(0, comprimentoM - 0.05)
        const tick = (now: number): void => {
          const elapsed = (now - startTime) % duracaoCicloMs
          const progress = elapsed / duracaoCicloMs
          const distM = Math.min(comprimentoM * progress, fimSeguro)

          try {
            const ptAtual = along(lineFeature, distM, { units: 'meters' })
            const [lngA, latA] = ptAtual.geometry.coordinates

            // Vetor de direcao: ponto a +10m vs atual (com clamp no fim).
            const distLookahead = Math.min(distM + 10, fimSeguro)
            const ptNext = along(lineFeature, distLookahead, { units: 'meters' })
            const [lngN, latN] = ptNext.geometry.coordinates
            const dx = lngN - lngA
            const dy = latN - latA

            seta.setLatLng([latA, lngA])
            // no último trecho o ponto à frente coincide com o atual: mantém o ângulo anterior
            if (dx !== 0 || dy !== 0) {
              // 0 = norte; cresce no sentido horario (o triângulo aponta para cima por padrão)
              const angleDeg = (Math.atan2(dx, dy) * 180) / Math.PI
              const arrow = seta.getElement()?.querySelector('[data-arrow]') as HTMLElement | null
              if (arrow) arrow.style.transform = `rotate(${angleDeg}deg)`
            }
          } catch {
            // geometria degenerada num quadro: segue para o próximo
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
