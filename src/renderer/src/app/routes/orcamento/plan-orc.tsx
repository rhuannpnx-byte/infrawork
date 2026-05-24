import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, RefreshCw, Package, RefreshCcw, FileUp } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import {
  useAtualizarItensParaCpuVigente,
  usePlanOrc,
  useRecalcularOrcamento
} from '@/features/orcamento/hooks/plan-orc'
import { useTaxaVigente } from '@/features/orcamento/hooks/taxas'
import { PlanOrcTree } from '@/features/orcamento/components/PlanOrcTree'
import { ItemDetailPanel } from '@/features/orcamento/components/ItemDetailPanel'
import { NewItemOrcamentarioDialog } from '@/features/orcamento/modals/NewItemOrcamentarioDialog'
import { AgruparComoServicoDialog } from '@/features/orcamento/modals/AgruparComoServicoDialog'
import { MoveItemDialog } from '@/features/orcamento/modals/MoveItemDialog'
import { ImportPlanOrcDialog } from '@/features/orcamento/modals/ImportPlanOrcDialog'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import type { ItemTreeNode } from '@/types/orcamento'

export function PlanOrcPage(): ReactNode {
  return (
    <RequireObra pageTitle="Planilha Orçamentária">
      <PlanilhaOrcamentaria />
    </RequireObra>
  )
}

