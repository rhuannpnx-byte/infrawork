// Desenhos dos tanques em vista de arame, em perspectiva: o corpo, os tampos, os anéis de solda, os berços, a boca
// de visita e a escada. Cada desenho sai da geometria 3D projetada por uma câmera — é só traço, sem imagem pronta —
// para o cadastro mostrar o tanque como ele é visto no canteiro, em vez de pedir o nome do tampo.
//
// Cada peça é um corpo convexo: o contorno é o fecho convexo dos pontos projetados e, por dentro, só entram as
// linhas que ficam de frente para a câmera. As peças são pintadas de trás para a frente, com o fundo da folha, para
// a da frente esconder a de trás.

import type { FundoCampo, TampoCampo } from './formulario-tanque'
import type { FormaTanque } from './tanque'

type V3 = [number, number, number]
type P2 = [number, number]

const soma = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const menos = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const vezes = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
const escalar = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const vetorial = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const unitario = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / n, a[1] / n, a[2] / n]
}

interface Camera {
  pos: V3
  frente: V3
  direita: V3
  cima: V3
}

/** Câmera olhando para `alvo`: `az` gira em volta do eixo vertical (0 = de frente para +x), `el` é a altura. */
function camera(alvo: V3, az: number, el: number, dist: number): Camera {
  const g = Math.PI / 180
  const pos = soma(alvo, [
    dist * Math.cos(el * g) * Math.cos(az * g),
    -dist * Math.cos(el * g) * Math.sin(az * g),
    dist * Math.sin(el * g)
  ])
  const frente = unitario(menos(alvo, pos))
  const direita = unitario(vetorial(frente, [0, 0, 1]))
  return { pos, frente, direita, cima: vetorial(direita, frente) }
}

function projetar(c: Camera, p: V3): P2 {
  const v = menos(p, c.pos)
  const z = escalar(v, c.frente)
  return [escalar(v, c.direita) / z, -escalar(v, c.cima) / z]
}

/** O ponto `p` de uma superfície com normal `n` está de frente para a câmera? */
const deFrente = (c: Camera, p: V3, n: V3): boolean => escalar(n, menos(c.pos, p)) > 0

/** Fecho convexo de pontos 2D (cadeia monótona), no sentido do contorno. */
function fecho(pontos: P2[]): P2[] {
  const p = [...pontos].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const giro = (o: P2, a: P2, b: P2): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const baixo: P2[] = []
  for (const q of p) {
    while (baixo.length >= 2 && giro(baixo[baixo.length - 2], baixo[baixo.length - 1], q) <= 0)
      baixo.pop()
    baixo.push(q)
  }
  const alto: P2[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (alto.length >= 2 && giro(alto[alto.length - 2], alto[alto.length - 1], q) <= 0)
      alto.pop()
    alto.push(q)
  }
  return baixo.slice(0, -1).concat(alto.slice(0, -1))
}

/**
 * Uma camada do desenho: o contorno cheio de uma peça, ou linhas por cima dela. `nivel` é a parte do corpo ocupada
 * pelo material e `espelho`, a superfície dele, vista através do tanque; `vazio` devolve a cor da folha ao que fica
 * acima do material num corpo opaco (o monte). Essas três só existem no desenho do mapa, que mostra o estoque.
 */
interface Camada {
  tipo: 'corpo' | 'linha' | 'fina' | 'nivel' | 'espelho' | 'vazio'
  tracos: P2[][]
  fechado?: boolean
}

// ── Seções ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Contorno da seção, em (largura, altura), no sentido anti-horário a partir do lado direito. */
type Secao = Array<[number, number]>
const N_SECAO = 56

const secaoEliptica = (a: number, b: number): Secao =>
  Array.from({ length: N_SECAO }, (_, j) => {
    const t = (2 * Math.PI * j) / N_SECAO
    return [a * Math.cos(t), b * Math.sin(t)] as [number, number]
  })

/** Lados retos fechados por semicírculos, deitada (largura maior que a altura). */
function secaoOval(largura: number, altura: number): Secao {
  const r = altura / 2
  const s = (largura - altura) / 2
  const pts: Secao = []
  const meio = N_SECAO / 2
  for (let j = 0; j <= meio; j++) {
    const t = -Math.PI / 2 + (Math.PI * j) / meio
    pts.push([s + r * Math.cos(t), r * Math.sin(t)])
  }
  for (let j = 0; j <= meio; j++) {
    const t = Math.PI / 2 + (Math.PI * j) / meio
    pts.push([-s + r * Math.cos(t), r * Math.sin(t)])
  }
  return pts
}

// ── Corpo em estações (costado e tampos) ─────────────────────────────────────────────────────────────────────

interface Estacao {
  /** posição ao longo do eixo */
  t: number
  /** escala da seção (1 no costado; cai até 0 na ponta do tampo) */
  k: number
}

interface Corpo {
  origem: V3
  eixo: V3
  /** direções da largura e da altura da seção */
  e2: V3
  e3: V3
  secao: Secao
  estacoes: Estacao[]
}

