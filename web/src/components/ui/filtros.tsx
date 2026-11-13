import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { Popover } from './popover'
import { Button } from './button'
import { cn } from '@/lib/utils'

/** Faixa de filtros abaixo do cabeçalho da página. */
export function BarraFiltros({
  children,
  aoLimpar,
  className
}: {
  children: ReactNode
  /** Mostra "Limpar filtros" quando informado. */
  aoLimpar?: (() => void) | null
  className?: string
}): ReactNode {
  return (
    <div
      role="group"
      aria-label="Filtros"
      className={cn(
        'border-b border-border bg-bg-panel px-5 py-2 flex flex-wrap items-center gap-x-4 gap-y-2',
        className
      )}
    >
      {children}
      {aoLimpar ? (
        <Button variant="ghost" size="sm" onClick={aoLimpar}>
          <X size={12} /> Limpar filtros
        </Button>
      ) : null}
    </div>
  )
}

/** Um filtro com o seu rótulo à esquerda. */
export function Filtro({ rotulo, children }: { rotulo: string; children: ReactNode }): ReactNode {
  return (
    <label className="flex items-center gap-2 text-sm text-text-muted">
      <span>{rotulo}</span>
      {children}
    </label>
  )
}

export const CONTROLE_FILTRO =
  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded border bg-bg-panel text-sm transition-colors'

interface Opcao {
  valor: string
  rotulo: string
}

/**
 * Filtro de múltipla escolha: botão com o resumo da seleção e lista com caixas de marcar; com muitas opções
 * aparece a busca. Sem seleção vale "todos".
 */
export function FiltroMulti({
  rotulo,
  opcoes,
  selecionados,
  aoMudar,
  todos = 'Todos'
}: {
  rotulo: string
  opcoes: Opcao[]
  selecionados: string[]
  aoMudar: (valores: string[]) => void
  /** Texto do botão quando nada está marcado (ex.: "Todas"). */
  todos?: string
}): ReactNode {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? opcoes.filter((o) => o.rotulo.toLowerCase().includes(q)) : opcoes
  }, [opcoes, busca])
  const resumo =
    selecionados.length === 0
      ? todos
      : selecionados.length === 1
        ? (opcoes.find((o) => o.valor === selecionados[0])?.rotulo ?? '1 marcado')
        : `${selecionados.length} marcados`

  return (
    <div className="flex items-center gap-2 text-sm text-text-muted">
      <span>{rotulo}</span>
      <Popover
        open={aberto}
        onOpenChange={(o) => {
          setAberto(o)
          if (!o) setBusca('')
        }}
        className="w-[300px] max-w-[90vw] p-0"
        trigger={
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={aberto}
            aria-label={`${rotulo}: ${resumo}`}
            onClick={() => setAberto((a) => !a)}
            className={cn(
              CONTROLE_FILTRO,
              'max-w-[240px]',
              selecionados.length > 0
                ? 'border-accent text-accent font-semibold'
                : 'border-border-strong text-text hover:border-border-accent'
            )}
          >
            <span className="truncate">{resumo}</span>
            <ChevronDown size={12} className="shrink-0" />
          </button>
        }
      >
        {opcoes.length > 8 ? (
          <div className="flex items-center gap-2 px-2.5 h-9 border-b border-border">
            <Search size={12} className="text-text-dim shrink-0" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={`Buscar em ${rotulo.toLowerCase()}`}
              className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
            />
          </div>
        ) : null}
        <div role="listbox" aria-multiselectable className="max-h-[280px] overflow-auto p-1">
          {visiveis.length === 0 ? (
            <div className="px-2 py-3 text-sm text-text-muted">
              {opcoes.length === 0 ? 'Nenhuma opção disponível.' : 'Nada com esse nome.'}
            </div>
          ) : null}
          {visiveis.map((o) => {
            const marcado = selecionados.includes(o.valor)
            return (
              <button
                key={o.valor}
                type="button"
                role="option"
                aria-selected={marcado}
                onClick={() =>
                  aoMudar(
                    marcado ? selecionados.filter((v) => v !== o.valor) : [...selecionados, o.valor]
                  )
                }
                className={cn(
                  'w-full flex items-center gap-2 px-2 min-h-8 py-1 rounded text-left text-sm',
                  marcado ? 'text-accent font-semibold' : 'text-text',
                  'hover:bg-bg-hover'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 rounded-sm border inline-flex items-center justify-center',
                    marcado
                      ? 'bg-accent border-accent text-[color:var(--on-accent)]'
                      : 'border-border-strong bg-bg-panel'
                  )}
                >
                  {marcado ? <Check size={12} strokeWidth={3} /> : null}
                </span>
                <span className="truncate">{o.rotulo}</span>
              </button>
            )
          })}
        </div>
        {selecionados.length > 0 ? (
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => aoMudar([])}
              className="w-full h-8 px-2 rounded text-left text-sm text-text-muted hover:bg-bg-hover hover:text-text"
            >
              Limpar seleção
            </button>
          </div>
        ) : null}
      </Popover>
    </div>
  )
}

