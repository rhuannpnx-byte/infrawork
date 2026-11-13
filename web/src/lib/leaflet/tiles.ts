// Helper compartilhado pra adicionar a "base map" do InfraWork em qualquer
// instancia Leaflet. Trio de tiles Esri:
//
//   1) World_Imagery — satelite (fundo)
//   2) World_Boundaries_and_Places — divisas politicas + nomes de cidades
//   3) World_Transportation — rodovias + ferrovias + numero de BR
//
// As duas layers de referencia sao PNG com fundo transparente. Empilhar elas
// por cima do satelite da o mesmo efeito do "Hybrid" do Google Maps.
//
// Esri Reference layers: gratis pra uso comum, sem chave. Documentado em
// https://server.arcgisonline.com/arcgis/rest/services/Reference

const ESRI_IMAGERY =
  'https://{s}.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const ESRI_BOUNDARIES_PLACES =
  'https://{s}.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

const ESRI_TRANSPORTATION =
  'https://{s}.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'

/**
 * Ladrilhos carregados além da borda da tela, em cada lado. Com 3, uma tela de 1440×900 busca uma área de
 * cerca de 12×10 ladrilhos em vez de 6×4: o arraste rápido já encontra o entorno pronto. O Leaflet ordena a
 * fila pela distância ao centro, então o que está na tela chega primeiro.
 */
const BORDA_LADRILHOS = 3

/**
 * Opções comuns: carrega durante o arraste e guarda os ladrilhos já baixados ao redor da vista. A Esri
 * serve os mesmos ladrilhos em dois endereços, por HTTP/1.1 (o navegador abre só 6 conexões por endereço):
 * repartir entre os dois dobra o que baixa em paralelo. O endereço de cada ladrilho é fixo, então o cache
 * do navegador continua valendo.
 */
const OPCOES_LADRILHOS = {
  subdomains: ['server', 'services'],
  maxZoom: 18,
  maxNativeZoom: 18,
  updateWhenIdle: false,
  updateWhenZooming: false,
  updateInterval: 100,
  keepBuffer: BORDA_LADRILHOS + 6
}

type ConstrutorCamada = new (
  url: string,
  opcoes: import('leaflet').TileLayerOptions
) => import('leaflet').TileLayer

const camadaComBorda = new WeakMap<typeof import('leaflet'), ConstrutorCamada>()

/**
 * TileLayer que pede ao Leaflet uma área maior que a tela (o mesmo recurso do plugin Leaflet.EdgeBuffer):
 * amplia os limites em pixels que a camada usa para decidir quais ladrilhos buscar.
 */
function construtorComBorda(L: typeof import('leaflet')): ConstrutorCamada {
  const pronto = camadaComBorda.get(L)
  if (pronto) return pronto
  type Interno = {
    _getTiledPixelBounds: (centro: import('leaflet').LatLng) => import('leaflet').Bounds
  }
  const original = (L.TileLayer.prototype as unknown as Interno)._getTiledPixelBounds
  const Classe = (L.TileLayer as unknown as { extend: (props: object) => ConstrutorCamada }).extend(
    {
      _getTiledPixelBounds(
        this: import('leaflet').TileLayer,
        centro: import('leaflet').LatLng
      ): import('leaflet').Bounds {
        const limites = original.call(this, centro)
        const borda = this.getTileSize().multiplyBy(BORDA_LADRILHOS)
        return L.bounds(limites.min!.subtract(borda), limites.max!.add(borda))
      }
    }
  )
  camadaComBorda.set(L, Classe)
  return Classe
}

export interface BaseMapLayers {
  satelite: import('leaflet').TileLayer
  fronteiras: import('leaflet').TileLayer
  rodovias: import('leaflet').TileLayer
}

/** Visibilidade de cada camada base — espelha o store de preferências do mapa. */
export interface BaseMapVisibilidade {
  camadaSatelite: boolean
  camadaFronteiras: boolean
  camadaRodovias: boolean
}

/**
 * Cria e adiciona ao mapa: satelite + divisas/cidades + rodovias. Ordem importa:
 * satelite vai no fundo, labels por cima. Todas começam visíveis.
 *
 * Retorna as referências das 3 TileLayers para que o chamador possa alternar a
 * visibilidade via `aplicarVisibilidadeBase`. Chamadores que ignoram o retorno
 * continuam com o comportamento antigo (tudo visível).
 *
 * Use sempre que precisar de uma "base" rica pra context geografico
 * brasileiro (BR-XXX, capitais, divisas estaduais).
 */
export function addBaseMapEsri(
  map: import('leaflet').Map,
  L: typeof import('leaflet')
): BaseMapLayers {
  const Camada = construtorComBorda(L)
  const satelite = new Camada(ESRI_IMAGERY, OPCOES_LADRILHOS).addTo(map)
  const fronteiras = new Camada(ESRI_BOUNDARIES_PLACES, {
    ...OPCOES_LADRILHOS,
    opacity: 0.95
  }).addTo(map)
  const rodovias = new Camada(ESRI_TRANSPORTATION, { ...OPCOES_LADRILHOS, opacity: 0.95 }).addTo(
    map
  )
  return { satelite, fronteiras, rodovias }
}

/** Adiciona/remove cada camada base do mapa conforme as preferências. */
export function aplicarVisibilidadeBase(
  map: import('leaflet').Map,
  layers: BaseMapLayers,
  vis: BaseMapVisibilidade
): void {
  const aplicar = (layer: import('leaflet').TileLayer, visivel: boolean): void => {
    if (visivel) {
      if (!map.hasLayer(layer)) layer.addTo(map)
    } else if (map.hasLayer(layer)) {
      map.removeLayer(layer)
    }
  }
  aplicar(layers.satelite, vis.camadaSatelite)
  aplicar(layers.fronteiras, vis.camadaFronteiras)
  aplicar(layers.rodovias, vis.camadaRodovias)
}