function PlanilhaOrcamentaria(): ReactNode {
  const scope = useCurrentScope()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!

  const { data: plan, isLoading, error } = usePlanOrc(obraId)
  const recalc = useRecalcularOrcamento()
  const atualizar = useAtualizarItensParaCpuVigente()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newParent, setNewParent] = useState<string | null>(null)
  const [newTipoInicial, setNewTipoInicial] = useState<'etapa' | 'receita'>('receita')
  const [agruparOpen, setAgruparOpen] = useState(false)
  const [moverItem, setMoverItem] = useState<ItemTreeNode | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  /** IDs de receitas selecionadas (para agrupar). */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [hidratado, setHidratado] = useState(false)

  if (!hidratado && plan?.tree && plan.tree.length > 0) {
    setHidratado(true)
    setExpandedIds(new Set(plan.tree.map((n) => n.id)))
  }

  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'

  const { data: taxaVigente } = useTaxaVigente(obraId)

  const totalRaizVenda = useMemo(
    () => (plan?.tree ?? []).reduce((acc, n) => acc + n.venda_total_calc, 0),
    [plan]
  )
  const totalRaizCusto = useMemo(
    () => (plan?.tree ?? []).reduce((acc, n) => acc + n.custo_total_calc, 0),
    [plan]
  )
  // Aplica taxa vigente como deflator de receita pra calcular lucro líquido.
  const taxaPerc = Number(taxaVigente?.total_perc_calc ?? 0)
  const impostos = totalRaizVenda * taxaPerc
  const lucro = totalRaizVenda - totalRaizCusto - impostos
  const margemLiquida = totalRaizVenda > 0 ? lucro / totalRaizVenda : null

  const handleNewChild = (parent: ItemTreeNode | null): void => {
    setNewParent(parent?.id ?? null)
    // Em servico_grupo, força receita (regra de schema). Em outros, default receita.
    setNewTipoInicial(parent?.tipo === 'servico_grupo' ? 'receita' : 'receita')
    setNewOpen(true)
  }

  const handleToggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAbrirItem = (id: string): void => {
    setSelectedId(id)
    setDetailOpen(true)
  }

  const handleRecalcular = async (): Promise<void> => {
    try {
      const r = await recalc.mutateAsync({ obra_id: obraId })
      toast.success(`Recalculado: ${r.itens_atualizados} itens em ${r.duracao_ms}ms.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao recalcular')
    }
  }

  const handleAtualizarCpus = async (): Promise<void> => {
    try {
      const r = await atualizar.mutateAsync({ obra_id: obraId })
      toast.success(`${r.atualizados} item(s) atualizados para CPU vigente.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao atualizar')
    }
  }

  // Receitas selecionadas (para o modal de agrupar)
  const receitasSelecionadas = useMemo(() => {
    return (plan?.flat ?? []).filter((n) => n.tipo === 'receita' && selectedIds.has(n.id))
  }, [plan, selectedIds])

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Planilha Orçamentária"
        subtitle={`${scope.obra?.nome ?? ''} — receitas, etapas e grupos de serviço`}
        actions={
          podeEditar ? (
            <div className="flex items-center gap-2">
              {receitasSelecionadas.length > 0 ? (
                <Button variant="default" size="sm" onClick={() => setAgruparOpen(true)}>
                  <Package size={11} /> Agrupar {receitasSelecionadas.length} como serviço
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAtualizarCpus}
                disabled={atualizar.isPending}
              >
                <RefreshCcw size={11} />{' '}
                {atualizar.isPending ? 'Atualizando…' : 'Atualizar CPUs vigentes'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRecalcular}
                disabled={recalc.isPending}
              >
                <RefreshCw size={11} /> {recalc.isPending ? 'Recalculando…' : 'Recalcular'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                <FileUp size={11} /> Importar planilha
              </Button>
              <Button variant="default" size="sm" onClick={() => handleNewChild(null)}>
                <Plus size={11} /> Novo item raiz
              </Button>
            </div>
          ) : null
        }
      />
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      <div className="flex-1 min-h-0">
        <PlanOrcTree
          obraId={obraId}
          flat={plan?.flat ?? []}
          podeEditar={podeEditar}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelect={handleAbrirItem}
          onNewChild={handleNewChild}
          onMover={(node) => setMoverItem(node)}
          expandedIds={expandedIds}
          setExpandedIds={setExpandedIds}
        />
      </div>
      {/* Footer com totais — lucro inclui impostos da taxa vigente como deflator */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-bg-panel text-2xs font-mono">
        <div className="text-text-dim">
          {plan?.flat.length ?? 0} item(s){isLoading ? ' · carregando…' : ''}
          {selectedIds.size > 0 ? ` · ${selectedIds.size} selecionado(s)` : ''}
          {taxaVigente ? (
            <span>
              {' · '}
              <span className="text-text-muted">
                Taxa: {taxaVigente.nome} · {fmtPct2(taxaPerc)}
              </span>
            </span>
          ) : (
            <span>
              {' · '}
              <span className="text-warn">sem taxa vigente (lucro = bruto)</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-text-dim">
            Venda: <span className="text-text">{fmtBRL(totalRaizVenda)}</span>
          </span>
          <span className="text-text-dim">
            Custo: <span className="text-text">{fmtBRL(totalRaizCusto)}</span>
          </span>
          <span className="text-text-dim">
            Impostos: <span className="text-warn">{fmtBRL(impostos)}</span>
          </span>
          <span className="text-text-dim">
            Lucro:{' '}
            <span className={lucro >= 0 ? 'text-success' : 'text-danger'}>{fmtBRL(lucro)}</span>
          </span>
          <span className="text-text-dim">
            Margem líquida:{' '}
            <Badge
              variant={
                margemLiquida === null
                  ? 'default'
                  : margemLiquida < 0
                    ? 'danger'
                    : margemLiquida < 0.1
                      ? 'warn'
                      : 'success'
              }
            >
              {margemLiquida !== null ? fmtPct2(margemLiquida) : '—'}
            </Badge>
          </span>
        </div>
      </div>

      {/* Dialogs */}
      <ItemDetailPanel
        open={detailOpen}
        onOpenChange={setDetailOpen}
        itemId={selectedId}
        obraId={obraId}
        podeEditar={podeEditar}
      />
      <NewItemOrcamentarioDialog
        open={newOpen}
        onOpenChange={(o) => {
          setNewOpen(o)
          if (!o) setNewParent(null)
        }}
        obraId={obraId}
        parentId={newParent}
        tipoInicial={newTipoInicial}
      />
      <AgruparComoServicoDialog
        open={agruparOpen}
        onOpenChange={(o) => {
          setAgruparOpen(o)
          if (!o) setSelectedIds(new Set())
        }}
        obraId={obraId}
        receitas={receitasSelecionadas}
      />
      <MoveItemDialog
        open={moverItem !== null}
        onOpenChange={(o) => {
          if (!o) setMoverItem(null)
        }}
        obraId={obraId}
        item={moverItem}
      />
      <ImportPlanOrcDialog open={importOpen} onOpenChange={setImportOpen} obraId={obraId} />
    </div>
  )
}
