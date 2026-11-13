import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ChevronsRight, Link2Off, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { contar } from '@/lib/rotulos'
import { fmtBRL, fmtQtd } from '@/lib/money'
import type { ItemAlocacao, ItemOrcamentario } from '@/types/orcamento'
import { useAlocarReceitas, useCriarServico } from '../hooks/alocacao'
import { DRAG_RECEITAS, avisarAlocacao } from '../lib/alocacao-ui'

interface Props {
  obraId: string
  servicos: ItemOrcamentario[]
  alocacoes: ItemAlocacao[]
  podeEditar: boolean
  /** Serviço destacado na planilha (clique alterna). */
  destacadoId: string | null
  onDestacar: (id: string | null) => void
  onAbrir: (id: string) => void
  onRecolher: () => void
}

/**
 * Painel "Serviços" ao lado da planilha de venda: lista os agrupadores com
 * venda, quantidade e preço unitário cheio. Clique destaca as receitas do
 * serviço na planilha; arrastar receitas para um serviço as aloca.
 */
export function ServicosPanel({
  obraId,
  servicos,
  alocacoes,
  podeEditar,
  destacadoId,
  onDestacar,
  onAbrir,
  onRecolher
}: Props): ReactNode {
  const [busca, setBusca] = useState('')
  const [novo, setNovo] = useState('')
  const [dropAlvo, setDropAlvo] = useState<string | null>(null)
  const criar = useCriarServico()
  const alocar = useAlocarReceitas()

  const nReceitas = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of alocacoes) m.set(a.grupo_id, (m.get(a.grupo_id) ?? 0) + 1)
    return m
  }, [alocacoes])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return servicos
    return servicos.filter(
      (s) => s.descricao.toLowerCase().includes(q) || s.codigo.toLowerCase().includes(q)
    )
  }, [servicos, busca])

  const onDrop = async (e: DragEvent, grupoId: string): Promise<void> => {
    e.preventDefault()
    setDropAlvo(null)
    const raw = e.dataTransfer.getData(DRAG_RECEITAS)
    if (!raw) return
    const ids = JSON.parse(raw) as string[]
    try {
      const r = await alocar.mutateAsync({ obra_id: obraId, grupo_id: grupoId, receita_ids: ids })
      avisarAlocacao(r.alocadas, r.avisos)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível agrupar as receitas.')
    }
  }

  const criarServico = async (): Promise<void> => {
    const nome = novo.trim()
    if (!nome) return
    try {
      const r = await criar.mutateAsync({ obra_id: obraId, descricao: nome })
      setNovo('')
      toast.success(`Serviço ${r.codigo} criado.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível criar o serviço.')
    }
  }

  return (
    <aside
      aria-label="Serviços"
      className="w-[320px] shrink-0 border-l border-border bg-bg-panel flex flex-col min-h-0"
    >
      <div className="flex items-center gap-2 px-3 h-10 border-b border-border">
        <h2 className="text-md font-semibold text-text flex-1">
          Serviços <span className="font-normal text-text-muted tabular">{servicos.length}</span>
        </h2>
        <button
          type="button"
          onClick={onRecolher}
          title="Recolher os serviços"
          aria-label="Recolher os serviços"
          className="w-7 h-7 grid place-items-center rounded text-text-muted hover:text-text hover:bg-bg-hover"
        >
          <ChevronsRight size={14} />
        </button>
      </div>

      {servicos.length > 8 ? (
        <div className="px-2 py-1.5 border-b border-border">
          <div className="flex items-center gap-1.5 h-8 px-2 rounded bg-bg-panel border border-border-strong focus-within:border-accent">
            <Search size={12} className="text-text-dim" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar serviço"
              aria-label="Buscar serviço"
              className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
            />
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        {lista.map((s) => {
          const qtd = Number(s.quantidade_referencia ?? 0)
          const venda = Number(s.venda_total_calc ?? 0)
          const unit = qtd > 0 ? venda / qtd : null
          const ativo = destacadoId === s.id
          const semVinculo = !s.servico_id && !s.indireto_id
          return (
            <div
              key={s.id}
              onDragOver={(e) => {
                if (!podeEditar || !e.dataTransfer.types.includes(DRAG_RECEITAS)) return
                e.preventDefault()
                setDropAlvo(s.id)
              }}
              onDragLeave={() => setDropAlvo((d) => (d === s.id ? null : d))}
              onDrop={(e) => void onDrop(e, s.id)}
              tabIndex={0}
              aria-current={ativo || undefined}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter') onAbrir(s.id)
                else if (e.key === ' ') {
                  e.preventDefault()
                  onDestacar(ativo ? null : s.id)
                }
              }}
              className={cn(
                'group px-3 py-2 border-b border-border cursor-pointer focus-visible:outline-none focus-visible:bg-bg-active',
                ativo ? 'bg-accent-glow-strong' : 'hover:bg-bg-hover',
                dropAlvo === s.id && 'bg-accent-glow ring-1 ring-inset ring-accent'
              )}
              onClick={() => onDestacar(ativo ? null : s.id)}
              onDoubleClick={() => onAbrir(s.id)}
              title="Clique para destacar as receitas na planilha; duplo clique ou Enter para abrir"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-xs tabular text-text-dim">{s.codigo}</span>
                <span className="text-sm text-text font-medium truncate flex-1">{s.descricao}</span>
                <span className="text-sm tabular-nums text-text">{fmtBRL(venda)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                <span className="tabular-nums">
                  {fmtQtd(qtd)} {s.unidade_referencia ?? ''}
                </span>
                {unit !== null ? <span className="tabular-nums">· {fmtBRL(unit)}/un</span> : null}
                <span className="ml-auto">
                  {contar(nReceitas.get(s.id) ?? 0, 'receita', 'receitas')}
                </span>
                {semVinculo ? (
                  <span
                    role="img"
                    aria-label="Sem composição vinculada"
                    title="Sem composição vinculada: não entra em custo, programação e produção"
                  >
                    <Link2Off size={12} className="text-warn" />
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAbrir(s.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 font-semibold text-accent hover:underline"
                >
                  Abrir
                </button>
              </div>
            </div>
          )
        })}
        {servicos.length === 0 ? (
          <div className="p-4 text-sm text-text-muted">
            Nenhum serviço ainda. Selecione receitas na planilha e use &quot;Agrupar em um serviço&quot;, ou
            crie um serviço abaixo e arraste as receitas para ele.
          </div>
        ) : null}
      </div>

      {podeEditar ? (
        <div className="p-2 border-t border-border">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void criarServico()
            }}
            className="flex items-center gap-1.5 h-8 px-2 rounded border border-dashed border-border-strong focus-within:border-accent"
          >
            <Plus size={12} className="text-text-dim" />
            <input
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              placeholder="Novo serviço (Enter para criar)"
              aria-label="Nome do novo serviço"
              className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
              disabled={criar.isPending}
            />
          </form>
        </div>
      ) : null}
    </aside>
  )
}
