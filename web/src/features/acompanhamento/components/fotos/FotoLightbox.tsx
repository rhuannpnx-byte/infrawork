import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Lightbox, { type ControllerRef } from 'yet-another-react-lightbox'
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

const PIXEL_VAZIO = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

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
  const controle = useRef<ControllerRef>(null)

  // Pré-carrega URLs assinadas das fotos visíveis (atual + vizinhas)
  useEffect(() => {
    if (index == null) return
    const start = Math.max(0, index - 2)
    const end = Math.min(fotos.length, index + 3)
    const ids = fotos.slice(start, end).map((f) => f.id)
    if (ids.length === 0) return
    let canceled = false
    void getSignedUrls(ids, 'full').then((r) => {
      if (!canceled) setUrls((cur) => ({ ...cur, ...r }))
    })
    return () => {
      canceled = true
    }
  }, [index, fotos])

  const slides = useMemo(
    () =>
      fotos.map((f) => {
        const url = urls[f.id]
        const title = f.servico_display_nome ?? f.servico_nome ?? 'Foto'
        const desc = [
          f.encarregado_display_nome,
          f.equipe_display_nome && f.equipe_display_nome !== '—' ? f.equipe_display_nome : null,
          f.captured_date ? f.captured_date.split('-').reverse().join('/') : null
        ]
          .filter(Boolean)
          .join(' · ')
        return {
          // enquanto a URL assinada não chega, um pixel transparente (src vazio recarrega a página)
          src: url ?? PIXEL_VAZIO,
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
    const nome = fotoAtual.servico_display_nome ?? fotoAtual.servico_nome ?? 'Foto'
    const quando = formatDateTimeShort(fotoAtual.captured_at)
    const ok = await confirm({
      title: 'Excluir esta foto definitivamente?',
      description: `${nome}${quando ? ` · ${quando}` : ''}\n\nA foto sai do lançamento e o arquivo é apagado. Não dá para desfazer.`,
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    // a confirmação tira o foco do visualizador: sem devolver, Esc e setas param de responder
    controle.current?.focus()
    if (!ok) return
    try {
      const r = await deleteMut.mutateAsync({ fotoIds: [fotoAtual.id] })
      if (r.removidas > 0) toast.success('Foto excluída.')
      else toast.error('A foto não foi excluída. Atualize a página e tente de novo.')
      if (fotos.length <= 1) onClose()
      else onIndexChange?.(Math.min(idx, fotos.length - 2))
    } catch (e) {
      toast.error(`Não foi possível excluir a foto. ${(e as Error).message}`)
    }
  }

  return (
    <Lightbox
      open
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Captions]}
      controller={{ ref: controle }}
      labels={{ Close: 'Fechar', Previous: 'Foto anterior', Next: 'Próxima foto' }}
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
                  title="Excluir foto"
                  aria-label="Excluir foto"
                  style={{ color: 'var(--danger)' }}
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
