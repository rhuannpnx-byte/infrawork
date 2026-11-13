import { useMemo, useState, type ReactNode } from 'react'
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
  className
}: {
  itens: ItemLancavel[]
  value: string
  onChange: (id: string) => void
  loading?: boolean
  className?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState('')
  const sel = itens.find((i) => i.id === value) ?? null
  const filtrados = useMemo(() => {
    const q = normalize(busca.trim())
    if (!q) return itens
    return itens.filter((i) =>
      normalize(`${i.codigo} ${i.descricao} ${i.servico_nome ?? ''}`).includes(q)
    )
  }, [itens, busca])

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="h-10 w-full rounded border border-border-strong bg-bg-panel px-3 text-sm text-left flex items-center gap-2 hover:border-border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
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
        <ChevronDown size={14} className="ml-auto text-text-muted shrink-0" />
      </button>
      {open ? (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => {
              setOpen(false)
              setBusca('')
            }}
          />
          <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded border border-border-strong bg-[color:var(--popover)] shadow-[var(--sombra-flutuante)] max-h-[60vh] flex flex-col overflow-hidden">
            <div className="px-2.5 py-1 border-b border-border flex items-center gap-2">
              <Search size={14} className="text-text-dim shrink-0" />
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  e.stopPropagation()
                  setOpen(false)
                  setBusca('')
                }}
                placeholder="Buscar por código ou descrição"
                aria-label="Buscar serviço por código ou descrição"
                className="bg-transparent flex-1 text-sm text-text outline-none placeholder:text-text-dim h-8"
              />
            </div>
            <div role="listbox" aria-label="Serviços" className="overflow-auto flex-1 p-1">
              {filtrados.length === 0 ? (
                <div className="text-sm text-text-muted px-3 py-3">
                  {itens.length === 0
                    ? 'Nenhum serviço com composição no orçamento desta obra. Vincule as composições na planilha orçamentária para poder lançar.'
                    : 'Nenhum serviço com esse código ou descrição.'}
                </div>
              ) : null}
              {filtrados.map((i) => {
                const ativo = i.id === value
                const orc = Number(i.quantidade_referencia ?? 0)
                const pct = orc > 0 ? Math.min(1, Number(i.qtd_real ?? 0) / orc) : 0
                return (
                  <button
                    key={i.id}
                    type="button"
                    role="option"
                    aria-selected={ativo}
                    onClick={() => {
                      onChange(i.id)
                      setOpen(false)
                      setBusca('')
                    }}
                    className={cn(
                      'w-full text-left px-2 py-2 rounded flex flex-col gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                      ativo ? 'bg-accent-glow-strong' : 'hover:bg-bg-hover'
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {ativo ? (
                        <Check size={12} className="text-accent shrink-0" />
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
                  </button>
                )
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
