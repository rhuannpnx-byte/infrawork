import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Package, RefreshCcw, FileUp, Trash2, X, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RequireObra } from '@/components/layout/RequireObra'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import {
  useAtualizarItensParaCpuVigente,
  usePlanOrc,
  useRecalcularOrcamento
} from '@/features/orcamento/hooks/plan-orc'
import { previewCascadeItensOrcamentarios } from '@/features/orcamento/hooks/cascade'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useTaxaVigente } from '@/features/orcamento/hooks/taxas'
import { PlanOrcTree } from '@/features/orcamento/components/PlanOrcTree'
import { ItemDetailPanel } from '@/features/orcamento/components/ItemDetailPanel'
import { NewItemOrcamentarioDialog } from '@/features/orcamento/modals/NewItemOrcamentarioDialog'
import { AgruparComoServicoDialog } from '@/features/orcamento/modals/AgruparComoServicoDialog'
import { AgenteAgrupamentoDialog } from '@/features/orcamento/modals/AgenteAgrupamentoDialog'
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
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newParent, setNewParent] = useState<string | null>(null)
  const [newTipoInicial, setNewTipoInicial] = useState<'etapa' | 'receita'>('receita')
  const [agruparOpen, setAgruparOpen] = useState(false)
  const [agenteOpen, setAgenteOpen] = useState(false)
  const [moverItem, setMoverItem] = useState<ItemTreeNode | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  /** IDs de receitas selecionadas (para agrupar). */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [hidratado, setHidratado] = useState(false)

  // Planilha vem TOTALMENTE expandida por default (todos os níveis, não só as raízes).
  if (!hidratado && plan?.flat && plan.flat.length > 0) {
    setHidratado(true)
    setExpandedIds(new Set(plan.flat.map((n) => n.id)))
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

  // Receitas selecionadas (para o modal de agrupar — só receitas podem agrupar)
  const receitasSelecionadas = useMemo(() => {
    return (plan?.flat ?? []).filter((n) => n.tipo === 'receita' && selectedIds.has(n.id))
  }, [plan, selectedIds])
  // Todas as selecionadas (qualquer tipo) — pra exclusão em lote
  const itensSelecionados = useMemo(() => {
    return (plan?.flat ?? []).filter((n) => selectedIds.has(n.id))
  }, [plan, selectedIds])
  const todasSelecionadasSaoReceitas =
    itensSelecionados.length > 0 && itensSelecionados.every((n) => n.tipo === 'receita')

  const handleBulkDelete = async (): Promise<void> => {
    if (itensSelecionados.length === 0) return
    const tiposCount = itensSelecionados.reduce<Record<string, number>>((acc, n) => {
      acc[n.tipo] = (acc[n.tipo] ?? 0) + 1
      return acc
    }, {})
    const breakdown = Object.entries(tiposCount)
      .map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`)
      .join(', ')

    let preview
    try {
      preview = await previewCascadeItensOrcamentarios(
        itensSelecionados.map((n) => n.id),
        plan?.flat ?? []
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao avaliar dependências')
      return
    }

    const ok = await confirm({
      title: `Excluir ${itensSelecionados.length} item(ns)?`,
      description: (
        <div className="space-y-2">
          <p>
            Seleção: <span className="text-text">{breakdown}</span>.
          </p>
          {preview.descendentesEmCascata > 0 ? (
            <p>
              <span className="text-warn">{preview.descendentesEmCascata} descendente(s)</span>{' '}
              serão apagados em cascata (índices/grupos com filhos arrastam tudo).
            </p>
          ) : null}
          {preview.tarefasQueFicarOrfas > 0 ? (
            <p>
              <span className="text-warn">
                {preview.tarefasQueFicarOrfas} tarefa(s) de planejamento
              </span>{' '}
              ficarão órfãs (perdem o vínculo com o item, inclusive em linha de base). As tarefas{' '}
              <strong>não</strong> serão apagadas — só desvinculadas. Você pode re-vinculá-las ou
              apagá-las depois pelo módulo de Planejamento.
            </p>
          ) : null}
          <p className="text-text-dim">
            Total a apagar: <strong>{preview.totalParaApagar}</strong> item(ns).
          </p>
        </div>
      ),
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
    if (!SUPABASE_ENABLED || !supabase) {
      toast.error('Supabase não configurado.')
      return
    }

    // Limpa seleção imediatamente — UX responsiva.
    setSelectedIds(new Set())
    setBulkDeleting(true)
    const t0 = performance.now()

    try {
      // Agrupa por nível pra apagar folhas-primeiro (FK parent_id é RESTRICT).
      // 1 query por nível em vez de N queries por item.
      const nivelById = new Map<string, number>()
      for (const n of plan?.flat ?? []) nivelById.set(n.id, n.nivel ?? 0)
      const porNivel = new Map<number, string[]>()
      for (const id of preview.idsOrdenadosParaDelete) {
        const nv = nivelById.get(id) ?? 0
        const arr = porNivel.get(nv) ?? []
        arr.push(id)
        porNivel.set(nv, arr)
      }
      const niveisDesc = [...porNivel.keys()].sort((a, b) => b - a)
      let total = 0
      for (const nv of niveisDesc) {
        const ids = porNivel.get(nv)!
        const { error: err } = await supabase.from('item_orcamentario').delete().in('id', ids)
        if (err) {
          console.error('[plan-orc bulk delete] nivel', nv, err)
          toast.error(
            `Falha no nível ${nv}: ${err.message}. Apagados antes: ${total}/${preview.idsOrdenadosParaDelete.length}.`
          )
          return
        }
        total += ids.length
      }
      const ms = Math.round(performance.now() - t0)
      toast.success(`${total} item(ns) excluído(s) em ${ms}ms.`)
    } finally {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', obraId] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade', obraId] })
      setBulkDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Planilha Orçamentária"
        subtitle={`${scope.obra?.nome ?? ''} — receitas, etapas e grupos de serviço`}
        actions={
          podeEditar ? (
            <div className="flex items-center gap-2">
              {itensSelecionados.length > 0 ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                    title="Limpar seleção"
                  >
                    <X size={11} /> {itensSelecionados.length} selecionado(s)
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger/10"
                    onClick={() => void handleBulkDelete()}
                    disabled={bulkDeleting}
                  >
                    <Trash2 size={11} /> {bulkDeleting ? 'Excluindo…' : 'Excluir'}
                  </Button>
                </>
              ) : null}
              {todasSelecionadasSaoReceitas && receitasSelecionadas.length > 0 ? (
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
              {role === 'god' ? (
                <Button variant="secondary" size="sm" onClick={() => setAgenteOpen(true)}>
                  <Sparkles size={11} /> Agente de agrupamento
                </Button>
              ) : null}
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
          setSelectedIds={setSelectedIds}
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
      <AgenteAgrupamentoDialog open={agenteOpen} onOpenChange={setAgenteOpen} obraId={obraId} />
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
