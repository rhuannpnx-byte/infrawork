import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { situacao, type Estado4D } from '../lib/estado'
import type { ModeloPronto } from '../lib/preparar'
import { cor, tokenDoMaterial } from './cores'

export type Modo4D = 'previsto' | 'realizado' | 'comparar'

export interface Cena4DRef {
  irPara: (eixo: number, s: number) => void
  vistaGeral: () => void
}

interface Props {
  modelo: ModeloPronto
  estado: Estado4D | null
  /** Instante mostrado, em ms. */
  t: number
  modo: Modo4D
  /** Com período, o que não foi previsto nem feito nele fica esmaecido. */
  periodo: [number, number] | null
  ocultas: ReadonlySet<string>
  /** Mostra apagado o que ainda falta fazer. */
  mostrarFalta: boolean
  exagero: number
  selecionada: number | null
  aoEscolher: (peca: number | null) => void
  rotulo: string
}

// código visual de cada peça: 0 some; os demais indexam a paleta da classe
const SOME = 0
const FALTA = 1
const MATERIAL = 2
const FRENTE = 3
const CONCLUIDO = 4
const ADIANTADO = 5
const EXECUCAO = 6
const ATRASADO = 7
const CONTEXTO = 8
const N = 9
const FORA = 16
const ESCOLHIDA = 32

const CHEIO = 0.999
const VAZIO = 0.001
const PASSO_TERRENO = 20

interface Palco {
  renderer: WebGLRenderer
  cena: Scene
  camera: PerspectiveCamera
  controles: OrbitControls
  mundo: Group
  malhas: Mesh[]
  terreno: { malha: Mesh; base: Float32Array; ultimo: Float32Array | null }[]
  /** Por classe: N cores (r, g, b) + as mesmas esmaecidas. */
  paleta: Float32Array[]
  codigo: Uint8Array
  sujo: boolean
  solo: Color
  chao: Color
  destaque: Color
}

const mistura = (a: Color, b: Color, f: number): Color => a.clone().lerp(b, f)

