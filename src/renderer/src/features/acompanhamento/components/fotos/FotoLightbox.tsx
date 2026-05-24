import { type ReactNode, useEffect, useMemo, useState } from 'react'
import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/captions.css'
import { getSignedUrls } from '@/features/acompanhamento/hooks/fotos'
import type { FotoEnriquecida } from '@/types/acompanhamento'

interface Props {
  fotos: FotoEnriquecida[]
  index: number | null
  onClose: () => void
  onIndexChange?: (idx: number) => void
}

export function FotoLightbox({ fotos, index, onClose, onIndexChange }: Props): ReactNode {
  const [urls, setUrls] = useState<Record<string, string>>({})

  // Pré-carrega URLs assinadas das fotos visíveis (atual + vizinhas)
  useEffect(() => {
    if (index == null) return
    const start = Math.max(0, index - 2)
    const end = Math.min(fotos.length, index + 3)
    const ids = fotos.slice(start, end).map((f) => f.id)
    if (ids.length === 0) return
    let canceled = false
    void getSignedUrls(ids).then((r) => { if (!canceled) setUrls((cur) => ({ ...cur, ...r })) })
    return () => { canceled = true }
  }, [index, fotos])

  const slides = useMemo(
    () =>
      fotos.map((f) => {
        const url = urls[f.id]
        const title = f.servico_display_nome ?? f.siga_servico_nome ?? 'Foto'
        const desc = [
          f.encarregado_display_nome,
          f.equipe_display_nome,
          f.captured_date
        ].filter(Boolean).join(' · ')
        return {
          src: url ?? '',
          title,
          description: desc
        }
      }),
    [fotos, urls]
  )

  if (index == null) return null

  return (
    <Lightbox
      open
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Captions]}
      on={{ view: ({ index: i }) => onIndexChange?.(i) }}
    />
  )
}
