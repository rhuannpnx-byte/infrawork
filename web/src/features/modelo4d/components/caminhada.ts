import { Cartesian3 } from '@cesium/core'
import type { CesiumWidget } from '@cesium/engine'

/** Opções do modo Andar, como o "realismo" do Navisworks. */
export interface OpcoesAndar {
  /** Metros por segundo (Shift triplica). */
  velocidade: number
  /** Com gravidade, os olhos seguem o chão; sem ela, voa para onde olha. */
  gravidade: boolean
  /** Sem colisão dá para atravessar o chão e ver o que está enterrado (bueiros, drenos). */
  colisao: boolean
  /** Mostra um boneco e põe a câmera atrás dele. */
  terceira: boolean
}

export const ANDAR_PADRAO: OpcoesAndar = {
  velocidade: 8,
  gravidade: true,
  colisao: true,
  terceira: false
}

export interface ContextoAndar {
  w: CesiumWidget
  /** Elemento que recebe o teclado e o arrasto do mouse. */
  alvo: HTMLElement
  opcoes: () => OpcoesAndar
  /** Posição do mundo em coordenadas do modelo: x, n e cota. */
  paraLocal: (p: Cartesian3) => [number, number, number]
  paraMundo: (x: number, n: number, z: number) => Cartesian3
  /** Cota do chão em (x, n): a obra onde ela existe, o terreno fora dela. */
  chao: (x: number, n: number) => number
  /** Põe o boneco nos pés de quem anda, ou o esconde com `null`. */
  boneco: (pe: Cartesian3 | null, rumo: number) => void
}

const OLHOS = 1.7
const TECLAS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'ShiftLeft',
  'ShiftRight'
])

/** Liga o modo Andar e devolve a função que o desliga. */
export function iniciarCaminhada(c: ContextoAndar): () => void {
  const { camera, scene } = c.w
  const apertadas = new Set<string>()
  let x = 0
  let n = 0
  let z = 0
  let rumo = 0
  let incl = 0
  let ultima = new Cartesian3(NaN, NaN, NaN)
  let sujo = true
  let quadro = 0
  let antes = performance.now()
  let arrasto: { x: number; y: number } | null = null
  let opcoesAntes = ''

  const daCamera = (): void => {
    ;[x, n, z] = c.paraLocal(camera.positionWC)
    rumo = camera.heading
    incl = Math.max(-1.3, Math.min(1.3, camera.pitch))
    sujo = true
  }
  daCamera()

  const passo = (agora: number): void => {
    quadro = requestAnimationFrame(passo)
    const dt = Math.min(0.1, (agora - antes) / 1000)
    antes = agora
    // a câmera mudou por fora (cubo, ir para a estaca, vista salva): continua de onde ela está
    if (!Number.isNaN(ultima.x) && Cartesian3.distance(ultima, camera.positionWC) > 0.05) daCamera()

    const o = c.opcoes()
    // trocar de opção (terceira pessoa, gravidade) redesenha mesmo parado
    const marca = `${o.terceira}|${o.gravidade}|${o.colisao}`
    if (marca !== opcoesAntes) {
      opcoesAntes = marca
      sujo = true
    }
    const tem = (...ks: string[]): number => (ks.some((k) => apertadas.has(k)) ? 1 : 0)
    const frente = tem('KeyW', 'ArrowUp') - tem('KeyS', 'ArrowDown')
    const lado = tem('KeyD') - tem('KeyA')
    const giro = tem('ArrowRight') - tem('ArrowLeft')
    const sobe = tem('KeyE', 'PageUp') - tem('KeyQ', 'PageDown')
    const v = o.velocidade * (tem('ShiftLeft', 'ShiftRight') ? 3 : 1) * dt
    if (giro) {
      rumo += giro * 1.1 * dt
      sujo = true
    }
    if (frente || lado || sobe) {
      const plano = o.gravidade ? 1 : Math.cos(incl)
      x += (Math.sin(rumo) * frente * plano + Math.cos(rumo) * lado) * v
      n += (Math.cos(rumo) * frente * plano - Math.sin(rumo) * lado) * v
      if (!o.gravidade) z += (Math.sin(incl) * frente + sobe) * v
      sujo = true
    }
    const chao = c.chao(x, n)
    if (o.gravidade) {
      const alvo = chao + OLHOS
      if (Math.abs(alvo - z) > 0.005) {
        // desce e sobe suave, sem degrau na troca de fatia
        z += (alvo - z) * Math.min(1, dt * 9)
        sujo = true
      }
    } else if (o.colisao && z < chao + 0.4) {
      z = chao + 0.4
      sujo = true
    }
    if (!sujo) return
    sujo = false
    let destino: Cartesian3
    let inclinacao = incl
    if (o.terceira) {
      const pe = o.gravidade ? chao : z - OLHOS
      c.boneco(c.paraMundo(x, n, pe), rumo)
      destino = c.paraMundo(x - Math.sin(rumo) * 6.5, n - Math.cos(rumo) * 6.5, pe + 3.4)
      inclinacao = incl - 0.2
    } else {
      c.boneco(null, rumo)
      destino = c.paraMundo(x, n, z)
    }
    camera.setView({
      destination: destino,
      orientation: { heading: rumo, pitch: inclinacao, roll: 0 }
    })
    ultima = Cartesian3.clone(camera.positionWC, ultima)
    scene.requestRender()
  }
  quadro = requestAnimationFrame(passo)

  // as teclas valem na janela inteira (o foco pode estar num controle da barra), menos enquanto se digita
  const digitando = (t: EventTarget | null): boolean =>
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button'].includes(t.type)) ||
    (t instanceof HTMLElement && t.isContentEditable)
  const aoApertar = (e: KeyboardEvent): void => {
    if (!TECLAS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || digitando(e.target)) return
    apertadas.add(e.code)
    e.preventDefault()
  }
  const aoSoltar = (e: KeyboardEvent): void => {
    apertadas.delete(e.code)
  }
  const aoSair = (): void => apertadas.clear()
  const aoPegar = (e: PointerEvent): void => {
    arrasto = { x: e.clientX, y: e.clientY }
    c.alvo.setPointerCapture(e.pointerId)
    c.alvo.focus({ preventScroll: true })
  }
  const aoArrastar = (e: PointerEvent): void => {
    if (!arrasto) return
    rumo += (e.clientX - arrasto.x) * 0.004
    incl = Math.max(-1.3, Math.min(1.3, incl - (e.clientY - arrasto.y) * 0.004))
    arrasto = { x: e.clientX, y: e.clientY }
    sujo = true
  }
  const aoLargar = (e: PointerEvent): void => {
    arrasto = null
    if (c.alvo.hasPointerCapture(e.pointerId)) c.alvo.releasePointerCapture(e.pointerId)
  }
  window.addEventListener('keydown', aoApertar)
  window.addEventListener('keyup', aoSoltar)
  window.addEventListener('blur', aoSair)
  c.alvo.addEventListener('pointerdown', aoPegar)
  c.alvo.addEventListener('pointermove', aoArrastar)
  c.alvo.addEventListener('pointerup', aoLargar)
  c.alvo.focus({ preventScroll: true })

  return () => {
    cancelAnimationFrame(quadro)
    window.removeEventListener('keydown', aoApertar)
    window.removeEventListener('keyup', aoSoltar)
    window.removeEventListener('blur', aoSair)
    c.alvo.removeEventListener('pointerdown', aoPegar)
    c.alvo.removeEventListener('pointermove', aoArrastar)
    c.alvo.removeEventListener('pointerup', aoLargar)
    c.boneco(null, 0)
  }
}
