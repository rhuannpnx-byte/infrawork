import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Package, Plus } from 'lucide-react'
import { Popover } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { fmtBRL } from '@/lib/money'
import type { ItemOrcamentario } from '@/types/orcamento'
import { useAlocarReceitas, useCriarServico } from '../hooks/alocacao'
import { avisarAlocacao } from '../lib/alocacao-ui'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

interface Props {
  obraId: string
  servicos: ItemOrcamentario[]
  receitaIds: string[]
  onDone: () => void
}

/** "Agrupar em… ▾": aloca as receitas selecionadas num serviço existente ou novo. */
export function AgruparEmMenu({ obraId, servicos, receitaIds, onDone }: Props): ReactNode {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const alocar = useAlocarReceitas()
  const criar = useCriarServico()
  const ocupado = alocar.isPending || criar.isPending

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t
      ? servicos.filter(
          (s) => s.descricao.toLowerCase().includes(t) || s.codigo.toLowerCase().includes(t)
        )
      : servicos
  }, [servicos, q])
  const nomeNovo = q.trim()
  const jaExiste = servicos.some((s) => s.descricao.trim().toLowerCase() === nomeNovo.toLowerCase())

  const aplicar = async (grupoId: string): Promise<void> => {
    try {
      const r = await alocar.mutateAsync({
        obra_id: obraId,
        grupo_id: grupoId,
        receita_ids: receitaIds
      })
      avisarAlocacao(r.alocadas, r.avisos)
      setOpen(false)
      setQ('')
      onDone()
    } catch (err) {
      toast.error(`Não foi possível agrupar as receitas. ${detalheDoErro(err) ?? 'Tente de novo.'}`)
    }
  }

  const criarEAplicar = async (): Promise<void> => {
    if (!nomeNovo) return
    try {
      const s = await criar.mutateAsync({ obra_id: obraId, descricao: nomeNovo })
      await aplicar(s.id)
    } catch (err) {
      toast.error(`Não foi possível criar o serviço. ${detalheDoErro(err) ?? 'Tente de novo.'}`)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      trigger={
        <Button variant="default" size="sm" onClick={() => setOpen((o) => !o)} disabled={ocupado}>
          <Package size={12} /> Agrupar em um serviço <ChevronDown size={12} />
        </Button>
      }
      className="w-[360px] max-w-[90vw] p-0"
    >
      <div className="p-2 border-b border-border">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (lista.length === 1) void aplicar(lista[0].id)
              else if (nomeNovo && !jaExiste) void criarEAplicar()
            }
          }}
          placeholder="Buscar serviço ou digitar um novo"
          aria-label="Buscar serviço ou digitar um novo"
          className="w-full h-8 px-2 rounded bg-bg-panel border border-border-strong text-sm text-text outline-none focus:border-accent"
        />
      </div>
      <div className="max-h-[300px] overflow-auto py-1">
        {nomeNovo && !jaExiste ? (
          <button
            type="button"
            onClick={() => void criarEAplicar()}
            disabled={ocupado}
            className="w-full flex items-center gap-2 px-3 min-h-8 py-1.5 text-left text-sm font-semibold hover:bg-bg-hover text-accent"
          >
            <Plus size={12} /> Novo serviço “{nomeNovo}”
          </button>
        ) : null}
        {lista.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => void aplicar(s.id)}
            disabled={ocupado}
            className="w-full flex items-baseline gap-2 px-3 min-h-8 py-1.5 text-left hover:bg-bg-hover"
          >
            <span className="text-xs tabular text-text-dim w-8 shrink-0">{s.codigo}</span>
            <span className="text-sm text-text truncate flex-1">{s.descricao}</span>
            <span className="text-xs text-text-muted tabular-nums">
              {fmtBRL(Number(s.venda_total_calc ?? 0))}
            </span>
          </button>
        ))}
        {lista.length === 0 && !nomeNovo ? (
          <div className="px-3 py-2 text-sm text-text-muted">Digite o nome do novo serviço.</div>
        ) : null}
      </div>
    </Popover>
  )
}
