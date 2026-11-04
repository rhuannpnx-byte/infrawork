import { useEffect, useRef, type ReactNode } from 'react'
import './login-wallpaper.css'
import { createRelevo, type Relevo } from './login-relevo'

/**
 * Wallpaper do login: curvas de nível animadas (canvas) + HUD técnico — grid,
 * sweep, brackets de canto, retícula com física de mola seguindo o cursor e
 * leitura E/N/cota do relevo sob a retícula. Pressionar = estado "locked".
 *
 * O relevo é sintético (ruído fractal) e calculado uma vez por tamanho de tela;
 * a animação só desloca as cotas desenhadas, então cada quadro custa um
 * marching squares sobre as células que a curva cruza. Cor = token `--accent`. `prefers-reduced-motion` congela
 * as curvas (a retícula continua).
 */

const CELULA = 9 // px CSS por célula da grade do relevo
const EQUIDISTANCIA = 0.05 // distância entre curvas (unidades do campo)
const MESTRA_A_CADA = 5 // curva mestra (mais forte) a cada N curvas
const VELOCIDADE = 0.012 // unidades do campo por segundo
const COTA_BASE = 1017 // m — só para a leitura Z
const COTA_ESCALA = 90 // m por unidade do campo
const ORIGEM_E = 712_400 // leitura E/N fictícia (UTM 22S, Anápolis-GO)
const ORIGEM_N = 8_194_300
const METROS_POR_PX = 0.6

function comAlfa(cor: string, a: number): string {
  const c = cor.trim()
  if (c.startsWith('oklch(') && !c.includes('/')) return c.replace(/\)$/, ` / ${a})`)
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    const n = parseInt(c.slice(1), 16)
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
  }
  return c || `rgba(77, 142, 255, ${a})`
}

