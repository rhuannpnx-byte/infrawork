// Marcadores do mapa de estoque. Ficam sobre a foto de satélite, que não muda com o tema: as cores são fixas (como as
// dos outros mapas desta pasta) e o status nunca depende só da cor — o rótulo traz o nome, o percentual e um sinal.

export type StatusMarcador = 'normal' | 'atencao' | 'baixo' | 'zerado' | 'negativo' | 'sem_saldo'

// verde: com folga; amarelo: até 20% acima do mínimo; vermelho: no mínimo ou abaixo dele, zerado ou negativo
const COR: Record<StatusMarcador, string> = {
  normal: '#15803d',
  atencao: '#ca8a04',
  baixo: '#b91c1c',
  zerado: '#b91c1c',
  negativo: '#b91c1c',
  sem_saldo: '#4b5563'
}
const SINAL: Record<StatusMarcador, string> = {
  normal: '',
  atencao: ' ▽',
  baixo: ' ▼',
  zerado: ' !',
  negativo: ' !',
  sem_saldo: ''
}
const FOLHA = '#ffffff'
const TINTA = '#111827'
const SOMBRA = '0 1px 4px rgba(0,0,0,.55)'

const escapar = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Cor do status, para o contorno do traçado ou de outro desenho no mesmo mapa. */
export const corDoStatus = (status: StatusMarcador): string => COR[status]

/** O desenho do ativo em vista de arame (de `features/estoque/lib/arame3d`), já na ordem de pintura. */
export interface DesenhoMarcador {
  largura: number
  altura: number
  tracos: Array<{ tipo: 'corpo' | 'linha' | 'fina' | 'nivel' | 'espelho' | 'vazio'; d: string }>
}

/** O desenho em SVG: o corpo em traço, o material na cor do status e o espelho dele (no tanque) mais claro. */
function svgDoDesenho(d: DesenhoMarcador, cor: string): string {
  const caminhos = d.tracos
    .map((t) => {
      if (t.tipo === 'corpo')
        return `<path d="${t.d}" fill="${FOLHA}" stroke="${TINTA}" stroke-width="1.2" stroke-linejoin="round"/>`
      if (t.tipo === 'nivel') return `<path d="${t.d}" fill="${cor}" fill-opacity=".72"/>`
      if (t.tipo === 'vazio') return `<path d="${t.d}" fill="${FOLHA}"/>`
      if (t.tipo === 'espelho')
        return `<path d="${t.d}" fill="${FOLHA}" fill-opacity=".45" stroke="${cor}" stroke-width=".9" stroke-linejoin="round"/>`
      return `<path d="${t.d}" fill="none" stroke="${TINTA}" stroke-width="${t.tipo === 'linha' ? 0.9 : 0.6}" stroke-opacity="${t.tipo === 'linha' ? 1 : 0.75}" stroke-linejoin="round" stroke-linecap="round"/>`
    })
    .join('')
  return `<svg width="${d.largura}" height="${d.altura}" viewBox="0 0 ${d.largura} ${d.altura}" aria-hidden="true" style="display:block">${caminhos}</svg>`
}

/**
 * HTML do marcador de um ativo: o desenho do tanque (no formato do cadastro) ou do monte, cheio até o nível do
 * estoque, com o nome e o percentual embaixo, a haste e o ponto no local. `selecionado` engrossa o contorno.
 */
export function htmlMarcadorEstoque(a: {
  nome: string
  status: StatusMarcador
  /** texto do nível, já formatado ("61%"), ou vazio quando não há saldo */
  nivel: string
  selecionado: boolean
  desenho: DesenhoMarcador
}): string {
  const cor = COR[a.status]
  const texto = `${escapar(a.nome)}${a.nivel ? ` · ${escapar(a.nivel)}` : ''}${SINAL[a.status]}`
  return (
    `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:pointer">` +
    `<div style="display:flex;flex-direction:column;align-items:center;background:${FOLHA};color:${TINTA};border:${a.selecionado ? 3 : 2}px solid ${cor};border-radius:8px;padding:2px 7px 3px;font:600 12px/1.3 system-ui,sans-serif;white-space:nowrap;box-shadow:${SOMBRA}">${svgDoDesenho(a.desenho, cor)}<span>${texto}</span></div>` +
    `<div style="width:2px;height:9px;background:${cor}"></div>` +
    `<div style="width:10px;height:10px;border-radius:50%;background:${cor};border:2px solid ${FOLHA};box-shadow:${SOMBRA}"></div>` +
    `</div>`
  )
}

/** HTML do alfinete do mapa de escolher o ponto. */
export function htmlAlfinete(): string {
  const cor = '#1d4ed8'
  return (
    `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;cursor:grab">` +
    `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${cor};border:2px solid ${FOLHA};box-shadow:${SOMBRA}"></div>` +
    `<div style="width:6px;height:6px;border-radius:50%;background:${FOLHA};margin-top:-16px;margin-bottom:10px"></div>` +
    `</div>`
  )
}

/** Cor do traçado da obra desenhado ao fundo, só como referência. */
export const COR_TRACADO_FUNDO = '#fbbf24'

/**
 * Painel das marcações do traçado (km, estaca…). Fica acima da linha e abaixo dos marcadores do estoque, para o
 * rótulo de um km nunca cobrir o desenho de um tanque.
 */
const PAINEL_MARCACOES = 'marcacoes-tracado'

export function prepararPainelMarcacoes(map: import('leaflet').Map): void {
  const painel = map.getPane(PAINEL_MARCACOES) ?? map.createPane(PAINEL_MARCACOES)
  painel.style.zIndex = '450'
  painel.style.pointerEvents = 'none'
}

/** Uma marcação do traçado: o ponto sobre a linha e o rótulo ("km 5", "EST 120") sempre à vista. */
export function desenharMarcacao(
  L: typeof import('leaflet'),
  camada: import('leaflet').LayerGroup,
  m: { lat: number; lng: number; label: string }
): void {
  L.circleMarker([m.lat, m.lng], {
    pane: PAINEL_MARCACOES,
    interactive: false,
    radius: 4,
    color: FOLHA,
    weight: 1.5,
    fillColor: COR_TRACADO_FUNDO,
    fillOpacity: 1
  })
    .bindTooltip(escapar(m.label), {
      pane: PAINEL_MARCACOES,
      permanent: true,
      direction: 'top',
      offset: [0, -5]
    })
    .addTo(camada)
}
