import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'
import type { ItemLancavel } from '../../hooks/lancamento'

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Seletor de item do orçamento com busca e barra de executado/orçado. */
export function ItemCombobox({
  itens,
  value,
  onChange,
  loading,
  className,
  rotuloId,
  invalido,
  descritoPor
}: {
  itens: ItemLancavel[]
  value: string
  onChange: (id: string) => void
  loading?: boolean
  className?: string
  /** id do rótulo visível do campo (entra no nome acessível do botão). */
  rotuloId?: string
  invalido?: boolean
  /** id da mensagem de erro do campo. */
  descritoPor?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const botaoRef = useRef<HTMLButtonElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const valorId = `${uid}-valor`
  const listaId = `${uid}-lista`
  const sel = itens.find((i) => i.id === value) ?? null
  const filtrados = useMemo(() => {
    const q = normalize(busca.trim())
    if (!q) return itens
    return itens.filter((i) =>
      normalize(`${i.codigo} ${i.descricao} ${i.servico_nome ?? ''}`).includes(q)
    )
  }, [itens, busca])
  const indiceAtivo = Math.min(ativo, Math.max(0, filtrados.length - 1))

  useEffect(() => {
    if (!open) return
    listaRef.current
      ?.querySelector<HTMLElement>('[data-ativo="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, indiceAtivo])

  const abrir = (): void => {
    setAtivo(
      Math.max(
        0,
        itens.findIndex((i) => i.id === value)
      )
    )
    setOpen(true)
  }
  const fechar = (devolverFoco: boolean): void => {
    setOpen(false)
    setBusca('')
    if (devolverFoco) botaoRef.current?.focus()
  }
  const escolher = (id: string): void => {
    onChange(id)
    fechar(true)
  }
  const naBusca = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtrados.length === 0) return
      const passo = e.key === 'ArrowDown' ? 1 : -1
      setAtivo((indiceAtivo + passo + filtrados.length) % filtrados.length)
    } else if (e.key === 'Enter') {
      // dentro do formulário, o Enter escolhe o serviço em vez de enviar
      e.preventDefault()
      const item = filtrados[indiceAtivo]
      if (item) escolher(item.id)
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      fechar(true)
    } else if (e.key === 'Tab') {
      fechar(false)
    }
  }

  return (
    <div className={cn('relative', className)}>
      <button
        ref={botaoRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listaId : undefined}
        aria-labelledby={rotuloId ? `${rotuloId} ${valorId}` : undefined}
        aria-invalid={invalido || undefined}
        aria-describedby={descritoPor}
        onClick={() => (open ? fechar(false) : abrir())}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' || open) return
          e.preventDefault()
          abrir()
        }}
        className="h-10 w-full rounded border border-border-strong bg-bg-panel px-3 text-sm text-left flex items-center gap-2 hover:border-border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger"
      >
        <span id={valorId} className="flex min-w-0 items-center gap-2">
          {sel ? (
            <>
              <span className="tabular text-xs text-text-muted shrink-0">{sel.codigo}</span>
              <span className="truncate text-text">{sel.descricao}</span>
            </>
          ) : (
            <span className="text-text-dim">
              {loading ? 'Carregando os serviços…' : 'Escolha o serviço'}
            </span>
          )}
        </span>
        <ChevronDown size={14} className="ml-auto text-text-muted shrink-0" aria-hidden />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => fechar(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded border border-border-strong bg-[color:var(--popover)] shadow-[var(--sombra-flutuante)] max-h-[60vh] flex flex-col overflow-hidden">
            <div className="px-2.5 py-1 border-b border-border flex items-center gap-2">
              <Search size={14} className="text-text-dim shrink-0" aria-hidden />
              <input
                autoFocus
                role="combobox"
                aria-expanded
                aria-controls={listaId}
                aria-autocomplete="list"
                aria-activedescendant={
                  filtrados[indiceAtivo] ? `${uid}-op-${filtrados[indiceAtivo].id}` : undefined
                }
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value)
                  setAtivo(0)
                }}
                onKeyDown={naBusca}
                placeholder="Buscar por código ou descrição"
                aria-label="Buscar serviço por código ou descrição"
                className="bg-transparent flex-1 text-sm text-text outline-none placeholder:text-text-dim h-8"
              />
            </div>
            <div
              ref={listaRef}
              id={listaId}
              role="listbox"
              aria-label="Serviços"
              className="overflow-auto flex-1 p-1"
            >
              {filtrados.length === 0 ? (
                <div className="text-sm text-text-muted px-3 py-3">
                  {itens.length === 0
                    ? 'Nenhum serviço com composição no orçamento desta obra. Vincule as composições na planilha orçamentária para poder lançar.'
                    : 'Nenhum serviço com esse código ou descrição.'}
                </div>
              ) : null}
              {filtrados.map((i, idx) => {
                const escolhido = i.id === value
                const emFoco = idx === indiceAtivo
                const orc = Number(i.quantidade_referencia ?? 0)
                const pct = orc > 0 ? Math.min(1, Number(i.qtd_real ?? 0) / orc) : 0
                return (
                  <div
                    key={i.id}
                    id={`${uid}-op-${i.id}`}
                    role="option"
                    aria-selected={escolhido}
                    data-ativo={emFoco}
                    onMouseMove={() => setAtivo(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => escolher(i.id)}
                    className={cn(
                      'w-full cursor-pointer text-left px-2 py-2 rounded flex flex-col gap-1',
                      escolhido && 'bg-accent-glow-strong',
                      emFoco && 'ring-2 ring-inset ring-accent',
                      !escolhido && emFoco && 'bg-bg-hover'
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {escolhido ? (
                        <Check size={12} className="text-accent shrink-0" aria-hidden />
                      ) : (
                        <span className="size-3 shrink-0" />
                      )}
                      <span className="tabular text-xs text-text-muted shrink-0">{i.codigo}</span>
                      <span className="truncate text-text">{i.descricao}</span>
                    </div>
                    <div className="pl-5 flex items-center gap-2 text-xs text-text-muted tabular">
                      <span
                        aria-hidden
                        className="h-1.5 w-16 bg-bg-elevated border border-border overflow-hidden inline-block"
                      >
                        <span
                          className="block h-full bg-accent"
                          style={{ width: `${pct * 100}%` }}
                        />
                      </span>
                      <span>
                        {formatNumber(Number(i.qtd_real ?? 0), 1)} de{' '}
                        {orc > 0 ? formatNumber(orc, 1) : '—'}{' '}
                        {i.unidade_referencia ?? i.servico_unidade ?? ''}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
