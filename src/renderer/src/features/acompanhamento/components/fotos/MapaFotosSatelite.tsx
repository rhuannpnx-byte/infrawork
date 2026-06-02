import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Supercluster from 'supercluster'
import type { FotoEnriquecida, SequenciaAtaque } from '@/types/acompanhamento'
import { corDeServico } from '@/types/acompanhamento'
import type { ObraTrecho } from '@/types/gerencial'
import { FotoMapHoverCard, type PinFoto } from './FotoMapHoverCard'
import { MapaConfigPopover } from './MapaConfigPopover'
import { AvisoProducaoSemFoto } from './AvisoProducaoSemFoto'
import { MapaLegenda, type LegendaItem } from './MapaLegenda'
import type { DiaSemFoto } from '../../lib/sequencia-ataque'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'
import { addBaseMapEsri, aplicarVisibilidadeBase, type BaseMapLayers } from '@/lib/leaflet/tiles'
import { gerarMarcadoresControle, decimarPorZoom, type MarcadorControle } from '../../lib/projecao-trecho'
import { useMapaPrefsStore } from '../../stores/mapa-prefs'

interface Props {
  fotos: FotoEnriquecida[]
  onPickFoto?: (idx: number) => void
  layoutKey?: string
  trechos?: ObraTrecho[]
  sequencias?: SequenciaAtaque[]
  /** Grupos de produção sem foto (alerta), exibidos quando a sequência está ligada. */
  avisosSemFoto?: DiaSemFoto[]
  showConfig?: boolean
}

interface HoverState { pos: { x: number; y: number }; fotos: PinFoto[] }

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
  ))
}

function fmtDiaBR(s: string): string {
  try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') } catch { return s }
}

/** Etiqueta fixa (HTML) com os dados estruturados de uma seta de ataque. */
function etiquetaSeqHtml(seq: SequenciaAtaque): string {
  const ini = seq.ini.marcador ? `${esc(seq.ini.marcador)}` : 's/ trecho'
  const fim = seq.fim.marcador ? `${esc(seq.fim.marcador)}` : 's/ trecho'
  const sub = [seq.frente, seq.encarregado].filter(Boolean).map(esc).join(' · ')
  const sentido = seq.sentido ? ` <span style="color:#6b7280">(${seq.sentido})</span>` : ''
  const qtd = seq.qtdTotal > 0 ? seq.qtdTotal.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'
  const linhas = [
    `<div style="font-weight:600;color:#fff">${esc(seq.servico ?? 'Serviço —')} <span style="color:#9ca3af;font-weight:400">· ${esc(fmtDiaBR(seq.dia))}</span></div>`,
    sub ? `<div style="color:#9ca3af">${sub}</div>` : '',
    `<div style="color:#e5e7eb">${ini} <span style="color:#6b7280">→</span> ${fim}${sentido}</div>`,
    `<div style="color:#9ca3af">Dist ${esc(seq.distanciaFmt ?? '—')} · Qtd ${qtd}</div>`,
    seq.trechoNome ? `<div style="color:#6b7280">${esc(seq.trechoNome)}</div>` : ''
  ].filter(Boolean).join('')
  return `<div style="transform:translate(-50%,-118%);display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:10px;line-height:1.35;background:rgba(11,23,38,.93);border:1px solid rgba(255,255,255,.18);border-left:3px solid ${seq.cor};border-radius:4px;padding:4px 7px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.55)">${linhas}</div>`
}

let LeafletModule: typeof import('leaflet') | null = null
async function loadLeaflet(): Promise<typeof import('leaflet')> {
  if (LeafletModule) return LeafletModule
  const m = await import('leaflet')
  await import('leaflet/dist/leaflet.css')
  LeafletModule = m
  return m
}

interface PointProps { cluster: boolean; point_count?: number; fotoIdx?: number; cor?: string; cores?: Record<string, number> }
type Valida = Omit<FotoEnriquecida, 'lat' | 'lng'> & { lat: number; lng: number; _idx: number }

function corDominante(cores: Record<string, number> | undefined): string {
  if (!cores) return '#67e8f9'
  let melhor = '#67e8f9'; let max = -1
  for (const k in cores) if (cores[k] > max) { max = cores[k]; melhor = k }
  return melhor
}

