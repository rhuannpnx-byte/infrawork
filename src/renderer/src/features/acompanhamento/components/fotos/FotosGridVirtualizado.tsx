import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Image as ImageIcon, MapPin } from 'lucide-react'
import { getSignedUrls } from '@/features/acompanhamento/hooks/fotos'
import type { FotoEnriquecida } from '@/types/acompanhamento'
import { cn } from '@/lib/utils'

interface Props {
  fotos: FotoEnriquecida[]
  onPick: (idx: number) => void
  loading?: boolean
  cols?: number
}

const THUMB_HEIGHT = 96

interface HoverState { fotoId: string; x: number; y: number }

export function FotosGridVirtualizado({ fotos, onPick, loading, cols = 2 }: Props): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [hover, setHover] = useState<HoverState | null>(null)

  // grid: cada "row" do virtualizer corresponde a `cols` thumbnails
  const rows = useMemo(() => {
    const out: FotoEnriquecida[][] = []
    for (let i = 0; i < fotos.length; i += cols) out.push(fotos.slice(i, i + cols))
    return out
  }, [fotos, cols])

  // Map id -> foto para lookup O(1) em hover (evita Array.find a cada render).
  const fotosById = useMemo(() => {
    const m = new Map<string, FotoEnriquecida>()
    for (const f of fotos) m.set(f.id, f)
    return m
  }, [fotos])

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => THUMB_HEIGHT + 6,
    overscan: 6
  })

  // Carrega signed URLs dos itens visíveis
  useEffect(() => {
    const items = rowVirtualizer.getVirtualItems()
    if (items.length === 0) return
    const startIdx = items[0].index * cols
    const endIdx = Math.min(fotos.length, (items[items.length - 1].index + 1) * cols)
    const ids = fotos.slice(startIdx, endIdx).map((f) => f.id)
    if (ids.length === 0) return
    let canceled = false
    void getSignedUrls(ids, 'thumb').then((r) => {
      if (!canceled) setUrls((cur) => ({ ...cur, ...r }))
    })
    return () => { canceled = true }
  }, [rowVirtualizer, fotos, cols])

  const fotoHover = useMemo(
    () => (hover ? fotosById.get(hover.fotoId) ?? null : null),
    [hover, fotosById]
  )
  // Hover usa preview (480px) — qualidade melhor que o thumb usado no grid
  const [urlsHover, setUrlsHover] = useState<Record<string, string>>({})
  const urlHover = fotoHover ? urlsHover[fotoHover.id] ?? urls[fotoHover.id] ?? null : null

  useEffect(() => {
    if (!fotoHover || urlsHover[fotoHover.id]) return
    let canceled = false
    void getSignedUrls([fotoHover.id], 'preview').then((r) => {
      if (!canceled) setUrlsHover((cur) => ({ ...cur, ...r }))
    })
    return () => { canceled = true }
  }, [fotoHover, urlsHover])

  if (loading && fotos.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-1 p-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse bg-bg-elevated rounded" style={{ height: THUMB_HEIGHT }} />
        ))}
      </div>
    )
  }
  if (fotos.length === 0) {
    return <div className="p-4 text-text-dim text-2xs font-mono text-center">Sem fotos</div>
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto px-1 py-1">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          return (
            <div
              key={vi.key}
              className="grid gap-1"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                transform: `translateY(${vi.start}px)`,
                paddingBottom: 6
              }}
            >
              {row.map((f, idxInRow) => {
                const idx = vi.index * cols + idxInRow
                const url = urls[f.id]
                return (
                  <button
                    key={f.id}
                    onClick={() => onPick(idx)}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setHover({ fotoId: f.id, x: rect.right + 8, y: rect.top })
                    }}
                    onMouseMove={(e) => {
                      // sincroniza posição com o cursor (caso o virtualizador reposicione)
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      if (!hover || hover.fotoId !== f.id) {
                        setHover({ fotoId: f.id, x: rect.right + 8, y: rect.top })
                      }
                    }}
                    onMouseLeave={() => setHover((cur) => (cur?.fotoId === f.id ? null : cur))}
                    className={cn(
                      'relative rounded overflow-hidden bg-bg-elevated border border-border hover:border-accent transition-colors',
                      'group'
                    )}
                    style={{ height: THUMB_HEIGHT }}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="object-cover w-full h-full"
                      />
                    ) : (
                      <div className="flex items-center justify-center w-full h-full text-text-dim">
                        <ImageIcon size={18} />
                      </div>
                    )}
                    {f.lat != null && f.lng != null && (
                      <span className="absolute top-1 left-1 text-text drop-shadow bg-black/50 rounded p-0.5">
                        <MapPin size={9} />
                      </span>
                    )}
                    {f.equipe_display_cor && (
                      <span
                        className="absolute bottom-1 left-1 size-2 rounded-sm border border-text/40"
                        style={{ background: f.equipe_display_cor }}
                      />
                    )}
                    <div className="absolute bottom-0 left-0 right-0 text-[9px] font-mono text-text bg-gradient-to-t from-black/80 to-transparent px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity truncate">
                      {f.captured_date ?? ''}
                    </div>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {hover && fotoHover && createPortal(
        <div
          className="fixed z-[200] pointer-events-none rounded border border-border-strong shadow-2xl bg-bg-elevated overflow-hidden animate-fade-in"
          style={{
            left: clampX(hover.x),
            top: clampY(hover.y),
            width: 280
          }}
        >
          {urlHover ? (
            <img src={urlHover} alt="" className="w-full block" style={{ maxHeight: 220, objectFit: 'cover' }} />
          ) : (
            <div className="w-full h-[180px] flex items-center justify-center text-text-dim">
              <ImageIcon size={28} />
            </div>
          )}
          <div className="p-2 space-y-0.5">
            <div className="text-xs font-mono text-text truncate" title={fotoHover.servico_display_nome ?? fotoHover.siga_servico_nome ?? ''}>
              {fotoHover.servico_display_nome ?? fotoHover.siga_servico_nome ?? '—'}
            </div>
            <div className="text-2xs font-mono text-text-dim flex items-center gap-1.5">
              {fotoHover.equipe_display_cor && (
                <span className="size-2 rounded-sm" style={{ background: fotoHover.equipe_display_cor }} />
              )}
              <span className="truncate">{fotoHover.equipe_display_nome ?? '—'}</span>
            </div>
            <div className="text-2xs font-mono text-text-dim">
              {fotoHover.encarregado_display_nome ?? '—'} · {fotoHover.captured_date ?? '—'}
            </div>
            {fotoHover.lat != null && fotoHover.lng != null && (
              <div className="text-2xs font-mono text-text-faint">
                {Number(fotoHover.lat).toFixed(5)}, {Number(fotoHover.lng).toFixed(5)}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function clampX(x: number): number {
  if (typeof window === 'undefined') return x
  return Math.min(x, window.innerWidth - 290)
}
function clampY(y: number): number {
  if (typeof window === 'undefined') return y
  return Math.min(y, window.innerHeight - 280)
}
