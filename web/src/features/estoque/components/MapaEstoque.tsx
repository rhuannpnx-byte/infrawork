// Mapas do estoque: o da página (um marcador por ativo, com o status) e o de escolher o ponto no cadastro.
// Leaflet carregado sob demanda, no mesmo fundo de satélite dos outros mapas, com o traçado da obra como referência.

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { loadLeaflet } from '@/lib/leaflet/carregar'
import { addBaseMapEsri } from '@/lib/leaflet/tiles'
import {
  COR_TRACADO_FUNDO,
  htmlAlfinete,
  htmlMarcadorEstoque
} from '@/lib/leaflet/marcador-estoque'
import { cn } from '@/lib/utils'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { linhaDoTrecho, poligonoDoTrecho } from '@/features/planejamento/lib/trecho'
import type { ObraTrecho } from '@/types/gerencial'
import type { AtivoEstoque } from '../tipos'

type Mapa = import('leaflet').Map
type Leaflet = typeof import('leaflet')
type Ponto = [number, number]

const BRASIL: { centro: Ponto; zoom: number } = { centro: [-15.78, -47.93], zoom: 4 }

/** Linhas e contornos da obra em [lat, lng], para desenhar ao fundo e enquadrar o mapa. */
function tracadosDaObra(trechos: ObraTrecho[]): Ponto[][] {
  const out: Ponto[][] = []
  for (const t of trechos) {
    const linha = linhaDoTrecho(t)
    if (linha && linha.coordinates.length >= 2)
      out.push(linha.coordinates.map((c) => [c[1], c[0]] as Ponto))
    const anel = poligonoDoTrecho(t)?.coordinates[0]
    if (anel && anel.length >= 3) out.push(anel.map((c) => [c[1], c[0]] as Ponto))
  }
  return out
}

