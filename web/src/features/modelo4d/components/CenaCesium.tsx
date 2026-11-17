import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  BoundingSphere,
  BoxGeometry,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  DistanceDisplayConditionGeometryInstanceAttribute,
  Ellipsoid,
  Geometry,
  GeometryAttribute,
  GeometryInstance,
  HeadingPitchRange,
  JulianDate,
  Matrix3,
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
  PostProcessStage,
  PostProcessStageLibrary,
  Primitive,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  ShadowMode,
  Transforms,
  UrlTemplateImageryProvider
} from '@cesium/engine'
import '@cesium/engine/Source/Widget/CesiumWidget.css'
import { situacao, type Estado4D } from '../lib/estado'
import { geoParaUtm, utmParaGeo } from '../lib/geo'
import { cotaNaGrade, type ModeloPronto } from '../lib/preparar'
import { RelevoRegional, type MosaicoRelevo } from '../lib/relevo'
import { Superficie } from '../lib/superficie'
import {
  ARESTAS,
  FORCA_ARESTA,
  PADRAO_DO_MATERIAL,
  VERTICE,
  fragmento,
  type Exibicao
} from './aparencia'
import { iniciarCaminhada, type OpcoesAndar } from './caminhada'
import { cor, coresDosMateriais, mistura, type Rgb } from './cores'
import { CuboVista, type CuboVistaRef, type VistaCubo } from './CuboVista'

