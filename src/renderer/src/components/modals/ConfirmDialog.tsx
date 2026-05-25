// Confirm dialog tematico (substituto do window.confirm nativo do Electron).
//
// Uso:
//   const confirm = useConfirm()
//   const ok = await confirm({
//     title: 'Excluir foto definitivamente?',
//     description: 'A acao remove o arquivo do bucket. Nao da pra desfazer.',
//     variant: 'danger'
//   })
//   if (!ok) return
//
// Implementacao: store Zustand com { open, options, resolve }. O hook
// `useConfirm` retorna funcao que abre o dialog e devolve Promise<boolean>.
// Componente `<ConfirmDialog />` (singleton) le do store e renderiza.

import { type ReactNode } from 'react'
import { create } from 'zustand'
import { AlertTriangle, Info, HelpCircle } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type ConfirmVariant = 'danger' | 'warn' | 'info'

export interface ConfirmOptions {
  title: string
  /** Texto descritivo. Pode conter `\n` que viram quebras de linha. */
  description?: string | ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
}

interface ConfirmState {
  open: boolean
  options: ConfirmOptions | null
  resolve: ((v: boolean) => void) | null
  ask: (opts: ConfirmOptions) => Promise<boolean>
  answer: (v: boolean) => void
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,
  ask: (options) =>
    new Promise<boolean>((resolve) => {
      // Se ja existir um confirm aberto sem resposta, resolve como cancelado
      const prev = get().resolve
      if (prev) prev(false)
      set({ open: true, options, resolve })
    }),
  answer: (v) => {
    const r = get().resolve
    set({ open: false, options: null, resolve: null })
    r?.(v)
  }
}))

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  return useConfirmStore((s) => s.ask)
}

export function ConfirmDialog(): ReactNode {
  const open = useConfirmStore((s) => s.open)
  const options = useConfirmStore((s) => s.options)
  const answer = useConfirmStore((s) => s.answer)

  const variant = options?.variant ?? 'danger'
  const Icon = variant === 'info' ? Info : variant === 'warn' ? HelpCircle : AlertTriangle
  const iconColor =
    variant === 'info' ? 'text-accent' : variant === 'warn' ? 'text-warn' : 'text-danger'
  const confirmVariant = variant === 'danger' ? 'danger' : 'default'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && answer(false)} size="sm">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Icon size={14} className={iconColor} />
          {options?.title ?? 'Confirmar'}
        </DialogTitle>
      </DialogHeader>
      <DialogBody>
        {options?.description ? (
          typeof options.description === 'string' ? (
            <p className="text-xs text-text-muted whitespace-pre-line leading-relaxed">
              {options.description}
            </p>
          ) : (
            <div className="text-xs text-text-muted">{options.description}</div>
          )
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => answer(false)} autoFocus>
          {options?.cancelLabel ?? 'Cancelar'}
        </Button>
        <Button variant={confirmVariant} onClick={() => answer(true)}>
          {options?.confirmLabel ?? 'Confirmar'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
