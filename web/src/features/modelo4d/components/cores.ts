import type { Material } from '../lib/contrato'

export type Rgb = [r: number, g: number, b: number]

let tela: CanvasRenderingContext2D | null = null

/** Cor de um token do tema em sRGB de 0 a 1 (o tema é em oklch, que a cena 3D não lê). */
export function cor(nome: string): Rgb {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(`--${nome}`).trim()
  tela ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!tela || !valor) return [0.5, 0.5, 0.5]
  tela.clearRect(0, 0, 1, 1)
  tela.fillStyle = valor
  tela.fillRect(0, 0, 1, 1)
  const [r, g, b] = tela.getImageData(0, 0, 1, 1).data
  return [r / 255, g / 255, b / 255]
}

export const mistura = (a: Rgb, b: Rgb, f: number): Rgb => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
  a[2] + (b[2] - a[2]) * f
]

/** Cor de cada material do contrato, lida do tema. */
export function coresDosMateriais(): Record<Material, Rgb> {
  return {
    corte: cor('m4d-corte'),
    aterro: cor('m4d-aterro'),
    solo: cor('m4d-solo'),
    granular: cor('m4d-granular'),
    betume: cor('m4d-betume'),
    asfalto: cor('m4d-asfalto'),
    concreto: cor('m4d-concreto'),
    metal: cor('m4d-metal'),
    madeira: cor('m4d-madeira'),
    grama: cor('m4d-grama'),
    'sinal-branco': cor('m4d-sinal-branco'),
    'sinal-amarelo': cor('m4d-sinal-amarelo'),
    'sinal-vermelho': cor('m4d-sinal-vermelho'),
    'sinal-verde': cor('m4d-sinal-verde'),
    'sinal-azul': cor('m4d-sinal-azul'),
    contexto: cor('m4d-contexto')
  }
}
