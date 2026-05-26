import { type ReactNode, useEffect, useMemo, useState } from 'react'
import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/captions.css'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getSignedUrls, useDeleteFotos } from '@/features/acompanhamento/hooks/fotos'
import { useAuthStore } from '@/stores/auth-store'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import type { FotoEnriquecida } from '@/types/acompanhamento'
import { formatDateTimeShort } from '@/lib/format'

interface Props {
  fotos: FotoEnriquecida[]
  index: number | null
  onClose: () => void
  onIndexChange?: (idx: number) => void
}

export function FotoLightbox({ fotos, index, onClose, onIndexChange }: Props): ReactNode {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const podeDeletar = role === 'god' || role === 'adm'
  const deleteMut = useDeleteFotos()
  const confirm = useConfirm()

  // Pré-carrega URLs assinadas das fotos visíveis (atual + vizinhas)
  useEffect(() => {
    if (index == null) return
    const start = Math.max(0, index - 2)
    const end = Math.min(fotos.length, index + 3)
    const ids = fotos.slice(start, end).map((f) => f.id)
    if (ids.length === 0) return
    let canceled = false
    void getSignedUrls(ids, 'full').then((r) => { if (!canceled) setUrls((cur) => ({ ...cur, ...r })) })
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
  const idx = index
  const fotoAtual = fotos[idx]

  async function handleDelete(): Promise<void> {
    if (!fotoAtual) return
    const nome = fotoAtual.servico_display_nome ?? fotoAtual.siga_servico_nome ?? 'Foto'
    const quando = formatDateTimeShort(fotoAtual.captured_at)
    const ok = await confirm({
      title: 'Excluir esta foto definitivamente?',
      description: `${nome}${quando ? ` · ${quando}` : ''}\n\nA ação remove o arquivo do bucket. Não dá pra desfazer.`,
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    try {
      const r = await deleteMut.mutateAsync({ fotoIds: [fotoAtual.id] })
      toast.success(`Foto excluida (${r.removidas} removida${r.removidas !== 1 ? 's' : ''})`)
      if (fotos.length <= 1) onClose()
      else onIndexChange?.(Math.min(idx, fotos.length - 2))
    } catch (e) {
      toast.error(`Falha ao excluir: ${(e as Error).message}`)
    }
  }

  return (
    <Lightbox
      open
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Captions]}
      on={{ view: ({ index: i }) => onIndexChange?.(i) }}
      toolbar={{
        buttons: [
          ...(podeDeletar
            ? [
                <button
                  key="delete-foto"
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteMut.isPending}
                  className="yarl__button"
                  title="Excluir foto (god/adm)"
                  style={{ color: 'oklch(70% 0.18 25)' }}
                >
                  <Trash2 size={20} />
                </button>
              ]
            : []),
          'close'
        ]
      }}
    />
  )
}