const pontoDoCorpo = (c: Corpo, i: number, j: number): V3 => {
  const e = c.estacoes[i]
  const s = c.secao[(j + c.secao.length) % c.secao.length]
  return soma(
    soma(c.origem, vezes(c.eixo, e.t)),
    soma(vezes(c.e2, s[0] * e.k), vezes(c.e3, s[1] * e.k))
  )
}

function normalDoCorpo(c: Corpo, i: number, j: number): V3 {
  const n = c.estacoes.length
  const ao = menos(
    pontoDoCorpo(c, Math.min(n - 1, i + 1), j),
    pontoDoCorpo(c, Math.max(0, i - 1), j)
  )
  const em = menos(pontoDoCorpo(c, i, j + 1), pontoDoCorpo(c, i, j - 1))
  let nrm = vetorial(em, ao)
  if (Math.hypot(nrm[0], nrm[1], nrm[2]) < 1e-9) nrm = vezes(c.eixo, i === 0 ? -1 : 1)
  const centro = soma(c.origem, vezes(c.eixo, c.estacoes[i].t))
  const fora = menos(pontoDoCorpo(c, i, j), centro)
  const dir =
    escalar(nrm, fora) < 0 ||
    (escalar(fora, fora) < 1e-9 && escalar(nrm, c.eixo) * (i === 0 ? -1 : 1) < 0)
  return unitario(dir ? vezes(nrm, -1) : nrm)
}

/** As partes de uma linha fechada (ou aberta) que ficam à vista, quebrada onde some. */
function partesVisiveis(pts: V3[], visivel: boolean[], cam: Camera, fechada: boolean): P2[][] {
  const out: P2[][] = []
  let atual: P2[] = []
  const n = pts.length
  for (let k = 0; k < (fechada ? n + 1 : n); k++) {
    const i = k % n
    if (visivel[i]) atual.push(projetar(cam, pts[i]))
    else {
      if (atual.length > 1) out.push(atual)
      atual = []
    }
  }
  if (atual.length > 1) out.push(atual)
  return out
}

/** Anel do corpo numa estação: só o que está de frente (o anel inteiro, na tampa plana virada para a câmera). */
function anel(c: Corpo, i: number, cam: Camera): P2[][] {
  const n = c.secao.length
  const pts = Array.from({ length: n }, (_, j) => pontoDoCorpo(c, i, j))
  const ponta = i === 0 || i === c.estacoes.length - 1
  const tampaDeFrente =
    ponta &&
    c.estacoes[i].k > 0.05 &&
    deFrente(cam, soma(c.origem, vezes(c.eixo, c.estacoes[i].t)), vezes(c.eixo, i === 0 ? -1 : 1))
  const vis = pts.map((p, j) => tampaDeFrente || deFrente(cam, p, normalDoCorpo(c, i, j)))
  return partesVisiveis(pts, vis, cam, true)
}

/** Linha ao longo do corpo (uma geratriz), no ponto `j` da seção. */
function geratriz(c: Corpo, j: number, cam: Camera, de = 0, ate = c.estacoes.length - 1): P2[][] {
  const pts: V3[] = []
  const vis: boolean[] = []
  for (let i = de; i <= ate; i++) {
    const p = pontoDoCorpo(c, i, j)
    pts.push(p)
    vis.push(deFrente(cam, p, normalDoCorpo(c, i, j)))
  }
  return partesVisiveis(pts, vis, cam, false)
}

function contornoDoCorpo(c: Corpo, cam: Camera): P2[] {
  const pts: P2[] = []
  for (let i = 0; i < c.estacoes.length; i++)
    for (let j = 0; j < c.secao.length; j++) pts.push(projetar(cam, pontoDoCorpo(c, i, j)))
  return fecho(pts)
}

// ── Nível do material ────────────────────────────────────────────────────────────────────────────────────────

/**
 * A parte do corpo abaixo da cota `z`: o contorno cheio do material e o espelho (a superfície). O corpo é convexo,
 * então o que sobra do corte também é, e o contorno é o fecho dos pontos de baixo com os do corte.
 */
function nivelDoCorpo(c: Corpo, z: number, cam: Camera): Camada[] {
  const baixo: V3[] = []
  const corte: V3[] = []
  const cruza = (p: V3, q: V3): void => {
    if ((p[2] - z) * (q[2] - z) >= 0) return
    corte.push(soma(p, vezes(menos(q, p), (z - p[2]) / (q[2] - p[2]))))
  }
  for (let i = 0; i < c.estacoes.length; i++)
    for (let j = 0; j < c.secao.length; j++) {
      const p = pontoDoCorpo(c, i, j)
      if (p[2] <= z) baixo.push(p)
      cruza(p, pontoDoCorpo(c, i, j + 1))
      if (i + 1 < c.estacoes.length) cruza(p, pontoDoCorpo(c, i + 1, j))
    }
  if (baixo.length + corte.length < 3) return []
  const camadas: Camada[] = [
    {
      tipo: 'nivel',
      tracos: [fecho([...baixo, ...corte].map((p) => projetar(cam, p)))],
      fechado: true
    }
  ]
  if (corte.length >= 3)
    camadas.push({
      tipo: 'espelho',
      tracos: [fecho(corte.map((p) => projetar(cam, p)))],
      fechado: true
    })
  return camadas
}