export function MapaFotosSatelite({
  fotos, onPickFoto, layoutKey, trechos = [], sequencias = [], avisosSemFoto = [], showConfig = true
}: Props): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const LRef = useRef<typeof import('leaflet') | null>(null)
  const baseLayersRef = useRef<BaseMapLayers | null>(null)
  const fotosLayerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const trechosLayerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const seqLayerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const supRef = useRef<Supercluster<PointProps> | null>(null)
  const supSigRef = useRef<string>('')
  const seqRendererRef = useRef<import('leaflet').Renderer | null>(null)
  const marcadoresRef = useRef<Map<string, MarcadorControle[]>>(new Map())
  const [ready, setReady] = useState(false)

  const [hover, setHover] = useState<HoverState | null>(null)

  // Callbacks/dados acessados pelos renders via ref (sempre o valor atual).
  const onPickRef = useRef(onPickFoto); onPickRef.current = onPickFoto

  const corPor = useMapaPrefsStore((s) => s.corPor)
  const mostrarFotos = useMapaPrefsStore((s) => s.mostrarFotos)
  const mostrarKmzTrechos = useMapaPrefsStore((s) => s.mostrarKmzTrechos)
  const mostrarSequenciaAtaque = useMapaPrefsStore((s) => s.mostrarSequenciaAtaque)
  const mostrarLegenda = useMapaPrefsStore((s) => s.mostrarLegenda)
  const camadaSatelite = useMapaPrefsStore((s) => s.camadaSatelite)
  const camadaFronteiras = useMapaPrefsStore((s) => s.camadaFronteiras)
  const camadaRodovias = useMapaPrefsStore((s) => s.camadaRodovias)

  const validas = useMemo<Valida[]>(
    () => fotos.flatMap((f, idx) => (f.lat != null && f.lng != null ? [{ ...f, lat: f.lat, lng: f.lng, _idx: idx }] : [])),
    [fotos]
  )
  const fotosByIdx = useMemo(() => {
    const m = new Map<number, FotoEnriquecida>()
    for (let i = 0; i < fotos.length; i++) m.set(i, fotos[i])
    return m
  }, [fotos])

  // Itens da legenda (cor → o que representa), adaptados às camadas ativas.
  const legendaFotos = useMemo<LegendaItem[]>(() => {
    if (!mostrarFotos) return []
    const m = new Map<string, { label: string; cor: string; count: number }>()
    for (const f of fotos) {
      if (f.lat == null || f.lng == null) continue
      const cor = corPor === 'servico'
        ? corDeServico(f.siga_servico_id ?? f.servico_display_nome)
        : (f.equipe_display_cor ?? '#67e8f9')
      const label = corPor === 'servico'
        ? (f.servico_display_nome ?? f.siga_servico_nome ?? '—')
        : (f.equipe_display_nome ?? '—')
      const k = `${cor}|${label}`
      const e = m.get(k) ?? { label, cor, count: 0 }
      e.count++; m.set(k, e)
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [fotos, corPor, mostrarFotos])

  const legendaTrechos = useMemo<LegendaItem[]>(() =>
    (mostrarKmzTrechos ? trechos : [])
      .filter((t) => t.geometry_geojson?.coordinates?.length)
      .map((t) => ({ label: t.nome, cor: t.cor || '#38bdf8' })),
  [trechos, mostrarKmzTrechos])

  // Refs com os dados/prefs atuais p/ os renders chamados no zoom/pan.
  const st = useRef({
    validas, fotosByIdx, trechos, sequencias,
    corPor, mostrarFotos, mostrarKmzTrechos, mostrarSequenciaAtaque
  })
  st.current = { validas, fotosByIdx, trechos, sequencias, corPor, mostrarFotos, mostrarKmzTrechos, mostrarSequenciaAtaque }

  const toPinFoto = (f: FotoEnriquecida): PinFoto => ({
    id: f.id, captured_at: f.captured_at, servico_display_nome: f.servico_display_nome, siga_servico_nome: f.siga_servico_nome
  })
  const corDaFoto = (v: Valida, cp: string): string =>
    cp === 'servico' ? corDeServico(v.siga_servico_id ?? v.servico_display_nome) : (v.equipe_display_cor ?? '#67e8f9')

  // ── Render: FOTOS (cluster) ──
  const renderFotos = (): void => {
    const L = LRef.current, map = mapRef.current, lay = fotosLayerRef.current
    if (!L || !map || !lay) return
    lay.clearLayers()
    const { validas, fotosByIdx, mostrarFotos, corPor } = st.current
    if (!mostrarFotos) { supRef.current = null; supSigRef.current = ''; return }

    const sig = `${corPor}|${validas.length}|${validas[0]?._idx ?? ''}|${validas[validas.length - 1]?._idx ?? ''}`
    if (!supRef.current || supSigRef.current !== sig) {
      const sup = new Supercluster<PointProps>({
        radius: 60, maxZoom: 18,
        map: (p) => ({ cores: { [p.cor ?? '#67e8f9']: 1 } }),
        reduce: (acc, p) => { const c = p.cores ?? {}; acc.cores = acc.cores ?? {}; for (const k in c) acc.cores![k] = (acc.cores![k] ?? 0) + c[k] }
      })
      sup.load(validas.map((v) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
        properties: { cluster: false, fotoIdx: v._idx, cor: corDaFoto(v, corPor) }
      })))
      supRef.current = sup
      supSigRef.current = sig
    }
    const sup = supRef.current
    const bnd = map.getBounds()
    const bbox: [number, number, number, number] = [bnd.getWest(), bnd.getSouth(), bnd.getEast(), bnd.getNorth()]
    for (const c of sup.getClusters(bbox, Math.round(map.getZoom()))) {
      const [lng, lat] = c.geometry.coordinates
      if (c.properties.cluster) {
        const count = c.properties.point_count ?? 0
        const cor = corDominante(c.properties.cores)
        const tam = count >= 100 ? 38 : count >= 10 ? 32 : 26
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:${tam}px;height:${tam}px;border-radius:50%;background:${cor};color:#fff;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.5);text-shadow:0 1px 2px rgba(0,0,0,.7)">${count}</div>`,
          iconSize: [tam, tam], iconAnchor: [tam / 2, tam / 2]
        })
        const m = L.marker([lat, lng], { icon })
        const clusterId = c.id as number
        m.on('mouseover', (ev) => {
          const me = ev as unknown as { originalEvent: MouseEvent }
          const leaves = sup.getLeaves(clusterId, 30, 0)
          const fc: PinFoto[] = leaves.flatMap((l) => {
            const idx = (l.properties as PointProps).fotoIdx
            if (idx == null) return []
            const f = st.current.fotosByIdx.get(idx)
            return f ? [toPinFoto(f)] : []
          })
          if (fc.length) setHover({ pos: { x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 }, fotos: fc })
        })
        m.on('mousemove', (ev) => { const me = ev as unknown as { originalEvent: MouseEvent }; setHover((p) => p ? { ...p, pos: { x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 } } : p) })
        m.on('mouseout', () => setHover(null))
        m.on('click', () => { setHover(null); map.setView([lat, lng], Math.min(sup.getClusterExpansionZoom(clusterId), 18), { animate: true }) })
        m.addTo(lay)
      } else {
        const cor = c.properties.cor ?? '#67e8f9'
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${cor};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5)"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7]
        })
        const m = L.marker([lat, lng], { icon })
        const idxFoto = c.properties.fotoIdx
        m.on('mouseover', (ev) => {
          const me = ev as unknown as { originalEvent: MouseEvent }
          if (idxFoto == null) return
          const f = fotosByIdx.get(idxFoto); if (!f) return
          setHover({ pos: { x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 }, fotos: [toPinFoto(f)] })
        })
        m.on('mousemove', (ev) => { const me = ev as unknown as { originalEvent: MouseEvent }; setHover((p) => p ? { ...p, pos: { x: me.originalEvent.clientX + 12, y: me.originalEvent.clientY + 12 } } : p) })
        m.on('mouseout', () => setHover(null))
        m.on('click', () => { setHover(null); if (idxFoto != null) onPickRef.current?.(idxFoto) })
        m.addTo(lay)
      }
    }
  }

  // ── Render: TRECHOS (KMZ) + marcadores de controle (km/estaca) ──
  const renderTrechos = (): void => {
    const L = LRef.current, map = mapRef.current, lay = trechosLayerRef.current
    if (!L || !map || !lay) return
    lay.clearLayers()
    const { trechos, mostrarKmzTrechos } = st.current
    if (!mostrarKmzTrechos) return
    const centerLat = map.getCenter().lat
    const zoom = map.getZoom()
    for (const t of trechos) {
      const geom = t.geometry_geojson
      if (!geom || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) continue
      const cor = t.cor || '#38bdf8'
      const latLngs = geom.coordinates.map((c) => [c[1], c[0]] as [number, number])
      L.polyline(latLngs, { color: cor, weight: 3, opacity: 0.9 })
        .bindTooltip(t.nome, { sticky: true, direction: 'top', className: 'leaflet-tooltip-marker' })
        .addTo(lay)
      // Início / fim
      L.circleMarker(latLngs[0], { radius: 5, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }).addTo(lay)
      L.circleMarker(latLngs[latLngs.length - 1], { radius: 5, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }).addTo(lay)
      // Marcadores de controle km/estaca (cache + decimação por zoom)
      let marcs = marcadoresRef.current.get(t.id)
      if (!marcs) { marcs = gerarMarcadoresControle(t); marcadoresRef.current.set(t.id, marcs) }
      for (const m of decimarPorZoom(marcs, zoom, centerLat)) {
        L.circleMarker([m.lat, m.lng], { radius: 3, color: '#fff', weight: 1, fillColor: cor, fillOpacity: 0.9 })
          .bindTooltip(m.label, { permanent: true, direction: 'top', offset: [0, -5], className: 'leaflet-tooltip-marker' })
          .addTo(lay)
      }
    }
  }

  // ── Render: SEQUÊNCIA DE ATAQUE ──
  const renderSeq = (): void => {
    const L = LRef.current, map = mapRef.current, lay = seqLayerRef.current
    if (!L || !map || !lay) return
    lay.clearLayers()
    const { sequencias, mostrarSequenciaAtaque } = st.current
    if (!mostrarSequenciaAtaque) return
    const rnd = seqRendererRef.current ?? undefined
    const PANE = 'seqAtaque'
    for (const seq of sequencias) {
      const a: [number, number] = [seq.ini.lat, seq.ini.lng]
      const b: [number, number] = [seq.fim.lat, seq.fim.lng]
      // Tail: casca branca + linha colorida (contraste sobre satélite e trecho).
      L.polyline([a, b], { pane: PANE, renderer: rnd, interactive: false, color: '#fff', weight: 7, opacity: 0.95, lineCap: 'round' }).addTo(lay)
      L.polyline([a, b], { pane: PANE, renderer: rnd, interactive: false, color: seq.cor, weight: 4, opacity: 1, lineCap: 'round' }).addTo(lay)
      // Origem: foto inicial.
      L.circleMarker(a, { pane: PANE, renderer: rnd, interactive: false, radius: 5, color: '#fff', weight: 2, fillColor: seq.cor, fillOpacity: 1 }).addTo(lay)
      // Ponta da flecha na foto final, apontando o sentido. Dois triângulos
      // sobrepostos: um branco (contorno) atrás + o colorido na frente. Fica
      // acima da cauda (marker é DOM posterior ao <svg> das linhas na pane).
      const ang = (Math.atan2(seq.fim.lng - seq.ini.lng, seq.fim.lat - seq.ini.lat) * 180) / Math.PI
      const setaIcon = L.divIcon({
        className: '',
        html: `<div style="position:relative;width:24px;height:24px;transform:rotate(${ang}deg);transform-origin:50% 60%;filter:drop-shadow(0 0 2px rgba(0,0,0,.7))">
          <div style="position:absolute;left:0;top:0;width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:22px solid #fff"></div>
          <div style="position:absolute;left:2px;top:3px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:18px solid ${seq.cor}"></div>
        </div>`,
        iconSize: [24, 24], iconAnchor: [12, 14]
      })
      L.marker(b, { pane: PANE, icon: setaIcon, interactive: false }).addTo(lay)
      // Etiqueta FIXA — pane mais alta (acima da seta).
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      L.marker(mid, {
        pane: 'seqAtaqueCard',
        interactive: false,
        icon: L.divIcon({ className: '', html: etiquetaSeqHtml(seq), iconSize: [0, 0], iconAnchor: [0, 0] })
      }).addTo(lay)
    }
  }

  // ── Init (uma vez) ──
  useEffect(() => {
    let canceled = false
    void (async () => {
      if (!ref.current) return
      const L = await loadLeaflet()
      if (canceled || !ref.current) return
      LRef.current = L
      if (!mapRef.current) {
        const map = L.map(ref.current, { preferCanvas: true, maxZoom: 18, worldCopyJump: true }).setView([-15.78, -47.93], 4)
        baseLayersRef.current = addBaseMapEsri(map, L)
        mapRef.current = map
        // Pane dedicada p/ a sequência de ataque ACIMA de fotos (600) e tooltips
        // (650), pra a seta e os cards ficarem por cima de tudo.
        map.createPane('seqAtaque')
        const sp = map.getPane('seqAtaque')
        if (sp) { sp.style.zIndex = '680'; sp.style.pointerEvents = 'none' }
        // Pane ainda mais alta só pros cards (acima da seta).
        map.createPane('seqAtaqueCard')
        const cp = map.getPane('seqAtaqueCard')
        if (cp) { cp.style.zIndex = '690'; cp.style.pointerEvents = 'none' }
        seqRendererRef.current = L.svg({ pane: 'seqAtaque' })
        trechosLayerRef.current = L.layerGroup().addTo(map)
        seqLayerRef.current = L.layerGroup().addTo(map)
        fotosLayerRef.current = L.layerGroup().addTo(map)
        // Re-render do que depende de zoom/pan (clusters + decimação de marcadores).
        map.on('moveend zoomend', () => { renderFotos(); renderTrechos() })
      }
      if (!canceled) setReady(true)
    })()
    return () => { canceled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Sync de dados/prefs → atualiza camadas sem recriar o mapa ──
  useEffect(() => {
    if (!ready || !mapRef.current || !baseLayersRef.current) return
    aplicarVisibilidadeBase(mapRef.current, baseLayersRef.current, { camadaSatelite, camadaFronteiras, camadaRodovias })
    renderTrechos()
    renderSeq()
    renderFotos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, validas, sequencias, corPor, mostrarFotos, mostrarKmzTrechos, mostrarSequenciaAtaque, camadaSatelite, camadaFronteiras, camadaRodovias])

  // Trechos mudaram → limpa cache de marcadores e re-renderiza.
  useEffect(() => {
    marcadoresRef.current.clear()
    if (ready) renderTrechos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trechos, ready])

  // ── Auto-fit: só quando o conjunto de fotos/trechos muda ──
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current; if (!map) return
    const pts: Array<[number, number]> = validas.map((v) => [v.lat, v.lng])
    if (pts.length === 0) {
      for (const t of trechos) {
        const g = t.geometry_geojson
        if (g?.coordinates) for (const c of g.coordinates) pts.push([c[1], c[0]])
      }
    }
    if (pts.length === 0) { map.setView([-15.78, -47.93], 4, { animate: false }); return }
    const lats = pts.map((p) => p[0]); const lngs = pts.map((p) => p[1])
    const south = Math.min(...lats), north = Math.max(...lats), west = Math.min(...lngs), east = Math.max(...lngs)
    if ((north - south) < 0.001 && (east - west) < 0.001) map.setView([lats[0], lngs[0]], 16, { animate: false })
    else map.fitBounds([[south, west], [north, east]], { padding: [40, 40], maxZoom: 16, animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, validas, trechos])

  // ResizeObserver — invalida tamanho quando o container muda.
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

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }, [])

  useEffect(() => {
    if (!mapRef.current) return
    const t1 = setTimeout(() => { try { mapRef.current?.invalidateSize(false) } catch { /* */ } }, 50)
    const t2 = setTimeout(() => { try { mapRef.current?.invalidateSize(false) } catch { /* */ } }, 250)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [layoutKey])

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="absolute inset-0" />
      {showConfig && (
        <div className="absolute top-2 right-2 z-[400] flex items-center gap-1.5">
          {mostrarSequenciaAtaque && <AvisoProducaoSemFoto avisos={avisosSemFoto} />}
          <MapaConfigPopover />
        </div>
      )}
      {mostrarFotos && validas.length === 0 && (
        <ChartEmptyState overlay message="Nenhuma foto com GPS no filtro atual" />
      )}
      {mostrarLegenda && (
      <div className="absolute bottom-2 left-2 z-[400]">
        <MapaLegenda
          corPor={corPor}
          mostrarFotos={mostrarFotos}
          mostrarKmz={mostrarKmzTrechos}
          mostrarSeq={mostrarSequenciaAtaque}
          fotos={legendaFotos}
          trechos={legendaTrechos}
        />
      </div>
      )}
      {hover && hover.fotos.length > 0 && <FotoMapHoverCard fotos={hover.fotos} position={hover.pos} />}
    </div>
  )
}