export function LoginWallpaper(): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<HTMLDivElement>(null)
  const chvRef = useRef<HTMLDivElement>(null)
  const chhRef = useRef<HTMLDivElement>(null)
  const reticleRef = useRef<HTMLDivElement>(null)
  const rinnerRef = useRef<HTMLDivElement>(null)
  const cxRef = useRef<HTMLSpanElement>(null)
  const cyRef = useRef<HTMLSpanElement>(null)
  const czRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const pad = padRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!root || !pad || !canvas || !ctx) return

    let raf = 0
    let running = true
    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // ── física de mola da retícula (segue o cursor) ──
    let tx = 50,
      ty = 50,
      cx = 50,
      cy = 50,
      vX = 0,
      vY = 0
    let active = false
    const STIFF = 240,
      DAMP = 26

    const rect = (): DOMRect => root.getBoundingClientRect()
    const inside = (e: PointerEvent): boolean => {
      const r = rect()
      return (
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      )
    }
    const setTarget = (e: PointerEvent): void => {
      const r = rect()
      tx = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))
      ty = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100))
    }
    const enter = (): void => {
      active = true
      pad.classList.add('active')
    }
    const leave = (): void => {
      active = false
      pad.classList.remove('active', 'locked')
      tx = 50
      ty = 50
    }
    const onMove = (e: PointerEvent): void => {
      if (!inside(e)) {
        if (active) leave()
        return
      }
      if (!active) enter()
      setTarget(e)
    }
    const onDown = (e: PointerEvent): void => {
      if (!inside(e)) return
      enter()
      setTarget(e)
      pad.classList.add('locked')
    }
    const onUp = (): void => {
      pad.classList.remove('locked')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('blur', leave)

    // ── relevo + canvas ──
    let relevo: Relevo | null = null
    let largura = 0
    let altura = 0
    const redimensionar = (): void => {
      const r = rect()
      if (r.width < 1 || r.height < 1) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      largura = r.width
      altura = r.height
      canvas.width = Math.round(largura * dpr)
      canvas.height = Math.round(altura * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      relevo = createRelevo(Math.ceil(largura / CELULA) + 1, Math.ceil(altura / CELULA) + 1)
    }
    redimensionar()

    const acento = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()

    const desenhar = (fase: number, rx: number, ry: number, locked: boolean): void => {
      ctx.clearRect(0, 0, largura, altura)
      if (!relevo) return
      const ciclo = EQUIDISTANCIA * MESTRA_A_CADA
      const deslocamento = ((fase % ciclo) + ciclo) % ciclo
      const lente = Math.max(largura, altura) * 0.28
      const cor = locked ? 'rgb(239, 68, 68)' : acento
      const gradiente = (aPerto: number, aLonge: number): CanvasGradient => {
        const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, lente)
        g.addColorStop(0, comAlfa(cor, aPerto))
        g.addColorStop(1, comAlfa(acento, aLonge))
        return g
      }
      const { normais, mestras } = relevo.isolinhas(EQUIDISTANCIA, deslocamento, MESTRA_A_CADA)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.lineWidth = 1
      ctx.strokeStyle = gradiente(0.55, 0.16)
      ctx.stroke(escalar(normais))
      ctx.lineWidth = 1.6
      ctx.strokeStyle = gradiente(0.9, 0.34)
      ctx.stroke(escalar(mestras))
    }
    // isolinhas vêm em coordenadas de célula → px CSS
    const escalar = (segs: Float32Array): Path2D => {
      const p = new Path2D()
      for (let i = 0; i < segs.length; i += 4) {
        p.moveTo(segs[i] * CELULA, segs[i + 1] * CELULA)
        p.lineTo(segs[i + 2] * CELULA, segs[i + 3] * CELULA)
      }
      return p
    }

    const t0 = performance.now()
    let last = t0
    let ultimoDesenho = 0
    const tick = (now: number): void => {
      if (!running) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const steps = 2,
        h = dt / steps
      for (let s = 0; s < steps; s++) {
        vX += (STIFF * (tx - cx) - DAMP * vX) * h
        cx += vX * h
        vY += (STIFF * (ty - cy) - DAMP * vY) * h
        cy += vY * h
      }
      if (chvRef.current) chvRef.current.style.left = cx + '%'
      if (chhRef.current) chhRef.current.style.top = cy + '%'
      if (reticleRef.current) {
        reticleRef.current.style.left = cx + '%'
        reticleRef.current.style.top = cy + '%'
      }
      const rotY = Math.max(-16, Math.min(16, vX * 0.55))
      const rotX = Math.max(-16, Math.min(16, -vY * 0.55))
      if (rinnerRef.current) {
        rinnerRef.current.style.transform = `perspective(420px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`
      }

      const px = (cx / 100) * largura
      const py = (cy / 100) * altura
      // ~30 fps para as curvas (a retícula segue a 60)
      if (now - ultimoDesenho > 33) {
        ultimoDesenho = now
        const fase = reduzido ? 0 : ((now - t0) / 1000) * VELOCIDADE
        desenhar(fase, px, py, pad.classList.contains('locked'))
      }
      if (relevo) {
        const z = relevo.valor(px / CELULA, py / CELULA)
        if (cxRef.current)
          cxRef.current.textContent = Math.round(ORIGEM_E + px * METROS_POR_PX).toLocaleString(
            'pt-BR'
          )
        if (cyRef.current)
          cyRef.current.textContent = Math.round(ORIGEM_N - py * METROS_POR_PX).toLocaleString(
            'pt-BR'
          )
        if (czRef.current)
          czRef.current.textContent = (COTA_BASE + z * COTA_ESCALA).toFixed(1).replace('.', ',')
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onVis = (): void => {
      if (document.hidden) {
        running = false
      } else if (!running) {
        running = true
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', onVis)

    const ro = new ResizeObserver(redimensionar)
    ro.observe(root)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('blur', leave)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
    }
  }, [])

  return (
    <div ref={rootRef} className="login-wallpaper">
      <canvas ref={canvasRef} className="lw-canvas" />
      <div className="lw-tint" />

      <div ref={padRef} className="lw-pad">
        <div className="lw-grid" />
        <div className="lw-sweep" />
        <div className="lw-bracket tl" />
        <div className="lw-bracket tr" />
        <div className="lw-bracket bl" />
        <div className="lw-bracket br" />
        <div className="lw-regua topo" />
        <div className="lw-regua esquerda" />
        <div className="lw-norte">
          <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden>
            <path d="M5 0 L10 14 L5 10.5 L0 14 Z" fill="currentColor" />
          </svg>
          N
        </div>

        <div ref={chvRef} className="lw-ch-v" />
        <div ref={chhRef} className="lw-ch-h" />

        <div ref={reticleRef} className="lw-reticle">
          <div ref={rinnerRef} className="lw-reticle-inner">
            <div className="lw-dot" />
            <div className="lw-box">
              <i className="a" />
              <i className="b" />
              <i className="c" />
              <i className="d" />
            </div>
            <div className="lw-ping" />
          </div>
        </div>

        <div className="lw-coords">
          <div className="lw-coord">
            <span className="k">E · LESTE</span>
            <span className="v">
              <span ref={cxRef}>—</span>
              <small>m</small>
            </span>
          </div>
          <div className="lw-coord">
            <span className="k">N · NORTE</span>
            <span className="v">
              <span ref={cyRef}>—</span>
              <small>m</small>
            </span>
          </div>
          <div className="lw-coord">
            <span className="k">Z · COTA</span>
            <span className="v">
              <span ref={czRef}>—</span>
              <small>m</small>
            </span>
          </div>
          <div className="lw-escala" style={{ width: 100 / METROS_POR_PX }}>
            <div className="barra">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="rotulos">
              <span>0</span>
              <span>50</span>
              <span>100 m</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
