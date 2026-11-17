import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  DistanceDisplayConditionGeometryInstanceAttribute,
  Ellipsoid,
  Geometry,
  GeometryAttribute,
  GeometryInstance,
  HeadingPitchRange,
  JulianDate,
  Matrix4,
  PolylineGeometry,
  PrimitiveType,
  ShowGeometryInstanceAttribute,
  Math as CesiumMath
} from '@cesium/core'
import {
  ArcGisMapServerImageryProvider,
  CameraEventType,
  CesiumWidget,
  ClippingPolygon,
  ClippingPolygonCollection,
  CustomHeightmapTerrainProvider,
  GeographicTilingScheme,
  ImageryLayer,
  KeyboardEventModifier,
  PerInstanceColorAppearance,
  PolylineColorAppearance,
  Primitive,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  ShadowMode,
  UrlTemplateImageryProvider
} from '@cesium/engine'
import '@cesium/engine/Source/Widget/CesiumWidget.css'
import { situacao, type Estado4D } from '../lib/estado'
import { utmParaGeo } from '../lib/geo'
import type { ModeloPronto } from '../lib/preparar'
import { RelevoRegional, type MosaicoRelevo } from '../lib/relevo'
import { cor, coresDosMateriais, mistura, type Rgb } from './cores'
import { CuboVista, type CuboVistaRef, type FaceCubo } from './CuboVista'

// os operários, as texturas e os dados do Cesium são servidos pelo próprio site (ver vite.config.ts)
;(globalThis as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium/'

export type Modo4D = 'previsto' | 'realizado' | 'comparar' | 'projeto'
export type ModoMouse = 'orbitar' | 'mover'

export interface CenaRef {
  irPara: (eixo: number, s: number) => void
  vistaGeral: () => void
  /** Põe a câmera sobre a pista na estaca `s`, olhando para a frente (ou para trás). */
  percorrer: (eixo: number, s: number, paraTras?: boolean) => void
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
  mouse: ModoMouse
  sombras: boolean
  selecionada: number | null
  aoEscolher: (peca: number | null) => void
  rotulo: string
}

// código visual de cada peça: 0 some; os demais escolhem a cor
const SOME = 0
const FALTA = 1
const MATERIAL = 2
const FRENTE = 3
const CONCLUIDO = 4
const ADIANTADO = 5
const EXECUCAO = 6
const ATRASADO = 7
const FORA = 16
const ESCOLHIDA = 32

const CHEIO = 0.999
const VAZIO = 0.001
/** Quantas fatias (de 20 m) cabem num polígono de recorte do terreno. */
const FATIAS_POR_RECORTE = 25

const RELEVO_ABERTO = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const IMAGEM = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'

/** Mosaico do relevo aberto (codificação "terrarium": metros = R × 256 + G + B ÷ 256 − 32768). */
async function mosaicoAberto(z: number, x: number, y: number): Promise<MosaicoRelevo | null> {
  const r = await fetch(`${RELEVO_ABERTO}/${z}/${x}/${y}.png`)
  if (!r.ok) return null
  const bmp = await createImageBitmap(await r.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none'
  })
  const ctx = new OffscreenCanvas(256, 256).getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bmp, 0, 0)
  const d = ctx.getImageData(0, 0, 256, 256).data
  const out = new Int16Array(65536)
  for (let i = 0; i < 65536; i++)
    out[i] = Math.round((d[4 * i] * 256 + d[4 * i + 1] + d[4 * i + 2] / 256 - 32768) * 2)
  return out
}

interface Palco {
  w: CesiumWidget
  /** Uma primitiva por classe (null quando a classe não tem peça). */
  prims: (Primitive | null)[]
  /** Atributos de cada peça na sua primitiva, pegos quando ela fica pronta. */
  attrs: ({ color: Uint8Array; show: Uint8Array } | null)[]
  codigo: Uint8Array
  /** Cantos de cada fatia da pegada, já no mundo. */
  cantos: Cartesian3[][]
  recorte: string
  pronto: boolean
}

