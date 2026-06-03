import { useEffect, useRef, type ReactNode } from 'react'
import './login-wallpaper.css'

/**
 * Wallpaper interativo "Vetor" do login (recriação do protótipo Claude Design):
 * mapa Leaflet escuro (carto dark) com um HUD técnico sobreposto — grid, sweep,
 * brackets de canto, retícula com física de mola seguindo o cursor e leitura de
 * coordenadas X/Y/Z. Arraste para mover o mapa; pressionar = estado "locked".
 *
 * Renderiza atrás do card de login (preenche o `#login-fx`). As camadas do HUD
 * são `pointer-events:none`, então o arraste chega ao mapa por baixo.
 */
export function LoginWallpaper(): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)
  const mapElRef = useRef<HTMLDivElement>(null)
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
    if (!root || !pad) return

    let map: import('leaflet').Map | null = null
    let raf = 0
    let running = true
    let disposed = false
    let mapLoaded = false

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

    // cota sintética (carto dark não traz elevação) — média ~1017 m, Anápolis-GO
    const altitude = (lng: number, lat: number): number => {
      const v =
        Math.sin(lng * 6.7) * Math.cos(lat * 7.9) * 42 +
        Math.sin(lat * 13.0 + lng * 4.0) * 23 +
        Math.cos(lng * 10.5 - lat * 5.0) * 16
      return Math.round(1017 + v)
    }

    // ── mapa (Leaflet + carto dark) ──
    void (async () => {
      const L = await import('leaflet')
      await import('leaflet/dist/leaflet.css')
      if (disposed || !mapElRef.current) return
      map = L.map(mapElRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        keyboard: false
      }).setView([-16.3267, -48.9526], 13) // Anápolis · GO
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(map)
      mapLoaded = true
    })()

    let last = performance.now()
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
      if (mapLoaded && map) {
        const r = rect()
        const ll = map.containerPointToLatLng([(cx / 100) * r.width, (cy / 100) * r.height])
        if (cxRef.current) cxRef.current.textContent = ll.lng.toFixed(4)
        if (cyRef.current) cyRef.current.textContent = ll.lat.toFixed(4)
        if (czRef.current) czRef.current.textContent = String(altitude(ll.lng, ll.lat))
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

    const ro = new ResizeObserver(() => map?.invalidateSize())
    ro.observe(root)

    return () => {
      disposed = true
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('blur', leave)
      document.removeEventListener('visibilitychange', onVis)
      ro.disconnect()
      if (map) {
        map.remove()
        map = null
      }
    }
  }, [])

  return (
    <div ref={rootRef} className="login-wallpaper">
      <div ref={mapElRef} className="lw-map" />
      <div className="lw-tint" />

      <div ref={padRef} className="lw-pad">
        <div className="lw-grid" />
        <div className="lw-sweep" />
        <div className="lw-bracket tl" />
        <div className="lw-bracket tr" />
        <div className="lw-bracket bl" />
        <div className="lw-bracket br" />

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
            <span className="k">X · LONG</span>
            <span className="v">
              <span ref={cxRef}>—</span>
              <small>°</small>
            </span>
          </div>
          <div className="lw-coord">
            <span className="k">Y · LAT</span>
            <span className="v">
              <span ref={cyRef}>—</span>
              <small>°</small>
            </span>
          </div>
          <div className="lw-coord">
            <span className="k">Z · ALT</span>
            <span className="v">
              <span ref={czRef}>—</span>
              <small>m</small>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
