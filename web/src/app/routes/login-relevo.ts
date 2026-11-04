/**
 * Relevo sintético para o wallpaper do login: campo de ruído fractal (Perlin
 * 2D, 3 oitavas) amostrado numa grade de células e extração de curvas de nível
 * por marching squares. Coordenadas em unidades de célula.
 */

export interface Isolinhas {
  /** Segmentos [x1, y1, x2, y2, …] das curvas comuns. */
  normais: Float32Array
  /** Segmentos das curvas mestras (a cada N curvas). */
  mestras: Float32Array
}

export interface Relevo {
  /** Valor do campo (≈ −1…1) em coordenadas de célula, interpolado. */
  valor(x: number, y: number): number
  /** Curvas de nível nas cotas `deslocamento + k × equidistancia`. */
  isolinhas(equidistancia: number, deslocamento: number, mestraACada: number): Isolinhas
}

const ESCALA = 1 / 52 // células por "morro" (~470 px com célula de 9 px)
const OITAVAS = 3
const GANHO = 0.42 // peso de cada oitava sobre a anterior (menor = relevo mais liso)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function criarPerlin(rand: () => number): (x: number, y: number) => number {
  const p = new Uint8Array(512)
  const base = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[base[i], base[j]] = [base[j], base[i]]
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
  const grad = (h: number, x: number, y: number): number => {
    switch (h & 7) {
      case 0:
        return x + y
      case 1:
        return x - y
      case 2:
        return -x + y
      case 3:
        return -x - y
      case 4:
        return x
      case 5:
        return -x
      case 6:
        return y
      default:
        return -y
    }
  }
  return (x, y) => {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)
    const aa = p[p[xi] + yi]
    const ab = p[p[xi] + yi + 1]
    const ba = p[p[xi + 1] + yi]
    const bb = p[p[xi + 1] + yi + 1]
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf))
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1))
    return x1 + v * (x2 - x1)
  }
}

export function createRelevo(colunas: number, linhas: number, seed = Date.now()): Relevo {
  const perlin = criarPerlin(mulberry32(seed))
  const campo = new Float32Array(colunas * linhas)
  for (let j = 0; j < linhas; j++) {
    for (let i = 0; i < colunas; i++) {
      let soma = 0
      let amp = 1
      let freq = ESCALA
      for (let o = 0; o < OITAVAS; o++) {
        soma += perlin(i * freq + 17.3, j * freq + 9.1) * amp
        amp *= GANHO
        freq *= 2
      }
      // leve caimento diagonal: dá "direção" ao terreno, como um vale
      campo[j * colunas + i] = soma + (i / colunas - j / linhas) * 0.25
    }
  }

  // mínimo/máximo por célula: só visita as cotas que a célula realmente cruza
  const nc = colunas - 1
  const nl = linhas - 1
  const minC = new Float32Array(nc * nl)
  const maxC = new Float32Array(nc * nl)
  for (let j = 0; j < nl; j++) {
    for (let i = 0; i < nc; i++) {
      const a = campo[j * colunas + i]
      const b = campo[j * colunas + i + 1]
      const c = campo[(j + 1) * colunas + i + 1]
      const d = campo[(j + 1) * colunas + i]
      minC[j * nc + i] = Math.min(a, b, c, d)
      maxC[j * nc + i] = Math.max(a, b, c, d)
    }
  }

  const at = (i: number, j: number): number => campo[j * colunas + i]

  return {
    valor(x, y) {
      const i = Math.max(0, Math.min(nc - 1, Math.floor(x)))
      const j = Math.max(0, Math.min(nl - 1, Math.floor(y)))
      const fx = Math.max(0, Math.min(1, x - i))
      const fy = Math.max(0, Math.min(1, y - j))
      const top = at(i, j) * (1 - fx) + at(i + 1, j) * fx
      const bot = at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx
      return top * (1 - fy) + bot * fy
    },

    isolinhas(eq, desloc, mestraACada) {
      const normais: number[] = []
      const mestras: number[] = []
      for (let j = 0; j < nl; j++) {
        for (let i = 0; i < nc; i++) {
          const ci = j * nc + i
          const k0 = Math.ceil((minC[ci] - desloc) / eq)
          const k1 = Math.floor((maxC[ci] - desloc) / eq)
          if (k1 < k0) continue
          const tl = at(i, j)
          const tr = at(i + 1, j)
          const br = at(i + 1, j + 1)
          const bl = at(i, j + 1)
          for (let k = k0; k <= k1; k++) {
            const L = desloc + k * eq
            const out = ((k % mestraACada) + mestraACada) % mestraACada === 0 ? mestras : normais
            const aTL = tl >= L
            const aTR = tr >= L
            const aBR = br >= L
            const aBL = bl >= L
            const cTop = aTL !== aTR
            const cRight = aTR !== aBR
            const cBot = aBL !== aBR
            const cLeft = aTL !== aBL
            const topX = i + (L - tl) / (tr - tl)
            const rightY = j + (L - tr) / (br - tr)
            const botX = i + (L - bl) / (br - bl)
            const leftY = j + (L - tl) / (bl - tl)
            if (cTop && cRight && cBot && cLeft) {
              // sela: decide pela média do centro
              const centro = (tl + tr + br + bl) / 4 >= L
              if (aTL === centro) {
                out.push(topX, j, i + 1, rightY, botX, j + 1, i, leftY)
              } else {
                out.push(i, leftY, topX, j, i + 1, rightY, botX, j + 1)
              }
              continue
            }
            const pts: number[] = []
            if (cTop) pts.push(topX, j)
            if (cRight) pts.push(i + 1, rightY)
            if (cBot) pts.push(botX, j + 1)
            if (cLeft) pts.push(i, leftY)
            if (pts.length === 4) out.push(pts[0], pts[1], pts[2], pts[3])
          }
        }
      }
      return { normais: new Float32Array(normais), mestras: new Float32Array(mestras) }
    }
  }
}
