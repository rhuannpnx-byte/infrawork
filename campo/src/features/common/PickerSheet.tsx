import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { useFolha } from './useFolha'

export interface PickerSheetProps<T> {
  open: boolean
  title: string
  items: T[]
  label: (item: T) => string
  sublabel?: (item: T) => string | null
  onPick: (item: T) => void
  onDismiss: () => void
  searchHint?: string
  emptyMessage?: string
  emptyAction?: { label: string; onClick: () => void }
  /**
   * Conteúdo opcional renderizado entre o input de busca e a lista. Usado pra
   * status (loading, fallback de cache, etc.). Não scrolla com a lista.
   */
  header?: React.ReactNode
}

/**
 * Folha de seleção que sobe de baixo, com busca. É um diálogo: o Esc fecha só ela (mesmo aberta por cima de um
 * formulário), o Tab fica dentro e o foco volta ao campo que a abriu (`useFolha`).
 */
export function PickerSheet<T>(props: PickerSheetProps<T>) {
  const {
    open,
    title,
    items,
    label,
    sublabel,
    onPick,
    onDismiss,
    searchHint = 'Buscar…',
    emptyMessage = 'Nenhum item disponível',
    emptyAction,
    header,
  } = props

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const folhaRef = useFolha(open, onDismiss)
  const tituloId = useId()
  // Altura disponível para o sheet — encolhe quando teclado iOS sobe.
  // Sem isso, o sheet com items-end fica metade atrás do teclado e o item filtrado
  // some "lá embaixo" exigindo scroll bizarro.
  const [maxH, setMaxH] = useState('85vh')

  // Limpa busca ao reabrir
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  // Foca a busca quando abre. NÃO focamos em mobile pra não abrir keyboard
  // automaticamente — usuário toca no input se quiser filtrar.
  useEffect(() => {
    if (!open) return
    const isCoarse = window.matchMedia('(pointer: coarse)').matches
    if (isCoarse) return
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [open])

  // Acompanha visualViewport (iOS Safari encolhe quando teclado sobe)
  useEffect(() => {
    if (!open || typeof window === 'undefined' || !window.visualViewport) return
    const vv = window.visualViewport
    const update = () => {
      // Deixa 10% folga acima do teclado pra usuário ver o que digita
      const pct = (vv.height / window.innerHeight) * 100
      setMaxH(`${Math.min(85, pct - 5)}vh`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [open])

  if (!open) return null

  const filtered =
    query.trim() === ''
      ? items
      : items.filter((item) => {
          const q = query.toLowerCase()
          if (label(item).toLowerCase().includes(q)) return true
          const sub = sublabel?.(item)
          return sub != null && sub.toLowerCase().includes(q)
        })

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-veu sm:items-center sm:justify-center"
      onClick={(e) => {
        // aberta por cima de um formulário: o toque fora fecha só o seletor, não o formulário de baixo
        e.stopPropagation()
        onDismiss()
      }}
    >
      <div
        ref={folhaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={cn(
          'folha-flutuante w-full focus-visible:ring-0 sm:max-w-md sm:rounded-lg',
          // Mobile: altura FIXA grande pra item filtrado não "sumir" lá embaixo.
          // Desktop (sm+): adapta ao conteúdo.
          // (a altura vem por variável: no estilo direto ela venceria o `sm:h-auto` e o diálogo ficava alto e vazio)
          'flex h-[var(--folha-altura,85vh)] flex-col sm:h-auto sm:max-h-[80vh]',
          'rounded-t-2xl pb-safe sm:rounded-b-lg',
        )}
        style={{ '--folha-altura': maxH } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex items-center justify-center pb-1 pt-3 sm:hidden">
          <div className="h-1 w-12 rounded-full bg-border-strong" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 id={tituloId} className="text-lg font-semibold text-on-surface">
            {title}
          </h2>
          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Fechar">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-muted" />
            <Input
              ref={inputRef}
              type="search"
              placeholder={searchHint}
              aria-label={searchHint}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Header opcional (status como loading/cache-fallback) */}
        {header}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 px-4 py-12 text-center">
              <p className="text-sm text-on-surface-dim">{emptyMessage}</p>
              {emptyAction && (
                <Button variant="outline" size="sm" onClick={emptyAction.onClick}>
                  {emptyAction.label}
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((item, idx) => (
                <li key={idx}>
                  <button
                    type="button"
                    onClick={() => onPick(item)}
                    className={cn(
                      'w-full rounded-md px-3 py-3 text-left text-base',
                      'transition-colors hover:bg-bg-elevated active:bg-bg-elevated',
                      'min-h-[48px]',
                    )}
                  >
                    <div className="text-on-surface">{label(item)}</div>
                    {sublabel?.(item) && (
                      <div className="mt-0.5 text-xs text-on-surface-dim">{sublabel(item)}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