export const Cena4D = forwardRef<Cena4DRef, Props>(function Cena4D(
  {
    modelo,
    estado,
    t,
    modo,
    periodo,
    ocultas,
    mostrarFalta,
    exagero,
    selecionada,
    aoEscolher,
    rotulo
  },
  ref
): ReactNode {
  const caixa = useRef<HTMLDivElement>(null)
  const tela = useRef<HTMLCanvasElement>(null)
  const palco = useRef<Palco | null>(null)
  const [falha, setFalha] = useState<string | null>(null)
  const [tema, setTema] = useState(0)
  const aoEscolherRef = useRef(aoEscolher)
  useEffect(() => {
    aoEscolherRef.current = aoEscolher
  }, [aoEscolher])

  const enquadrar = (alvo: Vector3, dist: number, rumo?: Vector3): void => {
    const p = palco.current
    if (!p) return
    const dir = (rumo ?? new Vector3(0.45, 0, 0.9)).clone().setY(0).normalize()
    p.controles.target.copy(alvo)
    p.camera.position
      .copy(alvo)
      .addScaledVector(dir, dist)
      .setY(alvo.y + dist * 0.55)
    p.controles.update()
    p.sujo = true
  }

  const vistaGeral = (): void => {
    const { min, max } = modelo
    const centro = new Vector3((min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2)
    enquadrar(centro, Math.max(max[0] - min[0], max[2] - min[2]) * 0.75)
  }

  useImperativeHandle(ref, () => ({
    vistaGeral,
    irPara: (eixo: number, s: number) => {
      const e = modelo.eixos[eixo]
      if (!e) return
      const q = e.em(s)
      const y = (q.z - modelo.centro[2]) * exagero
      enquadrar(
        new Vector3(q.x - modelo.centro[0], y, -(q.n - modelo.centro[1])),
        260,
        new Vector3(-q.tx, 0, q.tn)
      )
    }
  }))

  // monta a cena uma vez por modelo
  useEffect(() => {
    const el = caixa.current
    const canvas = tela.current
    if (!el || !canvas) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true })
    } catch {
      setFalha('Este navegador não abriu a cena 3D (WebGL indisponível).')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const cena = new Scene()
    const camera = new PerspectiveCamera(40, 1, 2, 400_000)
    const controles = new OrbitControls(camera, canvas)
    controles.enableDamping = true
    controles.dampingFactor = 0.12
    controles.screenSpacePanning = true
    controles.maxPolarAngle = Math.PI * 0.495
    const branco = new Color(1, 1, 1)
    cena.add(
      new HemisphereLight(branco, new Color(0.5, 0.47, 0.4), 1.6),
      new AmbientLight(branco, 0.5)
    )
    const sol = new DirectionalLight(branco, 1.5)
    sol.position.set(-600, 900, 500)
    cena.add(sol)
    const mundo = new Group()
    cena.add(mundo)

    const terreno = modelo.terreno.map((b) => {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(b.pos.slice(), 3))
      g.setAttribute('uv', new BufferAttribute(b.uv, 2))
      g.setAttribute(
        'color',
        new BufferAttribute(new Float32Array((b.pos.length / 3) * 3).fill(1), 3)
      )
      g.setIndex(new BufferAttribute(b.idx, 1))
      g.computeVertexNormals()
      const mat = new MeshLambertMaterial({ vertexColors: true })
      if (b.imagem) {
        const img = new Image()
        const tex = new Texture(img)
        tex.colorSpace = SRGBColorSpace
        img.onload = () => {
          tex.needsUpdate = true
          if (palco.current) palco.current.sujo = true
        }
        img.src = `data:image/jpeg;base64,${b.imagem}`
        mat.map = tex
      }
      const malha = new Mesh(g, mat)
      mundo.add(malha)
      return { malha, base: b.pos, ultimo: null as Float32Array | null }
    })

    const malhas = modelo.malhas.map((m) => {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(m.pos, 3))
      g.setAttribute('color', new BufferAttribute(new Float32Array((m.pos.length / 3) * 4), 4))
      g.computeVertexNormals()
      const malha = new Mesh(
        g,
        new MeshLambertMaterial({
          vertexColors: true,
          side: DoubleSide,
          alphaTest: 0.5,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        })
      )
      mundo.add(malha)
      return malha
    })

    const linhas = modelo.eixos.map((e) => {
      const pts = e.p.map(
        (q) =>
          new Vector3(
            q[1] - modelo.centro[0],
            q[3] - modelo.centro[2] + 0.4,
            -(q[2] - modelo.centro[1])
          )
      )
      const l = new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial())
      mundo.add(l)
      return l
    })

    palco.current = {
      renderer,
      cena,
      camera,
      controles,
      mundo,
      malhas,
      terreno,
      paleta: [],
      codigo: new Uint8Array(modelo.pecas.length).fill(255),
      sujo: true,
      solo: new Color(),
      chao: new Color(),
      destaque: new Color()
    }
    vistaGeral()

    const medir = (): void => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      if (palco.current) palco.current.sujo = true
    }
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    medir()

    const temaObs = new MutationObserver(() => setTema((n) => n + 1))
    temaObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    // clique sem arrasto escolhe a peça sob o cursor
    let desce: [number, number] | null = null
    const raio = new Raycaster()
    const aoDescer = (e: PointerEvent): void => {
      desce = [e.clientX, e.clientY]
    }
    const aoSubir = (e: PointerEvent): void => {
      const p = palco.current
      if (!p || !desce || Math.hypot(e.clientX - desce[0], e.clientY - desce[1]) > 4) return
      const r = canvas.getBoundingClientRect()
      raio.setFromCamera(
        new Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1
        ),
        camera
      )
      for (const hit of raio.intersectObjects(
        p.malhas.filter((m) => m.visible),
        false
      )) {
        const ic = p.malhas.indexOf(hit.object as Mesh)
        const v = (hit.faceIndex ?? 0) * 3
        const pecas = modelo.malhas[ic].pecas
        let lo = 0
        let hi = pecas.length - 1
        while (lo < hi) {
          const m = (lo + hi + 1) >> 1
          if (modelo.pecas[pecas[m]].v0 <= v) lo = m
          else hi = m - 1
        }
        const i = pecas[lo]
        if ((p.codigo[i] & 15) === SOME) continue
        aoEscolherRef.current(i)
        return
      }
      aoEscolherRef.current(null)
    }
    canvas.addEventListener('pointerdown', aoDescer)
    canvas.addEventListener('pointerup', aoSubir)

    let quadro = 0
    const laco = (): void => {
      quadro = requestAnimationFrame(laco)
      const p = palco.current
      if (!p) return
      if (p.controles.update() || p.sujo) {
        p.sujo = false
        renderer.render(cena, camera)
      }
    }
    laco()

    return () => {
      cancelAnimationFrame(quadro)
      ro.disconnect()
      temaObs.disconnect()
      canvas.removeEventListener('pointerdown', aoDescer)
      canvas.removeEventListener('pointerup', aoSubir)
      controles.dispose()
      for (const m of [...malhas, ...terreno.map((x) => x.malha)]) {
        m.geometry.dispose()
        const mat = m.material as MeshLambertMaterial
        mat.map?.dispose()
        mat.dispose()
      }
      for (const l of linhas) {
        l.geometry.dispose()
        ;(l.material as LineBasicMaterial).dispose()
      }
      renderer.dispose()
      palco.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo])

  // paleta por classe, refeita quando o tema muda
  useEffect(() => {
    const p = palco.current
    if (!p) return
    const fantasma = cor('m4d-fantasma')
    const estados = [cor('success'), cor('module-planejamento'), cor('accent'), cor('danger')]
    const contexto = cor('m4d-contexto')
    p.solo = cor('m4d-solo')
    p.chao = cor('m4d-terreno')
    p.destaque = cor('chart-laranja')
    p.cena.background = cor('m4d-ceu')
    const eixo = cor('accent')
    for (const o of p.mundo.children)
      if (o instanceof Line) (o.material as LineBasicMaterial).color = eixo
    const vistos = new Map<string, number>()
    p.paleta = modelo.modelo.classes.map((c) => {
      const token = tokenDoMaterial(c)
      const k = vistos.get(token) ?? 0
      vistos.set(token, k + 1)
      // classes do mesmo material (sub-base, base…) ganham tons vizinhos para se distinguirem
      const material = cor(token).offsetHSL(0, 0, c.contexto ? 0 : -0.035 * (k % 4))
      const cores = [
        fantasma,
        fantasma,
        material,
        mistura(material, estados[2], 0.55),
        estados[0],
        estados[1],
        estados[2],
        estados[3],
        c.contexto ? material : contexto
      ]
      const out = new Float32Array(N * 2 * 3)
      cores.forEach((x, i) => {
        out.set([x.r, x.g, x.b], i * 3)
        const fora = mistura(x, fantasma, 0.78)
        out.set([fora.r, fora.g, fora.b], (N + i) * 3)
      })
      return out
    })
    p.codigo.fill(255)
    for (const b of p.terreno) b.ultimo = null
    p.sujo = true
  }, [modelo, tema])

  // estado → cores das peças e cota do terreno
  useEffect(() => {
    const p = palco.current
    if (!p || !p.paleta.length) return
    const { pecas, malhas } = modelo
    const classes = modelo.modelo.classes
    let dentro: Uint8Array | null = null
    if (estado && periodo) {
      const n = pecas.length
      const pa = new Float32Array(n)
      const ra = new Float32Array(n)
      const pb = new Float32Array(n)
      const rb = new Float32Array(n)
      estado.calcularEm(periodo[0], pa, ra)
      estado.calcularEm(periodo[1], pb, rb)
      dentro = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        const dp = pb[i] - pa[i] > VAZIO
        const dr = rb[i] - ra[i] > VAZIO
        dentro[i] = (modo === 'previsto' ? dp : modo === 'realizado' ? dr : dp || dr) ? 1 : 0
      }
    }
    estado?.calcular(t)

    malhas.forEach((m, ic) => {
      const malha = p.malhas[ic]
      malha.visible = !ocultas.has(classes[ic].id) && m.pecas.length > 0
      if (!malha.visible) return
      const attr = malha.geometry.getAttribute('color') as BufferAttribute
      const a = attr.array as Float32Array
      const pal = p.paleta[ic]
      let mudou = false
      for (const i of m.pecas) {
        let cod: number
        const falta = mostrarFalta && !pecas[i].sobre ? FALTA : SOME
        const prev = estado ? estado.prev[i] : NaN
        if (classes[ic].contexto) cod = CONTEXTO
        // sem vínculo nenhum, a cena mostra a obra pronta; classe solta num modelo vinculado vira contexto, e a
        // camada empilhada some para não cobrir o estado das de baixo
        else if (!estado) cod = MATERIAL
        else if (Number.isNaN(prev)) cod = pecas[i].sobre ? SOME : CONTEXTO
        else {
          const real = estado!.real[i]
          if (modo === 'comparar') {
            const s = situacao(prev, real)
            cod =
              s === 'concluido'
                ? CONCLUIDO
                : s === 'adiantado'
                  ? ADIANTADO
                  : s === 'execucao'
                    ? EXECUCAO
                    : s === 'atrasado'
                      ? ATRASADO
                      : falta
          } else {
            const g = modo === 'previsto' ? prev : real
            cod = g >= CHEIO ? MATERIAL : g > VAZIO ? FRENTE : falta
          }
          if (dentro && !dentro[i] && cod !== SOME) cod |= FORA
        }
        if (i === selecionada) cod |= ESCOLHIDA
        if (p.codigo[i] === cod) continue
        p.codigo[i] = cod
        mudou = true
        const base = cod & 15
        const k = ((cod & FORA ? N : 0) + base) * 3
        const r = cod & ESCOLHIDA ? p.destaque.r : pal[k]
        const g2 = cod & ESCOLHIDA ? p.destaque.g : pal[k + 1]
        const b = cod & ESCOLHIDA ? p.destaque.b : pal[k + 2]
        const alfa = base === SOME && !(cod & ESCOLHIDA) ? 0 : 1
        const pc = pecas[i]
        for (let v = pc.v0; v < pc.v1; v++) {
          a[4 * v] = r
          a[4 * v + 1] = g2
          a[4 * v + 2] = b
          a[4 * v + 3] = alfa
        }
      }
      if (mudou) attr.needsUpdate = true
    })

    // terreno: do atual para o de projeto conforme a terraplenagem anda (no modo comparar vale o realizado)
    const graus = estado
      ? estado.terreno(modo === 'previsto' ? estado.prev : estado.real, PASSO_TERRENO)
      : null
    const assinatura = graus ? graus[0] : new Float32Array(0)
    modelo.terreno.forEach((b, ib) => {
      const alvo = p.terreno[ib]
      const u = alvo.ultimo
      if (u && u.length === assinatura.length && u.every((v, i) => v === assinatura[i])) return
      alvo.ultimo = assinatura.slice()
      // com imagem, a cor do vértice multiplica a foto (branco não muda nada); sem imagem, ela é a cor do chão
      const de = b.imagem ? [1, 1, 1] : [p.chao.r, p.chao.g, p.chao.b]
      const f = b.imagem ? 1.6 : 1
      const para = [p.solo.r * f, p.solo.g * f, p.solo.b * f]
      const pos = alvo.malha.geometry.getAttribute('position') as BufferAttribute
      const cores = alvo.malha.geometry.getAttribute('color') as BufferAttribute
      const pa = pos.array as Float32Array
      const ca = cores.array as Float32Array
      for (let i = 0; i < b.dz.length; i++) {
        const e = modelo.eixos[b.eixo[i]]
        const g = graus
          ? (graus[b.eixo[i]][
              Math.max(
                0,
                Math.min(graus[b.eixo[i]].length - 1, Math.floor((b.s[i] - e.sMin) / PASSO_TERRENO))
              )
            ] ?? 1)
          : 1
        const mexe = Math.abs(b.dz[i]) > 0.05 ? g : 0
        // sob a plataforma pronta o terreno desce um pouco: a grade de 12 m não acompanha o bordo e apareceria por cima
        pa[3 * i + 1] = b.pos[3 * i + 1] + b.dz[i] * mexe - (b.afastamento[i] < 9 ? 0.35 * mexe : 0)
        // onde a terraplenagem passou aparece o solo exposto
        ca[3 * i] = de[0] + (para[0] - de[0]) * mexe
        ca[3 * i + 1] = de[1] + (para[1] - de[1]) * mexe
        ca[3 * i + 2] = de[2] + (para[2] - de[2]) * mexe
      }
      pos.needsUpdate = true
      cores.needsUpdate = true
      alvo.malha.geometry.computeVertexNormals()
    })
    p.sujo = true
  }, [modelo, estado, t, modo, periodo, ocultas, mostrarFalta, selecionada, tema])

  useEffect(() => {
    const p = palco.current
    if (!p) return
    p.mundo.scale.y = exagero
    p.sujo = true
  }, [exagero, modelo])

  if (falha) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-muted">
        {falha}
      </div>
    )
  }
  return (
    <div ref={caixa} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={tela}
        role="img"
        aria-label={rotulo}
        className="block h-full w-full touch-none"
      />
    </div>
  )
})