function criarMapa(L: Leaflet, el: HTMLElement): Mapa {
  const map = L.map(el, { zoomControl: false, attributionControl: false, maxZoom: 18 })
  L.control.zoom({ zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map)
  addBaseMapEsri(map, L)
  return map
}

function enquadrar(L: Leaflet, map: Mapa, pontos: Ponto[]): void {
  if (pontos.length === 0) map.setView(BRASIL.centro, BRASIL.zoom)
  else if (pontos.length === 1) map.setView(pontos[0], 16)
  else map.fitBounds(L.latLngBounds(pontos), { padding: [36, 36], maxZoom: 17 })
}

/** Texto do nível no marcador: "61%", ou vazio quando o ativo ainda não tem saldo. */
const textoNivel = (a: AtivoEstoque): string =>
  a.nivel == null ? '' : `${Math.round(a.nivel * 100)}%`

interface MapaEstoqueProps {
  obraId: string
  ativos: AtivoEstoque[]
  selecionadoId: string | null
  aoSelecionar: (id: string) => void
  className?: string
}

/** Mapa da página: cada tanque e depósito no seu ponto, com o nome, o nível e o status. */
export function MapaEstoque({
  obraId,
  ativos,
  selecionadoId,
  aoSelecionar,
  className
}: MapaEstoqueProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Mapa | null>(null)
  const LRef = useRef<Leaflet | null>(null)
  const camadaRef = useRef<import('leaflet').LayerGroup | null>(null)
  const enquadradoRef = useRef<string>('')
  const selecionarRef = useRef(aoSelecionar)
  useEffect(() => {
    selecionarRef.current = aoSelecionar
  })
  // o mapa carrega depois dos dados ou antes: `pronto` dispara o desenho quando ele passa a existir
  const [pronto, setPronto] = useState(false)
  const { data: trechos } = useObraTrechos(obraId)
  const tracados = useMemo(() => tracadosDaObra(trechos ?? []), [trechos])

  // cria o mapa uma vez; as camadas são redesenhadas sem recriá-lo
  useEffect(() => {
    let cancelado = false
    let observador: ResizeObserver | null = null
    void (async () => {
      const L = await loadLeaflet()
      if (cancelado || !ref.current) return
      const map = criarMapa(L, ref.current)
      map.setView(BRASIL.centro, BRASIL.zoom)
      LRef.current = L
      mapRef.current = map
      camadaRef.current = L.layerGroup().addTo(map)
      // o mapa nasce às vezes com a caixa ainda sem tamanho (aba escondida): acerta quando ela ganha tamanho
      observador = new ResizeObserver(() => map.invalidateSize())
      observador.observe(ref.current)
      setPronto(true)
    })()
    return () => {
      cancelado = true
      observador?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
      camadaRef.current = null
    }
  }, [])

  function desenhar(): void {
    const L = LRef.current
    const map = mapRef.current
    const camada = camadaRef.current
    if (!L || !map || !camada) return
    camada.clearLayers()
    for (const t of tracados)
      L.polyline(t, {
        color: COR_TRACADO_FUNDO,
        weight: 3,
        opacity: 0.85,
        interactive: false
      }).addTo(camada)
    for (const a of ativos) {
      const marcador = L.marker([a.lat, a.lng], {
        icon: L.divIcon({
          className: '',
          iconSize: [0, 0],
          html: htmlMarcadorEstoque({
            nome: a.nome,
            tipo: a.tipo,
            status: a.status,
            nivel: textoNivel(a),
            selecionado: a.id === selecionadoId
          })
        }),
        keyboard: true,
        title: a.nome,
        alt: `${a.nome}, ${textoNivel(a) || 'sem saldo'}`,
        zIndexOffset: a.id === selecionadoId ? 1000 : 0
      })
      marcador.on('click', () => selecionarRef.current(a.id))
      marcador.addTo(camada)
    }
    // enquadra de novo só quando muda o conjunto de ativos ou o traçado (clicar num ativo não mexe no mapa)
    const chave = `${ativos.map((a) => `${a.id}:${a.lat}:${a.lng}`).join('|')}#${tracados.length}`
    if (chave !== enquadradoRef.current) {
      enquadradoRef.current = chave
      const pontos = ativos.map((a) => [a.lat, a.lng] as Ponto)
      enquadrar(L, map, pontos.length > 0 ? pontos : tracados.flat())
    }
  }

  useEffect(() => {
    desenhar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, ativos, tracados, selecionadoId])

  return (
    <div
      ref={ref}
      role="application"
      aria-label="Mapa dos tanques e depósitos da obra"
      className={cn('h-full min-h-[320px] w-full', className)}
    />
  )
}

interface MapaEscolherPontoProps {
  obraId: string
  valor: { lat: number; lng: number } | null
  aoMudar: (ponto: { lat: number; lng: number }) => void
  altura?: number
}

/** Mapa do cadastro: clique para marcar onde o ativo fica; o alfinete também pode ser arrastado. */
export function MapaEscolherPonto({
  obraId,
  valor,
  aoMudar,
  altura = 300
}: MapaEscolherPontoProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Mapa | null>(null)
  const LRef = useRef<Leaflet | null>(null)
  const alfineteRef = useRef<import('leaflet').Marker | null>(null)
  const fundoRef = useRef<import('leaflet').LayerGroup | null>(null)
  const enquadradoRef = useRef(false)
  const mudarRef = useRef(aoMudar)
  useEffect(() => {
    mudarRef.current = aoMudar
  })
  const [pronto, setPronto] = useState(false)
  const { data: trechos } = useObraTrechos(obraId)
  const tracados = useMemo(() => tracadosDaObra(trechos ?? []), [trechos])
  const seis = (v: number): number => Math.round(v * 1e6) / 1e6

  useEffect(() => {
    let cancelado = false
    let observador: ResizeObserver | null = null
    void (async () => {
      const L = await loadLeaflet()
      if (cancelado || !ref.current) return
      const map = criarMapa(L, ref.current)
      map.setView(BRASIL.centro, BRASIL.zoom)
      LRef.current = L
      mapRef.current = map
      fundoRef.current = L.layerGroup().addTo(map)
      map.on('click', (e) => mudarRef.current({ lat: seis(e.latlng.lat), lng: seis(e.latlng.lng) }))
      observador = new ResizeObserver(() => map.invalidateSize())
      observador.observe(ref.current)
      setPronto(true)
    })()
    return () => {
      cancelado = true
      observador?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
      alfineteRef.current = null
      fundoRef.current = null
    }
  }, [])

  function atualizar(): void {
    const L = LRef.current
    const map = mapRef.current
    const fundo = fundoRef.current
    if (!L || !map || !fundo) return
    fundo.clearLayers()
    for (const t of tracados)
      L.polyline(t, {
        color: COR_TRACADO_FUNDO,
        weight: 3,
        opacity: 0.85,
        interactive: false
      }).addTo(fundo)
    if (valor) {
      if (!alfineteRef.current) {
        const alfinete = L.marker([valor.lat, valor.lng], {
          draggable: true,
          keyboard: false,
          icon: L.divIcon({ className: '', iconSize: [0, 0], html: htmlAlfinete() })
        }).addTo(map)
        alfinete.on('dragend', () => {
          const p = alfinete.getLatLng()
          mudarRef.current({ lat: seis(p.lat), lng: seis(p.lng) })
        })
        alfineteRef.current = alfinete
      } else alfineteRef.current.setLatLng([valor.lat, valor.lng])
    } else if (alfineteRef.current) {
      alfineteRef.current.remove()
      alfineteRef.current = null
    }
    // enquadra uma vez: no ponto já marcado, ou na obra; depois o usuário manda no mapa
    if (!enquadradoRef.current && (valor || tracados.length > 0)) {
      enquadradoRef.current = true
      enquadrar(L, map, valor ? [[valor.lat, valor.lng]] : tracados.flat())
    }
  }

  useEffect(() => {
    atualizar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, valor?.lat, valor?.lng, tracados])

  return (
    <div
      ref={ref}
      role="application"
      aria-label="Mapa para marcar o local: clique no ponto ou arraste o alfinete"
      style={{ height: altura }}
      className="w-full overflow-hidden rounded border border-border"
    />
  )
}