/** Área da parte da seção que fica abaixo da altura `u`. */
function areaAbaixo(secao: Secao, u: number): number {
  const pts: Array<[number, number]> = []
  for (let j = 0; j < secao.length; j++) {
    const p = secao[j]
    const q = secao[(j + 1) % secao.length]
    if (p[1] <= u) pts.push(p)
    if ((p[1] - u) * (q[1] - u) < 0)
      pts.push([p[0] + ((q[0] - p[0]) * (u - p[1])) / (q[1] - p[1]), u])
  }
  let a = 0
  for (let j = 0; j < pts.length; j++) {
    const p = pts[j]
    const q = pts[(j + 1) % pts.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(a) / 2
}

/** Volume do corpo deitado (seção em pé, eixo na horizontal) abaixo da cota `z`, medida a partir do eixo. */
function volumeDeitado(c: Corpo, z: number): number {
  const area = (e: Estacao): number => (e.k > 1e-6 ? e.k * e.k * areaAbaixo(c.secao, z / e.k) : 0)
  let v = 0
  for (let i = 0; i + 1 < c.estacoes.length; i++)
    v +=
      ((area(c.estacoes[i]) + area(c.estacoes[i + 1])) / 2) *
      Math.abs(c.estacoes[i + 1].t - c.estacoes[i].t)
  return v
}

/** Volume do corpo em pé (eixo na vertical) do fundo até a cota `z`, a menos da área da seção. */
function volumeEmPe(c: Corpo, z: number): number {
  let v = 0
  for (let i = 0; i + 1 < c.estacoes.length; i++) {
    const a = c.estacoes[i]
    const b = c.estacoes[i + 1]
    if (a.t >= z) break
    const fim = Math.min(b.t, z)
    const kf = a.k + ((b.k - a.k) * (fim - a.t)) / (b.t - a.t)
    v += ((a.k * a.k + kf * kf) / 2) * (fim - a.t)
  }
  return v
}

/** A cota em que o volume abaixo dela é a fração `f` do volume até `ate` (o desenho enche em volume, como o tanque). */
function cotaDoNivel(f: number, de: number, ate: number, volume: (z: number) => number): number {
  const alvo = f * volume(ate)
  let a = de
  let b = ate
  for (let n = 0; n < 24; n++) {
    const m = (a + b) / 2
    if (volume(m) < alvo) a = m
    else b = m
  }
  return (a + b) / 2
}

/** Fração do estoque que vale desenhar: nada sem saldo, e o que passa da capacidade aparece como cheio. */
const fracaoDesenhada = (nivel: number | null | undefined): number =>
  nivel == null || !Number.isFinite(nivel) ? 0 : Math.min(1, Math.max(0, nivel))

/** Estações de um tampo: o quanto avança além da emenda (`t`) e a escala da seção ali. `r` é o raio de referência. */
function estacoesDoTampo(tampo: TampoCampo, r: number, n = 14): Estacao[] {
  if (tampo === 'plano') return []
  const out: Estacao[] = []
  const passo = (s: number): number => Math.sin((s * Math.PI) / 2)
  if (tampo === 'abaulado') {
    const f = 0.3 * r
    const rc = (r * r + f * f) / (2 * f)
    for (let i = 1; i <= n; i++) {
      const t = f * passo(i / n)
      out.push({ t, k: Math.sqrt(Math.max(0, rc * rc - (rc - f + t) ** 2)) / r })
    }
    return out
  }
  if (tampo === 'semieliptico' || tampo === 'hemisferico') {
    const d = tampo === 'hemisferico' ? r : r / 2
    for (let i = 1; i <= n; i++) {
      const t = d * passo(i / n)
      out.push({ t, k: Math.sqrt(Math.max(0, 1 - (t / d) ** 2)) })
    }
    return out
  }
  // torisférico: calota de raio 2r com rebordo de raio 0,2r (o padrão DIN 28011)
  const rc = 2 * r
  const rk = 0.2 * r
  const d = rc - Math.sqrt((rc - rk) ** 2 - (r - rk) ** 2)
  const rt = (rc * (r - rk)) / (rc - rk)
  const t1 = Math.sqrt(Math.max(0, rk * rk - (rt - (r - rk)) ** 2))
  for (let i = 1; i <= n; i++) {
    const t = d * passo(i / n)
    const raio =
      t <= t1
        ? r - rk + Math.sqrt(Math.max(0, rk * rk - t * t))
        : Math.sqrt(Math.max(0, rc * rc - (t + rc - d) ** 2))
    out.push({ t, k: raio / r })
  }
  return out
}

/** Caixa de lados retos: o contorno cheio e as arestas das faces de frente. */
function caixa(min: V3, max: V3, cam: Camera): Camada[] {
  const v = (i: number): V3 => [
    i & 1 ? max[0] : min[0],
    i & 2 ? max[1] : min[1],
    i & 4 ? max[2] : min[2]
  ]
  const faces: Array<{ n: V3; idx: number[] }> = [
    { n: [-1, 0, 0], idx: [0, 2, 6, 4] },
    { n: [1, 0, 0], idx: [1, 3, 7, 5] },
    { n: [0, -1, 0], idx: [0, 1, 5, 4] },
    { n: [0, 1, 0], idx: [2, 3, 7, 6] },
    { n: [0, 0, -1], idx: [0, 1, 3, 2] },
    { n: [0, 0, 1], idx: [4, 5, 7, 6] }
  ]
  const cantos = Array.from({ length: 8 }, (_, i) => v(i))
  const tracos: P2[][] = []
  for (const f of faces) {
    const p = f.idx.map((i) => cantos[i])
    if (!deFrente(cam, p[0], f.n)) continue
    tracos.push([...p, p[0]].map((q) => projetar(cam, q)))
  }
  return [
    { tipo: 'corpo', tracos: [fecho(cantos.map((q) => projetar(cam, q)))], fechado: true },
    { tipo: 'fina', tracos }
  ]
}

/** Cilindro em pé pequeno (boca de visita, bocal, perna): contorno cheio e o anel de cima. */
function cilindroEmPe(centro: V3, raio: number, altura: number, cam: Camera): Camada[] {
  const c: Corpo = {
    origem: centro,
    eixo: [0, 0, 1],
    e2: [1, 0, 0],
    e3: [0, 1, 0],
    secao: secaoEliptica(raio, raio),
    estacoes: [
      { t: 0, k: 1 },
      { t: altura, k: 1 }
    ]
  }
  return [
    { tipo: 'corpo', tracos: [contornoDoCorpo(c, cam)], fechado: true },
    { tipo: 'fina', tracos: anel(c, 1, cam) }
  ]
}

// ── Tanques ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Deitado {
  secao: Secao
  /** meia largura e meia altura da seção */
  a: number
  b: number
  comprimento: number
  tampoFrente: TampoCampo
  tampoFundo: TampoCampo
  /** sem acessórios: só o corpo e um berço (a vista ampliada da ponta) */
  simples?: boolean
  /** sem a escada, que vira borrão no tamanho do marcador do mapa */
  semEscada?: boolean
  /** quanto do tanque está cheio (0 a 1); sem isso o desenho sai vazio */
  nivel?: number | null
}

/** Tanque deitado, com o eixo em x. Devolve as camadas de trás para a frente. */
function tanqueDeitado(d: Deitado, cam: Camera): Camada[] {
  const { a, b, comprimento: L } = d
  const tras = estacoesDoTampo(d.tampoFundo, b)
  const frente = estacoesDoTampo(d.tampoFrente, b)
  const nCostado = 9
  const estacoes: Estacao[] = [
    ...tras.map((e) => ({ t: -L / 2 - e.t, k: e.k })).reverse(),
    ...Array.from({ length: nCostado }, (_, i) => ({ t: -L / 2 + (L * i) / (nCostado - 1), k: 1 })),
    ...frente.map((e) => ({ t: L / 2 + e.t, k: e.k }))
  ]
  const corpo: Corpo = {
    origem: [0, 0, 0],
    eixo: [1, 0, 0],
    e2: [0, 1, 0],
    e3: [0, 0, 1],
    secao: d.secao,
    estacoes
  }
  const i0 = tras.length
  const i1 = tras.length + nCostado - 1
  const camadas: Camada[] = []

  // berços, antes do tanque: ele esconde o que fica atrás
  const chao = -b * 1.32
  const bercos = d.simples ? [0] : [-0.3 * L, 0.3 * L]
  for (const x of bercos
    .sort((p, q) => escalar([p, 0, 0], cam.frente) - escalar([q, 0, 0], cam.frente))
    .reverse())
    camadas.push(
      ...caixa([x - 0.045 * L, -0.62 * a, chao], [x + 0.045 * L, 0.62 * a, -0.74 * b], cam)
    )

  camadas.push({ tipo: 'corpo', tracos: [contornoDoCorpo(corpo, cam)], fechado: true })
  const cheio = fracaoDesenhada(d.nivel)
  if (cheio > 0)
    camadas.push(
      ...nivelDoCorpo(
        corpo,
        cheio >= 1 ? b * 1.01 : cotaDoNivel(cheio, -b, b, (z) => volumeDeitado(corpo, z)),
        cam
      )
    )
  // emendas do costado com os tampos e anéis de solda do costado
  const emendas: P2[][] = [...anel(corpo, i0, cam), ...anel(corpo, i1, cam)]
  camadas.push({ tipo: 'linha', tracos: emendas })
  const finas: P2[][] = []
  for (const f of d.simples ? [0.5] : [0.25, 0.5, 0.75])
    finas.push(...anel(corpo, i0 + Math.round(f * (nCostado - 1)), cam))
  // um anel no meio de cada tampo abaulado mostra a curva; na tampa plana, um friso por dentro da borda
  for (const [lista, base, sinal] of [
    [frente, i1, 1],
    [tras, i0, -1]
  ] as const) {
    if (lista.length > 0)
      finas.push(...anel(corpo, base + sinal * Math.round(lista.length * 0.55), cam))
    else {
      const friso: Corpo = {
        ...corpo,
        estacoes: [{ t: (sinal * L) / 2, k: 0.9 }]
      }
      const centro: V3 = [(sinal * L) / 2, 0, 0]
      if (deFrente(cam, centro, [sinal, 0, 0]))
        finas.push([
          ...Array.from({ length: d.secao.length + 1 }, (_, j) =>
            projetar(cam, pontoDoCorpo(friso, 0, j))
          )
        ])
    }
  }
  // a emenda ao longo do costado, pouco acima do meio, do lado de quem olha
  const lado = cam.pos[1] < 0 ? -1 : 1
  let jEmenda = 0
  let melhor = -Infinity
  d.secao.forEach((s, j) => {
    const nota = -Math.abs(s[1] - 0.28 * b) + (s[0] * lado > 0 ? 0 : -1e6)
    if (nota > melhor) {
      melhor = nota
      jEmenda = j
    }
  })
  finas.push(...geratriz(corpo, jEmenda, cam, i0, i1))
  camadas.push({ tipo: 'fina', tracos: finas })

  if (!d.simples) {
    // boca de visita em cima
    camadas.push(...cilindroEmPe([0.02 * L, 0, b * 0.97], 0.2 * b, 0.2 * b, cam))
  }
  if (!d.simples && !d.semEscada) {
    // escada do lado de quem olha: dois montantes que acompanham o costado e os degraus
    const xs = [0.3 * L - 0.13 * b, 0.3 * L + 0.13 * b]
    const perfil = d.secao
      .map((s) => [s[0] * 1.045, s[1] * 1.045] as [number, number])
      .filter((s) => s[0] * lado > 0)
      .sort((p, q) => p[1] - q[1])
    const montante = (x: number): V3[] => [
      [x, perfil[0][0], chao] as V3,
      ...perfil.filter((s) => s[1] > -0.75 * b).map((s) => [x, s[0], s[1]] as V3)
    ]
    const m0 = montante(xs[0])
    const m1 = montante(xs[1])
    const degraus: P2[][] = []
    for (let k = 1; k < m0.length; k += 3)
      degraus.push([projetar(cam, m0[k]), projetar(cam, m1[k])])
    camadas.push({
      tipo: 'fina',
      tracos: [m0.map((p) => projetar(cam, p)), m1.map((p) => projetar(cam, p)), ...degraus]
    })
  }
  return camadas
}

interface EmPe {
  raio: number
  altura: number
  fundo: FundoCampo
  /** a vista ampliada do fundo: tanque curto, sem escada */
  simples?: boolean
  semEscada?: boolean
  /** quanto do tanque está cheio (0 a 1); sem isso o desenho sai vazio */
  nivel?: number | null
}

/** Tanque em pé, com o eixo em z e o fundo do costado em z = 0. */
function tanqueEmPe(d: EmPe, cam: Camera): Camada[] {
  const { raio: r, altura: h } = d
  const fundo: Estacao[] =
    d.fundo === 'conico'
      ? Array.from({ length: 10 }, (_, i) => ({
          t: -(0.75 * r * (i + 1)) / 10,
          k: 1 - (i + 1) / 10
        }))
      : d.fundo === 'abaulado'
        ? estacoesDoTampo('abaulado', r).map((e) => ({ t: -e.t, k: e.k }))
        : []
  // teto em cone baixo
  const teto: Estacao[] = Array.from({ length: 8 }, (_, i) => ({
    t: h + (0.16 * r * (i + 1)) / 8,
    k: 1 - ((i + 1) / 8) * 0.97
  }))
  const nCostado = 7
  const estacoes: Estacao[] = [
    ...[...fundo].reverse(),
    ...Array.from({ length: nCostado }, (_, i) => ({ t: (h * i) / (nCostado - 1), k: 1 })),
    ...teto
  ]
  const corpo: Corpo = {
    origem: [0, 0, 0],
    eixo: [0, 0, 1],
    e2: [1, 0, 0],
    e3: [0, 1, 0],
    secao: secaoEliptica(r, r),
    estacoes
  }
  const i0 = fundo.length
  const i1 = i0 + nCostado - 1
  const camadas: Camada[] = []
  const profundo = d.fundo === 'conico' ? 0.75 * r : d.fundo === 'abaulado' ? 0.3 * r : 0
  const chao = -(profundo + (profundo > 0 ? 0.3 * r : 0.1 * r))
  // o material enche do fundo até o alto do costado (o teto não conta)
  const cheio = fracaoDesenhada(d.nivel)
  const material: Camada[] =
    cheio > 0
      ? nivelDoCorpo(
          corpo,
          cheio >= 1
            ? h * 0.995
            : cotaDoNivel(cheio, estacoes[0].t, h, (z) => volumeEmPe(corpo, z)),
          cam
        )
      : []

  if (profundo > 0) {
    // pernas: as de trás primeiro
    const pernas = [45, 135, 225, 315]
      .map((g) => {
        const t = (g * Math.PI) / 180
        return [0.93 * r * Math.cos(t), 0.93 * r * Math.sin(t)] as [number, number]
      })
      .sort((p, q) => escalar([q[0], q[1], 0], cam.frente) - escalar([p[0], p[1], 0], cam.frente))
    for (const p of pernas.slice(0, 2))
      camadas.push(
        ...caixa(
          [p[0] - 0.07 * r, p[1] - 0.07 * r, chao],
          [p[0] + 0.07 * r, p[1] + 0.07 * r, 0.25 * r],
          cam
        )
      )
    camadas.push({ tipo: 'corpo', tracos: [contornoDoCorpo(corpo, cam)], fechado: true })
    const depois = pernas.slice(2)
    camadas.push(
      ...material,
      { tipo: 'linha', tracos: [...anel(corpo, i0, cam), ...anel(corpo, i1, cam)] },
      { tipo: 'fina', tracos: anelDoFundo(corpo, fundo.length, cam) }
    )
    for (const p of depois)
      camadas.push(
        ...caixa(
          [p[0] - 0.07 * r, p[1] - 0.07 * r, chao],
          [p[0] + 0.07 * r, p[1] + 0.07 * r, 0.25 * r],
          cam
        )
      )
  } else {
    // fundo plano: o tanque assenta numa base
    camadas.push(...caixa([-1.18 * r, -1.18 * r, chao], [1.18 * r, 1.18 * r, 0], cam))
    camadas.push({ tipo: 'corpo', tracos: [contornoDoCorpo(corpo, cam)], fechado: true })
    camadas.push(...material)
    camadas.push({ tipo: 'linha', tracos: [...anel(corpo, i0, cam), ...anel(corpo, i1, cam)] })
  }
  const finas: P2[][] = []
  for (const f of d.simples ? [0.5] : [0.33, 0.67])
    finas.push(...anel(corpo, i0 + Math.round(f * (nCostado - 1)), cam))
  camadas.push({ tipo: 'fina', tracos: finas })

  if (!d.simples) {
    // bocal no alto do teto e escada do lado de quem olha
    camadas.push(...cilindroEmPe([0, 0, h + 0.14 * r], 0.16 * r, 0.14 * r, cam))
  }
  if (!d.simples && !d.semEscada) {
    const para = unitario([cam.pos[0], cam.pos[1], 0])
    const lateral = unitario(vetorial(para, [0, 0, 1]))
    const centro = soma(vezes(para, 0.72 * r * 1.04), vezes(lateral, 0.72 * r))
    const fora = unitario(centro)
    const base = vezes(fora, r * 1.05)
    const m = (s: number, z: number): V3 =>
      soma(soma(base, vezes(unitario(vetorial(fora, [0, 0, 1])), s)), [0, 0, z])
    const degraus: P2[][] = []
    for (let z = 0.12 * h; z < h; z += 0.085 * h)
      degraus.push([projetar(cam, m(-0.1 * r, z)), projetar(cam, m(0.1 * r, z))])
    camadas.push({
      tipo: 'fina',
      tracos: [
        [projetar(cam, m(-0.1 * r, 0)), projetar(cam, m(-0.1 * r, h * 1.02))],
        [projetar(cam, m(0.1 * r, 0)), projetar(cam, m(0.1 * r, h * 1.02))],
        ...degraus
      ]
    })
  }
  return camadas
}

/** Um anel no meio do fundo (cone ou calota), para a curva aparecer. */
function anelDoFundo(c: Corpo, n: number, cam: Camera): P2[][] {
  return n > 2 ? anel(c, Math.round(n * 0.45), cam) : []
}

/** Tanque retangular: a caixa com os reforços verticais nas faces de frente, sobre dois trilhos. */
function tanqueRetangular(cam: Camera, nivel?: number | null): Camada[] {
  const cx = 1.5
  const cy = 0.8
  const h = 0.9
  const camadas: Camada[] = []
  for (const y of [-0.55 * cy, 0.55 * cy].sort(
    (p, q) => escalar([0, q, 0], cam.frente) - escalar([0, p, 0], cam.frente)
  ))
    camadas.push(...caixa([-cx * 1.05, y - 0.08, -0.22], [cx * 1.05, y + 0.08, 0], cam))
  const [contorno, arestas] = caixa([-cx, -cy, 0], [cx, cy, h], cam)
  camadas.push(contorno)
  const cheio = fracaoDesenhada(nivel)
  if (cheio > 0) {
    const z = h * cheio
    const cantos = (cota: number): V3[] => [
      [-cx, -cy, cota],
      [cx, -cy, cota],
      [cx, cy, cota],
      [-cx, cy, cota]
    ]
    camadas.push({
      tipo: 'nivel',
      tracos: [fecho([...cantos(0), ...cantos(z)].map((p) => projetar(cam, p)))],
      fechado: true
    })
    if (cheio < 1)
      camadas.push({
        tipo: 'espelho',
        tracos: [cantos(z).map((p) => projetar(cam, p))],
        fechado: true
      })
  }
  camadas.push(arestas)
  const finas: P2[][] = []
  const lado = cam.pos[1] < 0 ? -cy : cy
  for (const f of [-0.6, -0.2, 0.2, 0.6])
    finas.push([projetar(cam, [f * cx, lado, 0]), projetar(cam, [f * cx, lado, h])])
  const ponta = cam.pos[0] > 0 ? cx : -cx
  for (const f of [-0.33, 0.33])
    finas.push([projetar(cam, [ponta, f * cy, 0]), projetar(cam, [ponta, f * cy, h])])
  camadas.push({ tipo: 'fina', tracos: finas })
  camadas.push(...caixa([-0.25 * cx, -0.3 * cy, h], [0.15 * cx, 0.3 * cy, h + 0.07], cam))
  return camadas
}

/**
 * Monte do depósito: um cone de talude natural, levemente abaulado, com as curvas de nível. Enche de baixo para
 * cima na altura (metade do estoque é meia altura do monte), que é a leitura que se faz de relance no mapa.
 */
function monte(cam: Camera, nivel?: number | null): Camada[] {
  const H = 0.95
  const n = 12
  const corpo: Corpo = {
    origem: [0, 0, 0],
    eixo: [0, 0, 1],
    e2: [1, 0, 0],
    e3: [0, 1, 0],
    secao: secaoEliptica(1.35, 1.1),
    estacoes: Array.from({ length: n + 1 }, (_, i) => ({
      t: (H * i) / n,
      k: Math.max(0, 1 - (i / n) ** 1.3)
    }))
  }
  const camadas: Camada[] = [
    { tipo: 'corpo', tracos: [contornoDoCorpo(corpo, cam)], fechado: true }
  ]
  const cheio = fracaoDesenhada(nivel)
  // o monte é opaco: o que se vê acima do material (por dentro do corte) volta a ser folha em branco
  if (cheio > 0)
    camadas.push(
      ...nivelDoCorpo(corpo, cheio >= 1 ? H : H * cheio, cam).map((c): Camada =>
        c.tipo === 'espelho' ? { ...c, tipo: 'vazio' } : c
      )
    )
  const finas: P2[][] = []
  for (const i of [3, 6, 9]) finas.push(...anel(corpo, i, cam))
  for (const j of [0, 1, 2, 3, 4, 5, 6, 7].map((q) => (q * N_SECAO) / 8))
    finas.push(...geratriz(corpo, j, cam, 0, n - 1))
  camadas.push({ tipo: 'fina', tracos: finas })
  return camadas
}

// ── Do desenho para o SVG ────────────────────────────────────────────────────────────────────────────────────

export interface DesenhoArame {
  largura: number
  altura: number
  /** caminhos na ordem de pintura */
  tracos: Array<{ tipo: Camada['tipo']; d: string }>
}

/** Ajusta as camadas à caixa do desenho e monta os caminhos. */
function montar(camadas: Camada[], largura: number, altura: number): DesenhoArame {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (const c of camadas)
    for (const t of c.tracos)
      for (const [x, y] of t) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
  const margem = 4
  const k = Math.min((largura - 2 * margem) / (x1 - x0), (altura - 2 * margem) / (y1 - y0))
  const dx = (largura - (x1 - x0) * k) / 2 - x0 * k
  const dy = (altura - (y1 - y0) * k) / 2 - y0 * k
  const ponto = ([x, y]: P2): string => `${(x * k + dx).toFixed(1)} ${(y * k + dy).toFixed(1)}`
  return {
    largura,
    altura,
    tracos: camadas
      .filter((c) => c.tracos.some((t) => t.length > 1))
      .map((c) => ({
        tipo: c.tipo,
        d: c.tracos
          .filter((t) => t.length > 1)
          .map((t) => `M${t.map(ponto).join('L')}${c.fechado ? 'Z' : ''}`)
          .join('')
      }))
  }
}

const memoria = new Map<string, DesenhoArame>()
const lembrar = (chave: string, f: () => DesenhoArame): DesenhoArame => {
  const tem = memoria.get(chave)
  if (tem) return tem
  const novo = f()
  memoria.set(chave, novo)
  return novo
}

/** O tanque inteiro, em perspectiva, para a escolha do formato. */
export function desenhoDoFormato(forma: Exclude<FormaTanque, 'tabela'>): DesenhoArame {
  return lembrar(`formato:${forma}`, () => {
    const L = 200
    const H = 120
    if (forma === 'cilindrico_vertical') {
      const cam = camera([0, 0, 1.2], 38, 17, 9)
      return montar(tanqueEmPe({ raio: 1, altura: 2.5, fundo: 'plano' }, cam), L, H)
    }
    if (forma === 'retangular')
      return montar(tanqueRetangular(camera([0, 0, 0.35], 40, 22, 8)), L, H)
    const cam = camera([0, 0, -0.1], 52, 15, 13)
    if (forma === 'cilindrico_horizontal')
      return montar(
        tanqueDeitado(
          {
            secao: secaoEliptica(1, 1),
            a: 1,
            b: 1,
            comprimento: 5.4,
            tampoFrente: 'torisferico',
            tampoFundo: 'torisferico'
          },
          cam
        ),
        L,
        H
      )
    const a = 1.32
    const b = 0.82
    return montar(
      tanqueDeitado(
        {
          secao: forma === 'eliptico_horizontal' ? secaoEliptica(a, b) : secaoOval(2 * a, 2 * b),
          a,
          b,
          comprimento: 5.4,
          tampoFrente: 'abaulado',
          tampoFundo: 'abaulado'
        },
        cam
      ),
      L,
      H
    )
  })
}

/** O que o mapa precisa saber do ativo para desenhá-lo: o formato e o tampo (ou o fundo) do cadastro. */
export interface ModeloNoMapa {
  tipo: 'tanque' | 'deposito'
  forma: FormaTanque | null
  tampo: TampoCampo
  fundo: FundoCampo
}

/**
 * O ativo como aparece no mapa: o tanque no formato e com o tampo do cadastro (sem a escada, que não se lê nesse
 * tamanho) ou o monte do depósito, cheio até a fração `nivel` do estoque. A tabela do fabricante não tem forma:
 * sai como o tanque deitado comum.
 */
export function desenhoNoMapa(m: ModeloNoMapa, nivel: number | null): DesenhoArame {
  const pct = nivel == null ? 'sem' : String(Math.round(fracaoDesenhada(nivel) * 100))
  const f = nivel == null ? null : Number(pct) / 100
  const L = 104
  const H = 62
  if (m.tipo === 'deposito')
    return lembrar(`mapa:monte:${pct}`, () =>
      montar(monte(camera([0, 0, 0.3], 40, 20, 9), f), L, H)
    )
  const forma = m.forma && m.forma !== 'tabela' ? m.forma : 'cilindrico_horizontal'
  return lembrar(`mapa:${forma}:${m.tampo}:${m.fundo}:${pct}`, () => {
    // o tanque em pé ganha uma caixa mais alta, senão sai miúdo ao lado dos deitados
    if (forma === 'cilindrico_vertical')
      return montar(
        tanqueEmPe(
          { raio: 1, altura: 2.1, fundo: m.fundo, semEscada: true, nivel: f },
          camera([0, 0, 1], 38, 17, 9)
        ),
        76,
        80
      )
    if (forma === 'retangular')
      return montar(tanqueRetangular(camera([0, 0, 0.35], 40, 22, 8), f), L, H)
    const cilindrico = forma === 'cilindrico_horizontal'
    const a = cilindrico ? 1 : 1.32
    const b = cilindrico ? 1 : 0.82
    const tampo: TampoCampo =
      m.forma === 'tabela' || m.forma == null
        ? 'torisferico'
        : cilindrico
          ? m.tampo
          : m.tampo === 'plano'
            ? 'plano'
            : 'abaulado'
    return montar(
      tanqueDeitado(
        {
          secao: forma === 'oval_horizontal' ? secaoOval(2 * a, 2 * b) : secaoEliptica(a, b),
          a,
          b,
          comprimento: 4.4,
          tampoFrente: tampo,
          tampoFundo: tampo,
          semEscada: true,
          nivel: f
        },
        camera([0, 0, -0.1], 52, 15, 13)
      ),
      L,
      H
    )
  })
}

/** A ponta do tanque deitado, de perto e mais de lado, para o tampo aparecer no contorno. */
export function desenhoDoTampo(tampo: TampoCampo): DesenhoArame {
  return lembrar(`tampo:${tampo}`, () =>
    montar(
      tanqueDeitado(
        {
          secao: secaoEliptica(1, 1),
          a: 1,
          b: 1,
          comprimento: 1.5,
          tampoFrente: tampo,
          tampoFundo: 'plano',
          simples: true
        },
        camera([0.5, 0, -0.1], 80, 9, 9)
      ),
      160,
      120
    )
  )
}

/** O fundo do tanque em pé, visto quase de lado, para o fundo aparecer por baixo do costado. */
export function desenhoDoFundo(fundo: FundoCampo): DesenhoArame {
  return lembrar(`fundo:${fundo}`, () =>
    montar(
      tanqueEmPe({ raio: 1, altura: 1.5, fundo, simples: true }, camera([0, 0, 0.45], 35, 7, 8)),
      160,
      120
    )
  )
}
