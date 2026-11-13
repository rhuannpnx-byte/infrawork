import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon, Layers } from 'lucide-react'
import { getSignedUrls } from '../../hooks/fotos'
import { formatDateTimeShort } from '@/lib/format'

export interface PinFoto {
  id: string
  captured_at: string | null
  servico_display_nome: string | null
  servico_nome: string | null
}

interface Props {
  /** 1 foto = preview single; >1 = preview de cluster com grid de thumbs. */
  fotos: PinFoto[]
  position: { x: number; y: number }
}

const CARD_W = 280

export function FotoMapHoverCard({ fotos, position }: Props): ReactNode {
  const isCluster = fotos.length > 1
  // Thumbs do cluster: ate 5 + slot "+N" se sobra; total 6 celulas
  const visiveis = isCluster ? fotos.slice(0, fotos.length > 6 ? 5 : 6) : fotos.slice(0, 1)
  const restante = isCluster ? Math.max(0, fotos.length - visiveis.length) : 0

  const [urls, setUrls] = useState<Record<string, string>>({})
  const ids = visiveis.map((f) => f.id)
  const idsKey = ids.join('|')
  useEffect(() => {
    if (ids.length === 0) return
    let cancel = false
    void getSignedUrls(ids, 'preview').then((u) => {
      if (!cancel) setUrls(u)
    })
    return () => {
      cancel = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const altura = isCluster ? 230 : 240
  const left = Math.min(
    position.x,
    (typeof window !== 'undefined' ? window.innerWidth : 9999) - CARD_W - 8
  )
  const top = Math.min(
    position.y,
    (typeof window !== 'undefined' ? window.innerHeight : 9999) - altura - 8
  )

  return createPortal(
    <div
      className="fixed z-[200] pointer-events-none rounded border border-border-strong shadow-[var(--sombra-flutuante)] bg-[color:var(--popover)] overflow-hidden animate-fade-in"
      style={{ left, top, width: CARD_W }}
    >
      {isCluster ? (
        <ClusterContent fotos={fotos} visiveis={visiveis} restante={restante} urls={urls} />
      ) : (
        <SingleContent foto={fotos[0]} url={urls[fotos[0]?.id]} />
      )}
    </div>,
    document.body
  )
}

function SingleContent({
  foto,
  url
}: {
  foto: PinFoto | undefined
  url: string | undefined
}): ReactNode {
  if (!foto) return null
  return (
    <>
      {url ? (
        <img
          src={url}
          alt=""
          className="w-full block"
          style={{ maxHeight: 180, objectFit: 'cover' }}
        />
      ) : (
        <div className="w-full h-[150px] flex items-center justify-center text-text-dim">
          <ImageIcon size={24} />
        </div>
      )}
      <div className="px-3 py-2 space-y-0.5">
        <div
          className="text-sm font-semibold text-text truncate"
          title={foto.servico_display_nome ?? ''}
        >
          {foto.servico_display_nome ?? foto.servico_nome ?? '—'}
        </div>
        <div className="text-xs text-text-muted tabular">{fmtDate(foto.captured_at)}</div>
      </div>
    </>
  )
}

function ClusterContent({
  fotos,
  visiveis,
  restante,
  urls
}: {
  fotos: PinFoto[]
  visiveis: PinFoto[]
  restante: number
  urls: Record<string, string>
}): ReactNode {
  return (
    <>
      <div className="px-3 py-2 border-b border-border text-sm font-semibold text-text flex items-center gap-1.5">
        <Layers size={14} className="text-text-muted" /> {fotos.length} fotos neste ponto
      </div>
      <div className="grid grid-cols-3 gap-px bg-border">
        {visiveis.map((f) => (
          <div key={f.id} className="aspect-square bg-bg overflow-hidden relative">
            {urls[f.id] ? (
              <img
                src={urls[f.id]}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-text-dim">
                <ImageIcon size={14} />
              </div>
            )}
          </div>
        ))}
        {restante > 0 && (
          <div className="aspect-square bg-bg flex items-center justify-center text-sm font-semibold tabular text-text-muted">
            +{restante}
          </div>
        )}
      </div>
      <div className="px-3 py-1.5 text-xs text-text-muted text-center">
        Clique para ver as fotos
      </div>
    </>
  )
}

function fmtDate(s: string | null): string {
  return formatDateTimeShort(s)
}
