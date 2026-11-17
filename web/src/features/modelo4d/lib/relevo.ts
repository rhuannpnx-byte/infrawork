import { geoParaUtm, utmParaGeo } from './geo'
import { cotaNaGrade, type ModeloPronto } from './preparar'

/** Mosaico de relevo de 256 × 256 pontos, em meios metros (Int16), no esquema XYZ da projeção de Mercator. */
export type MosaicoRelevo = Int16Array
export type FonteRelevo = (z: number, x: number, y: number) => Promise<MosaicoRelevo | null>

const LADO = 256
/** Zoom mais fino pedido à fonte: no relevo aberto de 30 m, além dele só há interpolação. */
const ZOOM_MAX = 13
/** Até esta distância do eixo vale o terreno do projeto; daí até `FORA`, ele se mistura ao relevo regional. */
const DENTRO = 60
const FORA = 140
/** Até onde o relevo regional é ajustado para encostar no terreno do projeto. */
const ALCANCE = 2500
const PASSO_AJUSTE = 250

const suave = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Relevo da cena: o levantamento do projeto na faixa da obra e, em volta, o relevo regional aberto (30 m),
 * deslocado para encostar no do projeto. Sem esse ajuste a obra apareceria num degrau, porque os dois
 * levantamentos diferem em alguns metros.
 */
export class RelevoRegional {
  private readonly cache = new Map<string, Promise<MosaicoRelevo | null>>()
  private ajuste: Promise<Float32Array[]> | null = null
  private readonly caixa: [number, number, number, number]

  constructor(
    private readonly modelo: ModeloPronto | null,
    private readonly fonte: FonteRelevo
  ) {
    let xa = Infinity
    let xb = -Infinity
    let na = Infinity
    let nb = -Infinity
    for (const e of modelo?.eixos ?? [])
      for (const p of e.p) {
        xa = Math.min(xa, p[1])
        xb = Math.max(xb, p[1])
        na = Math.min(na, p[2])
        nb = Math.max(nb, p[2])
      }
    this.caixa = [xa - ALCANCE, na - ALCANCE, xb + ALCANCE, nb + ALCANCE]
  }

  private mosaico(z: number, x: number, y: number): Promise<MosaicoRelevo | null> {
    const k = `${z}/${x}/${y}`
    let p = this.cache.get(k)
    if (p) {
      // usado de novo: volta para o fim da fila de descarte
      this.cache.delete(k)
    } else {
      p = this.fonte(z, x, y).catch(() => null)
      if (this.cache.size > 220) this.cache.delete(this.cache.keys().next().value as string)
    }
    this.cache.set(k, p)
    return p
  }

  /** Cotas do relevo regional nos pontos dados (graus), no zoom `z`. */
  private async regional(lons: Float64Array, lats: Float64Array, z: number): Promise<Float32Array> {
    const n = 2 ** z
    const fx = new Float64Array(lons.length)
    const fy = new Float64Array(lons.length)
    const precisa = new Map<string, [number, number]>()
    for (let i = 0; i < lons.length; i++) {
      const lat = Math.max(-85, Math.min(85, lats[i])) * (Math.PI / 180)
      fx[i] = ((lons[i] + 180) / 360) * n
      fy[i] = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n
      const tx = Math.min(n - 1, Math.max(0, Math.floor(fx[i])))
      const ty = Math.min(n - 1, Math.max(0, Math.floor(fy[i])))
      precisa.set(`${tx}/${ty}`, [tx, ty])
    }
    const mosaicos = new Map<string, MosaicoRelevo | null>()
    await Promise.all(
      [...precisa].map(async ([k, [tx, ty]]) => mosaicos.set(k, await this.mosaico(z, tx, ty)))
    )
    const out = new Float32Array(lons.length)
    for (let i = 0; i < lons.length; i++) {
      const tx = Math.min(n - 1, Math.max(0, Math.floor(fx[i])))
      const ty = Math.min(n - 1, Math.max(0, Math.floor(fy[i])))
      const m = mosaicos.get(`${tx}/${ty}`)
      if (!m) continue
      const px = Math.max(0, Math.min(LADO - 1.001, (fx[i] - tx) * LADO - 0.5))
      const py = Math.max(0, Math.min(LADO - 1.001, (fy[i] - ty) * LADO - 0.5))
      const ix = Math.floor(px)
      const iy = Math.floor(py)
      const ax = px - ix
      const ay = py - iy
      const v = (c: number, l: number): number => m[l * LADO + c]
      out[i] =
        ((v(ix, iy) * (1 - ax) + v(ix + 1, iy) * ax) * (1 - ay) +
          (v(ix, iy + 1) * (1 - ax) + v(ix + 1, iy + 1) * ax) * ay) /
        2
    }
    return out
  }

