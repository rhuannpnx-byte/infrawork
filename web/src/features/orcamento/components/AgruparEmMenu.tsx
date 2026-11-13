import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Package, Plus } from 'lucide-react'
import { Popover } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { fmtBRL } from '@/lib/money'
import type { ItemOrcamentario } from '@/types/orcamento'
import { useAlocarReceitas, useCriarServico } from '../hooks/alocacao'
import { avisarAlocacao } from '../lib/alocacao-ui'

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
      toast.error(err instanceof Error ? err.message : 'Falha ao agrupar')
    }
  }

  const criarEAplicar = async (): Promise<void> => {
    if (!nomeNovo) return
    try {
      const s = await criar.mutateAsync({ obra_id: obraId, descricao: nomeNovo })
      await aplicar(s.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao criar serviço')
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <Button variant="default" size="sm" onClick={() => setOpen((o) => !o)} disabled={ocupado}>
          <Package size={12} /> Agrupar {receitaIds.length} em… <ChevronDown size={12} />
        </Button>
      }
      className="w-[320px] p-0"
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
          placeholder="Buscar serviço ou digitar um novo…"
          className="w-full h-7 px-2 rounded bg-bg-elevated border border-border-strong text-xs outline-none focus:border-accent"
        />
      </div>
      <div className="max-h-[300px] overflow-auto py-1">
        {nomeNovo && !jaExiste ? (
          <button
            type="button"
            onClick={() => void criarEAplicar()}
            disabled={ocupado}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-bg-hover text-accent"
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
            className="w-full flex items-baseline gap-2 px-3 py-1.5 text-left hover:bg-bg-hover"
          >
            <span className="text-2xs font-mono text-text-dim w-8 shrink-0">{s.codigo}</span>
            <span className="text-xs text-text truncate flex-1">{s.descricao}</span>
            <span className="text-2xs font-mono text-text-dim tabular-nums">
              {fmtBRL(Number(s.venda_total_calc ?? 0))}
            </span>
          </button>
        ))}
        {lista.length === 0 && !nomeNovo ? (
          <div className="px-3 py-2 text-2xs text-text-dim">Digite o nome do novo serviço.</div>
        ) : null}
      </div>
    </Popover>
  )
}