// os operários, as texturas e os dados do Cesium são servidos pelo próprio site (ver vite.config.ts)
;(globalThis as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium/'

export type Modo4D = 'previsto' | 'realizado' | 'comparar' | 'projeto'
export type ModoMouse = 'orbitar' | 'mover' | 'andar'

/** Posição da câmera para guardar numa vista: o ponto no mundo e para onde ela olha. */
export interface CameraSalva {
  p: [number, number, number]
  rumo: number
  inclinacao: number
}

export interface CenaRef {
  irPara: (eixo: number, s: number) => void
  vistaGeral: () => void
  /** Põe a câmera sobre a pista na estaca `s`, olhando para a frente (ou para trás). */
  percorrer: (eixo: number, s: number, paraTras?: boolean) => void
  /** Centra e aproxima a peça. */
  focar: (peca: number) => void
  camera: () => CameraSalva | null
  irParaCamera: (c: CameraSalva) => void
  /** Enquadra a obra na estaca `s`, de cima e por trás, sem animação (a câmera da simulação). */
  enquadrar: (eixo: number, s: number) => void
  /** Desenha a cena agora e devolve a tela, para quem grava o vídeo. */
  quadro: () => HTMLCanvasElement | null
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
  andar: OpcoesAndar
  /** No passeio pela pista (e no Andar) a câmera segue a obra, não o terreno natural. */
  passeando: boolean
  exibicao: Exibicao
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
  /** Estilo e luz com que as primitivas foram montadas. */
  aparencia: string
  arestas: PostProcessStage
  /** Fatias que já existem na data mostrada (1) ou não (0). */
  ativa: Uint8Array
  boneco: Primitive | null
}

const aparenciaDasPecas = (e: Exibicao): PerInstanceColorAppearance =>
  new PerInstanceColorAppearance({
    flat: false,
    translucent: false,
    closed: false,
    vertexShaderSource: VERTICE,
    fragmentShaderSource: fragmento(e.estilo, e.luz)
  })

export const CenaCesium = forwardRef<CenaRef, Props>(function CenaCesium(
  {
    modelo,
    estado,
    t,
    modo,
    periodo,
    ocultas,
    mouse,
    andar,
    passeando,
    exibicao,
    selecionada,
    aoEscolher,
    rotulo
  },
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
  const exibicaoRef = useRef(exibicao)
  useEffect(() => {
    exibicaoRef.current = exibicao
  }, [exibicao])
  const andarRef = useRef(andar)
  useEffect(() => {
    andarRef.current = andar
  }, [andar])
  const superficie = useMemo(() => new Superficie(modelo), [modelo])

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

  /** Centra e aproxima uma peça, mantendo o rumo da câmera. */
  const focar = (i: number): void => {
    const w = palco.current?.w
    const pc = modelo.pecas[i]
    if (!w || !pc) return
    const pos = modelo.malhas[pc.classe].pos
    const pts: Cartesian3[] = []
    const salto = Math.max(1, Math.floor((pc.v1 - pc.v0) / 60))
    for (let v = pc.v0; v < pc.v1; v += salto)
      pts.push(mundo(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]))
    if (!pts.length) return
    const esfera = BoundingSphere.fromPoints(pts)
    w.camera.flyToBoundingSphere(esfera, {
      duration: 0.6,
      offset: new HeadingPitchRange(
        w.camera.heading,
        Math.max(CesiumMath.toRadians(-70), Math.min(CesiumMath.toRadians(-18), w.camera.pitch)),
        Math.max(12, esfera.radius * 3.2)
      )
    })
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
    },
    focar,
    camera: () => {
      const c = palco.current?.w.camera
      if (!c) return null
      return {
        p: [c.positionWC.x, c.positionWC.y, c.positionWC.z],
        rumo: c.heading,
        inclinacao: c.pitch
      }
    },
    irParaCamera: (v) => {
      palco.current?.w.camera.flyTo({
        destination: new Cartesian3(v.p[0], v.p[1], v.p[2]),
        orientation: { heading: v.rumo, pitch: v.inclinacao, roll: 0 },
        duration: 0.8
      })
    },
    enquadrar: (ie, s) => {
      const w = palco.current?.w
      const q = noEixo(ie, s)
      if (!w || !q) return
      w.camera.lookAt(q.p, new HeadingPitchRange(q.rumo, CesiumMath.toRadians(-26), 320))
      w.camera.lookAtTransform(Matrix4.IDENTITY)
      w.scene.requestRender()
    },
    quadro: () => {
      const w = palco.current?.w
      if (!w) return null
      w.scene.render()
      return w.scene.canvas
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
    scene.globe.depthTestAgainstTerrain = true
    // fundo cor de céu: dentro de um corte a câmera fica abaixo do terreno natural e o Cesium não desenha o céu
    scene.backgroundColor = new Color(0.56, 0.74, 0.94, 1)
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
      pronto: false,
      aparencia: `${exibicaoRef.current.estilo}|${exibicaoRef.current.luz}`,
      arestas: new PostProcessStage({
        fragmentShader: ARESTAS,
        uniforms: { forca: FORCA_ARESTA[exibicaoRef.current.estilo] }
      }),
      ativa: new Uint8Array(modelo.fatias.length),
      boneco: null
    }
    scene.postProcessStages.add(p.arestas)
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
    const cimaL = new Cartesian3()
    const cimaN = new Cartesian3()
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
          // base local da peça: leste, norte e a vertical no primeiro vértice (exata ali, linear em volta). A
          // vertical também varia com a posição: com a cota perto de 1.000 m, uma vertical fixa por peça abriria
          // frestas de milímetros entre peças vizinhas
          const x0 = m.pos[3 * pc.v0]
          const n0 = m.pos[3 * pc.v0 + 1]
          const o = mundo(x0, n0, 0)
          const le = mundo(x0 + 40, n0, 0)
          const no = mundo(x0, n0 + 40, 0)
          Ellipsoid.WGS84.geodeticSurfaceNormal(o, cima)
          Ellipsoid.WGS84.geodeticSurfaceNormal(le, cimaL)
          Ellipsoid.WGS84.geodeticSurfaceNormal(no, cimaN)
          const cex = (cimaL.x - cima.x) / 40
          const cey = (cimaL.y - cima.y) / 40
          const cez = (cimaL.z - cima.z) / 40
          const cnx = (cimaN.x - cima.x) / 40
          const cny = (cimaN.y - cima.y) / 40
          const cnz = (cimaN.z - cima.z) / 40
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
            pos[3 * v] = o.x + dx * ex + dn * nx + z * (cima.x + dx * cex + dn * cnx)
            pos[3 * v + 1] = o.y + dx * ey + dn * ny + z * (cima.y + dx * cey + dn * cny)
            pos[3 * v + 2] = o.z + dx * ez + dn * nz + z * (cima.z + dx * cez + dn * cnz)
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
                // o alfa leva o padrão do material para o shader (a peça é opaca)
                color: new ColorGeometryInstanceAttribute(
                  c[0],
                  c[1],
                  c[2],
                  PADRAO_DO_MATERIAL[modelo.materiais[pc.material]] / 255
                ),
                show: new ShowGeometryInstanceAttribute(true)
              }
            })
          )
        }
        const prim = new Primitive({
          geometryInstances: instancias,
          appearance: aparenciaDasPecas(exibicaoRef.current),
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
    // duplo clique centra e aproxima a peça
    mao.setInputAction((e: { position: Cartesian2 }) => {
      const alvo = scene.pick(e.position) as { id?: unknown } | undefined
      if (typeof alvo?.id === 'number') focar(alvo.id)
    }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

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
    // andando ou percorrendo a pista, quem segura a câmera é a obra: a colisão do Cesium com o terreno natural
    // a levantaria nos cortes
    c.enableInputs = mouse !== 'andar'
    c.enableCollisionDetection = mouse !== 'andar' && !passeando
    if (mouse !== 'andar' && !passeando) return
    // Dentro de um corte a câmera fica abaixo do terreno natural (que ali foi escavado). O Cesium, achando que
    // ela está debaixo da terra, desenharia o avesso do terreno por cima da cena. O campo é interno do Cesium: se
    // mudar de nome numa versão nova, o efeito é só esse avesso aparecer nos cortes.
    const cena = palco.current!.w.scene
    return cena.preRender.addEventListener(() => {
      const interno = cena as unknown as { _cameraUnderground?: boolean }
      if (interno._cameraUnderground) interno._cameraUnderground = false
    })
  }, [mouse, passeando, modelo, montada])

  // modo Andar: teclado e mouse movem quem anda, sobre a obra onde ela já existe e sobre o terreno fora dela
  useEffect(() => {
    const p = palco.current
    const alvo = caixa.current
    if (mouse !== 'andar' || !p || !p.pronto || !alvo || !fuso || !origem) return
    const { scene } = p.w
    const carto = new Cartographic()
    let ultimo = 0
    const boneco = (pe: Cartesian3 | null, rumo: number): void => {
      if (!pe) {
        if (p.boneco) p.boneco.show = false
        return
      }
      if (!p.boneco) {
        const parte = (dim: [number, number, number], alto: number, c: Rgb): GeometryInstance =>
          new GeometryInstance({
            geometry: BoxGeometry.fromDimensions({
              dimensions: new Cartesian3(...dim),
              vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT
            }),
            modelMatrix: Matrix4.fromTranslation(new Cartesian3(0, 0, alto)),
            attributes: { color: new ColorGeometryInstanceAttribute(c[0], c[1], c[2], 1) }
          })
        p.boneco = scene.primitives.add(
          new Primitive({
            geometryInstances: [
              parte([0.5, 0.28, 1.45], 0.725, cor('chart-laranja')),
              parte([0.24, 0.24, 0.26], 1.58, cor('m4d-madeira')),
              parte([0.32, 0.32, 0.1], 1.75, cor('m4d-sinal-branco'))
            ],
            appearance: new PerInstanceColorAppearance({ translucent: false, closed: true }),
            asynchronous: false
          })
        ) as Primitive
      }
      p.boneco.show = true
      p.boneco.modelMatrix = Matrix4.multiplyByMatrix3(
        Transforms.eastNorthUpToFixedFrame(pe),
        Matrix3.fromRotationZ(-rumo),
        new Matrix4()
      )
    }
    return iniciarCaminhada({
      w: p.w,
      alvo,
      opcoes: () => andarRef.current,
      paraLocal: (q) => {
        Cartographic.fromCartesian(q, undefined, carto)
        const [e, n] = geoParaUtm(
          CesiumMath.toDegrees(carto.longitude),
          CesiumMath.toDegrees(carto.latitude),
          fuso
        )
        return [e - origem.e, n - origem.n, carto.height]
      },
      paraMundo: (x, n, z) => mundo(x - modelo.centro[0], n - modelo.centro[1], z),
      chao: (x, n) => {
        const q = superficie.em(x, n)
        if (q && p.ativa[q.fatia]) return (ultimo = q.z)
        // fora da obra (ou onde ela ainda não existe na data), o terreno que a cena desenha
        Cartographic.fromCartesian(
          mundo(x - modelo.centro[0], n - modelo.centro[1], 0),
          undefined,
          carto
        )
        const z = scene.globe.getHeight(carto) ?? cotaNaGrade(modelo.grades, x, n, 'atual')
        return z == null || Number.isNaN(z) ? ultimo : (ultimo = z)
      },
      boneco
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mouse, modelo, montada, superficie])

  // estilo, luz e efeitos: troca o shader das peças e liga ou desliga sombras, sombra de contato e arestas
  useEffect(() => {
    const p = palco.current
    if (!p) return
    const { scene } = p.w
    const sol = exibicao.luz === 'sol'
    const sombras = sol && exibicao.sombras
    scene.globe.enableLighting = sol
    scene.shadowMap.enabled = sombras
    scene.shadowMap.softShadows = true
    scene.shadowMap.maximumDistance = 1200
    scene.shadowMap.darkness = 0.55
    scene.globe.shadows = sombras ? ShadowMode.RECEIVE_ONLY : ShadowMode.DISABLED
    const oclusao = scene.postProcessStages.ambientOcclusion
    const contato = exibicao.contato && PostProcessStageLibrary.isAmbientOcclusionSupported(scene)
    oclusao.enabled = contato
    oclusao.uniforms.intensity = 2.2
    oclusao.uniforms.bias = 0.12
    oclusao.uniforms.lengthCap = 0.6
    oclusao.uniforms.stepCount = 16
    // a sombra de contato custa metade dos quadros: sai enquanto a câmera se move e volta quando ela para
    const parar = p.w.camera.moveStart.addEventListener(() => {
      oclusao.enabled = false
    })
    const voltar = p.w.camera.moveEnd.addEventListener(() => {
      oclusao.enabled = contato
      scene.requestRender()
    })
    ;(p.arestas.uniforms as { forca: number }).forca = FORCA_ARESTA[exibicao.estilo]
    const chave = `${exibicao.estilo}|${exibicao.luz}`
    if (chave !== p.aparencia) {
      p.aparencia = chave
      for (const prim of p.prims) if (prim) prim.appearance = aparenciaDasPecas(exibicao)
    }
    scene.requestRender()
    return () => {
      parar()
      voltar()
    }
  }, [exibicao, modelo, montada])

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
    const padrao = modelo.materiais.map((m) => PADRAO_DO_MATERIAL[m])

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
    p.ativa = ativa

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
          tipo === FALTA ? 0 : padrao[pecas[i].material]
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
      const poligonos = trechos.map((r0) => {
        // cada polígono entra uma fatia no seguinte: sem a sobra, fica um fio de terreno na emenda
        const prox = r0[r0.length - 1] + 1
        const segue =
          ativa[prox] === 1 &&
          fatias[prox].eixo === fatias[prox - 1].eixo &&
          fatias[prox].s0 === fatias[prox - 1].s1
        const r = segue ? [...r0, prox] : r0
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
  const olhar = (vista: VistaCubo): void => {
    const w = palco.current?.w
    const alvo = pivo()
    if (!w || !alvo) return
    w.camera.flyToBoundingSphere(new BoundingSphere(alvo.p, 1), {
      duration: 0.5,
      offset: new HeadingPitchRange(
        vista.rumo ?? w.camera.heading,
        vista.inclinacao,
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
      <div
        ref={caixa}
        role={mouse === 'andar' ? 'application' : 'img'}
        tabIndex={mouse === 'andar' ? 0 : undefined}
        aria-label={
          mouse === 'andar'
            ? `${rotulo}. Andar: W, A, S e D ou as setas movem, arrastar olha em volta, Shift corre.`
            : rotulo
        }
        className="h-full w-full focus-visible:outline-none"
      />
      <CuboVista ref={cubo} aoOlhar={olhar} aoArrastar={arrastarCubo} aoInicio={vistaGeral} />
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