  /** Por eixo: diferença entre o terreno do projeto e o relevo regional a cada `PASSO_AJUSTE` metros. */
  private ajustes(): Promise<Float32Array[]> {
    this.ajuste ??= (async () => {
      const m = this.modelo!
      const o = m.modelo.origem!
      return Promise.all(
        m.eixos.map(async (e) => {
          const n = Math.max(2, Math.ceil((e.sMax - e.sMin) / PASSO_AJUSTE) + 1)
          const lons = new Float64Array(n)
          const lats = new Float64Array(n)
          const cota = new Float32Array(n)
          for (let i = 0; i < n; i++) {
            const q = e.em(e.sMin + i * PASSO_AJUSTE)
            const z = cotaNaGrade(m.grades, q.x, q.n, 'atual')
            cota[i] = Number.isNaN(z) ? q.z : z
            ;[lons[i], lats[i]] = utmParaGeo(q.x + o.e, q.n + o.n, m.fuso!)
          }
          const reg = await this.regional(lons, lats, ZOOM_MAX)
          const bruto = cota.map((c, i) => c - reg[i])
          // média de 3 pontos: o relevo de 30 m tem ruído de alguns metros
          return bruto.map((_, i) => {
            const a = bruto[Math.max(0, i - 1)]
            const b = bruto[Math.min(n - 1, i + 1)]
            return (a + bruto[i] + b) / 3
          })
        })
      )
    })()
    return this.ajuste
  }

  /**
   * Cotas de uma grade regular em graus, em linhas de norte para sul (o formato dos blocos de terreno do Cesium).
   * `nivel` é o nível do bloco na grade geográfica, de onde sai o zoom pedido à fonte.
   */
  async alturas(
    oeste: number,
    sul: number,
    leste: number,
    norte: number,
    largura: number,
    altura: number,
    nivel: number
  ): Promise<Float32Array> {
    const total = largura * altura
    const lons = new Float64Array(total)
    const lats = new Float64Array(total)
    for (let l = 0; l < altura; l++)
      for (let c = 0; c < largura; c++) {
        lons[l * largura + c] = oeste + ((leste - oeste) * c) / (largura - 1)
        lats[l * largura + c] = norte - ((norte - sul) * l) / (altura - 1)
      }
    const out = await this.regional(lons, lats, Math.max(0, Math.min(ZOOM_MAX, nivel - 1)))
    const m = this.modelo
    const o = m?.modelo.origem
    if (!m || !m.fuso || !o) return out

    // só os blocos que tocam a região da obra passam pelo ajuste
    const cantos = [
      geoParaUtm(oeste, sul, m.fuso),
      geoParaUtm(leste, norte, m.fuso),
      geoParaUtm(oeste, norte, m.fuso),
      geoParaUtm(leste, sul, m.fuso)
    ].map(([e, n]) => [e - o.e, n - o.n])
    const [xa, na, xb, nb] = this.caixa
    if (
      Math.max(...cantos.map((c) => c[0])) < xa ||
      Math.min(...cantos.map((c) => c[0])) > xb ||
      Math.max(...cantos.map((c) => c[1])) < na ||
      Math.min(...cantos.map((c) => c[1])) > nb
    )
      return out

    const ajustes = await this.ajustes()
    // amostras vizinhas caem perto do mesmo ponto do eixo: a de cima (ou a da esquerda) serve de dica e poupa
    // procurar no eixo inteiro. Só vale com as amostras próximas entre si (blocos de perto)
    const passo = ((norte - sul) * 111000) / (altura - 1)
    const dicas = m.eixos.map(() => new Int32Array(largura).fill(-1))
    for (let i = 0; i < total; i++) {
      const [e, n] = geoParaUtm(lons[i], lats[i], m.fuso)
      const x = e - o.e
      const y = n - o.n
      const c = i % largura
      if (x < xa || x > xb || y < na || y > nb) {
        for (const dica of dicas) dica[c] = -1
        continue
      }
      let d = Infinity
      let delta = 0
      m.eixos.forEach((eixo, ie) => {
        const dica = dicas[ie]
        const perto = passo > 150 ? -1 : dica[c] >= 0 ? dica[c] : c > 0 ? dica[c - 1] : -1
        const q = eixo.projetar(x, y, perto >= 0 ? perto : undefined)
        // longe do eixo a dica deixa de ser confiável: a próxima amostra procura de novo
        dica[c] = q.d < ALCANCE ? q.i : -1
        if (q.d >= d) return
        d = q.d
        const f = Math.max(0, (q.s - eixo.sMin) / PASSO_AJUSTE)
        const a = ajustes[ie]
        const k = Math.min(a.length - 2, Math.floor(f))
        delta = a[k] + (a[k + 1] - a[k]) * Math.min(1, f - k)
      })
      if (d > ALCANCE) continue
      const regional = out[i] + delta * (1 - suave(FORA, ALCANCE, d))
      const projeto = d < FORA ? cotaNaGrade(m.grades, x, y, 'atual') : NaN
      out[i] = Number.isNaN(projeto)
        ? regional
        : projeto + (regional - projeto) * suave(DENTRO, FORA, d)
    }
    return out
  }
}
