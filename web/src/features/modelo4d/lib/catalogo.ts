import type { Material } from './contrato'

/**
 * Catálogo de projetos-tipo: a seção de cada dispositivo pelo código que o projeto usa ("STC 73-15", "MFC 03",
 * "VPAC 160-30"). As medidas saem do próprio código (largura e profundidade em centímetros) quando ele as traz.
 *
 * Os perfis são polígonos fechados em (lateral, vertical), com a lateral positiva para fora da pista e o zero
 * vertical no nível em que a peça é assentada.
 */

export type Perfil = [lateral: number, vertical: number][]

export interface Dispositivo {
  familia: string
  perfil: Perfil
  largura: number
  material: Material
  /** Onde a peça fica na seção. */
  posicao: 'sarjeta' | 'meio-fio' | 'crista' | 'pe' | 'dreno'
}

const numero = (t: string): number => Number(t.replace(/\./g, '').replace(',', '.'))

/** Sarjeta triangular: lado da pista suave, lado do talude 1:1. */
function sarjetaTriangular(w: number, h: number): Perfil {
  const t = 0.08
  const fundo = Math.max(-w / 4, w / 2 - h)
  return [
    [-w / 2, -h - t],
    [-w / 2, 0],
    [fundo, -h],
    [w / 2, 0],
    [w / 2, -h - t]
  ]
}

/** Valeta trapezoidal revestida, com as abas apoiadas no terreno. */
function valeta(w: number, h: number): Perfil {
  const b = Math.max(0.3, w - 2 * h)
  const aba = 0.12
  const t = 0.08
  return [
    [-w / 2 - aba, -h - t],
    [-w / 2 - aba, 0.04],
    [-w / 2, 0.04],
    [-b / 2, -h],
    [b / 2, -h],
    [w / 2, 0.04],
    [w / 2 + aba, 0.04],
    [w / 2 + aba, -h - t]
  ]
}

/** Meio-fio com sarjeta conjugada: a sarjeta do lado da pista e o espelho do meio-fio no zero lateral. */
const MEIO_FIO_SARJETA: Perfil = [
  [-0.3, -0.15],
  [-0.3, 0],
  [0, -0.04],
  [0, 0.15],
  [0.12, 0.15],
  [0.15, -0.15]
]

const MEIO_FIO: Perfil = [
  [0, -0.3],
  [0, 0.12],
  [0.03, 0.15],
  [0.15, 0.15],
  [0.15, -0.3]
]

/** Dispositivo de drenagem linear pelo código do projeto; `null` quando a família não está no catálogo. */
export function dispositivoDeDrenagem(tipo: string): Dispositivo | null {
  const t = tipo.trim().toUpperCase()
  const familia = /^[A-Z]+/.exec(t)?.[0] ?? ''
  const m = /(\d+(?:[.,]\d+)?)\s*[-xX]\s*(\d+(?:[.,]\d+)?)\s*$/.exec(t)
  const w = m ? numero(m[1]) / 100 : 0
  const h = m ? numero(m[2]) / 100 : 0
  if (/^STC|^SCC/.test(familia)) {
    const larg = w || 1
    return {
      familia,
      perfil: sarjetaTriangular(larg, h || 0.15),
      largura: larg,
      material: 'concreto',
      posicao: 'sarjeta'
    }
  }
  if (/^SZC|^SZG/.test(familia)) {
    const larg = w || 1.2
    return {
      familia,
      perfil: valeta(larg, h || 0.25),
      largura: larg,
      material: familia.endsWith('G') ? 'grama' : 'concreto',
      posicao: 'sarjeta'
    }
  }
  if (/^MFC/.test(familia))
    return {
      familia,
      perfil: MEIO_FIO_SARJETA,
      largura: 0.45,
      material: 'concreto',
      posicao: 'meio-fio'
    }
  if (/^MF/.test(familia))
    return { familia, perfil: MEIO_FIO, largura: 0.15, material: 'concreto', posicao: 'meio-fio' }
  if (/^VP[AC]/.test(familia)) {
    const larg = w || 1.2
    return {
      familia,
      perfil: valeta(larg, h || 0.3),
      largura: larg + 0.24,
      material: familia.endsWith('G') ? 'grama' : 'concreto',
      posicao: familia[2] === 'C' ? 'crista' : 'pe'
    }
  }
  if (/^DP|^DS/.test(familia))
    return {
      familia,
      perfil: [
        [-0.2, -0.2],
        [-0.2, 0.2],
        [0.2, 0.2],
        [0.2, -0.2]
      ],
      largura: 0.4,
      material: 'concreto',
      posicao: 'dreno'
    }
  return null
}

/** Canal em U da descida d'água pelo talude. */
export const CANAL_DESCIDA: Perfil = [
  [-0.4, -0.06],
  [-0.4, 0.22],
  [-0.3, 0.22],
  [-0.3, 0.04],
  [0.3, 0.04],
  [0.3, 0.22],
  [0.4, 0.22],
  [0.4, -0.06]
]

/** Lâmina da defensa metálica, com o zero vertical no topo do pavimento. */
export const LAMINA_DEFENSA: Perfil = [
  [-0.04, 0.45],
  [0.04, 0.45],
  [0.04, 0.78],
  [-0.04, 0.78]
]

/** Espelha um perfil para o lado esquerdo da pista, mantendo o sentido do contorno. */
export const espelhar = (p: Perfil): Perfil =>
  p.map(([x, z]): [number, number] => [-x, z]).reverse()

export const subir = (p: Perfil, dz: number): Perfil =>
  p.map(([x, z]): [number, number] => [x, z + dz])

/** Chapa da placa pelo código de sinalização (R-1, A-2b, indicativas) e pelas medidas escritas no projeto. */
export function chapaDaPlaca(
  codigo: string,
  dim = ''
): {
  forma: 'circulo' | 'losango' | 'octogono' | 'triangulo' | 'retangulo'
  largura: number
  altura?: number
  material: Material
} {
  const medidas = [...dim.matchAll(/\d+(?:,\d+)?/g)].map((x) => numero(x[0]))
  if (/^R-1$/.test(codigo)) return { forma: 'octogono', largura: 0.75, material: 'sinal-vermelho' }
  if (/^R-2$/.test(codigo)) return { forma: 'triangulo', largura: 0.9, material: 'sinal-vermelho' }
  if (/^R-/.test(codigo))
    return {
      forma: 'circulo',
      largura: Math.max(0.6, (medidas[0] ?? 0.4) * 1.6),
      material: 'sinal-vermelho'
    }
  if (/^A-/.test(codigo)) return { forma: 'losango', largura: 1.0, material: 'sinal-amarelo' }
  if (/^M[QP]/.test(codigo))
    return { forma: 'retangulo', largura: 0.5, altura: 0.7, material: 'sinal-azul' }
  return {
    forma: 'retangulo',
    largura: Math.min(3.5, medidas[0] ?? 1.2),
    altura: Math.min(1.5, medidas[1] ?? 0.6),
    material: 'sinal-verde'
  }
}
