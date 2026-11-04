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
        onClick={() => setOpen((o) => !o)}
        className="h-10 w-full rounded border border-border bg-bg px-3 text-sm text-left flex items-center gap-2 hover:border-border-strong focus:border-accent focus:outline-none"
      >
        {sel ? (
          <>
            <span className="font-mono text-2xs text-text-dim shrink-0">{sel.codigo}</span>
            <span className="truncate text-text">{sel.descricao}</span>
          </>
        ) : (
          <span className="text-text-dim">
            {loading ? 'Carregando itens…' : 'Selecionar serviço…'}
          </span>
        )}
        <ChevronDown size={14} className="ml-auto text-text-dim shrink-0" />
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
          <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded border border-border-strong bg-bg-elevated shadow-xl max-h-[60vh] flex flex-col overflow-hidden">
            <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5">
              <Search size={12} className="text-text-dim" />
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por código ou descrição…"
                className="bg-transparent flex-1 text-sm text-text outline-none placeholder:text-text-dim h-8"
              />
            </div>
            <div className="overflow-auto flex-1 p-1">
              {filtrados.length === 0 ? (
                <div className="text-2xs font-mono text-text-dim p-3 text-center">
                  {itens.length === 0
                    ? 'Nenhum item com composição no orçamento desta obra.'
                    : 'sem resultados'}
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
                    onClick={() => {
                      onChange(i.id)
                      setOpen(false)
                      setBusca('')
                    }}
                    className={cn(
                      'w-full text-left px-2 py-2 rounded flex flex-col gap-0.5',
                      ativo ? 'bg-accent/15' : 'hover:bg-bg-hover'
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {ativo ? (
                        <Check size={12} className="text-accent shrink-0" />
                      ) : (
                        <span className="size-3 shrink-0" />
                      )}
                      <span className="font-mono text-2xs text-text-dim shrink-0">{i.codigo}</span>
                      <span className="truncate text-text">{i.descricao}</span>
                    </div>
                    <div className="pl-5 flex items-center gap-2 text-2xs font-mono text-text-dim">
                      <span className="h-1 w-16 rounded bg-bg overflow-hidden inline-block">
                        <span
                          className="block h-full bg-accent"
                          style={{ width: `${pct * 100}%` }}
                        />
                      </span>
                      <span>
                        {formatNumber(Number(i.qtd_real ?? 0), 1)} /{' '}
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