export const CenaCesium = forwardRef<CenaRef, Props>(function CenaCesium(
  { modelo, estado, t, modo, periodo, ocultas, mouse, sombras, selecionada, aoEscolher, rotulo },
  ref
): ReactNode {
  const caixa = useRef<HTMLDivElement>(null)
  const creditos = useRef<HTMLDivElement>(null)
  const cubo = useRef<CuboVistaRef>(null)
  const palco = useRef<Palco | null>(null)
  const [fase, setFase] = useState<string | null>('Abrindo o terreno…')
  const [falha, setFalha] = useState<string | null>(null)
  const [montada, setMontada] = useState(0)
  const aoEscolherRef = useRef(aoEscolher)
  useEffect(() => {
    aoEscolherRef.current = aoEscolher
  }, [aoEscolher])

  const origem = modelo.modelo.origem
  const fuso = modelo.fuso

  /** Ponto do modelo (x e n relativos ao centro das malhas) no mundo. */
  const mundo = (x: number, n: number, z: number): Cartesian3 => {
    const [lon, lat] = utmParaGeo(
      x + modelo.centro[0] + origem!.e,
      n + modelo.centro[1] + origem!.n,
      fuso!
    )
    return Cartesian3.fromDegrees(lon, lat, z)
  }
  const noEixo = (ie: number, s: number, sobe = 0): { p: Cartesian3; rumo: number } | null => {
    const e = modelo.eixos[ie]
    if (!e || !fuso) return null
    const q = e.em(s)
    return {
      p: mundo(q.x - modelo.centro[0], q.n - modelo.centro[1], q.z + sobe),
      rumo: Math.atan2(q.tx, q.tn)
    }
  }
  /** Ponto do terreno no centro da tela e a distância da câmera até ele. */
  const pivo = (): { p: Cartesian3; dist: number } | null => {
    const w = palco.current?.w
    if (!w) return null
    const c = w.scene.canvas
    const raio = w.camera.getPickRay(new Cartesian2(c.clientWidth / 2, c.clientHeight / 2))
    const p = raio ? w.scene.globe.pick(raio, w.scene) : undefined
    return p ? { p, dist: Cartesian3.distance(w.camera.positionWC, p) } : null
  }

  const vistaGeral = (): void => {
    const w = palco.current?.w
    const e = modelo.eixos[0]
    if (!w || !e || !fuso) return
    const pts = e.p
      .filter((_, i) => i % 20 === 0)
      .map((q) => mundo(q[1] - modelo.centro[0], q[2] - modelo.centro[1], q[3]))
    const esfera = BoundingSphere.fromPoints(pts)
    w.camera.flyToBoundingSphere(esfera, {
      duration: 0,
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-50), esfera.radius * 2.2)
    })
  }

  useImperativeHandle(ref, () => ({
    vistaGeral,
    irPara: (ie, s) => {
      const w = palco.current?.w
      const q = noEixo(ie, s)
      if (!w || !q) return
      w.camera.flyToBoundingSphere(new BoundingSphere(q.p, 1), {
        duration: 0.8,
        offset: new HeadingPitchRange(q.rumo, CesiumMath.toRadians(-28), 260)
      })
    },
    percorrer: (ie, s, paraTras) => {
      const w = palco.current?.w
      const q = noEixo(ie, s, 3.2)
      if (!w || !q) return
      w.camera.setView({
        destination: q.p,
        orientation: {
          heading: q.rumo + (paraTras ? Math.PI : 0),
          pitch: CesiumMath.toRadians(-7),
          roll: 0
        }
      })
      w.scene.requestRender()
    }
  }))

  // monta a cena uma vez por modelo
  useEffect(() => {
    const el = caixa.current
    if (!el || !creditos.current) return
    if (!fuso || !origem) {
      setFalha(
        'Este modelo não traz a origem e o fuso UTM, e sem eles a cena não sabe onde a obra fica. Gere o modelo de novo com `origem` (e, n e fuso) e importe outra vez.'
      )
      return
    }
    let vivo = true
    let w: CesiumWidget
    const relevo = new RelevoRegional(modelo, mosaicoAberto)
    const grade = new GeographicTilingScheme()
    try {
      w = new CesiumWidget(el, {
        baseLayer: false,
        terrainProvider: new CustomHeightmapTerrainProvider({
          width: 65,
          height: 65,
          tilingScheme: grade,
          credit: 'Relevo: Mapzen e AWS Terrain Tiles (SRTM e outros)',
          callback: (x, y, nivel) => {
            const r = grade.tileXYToRectangle(x, y, nivel)
            const g = CesiumMath.toDegrees
            return relevo.alturas(g(r.west), g(r.south), g(r.east), g(r.north), 65, 65, nivel)
          }
        }),
        creditContainer: creditos.current,
        scene3DOnly: true,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        msaaSamples: 4
      })
    } catch {
      setFalha('Este navegador não abriu a cena 3D (WebGL 2 indisponível).')
      return
    }
    const { scene, camera } = w
    w.clock.shouldAnimate = false
    // sol do meio da tarde (15 h de Brasília), para o relevo e as sombras ficarem legíveis
    w.clock.currentTime = JulianDate.fromIso8601('2026-06-21T18:00:00Z')
    scene.globe.enableLighting = true
    scene.globe.depthTestAgainstTerrain = true
    scene.screenSpaceCameraController.enableCollisionDetection = true
    scene.screenSpaceCameraController.minimumZoomDistance = 2

    void ArcGisMapServerImageryProvider.fromUrl(IMAGEM)
      .catch(
        () =>
          new UrlTemplateImageryProvider({
            url: `${IMAGEM}/tile/{z}/{y}/{x}`,
            maximumLevel: 17,
            credit: 'Imagem: Esri, Maxar, Earthstar Geographics'
          })
      )
      .then((prov) => {
        if (!vivo) return
        scene.imageryLayers.add(new ImageryLayer(prov))
        scene.requestRender()
      })

    const p: Palco = {
      w,
      prims: modelo.malhas.map(() => null),
      attrs: modelo.pecas.map(() => null),
      codigo: new Uint8Array(modelo.pecas.length).fill(255),
      cantos: [],
      recorte: '',
      pronto: false
    }
    palco.current = p
    vistaGeral()

    // eixo: uma linha que se vê de longe e através do terreno, para achar a obra na vista geral
    const corEixo = cor('accent')
    for (const e of modelo.eixos) {
      const linha = new PolylineColorAppearance({ translucent: true })
      scene.primitives.add(
        new Primitive({
          geometryInstances: new GeometryInstance({
            geometry: new PolylineGeometry({
              positions: e.p.map((q) =>
                mundo(q[1] - modelo.centro[0], q[2] - modelo.centro[1], q[3] + 0.6)
              ),
              width: 2.5,
              vertexFormat: PolylineColorAppearance.VERTEX_FORMAT
            }),
            attributes: {
              color: new ColorGeometryInstanceAttribute(corEixo[0], corEixo[1], corEixo[2], 1),
              depthFailColor: new ColorGeometryInstanceAttribute(
                corEixo[0],
                corEixo[1],
                corEixo[2],
                0.55
              ),
              // de perto a pista já se vê: a linha é só para achar a obra de longe
              distanceDisplayCondition: new DistanceDisplayConditionGeometryInstanceAttribute(
                2500,
                1e9
              )
            }
          }),
          appearance: linha,
          depthFailAppearance: linha,
          asynchronous: false
        })
      )
    }

    // peças: uma primitiva por classe, uma instância por peça (cor e visibilidade próprias)
    const materiais = coresDosMateriais()
    const cima = new Cartesian3()
    const montar = async (): Promise<void> => {
      for (let ic = 0; ic < modelo.malhas.length; ic++) {
        if (!vivo) return
        const m = modelo.malhas[ic]
        if (!m.pecas.length) continue
        const instancias: GeometryInstance[] = []
        for (const i of m.pecas) {
          const pc = modelo.pecas[i]
          const nv = pc.v1 - pc.v0
          const pos = new Float64Array(nv * 3)
          const nor = new Float32Array(nv * 3)
          // base local da peça: leste, norte e a vertical no primeiro vértice (exata ali, linear em volta)
          const x0 = m.pos[3 * pc.v0]
          const n0 = m.pos[3 * pc.v0 + 1]
          const o = mundo(x0, n0, 0)
          const le = mundo(x0 + 40, n0, 0)
          const no = mundo(x0, n0 + 40, 0)
          Ellipsoid.WGS84.geodeticSurfaceNormal(o, cima)
          const ex = (le.x - o.x) / 40
          const ey = (le.y - o.y) / 40
          const ez = (le.z - o.z) / 40
          const nx = (no.x - o.x) / 40
          const ny = (no.y - o.y) / 40
          const nz = (no.z - o.z) / 40
          for (let v = 0; v < nv; v++) {
            const dx = m.pos[3 * (pc.v0 + v)] - x0
            const dn = m.pos[3 * (pc.v0 + v) + 1] - n0
            const z = m.pos[3 * (pc.v0 + v) + 2]
            pos[3 * v] = o.x + dx * ex + dn * nx + z * cima.x
            pos[3 * v + 1] = o.y + dx * ey + dn * ny + z * cima.y
            pos[3 * v + 2] = o.z + dx * ez + dn * nz + z * cima.z
          }
          for (let v = 0; v + 2 < nv; v += 3) {
            const ax = pos[3 * v + 3] - pos[3 * v]
            const ay = pos[3 * v + 4] - pos[3 * v + 1]
            const az = pos[3 * v + 5] - pos[3 * v + 2]
            const bx = pos[3 * v + 6] - pos[3 * v]
            const by = pos[3 * v + 7] - pos[3 * v + 1]
            const bz = pos[3 * v + 8] - pos[3 * v + 2]
            let cx = ay * bz - az * by
            let cy = az * bx - ax * bz
            let cz = ax * by - ay * bx
            const l = Math.hypot(cx, cy, cz)
            if (l < 1e-9) {
              // triângulo sem área: fica com a vertical, que é uma normal válida
              cx = cima.x
              cy = cima.y
              cz = cima.z
            } else {
              cx /= l
              cy /= l
              cz /= l
            }
            // a normal aponta para o lado de cima: o sol ilumina a face que se vê
            if (cx * cima.x + cy * cima.y + cz * cima.z < 0) {
              cx = -cx
              cy = -cy
              cz = -cz
            }
            for (let k = 0; k < 3; k++) {
              nor[3 * (v + k)] = cx
              nor[3 * (v + k) + 1] = cy
              nor[3 * (v + k) + 2] = cz
            }
          }
          const c = materiais[modelo.materiais[pc.material]]
          instancias.push(
            new GeometryInstance({
              id: i,
              geometry: new Geometry({
                attributes: {
                  position: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.DOUBLE,
                    componentsPerAttribute: 3,
                    values: pos
                  }),
                  normal: new GeometryAttribute({
                    componentDatatype: ComponentDatatype.FLOAT,
                    componentsPerAttribute: 3,
                    values: nor
                  })
                } as never,
                primitiveType: PrimitiveType.TRIANGLES,
                boundingSphere: BoundingSphere.fromVertices(pos as unknown as number[])
              }),
              attributes: {
                color: new ColorGeometryInstanceAttribute(c[0], c[1], c[2], 1),
                show: new ShowGeometryInstanceAttribute(true)
              }
            })
          )
        }
        const prim = new Primitive({
          geometryInstances: instancias,
          appearance: new PerInstanceColorAppearance({
            flat: false,
            translucent: false,
            closed: false
          }),
          asynchronous: false,
          releaseGeometryInstances: true,
          shadows: ShadowMode.ENABLED
        })
        scene.primitives.add(prim)
        p.prims[ic] = prim
        setFase(`Montando a obra… ${Math.round(((ic + 1) / modelo.malhas.length) * 100)}%`)
        await new Promise((ok) => setTimeout(ok))
      }
      // pegada de cada fatia no mundo, para o recorte do terreno
      p.cantos = modelo.fatias.map((f) =>
        f.contorno.map(([x, n]) => mundo(x - modelo.centro[0], n - modelo.centro[1], 0))
      )
    }
    void montar()

    // a cena está pronta quando todas as primitivas terminam de processar a geometria
    const aoRenderizar = (): void => {
      cubo.current?.orientar(camera.heading, camera.pitch)
      if (p.pronto || p.cantos.length !== modelo.fatias.length) return
      if (p.prims.some((x) => x && !x.ready)) {
        scene.requestRender()
        return
      }
      p.pronto = true
      setFase(null)
      setMontada((n) => n + 1)
    }
    scene.postRender.addEventListener(aoRenderizar)
    const pulso = window.setInterval(() => {
      if (!p.pronto) scene.requestRender()
    }, 250)

    // clique sem arrasto escolhe a peça sob o cursor
    const mao = new ScreenSpaceEventHandler(scene.canvas)
    mao.setInputAction((e: { position: Cartesian2 }) => {
      const alvo = scene.pick(e.position) as { id?: unknown } | undefined
      aoEscolherRef.current(typeof alvo?.id === 'number' ? alvo.id : null)
    }, ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      vivo = false
      window.clearInterval(pulso)
      mao.destroy()
      palco.current = null
      w.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo])

  // botões do mouse: orbitar em torno do ponto sob o cursor ou mover o terreno
  useEffect(() => {
    const c = palco.current?.w.scene.screenSpaceCameraController
    if (!c) return
    const orbita = [
      CameraEventType.MIDDLE_DRAG,
      CameraEventType.PINCH,
      { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL }
    ]
    const move = [{ eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.SHIFT }]
    c.tiltEventTypes = mouse === 'orbitar' ? [CameraEventType.LEFT_DRAG, ...orbita] : orbita
    c.rotateEventTypes = mouse === 'orbitar' ? move : [CameraEventType.LEFT_DRAG, ...move]
    c.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.RIGHT_DRAG, CameraEventType.PINCH]
  }, [mouse, modelo, montada])

  useEffect(() => {
    const w = palco.current?.w
    if (!w) return
    w.scene.shadowMap.enabled = sombras
    w.scene.shadowMap.softShadows = true
    w.scene.shadowMap.maximumDistance = 1200
    w.scene.globe.shadows = sombras ? ShadowMode.RECEIVE_ONLY : ShadowMode.DISABLED
    w.scene.requestRender()
  }, [sombras, modelo, montada])

  // estado → cor e visibilidade das peças, e recorte do terreno onde a obra existe
  useEffect(() => {
    const p = palco.current
    if (!p || !p.pronto) return
    const { pecas, malhas, fatias } = modelo
    const classes = modelo.modelo.classes
    const n = pecas.length
    const materiais = coresDosMateriais()
    const base = modelo.materiais.map((m) => materiais[m])
    const cores: Record<number, Rgb> = {
      [FALTA]: cor('m4d-fantasma'),
      [CONCLUIDO]: cor('success'),
      [ADIANTADO]: cor('module-planejamento'),
      [EXECUCAO]: cor('accent'),
      [ATRASADO]: cor('danger')
    }
    const frente = cor('accent')
    const apagado = cor('m4d-contexto')
    const destaque = cor('chart-laranja')

    let dentro: Uint8Array | null = null
    if (estado && periodo && modo !== 'projeto') {
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

    const cod = new Uint8Array(n)
    const semEstado = !estado || modo === 'projeto'
    for (let i = 0; i < n; i++) {
      const c = classes[pecas[i].classe]
      if (c.contexto || semEstado) cod[i] = MATERIAL
      else if (!estado.vinculada[i]) cod[i] = SOME
      else if (modo === 'comparar') {
        const s = situacao(estado.prev[i], estado.real[i])
        cod[i] =
          s === 'concluido'
            ? CONCLUIDO
            : s === 'adiantado'
              ? ADIANTADO
              : s === 'execucao'
                ? EXECUCAO
                : s === 'atrasado'
                  ? ATRASADO
                  : SOME
      } else {
        const g = modo === 'previsto' ? estado.prev[i] : estado.real[i]
        cod[i] = g >= CHEIO ? MATERIAL : g > VAZIO ? FRENTE : SOME
      }
      if (dentro && !dentro[i] && cod[i] !== SOME && !c.contexto) cod[i] |= FORA
    }
    // onde alguma camada existe, o terreno natural sai e a terraplenagem aparece inteira (o que falta, apagado)
    const ativa = new Uint8Array(fatias.length)
    fatias.forEach((f, k) => {
      if (!f.pecas.some((i) => (cod[i] & 15) !== SOME)) return
      ativa[k] = 1
      for (const i of f.pecas)
        if ((cod[i] & 15) === SOME && classes[pecas[i].classe].terreno) cod[i] = FALTA
    })
    if (selecionada != null && selecionada < n) cod[selecionada] |= ESCOLHIDA

    malhas.forEach((m, ic) => {
      const prim = p.prims[ic]
      if (!prim) return
      prim.show = !ocultas.has(classes[ic].id)
      if (!prim.show) return
      for (const i of m.pecas) {
        if (p.codigo[i] === cod[i]) continue
        p.codigo[i] = cod[i]
        const a = (p.attrs[i] ??= prim.getGeometryInstanceAttributes(i) as {
          color: Uint8Array
          show: Uint8Array
        })
        const tipo = cod[i] & 15
        a.show = ShowGeometryInstanceAttribute.toValue(
          tipo !== SOME || !!(cod[i] & ESCOLHIDA),
          a.show
        )
        let c: Rgb =
          tipo === MATERIAL
            ? base[pecas[i].material]
            : tipo === FRENTE
              ? mistura(base[pecas[i].material], frente, 0.5)
              : (cores[tipo] ?? apagado)
        if (cod[i] & FORA) c = mistura(c, apagado, 0.8)
        if (cod[i] & ESCOLHIDA) c = destaque
        a.color = new Uint8Array([
          Math.round(c[0] * 255),
          Math.round(c[1] * 255),
          Math.round(c[2] * 255),
          255
        ])
      }
    })
    // ocultar uma classe não muda o estado das peças dela: ao voltar, repinta
    malhas.forEach((m, ic) => {
      if (p.prims[ic] && !p.prims[ic]!.show) for (const i of m.pecas) p.codigo[i] = 255
    })

    // recorte: trechos seguidos de fatias ativas viram um polígono cada. Polígono curto: a distância até a borda é
    // calculada numa grade por polígono, e um de quilômetros perde a precisão (e custa caro)
    const trechos: number[][] = []
    for (let k = 0; k < fatias.length; k++) {
      if (!ativa[k]) continue
      const ult = trechos[trechos.length - 1]
      const ant = ult ? fatias[ult[ult.length - 1]] : null
      if (
        ant &&
        ult.length < FATIAS_POR_RECORTE &&
        ult[ult.length - 1] === k - 1 &&
        ant.eixo === fatias[k].eixo &&
        ant.s1 === fatias[k].s0
      )
        ult.push(k)
      else trechos.push([k])
    }
    const assinatura = trechos.map((r) => `${r[0]}-${r[r.length - 1]}`).join(',')
    if (assinatura !== p.recorte) {
      p.recorte = assinatura
      const poligonos = trechos.map((r) => {
        const esq = r.map((k) => p.cantos[k][0])
        const dir = r.map((k) => p.cantos[k][1])
        const fim = p.cantos[r[r.length - 1]]
        return new ClippingPolygon({ positions: [...esq, fim[3], fim[2], ...dir.reverse()] })
      })
      p.w.scene.globe.clippingPolygons = new ClippingPolygonCollection({ polygons: poligonos })
    }
    p.w.scene.requestRender()
  }, [modelo, estado, t, modo, periodo, ocultas, selecionada, montada])

  const girarPeloCubo = useRef<{ p: Cartesian3; dist: number } | null>(null)
  const olhar = (face: FaceCubo): void => {
    const w = palco.current?.w
    const alvo = pivo()
    if (!w || !alvo) return
    const rumo = {
      topo: w.camera.heading,
      norte: Math.PI,
      sul: 0,
      leste: -Math.PI / 2,
      oeste: Math.PI / 2
    }[face]
    w.camera.flyToBoundingSphere(new BoundingSphere(alvo.p, 1), {
      duration: 0.5,
      offset: new HeadingPitchRange(
        rumo,
        CesiumMath.toRadians(face === 'topo' ? -89.5 : -18),
        Math.max(40, alvo.dist)
      )
    })
  }
  const arrastarCubo = (dx: number, dy: number, fim: boolean): void => {
    const w = palco.current?.w
    if (!w) return
    if (fim) {
      girarPeloCubo.current = null
      w.camera.lookAtTransform(Matrix4.IDENTITY)
      return
    }
    girarPeloCubo.current ??= pivo()
    const alvo = girarPeloCubo.current
    if (!alvo) return
    const inclinacao = Math.max(
      CesiumMath.toRadians(-89.5),
      Math.min(CesiumMath.toRadians(-3), w.camera.pitch - dy * 0.01)
    )
    w.camera.lookAt(
      alvo.p,
      new HeadingPitchRange(w.camera.heading - dx * 0.012, inclinacao, alvo.dist)
    )
    w.scene.requestRender()
  }

  if (falha) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-muted">
        <p className="max-w-[60ch]">{falha}</p>
      </div>
    )
  }
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={caixa} role="img" aria-label={rotulo} className="h-full w-full" />
      <CuboVista ref={cubo} aoEscolher={olhar} aoArrastar={arrastarCubo} />
      {fase ? (
        <div
          role="status"
          className="absolute left-1/2 top-3 -translate-x-1/2 rounded border border-border bg-bg-panel px-3 py-1.5 text-sm text-text shadow-[var(--sombra-flutuante)]"
        >
          {fase}
        </div>
      ) : null}
      <div
        ref={creditos}
        className="absolute bottom-0 right-0 max-w-[60%] truncate bg-[color:var(--sobre-foto)] px-1.5 text-2xs text-[color:var(--na-foto)] [&_.cesium-credit-logoContainer]:hidden [&_a]:text-[color:var(--na-foto)]"
      />
    </div>
  )
})
