import { useMemo, useState, type ReactNode } from 'react'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useCadeiaTrava } from '@/features/planejamento/hooks/planejamentos'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, FileUp, FilePlus2, ChevronsLeft, Percent, Archive } from 'lucide-react'
import { ImportOrcamentoDialog } from '@/features/orcamento/modals/ImportOrcamentoDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RequireObra } from '@/components/layout/RequireObra'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { usePlanOrc } from '@/features/orcamento/hooks/plan-orc'
import { previewCascadeItensOrcamentarios } from '@/features/orcamento/hooks/cascade'
import { supabase } from '@/lib/supabase/client'
import { useTaxaVigente } from '@/features/orcamento/hooks/taxas'
import { PlanOrcTree } from '@/features/orcamento/components/PlanOrcTree'
import { ItemDetailPanel } from '@/features/orcamento/components/ItemDetailPanel'
import { NewItemOrcamentarioDialog } from '@/features/orcamento/modals/NewItemOrcamentarioDialog'
import { RatearDialog } from '@/features/orcamento/modals/RatearDialog'
import { ServicosPanel } from '@/features/orcamento/components/ServicosPanel'
import { AgruparEmMenu } from '@/features/orcamento/components/AgruparEmMenu'
import { useRemoverAlocacoes } from '@/features/orcamento/hooks/alocacao'
import { useAditivos } from '@/features/orcamento/hooks/aditivos'
import { useNavigate } from '@tanstack/react-router'
import { MoveItemDialog } from '@/features/orcamento/modals/MoveItemDialog'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { contar } from '@/lib/rotulos'
import type { AlocStatus, ItemTreeNode } from '@/types/orcamento'

export function PlanOrcPage(): ReactNode {
  return (
    <RequireObra pageTitle="Planilha Orçamentária">
      <PlanilhaOrcamentaria />
    </RequireObra>
  )
}