/** Filtro de escolha única com busca; a primeira opção é "todos" (valor nulo). */
export function FiltroUnico({
  rotulo,
  opcoes,
  valor,
  aoMudar,
  todos = 'Todos',
  largura = 280
}: {
  rotulo: string
  opcoes: Opcao[]
  valor: string | null
  aoMudar: (valor: string | null) => void
  todos?: string
  largura?: number
}): ReactNode {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? opcoes.filter((o) => o.rotulo.toLowerCase().includes(q)) : opcoes
  }, [opcoes, busca])
  const atual = valor ? opcoes.find((o) => o.valor === valor) : null
  const escolher = (v: string | null): void => {
    aoMudar(v)
    setAberto(false)
    setBusca('')
  }
  const item = (v: string | null, texto: string): ReactNode => {
    const marcado = valor === v
    return (
      <button
        key={v ?? '__todos'}
        type="button"
        role="option"
        aria-selected={marcado}
        onClick={() => escolher(v)}
        className={cn(
          'w-full flex items-center gap-2 px-2 min-h-8 py-1 rounded text-left text-sm hover:bg-bg-hover',
          marcado ? 'bg-accent-glow-strong text-accent font-semibold' : 'text-text'
        )}
      >
        <span className="size-3 shrink-0 inline-flex">{marcado ? <Check size={12} /> : null}</span>
        <span className="truncate">{texto}</span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 text-sm text-text-muted">
      <span>{rotulo}</span>
      <Popover
        open={aberto}
        onOpenChange={(o) => {
          setAberto(o)
          if (!o) setBusca('')
        }}
        className="w-[360px] max-w-[90vw] p-0"
        trigger={
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={aberto}
            aria-label={`${rotulo}: ${atual?.rotulo ?? todos}`}
            onClick={() => setAberto((a) => !a)}
            style={{ width: largura }}
            className={cn(
              CONTROLE_FILTRO,
              'max-w-full',
              atual
                ? 'border-accent text-accent font-semibold'
                : 'border-border-strong text-text hover:border-border-accent'
            )}
          >
            <span className="flex-1 text-left truncate">{atual?.rotulo ?? todos}</span>
            <ChevronDown size={12} className="shrink-0" />
          </button>
        }
      >
        <div className="flex items-center gap-2 px-2.5 h-9 border-b border-border">
          <Search size={12} className="text-text-dim shrink-0" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={`Buscar em ${rotulo.toLowerCase()}`}
            className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
          />
        </div>
        <div role="listbox" className="max-h-[300px] overflow-auto p-1">
          {busca ? null : item(null, todos)}
          {visiveis.length === 0 ? (
            <div className="px-2 py-3 text-sm text-text-muted">Nada com esse nome.</div>
          ) : null}
          {visiveis.map((o) => item(o.valor, o.rotulo))}
        </div>
      </Popover>
    </div>
  )
}
