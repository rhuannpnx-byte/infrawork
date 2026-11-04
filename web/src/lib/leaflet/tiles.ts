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
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const ESRI_BOUNDARIES_PLACES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

const ESRI_TRANSPORTATION =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'

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
  const satelite = L.tileLayer(ESRI_IMAGERY, { maxZoom: 18, maxNativeZoom: 18 }).addTo(map)
  const fronteiras = L.tileLayer(ESRI_BOUNDARIES_PLACES, {
    maxZoom: 18,
    maxNativeZoom: 18,
    opacity: 0.95
  }).addTo(map)
  const rodovias = L.tileLayer(ESRI_TRANSPORTATION, {
    maxZoom: 18,
    maxNativeZoom: 18,
    opacity: 0.95
  }).addTo(map)
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