function PlanilhaOrcamentaria(): ReactNode {
  const scope = useCurrentScope()
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!

  const { data: plan, isLoading, error } = usePlanOrc(obraId)
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newParent, setNewParent] = useState<string | null>(null)
  const [newTipoInicial, setNewTipoInicial] = useState<'etapa' | 'receita'>('receita')
  const [filtroAloc, setFiltroAloc] = useState<Set<AlocStatus>>(new Set())
  const [destacadoId, setDestacadoId] = useState<string | null>(null)
  const [painelServicos, setPainelServicos] = useState(true)
  const [ratearNode, setRatearNode] = useState<ItemTreeNode | null>(null)
  const removerAloc = useRemoverAlocacoes()
  const [importOpen, setImportOpen] = useState(false)
  const [moverItem, setMoverItem] = useState<ItemTreeNode | null>(null)
  /** IDs de receitas selecionadas (para agrupar). */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [hidratado, setHidratado] = useState(false)

  // Planilha vem TOTALMENTE expandida por default (todos os níveis, não só as raízes).
  if (!hidratado && plan?.flat && plan.flat.length > 0) {
    setHidratado(true)
    setExpandedIds(new Set(plan.flat.map((n) => n.id)))
  }

  const { data: cadeiaTrava } = useCadeiaTrava(obraId)
  const podeRole = role === 'god' || role === 'adm' || role === 'engenheiro'
  const { data: aditivos = [] } = useAditivos(obraId)
  const temAditivo = aditivos.some((a) => a.status === 'aplicado')
  // cadeia editável (sem vigente e com plano em edição, ou antes de qualquer LB)
  const podeEditar = podeRole && !cadeiaTrava
  // planilha de venda (receitas/etapas): só antes do 1º aditivo
  const podePlanilha = podeEditar && !temAditivo
  // agrupar/ratear: com a cadeia travada, só receitas nascidas de aditivo (saldo)
  const podeAlocar = (n: { tipo: string; aditivo_id?: string | null }): boolean =>
    podeRole && n.tipo === 'receita' && (podeEditar || !!n.aditivo_id)
  const temReceitaAditivo = (plan?.flat ?? []).some((n) => !!n.aditivo_id)
  const podeServicos = podeRole && (podeEditar || temReceitaAditivo)

  const { data: taxaVigente } = useTaxaVigente(obraId)

  const totalRaizVenda = plan?.totais.venda ?? 0
  const totalRaizCusto = useMemo(
    () => (plan?.servicos ?? []).reduce((acc, s) => acc + Number(s.custo_total_calc ?? 0), 0),
    [plan]
  )
  const agrupado = plan?.totais.agrupado ?? 0
  const pctAgrupado = totalRaizVenda > 0 ? agrupado / totalRaizVenda : 0

  // Receitas do serviço destacado no painel → fração
  const destaque = useMemo(() => {
    if (!destacadoId || !plan) return null
    return new Map(
      plan.alocacoes.filter((a) => a.grupo_id === destacadoId).map((a) => [a.receita_id, a.fracao])
    )
  }, [destacadoId, plan])
  const vendaPorReceita = useMemo(
    () =>
      new Map(
        (plan?.flat ?? [])
          .filter((n) => n.tipo === 'receita')
          .map((n) => [n.id, Number(n.venda_total_calc ?? 0)])
      ),
    [plan]
  )
  // Aplica taxa vigente como deflator de receita pra calcular lucro líquido.
  const taxaPerc = Number(taxaVigente?.total_perc_calc ?? 0)
  const impostos = totalRaizVenda * taxaPerc
  const lucro = totalRaizVenda - totalRaizCusto - impostos
  const margemLiquida = totalRaizVenda > 0 ? lucro / totalRaizVenda : null

  const handleNewChild = (parent: ItemTreeNode | null): void => {
    setNewParent(parent?.id ?? null)
    setNewTipoInicial('receita')
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

  const handleRemoverAlocacao = async (node: ItemTreeNode): Promise<void> => {
    const ids = (plan?.alocacoes ?? []).filter((a) => a.receita_id === node.id).map((a) => a.id)
    if (ids.length === 0) return
    try {
      await removerAloc.mutateAsync({ obra_id: obraId, ids })
      toast.success(`Alocação de ${node.codigo} removida.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao remover alocação')
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

    const alocadas = new Set((plan?.alocacoes ?? []).map((a) => a.receita_id))
    const idsSel = new Set(itensSelecionados.map((n) => n.id))
    const bloqueadas = (plan?.flat ?? []).filter((n) => {
      if (n.tipo !== 'receita' || !alocadas.has(n.id)) return false
      let cur: ItemTreeNode | undefined = n
      const byId = new Map((plan?.flat ?? []).map((x) => [x.id, x]))
      while (cur) {
        if (idsSel.has(cur.id)) return true
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
      }
      return false
    })
    if (bloqueadas.length > 0) {
      toast.error(
        `${contar(bloqueadas.length, 'receita está alocada', 'receitas estão alocadas')} em serviços (${bloqueadas
          .slice(0, 4)
          .map((n) => n.codigo)
          .join(', ')}${bloqueadas.length > 4 ? '…' : ''}) — remova a alocação antes de excluir.`
      )
      return
    }

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
      title: `Excluir ${contar(itensSelecionados.length, 'item', 'itens')}?`,
      description: (
        <div className="space-y-2">
          <p>
            Seleção: <span className="text-text">{breakdown}</span>.
          </p>
          {preview.descendentesEmCascata > 0 ? (
            <p>
              <span className="text-warn">
                {contar(preview.descendentesEmCascata, 'descendente', 'descendentes')}
              </span>{' '}
              {preview.descendentesEmCascata === 1 ? 'será apagado' : 'serão apagados'} em cascata
              (índices com filhos arrastam tudo).
            </p>
          ) : null}
          {preview.tarefasQueFicarOrfas > 0 ? (
            <p>
              <span className="text-warn">
                {contar(preview.tarefasQueFicarOrfas, 'tarefa', 'tarefas')} de planejamento
              </span>{' '}
              {preview.tarefasQueFicarOrfas === 1
                ? 'ficará órfã (perde o vínculo'
                : 'ficarão órfãs (perdem o vínculo'}{' '}
              com o item, inclusive em linha de base). As tarefas <strong>não</strong> serão
              apagadas — só desvinculadas. Você pode re-vinculá-las ou apagá-las depois pelo módulo
              de Planejamento.
            </p>
          ) : null}
          <p className="text-text-dim">
            Total a apagar: <strong>{preview.totalParaApagar}</strong>{' '}
            {preview.totalParaApagar === 1 ? 'item' : 'itens'}.
          </p>
        </div>
      ),
      confirmLabel: 'Excluir',
      variant: 'danger'
    })
    if (!ok) return
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
      toast.success(`${contar(total, 'item excluído', 'itens excluídos')} em ${ms}ms.`)
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
        subtitle="Planilha de venda e serviços"
        actions={
          podeRole ? (
            <div className="flex items-center gap-2">
              {podePlanilha && itensSelecionados.length > 0 ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                    title="Limpar seleção"
                  >
                    <X size={12} />{' '}
                    {contar(itensSelecionados.length, 'selecionado', 'selecionados')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger/10"
                    onClick={() => void handleBulkDelete()}
                    disabled={bulkDeleting}
                  >
                    <Trash2 size={12} /> {bulkDeleting ? 'Excluindo…' : 'Excluir'}
                  </Button>
                </>
              ) : null}
              {todasSelecionadasSaoReceitas &&
              receitasSelecionadas.length > 0 &&
              receitasSelecionadas.every(podeAlocar) ? (
                <AgruparEmMenu
                  obraId={obraId}
                  servicos={plan?.servicos ?? []}
                  receitaIds={receitasSelecionadas.map((n) => n.id)}
                  onDone={() => setSelectedIds(new Set())}
                />
              ) : null}
              <div className="flex items-center rounded border border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none"
                  onClick={() => navigate({ to: '/orcamento/obra/aditivos' })}
                  title="Aditivos de contrato (acréscimo, supressão, exclusão, itens novos)"
                >
                  <FilePlus2 size={12} /> Aditivos
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-none border-l border-border"
                  onClick={() => navigate({ to: '/orcamento/obra/reajustes' })}
                  title="Reajustes anuais por grupos de índices"
                >
                  <Percent size={12} /> Reajustes
                </Button>
                {temAditivo ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-none border-l border-border"
                    onClick={() => navigate({ to: '/orcamento/obra/planilha-inicial' })}
                    title="Planilha do contrato original, arquivada no 1º aditivo"
                  >
                    <Archive size={12} /> Planilha Inicial
                  </Button>
                ) : null}
              </div>
              {podePlanilha ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                    <FileUp size={12} /> Importar modelo
                  </Button>
                  <Button variant="default" size="sm" onClick={() => handleNewChild(null)}>
                    <Plus size={12} /> Novo item raiz
                  </Button>
                </>
              ) : null}
            </div>
          ) : null
        }
      />
      <CadeiaTravaBanner obraId={obraId} />
      {temAditivo && !cadeiaTrava ? (
        <div className="mx-5 mt-3 flex items-start gap-2 rounded border border-accent-line bg-accent-glow px-3 py-2 text-xs text-accent">
          <FilePlus2 size={13} className="mt-px shrink-0" />
          <span className="flex-1">
            Planilha com aditivo: a planilha de venda só muda pela tela de Aditivos (a Planilha
            Inicial fica arquivada). Agrupamentos e serviços continuam editáveis.
          </span>
        </div>
      ) : null}
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      {/* Progresso do agrupamento: 100% = venda total; preenchido = já agrupado */}
      <div
        className="mx-3 mb-1 flex items-center gap-2"
        title={`Agrupado ${fmtBRL(agrupado)} de ${fmtBRL(totalRaizVenda)}`}
      >
        <div className="flex-1 h-1 rounded-full bg-bg-elevated overflow-hidden">
          <div
            className={pctAgrupado >= 0.9999 ? 'h-full bg-success' : 'h-full bg-accent'}
            style={{ width: `${Math.min(100, pctAgrupado * 100)}%` }}
          />
        </div>
        <span className="text-2xs font-mono tabular-nums text-text-dim">
          {fmtBRL(agrupado)} · {fmtPct2(pctAgrupado)}
        </span>
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          <PlanOrcTree
            obraId={obraId}
            flat={plan?.flat ?? []}
            podeEditar={podePlanilha}
            podeAlocar={podeAlocar}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onToggleSelect={handleToggleSelect}
            onSelect={handleAbrirItem}
            onNewChild={handleNewChild}
            onMover={(node) => setMoverItem(node)}
            expandedIds={expandedIds}
            setExpandedIds={setExpandedIds}
            alocInfo={plan?.alocInfo ?? new Map()}
            filtroAloc={filtroAloc}
            setFiltroAloc={setFiltroAloc}
            destaque={destaque}
            onRatear={(node) => setRatearNode(node)}
            onRemoverAlocacao={(node) => void handleRemoverAlocacao(node)}
          />
        </div>
        {painelServicos ? (
          <ServicosPanel
            obraId={obraId}
            servicos={plan?.servicos ?? []}
            alocacoes={plan?.alocacoes ?? []}
            podeEditar={podeServicos}
            destacadoId={destacadoId}
            onDestacar={setDestacadoId}
            onAbrir={handleAbrirItem}
            onRecolher={() => {
              setPainelServicos(false)
              setDestacadoId(null)
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPainelServicos(true)}
            title="Mostrar serviços"
            className="w-7 shrink-0 border-l border-border bg-bg-panel flex flex-col items-center gap-2 pt-2 text-text-dim hover:text-text"
          >
            <ChevronsLeft size={12} />
            <span className="text-2xs font-mono uppercase tracking-wider [writing-mode:vertical-rl]">
              Serviços ({plan?.servicos.length ?? 0})
            </span>
          </button>
        )}
      </div>
      {/* Footer com totais — lucro inclui impostos da taxa vigente como deflator */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-bg-panel text-2xs font-mono">
        <div className="text-text-dim">
          {contar(plan?.flat.length ?? 0, 'item', 'itens')}
          {isLoading ? ' · carregando…' : ''}
          {selectedIds.size > 0
            ? ` · ${contar(selectedIds.size, 'selecionado', 'selecionados')}`
            : ''}
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
        podeEditar={plan?.servicos.some((s) => s.id === selectedId) ? podeServicos : podePlanilha}
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
      <RatearDialog
        open={ratearNode !== null}
        onOpenChange={(o) => {
          if (!o) setRatearNode(null)
        }}
        obraId={obraId}
        receita={ratearNode}
        servicos={plan?.servicos ?? []}
        alocacoes={plan?.alocacoes ?? []}
        vendaPorReceita={vendaPorReceita}
      />
      <ImportOrcamentoDialog open={importOpen} onOpenChange={setImportOpen} obraId={obraId} />
      <MoveItemDialog
        open={moverItem !== null}
        onOpenChange={(o) => {
          if (!o) setMoverItem(null)
        }}
        obraId={obraId}
        item={moverItem}
      />
    </div>
  )
}
