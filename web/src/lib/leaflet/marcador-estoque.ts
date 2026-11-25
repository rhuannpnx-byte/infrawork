// Marcadores do mapa de estoque. Ficam sobre a foto de satélite, que não muda com o tema: as cores são fixas (como as
// dos outros mapas desta pasta) e o status nunca depende só da cor — o rótulo traz o nome, o percentual e um sinal.

export type StatusMarcador = 'normal' | 'baixo' | 'zerado' | 'negativo' | 'sem_saldo'

const COR: Record<StatusMarcador, string> = {
  normal: '#15803d',
  baixo: '#b45309',
  zerado: '#b91c1c',
  negativo: '#b91c1c',
  sem_saldo: '#4b5563'
}
const SINAL: Record<StatusMarcador, string> = {
  normal: '',
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

/**
 * HTML do marcador de um ativo: etiqueta com o nome e o nível, haste e ponto no local. O tanque tem a marca
 * quadrada e o depósito, triangular. `selecionado` engrossa o contorno.
 */
export function htmlMarcadorEstoque(a: {
  nome: string
  tipo: 'tanque' | 'deposito'
  status: StatusMarcador
  /** texto do nível, já formatado ("61%"), ou vazio quando não há saldo */
  nivel: string
  selecionado: boolean
}): string {
  const cor = COR[a.status]
  const marca =
    a.tipo === 'tanque'
      ? `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${cor};margin-right:5px"></span>`
      : `<span style="display:inline-block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${cor};margin-right:5px"></span>`
  const texto = `${escapar(a.nome)}${a.nivel ? ` · ${escapar(a.nivel)}` : ''}${SINAL[a.status]}`
  return (
    `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:pointer">` +
    `<div style="display:flex;align-items:center;background:${FOLHA};color:${TINTA};border:${a.selecionado ? 3 : 2}px solid ${cor};border-radius:6px;padding:2px 7px;font:600 12px/1.3 system-ui,sans-serif;white-space:nowrap;box-shadow:${SOMBRA}">${marca}${texto}</div>` +
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
