import { useMemo, useState, type ReactNode } from 'react'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useCadeiaTrava } from '@/features/planejamento/hooks/planejamentos'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, FileUp, FilePlus2, ChevronsLeft } from 'lucide-react'
import { ImportOrcamentoDialog } from '@/features/orcamento/modals/ImportOrcamentoDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { ErroConsulta } from '@/components/ui/estado'
import { cn } from '@/lib/utils'
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
    <RequireObra pageTitle="Planilha orçamentária">
      <PlanilhaOrcamentaria />
    </RequireObra>
  )
}

function PlanilhaOrcamentaria(): ReactNode {
  const scope = useCurrentScope()
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!

  const { data: plan, isLoading, error, refetch } = usePlanOrc(obraId)
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
  // em tela estreita o painel começa recolhido, para a planilha ter onde aparecer
  const [painelServicos, setPainelServicos] = useState(
    () => window.matchMedia('(min-width: 1024px)').matches
  )
  const [ratearNode, setRatearNode] = useState<ItemTreeNode | null>(null)
  const removerAloc = useRemoverAlocacoes()
  const [importOpen, setImportOpen] = useState(false)
  const [moverItem, setMoverItem] = useState<ItemTreeNode | null>(null)
  /** IDs de receitas selecionadas (para agrupar). */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // A planilha vem toda expandida; guarda-se o que foi recolhido, para o índice novo já nascer aberto.
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set())
  const expandedIds = useMemo(
    () =>
      new Set(
        (plan?.flat ?? [])
          .filter((n) => n.tipo === 'etapa' && !recolhidos.has(n.id))
          .map((n) => n.id)
      ),
    [plan, recolhidos]
  )
  const setExpandedIds = (abertos: Set<string>): void =>
    setRecolhidos(
      new Set(
        (plan?.flat ?? []).filter((n) => n.tipo === 'etapa' && !abertos.has(n.id)).map((n) => n.id)
      )
    )

  const { data: cadeiaTrava, isLoading: travaCarregando } = useCadeiaTrava(obraId)
  const podeRole = role === 'god' || role === 'adm' || role === 'engenheiro'
  const { data: aditivos = [] } = useAditivos(obraId)
  const temAditivo = aditivos.some((a) => a.status === 'aplicado')
  // cadeia editável (sem vigente e com plano em edição, ou antes de qualquer LB)
  const podeEditar = podeRole && !travaCarregando && !cadeiaTrava
  // planilha de venda (receitas/etapas): só antes do 1º aditivo
  const podePlanilha = podeEditar && !temAditivo
  // agrupar/ratear: com a cadeia travada, só receitas nascidas de aditivo (saldo)
  const podeAlocar = (n: { tipo: string; aditivo_id?: string | null }): boolean =>
    podeRole && n.tipo === 'receita' && (podeEditar || !!n.aditivo_id)
  const temReceitaAditivo = (plan?.flat ?? []).some((n) => !!n.aditivo_id)
  const podeServicos = podeRole && (podeEditar || temReceitaAditivo)

  const motivoSomenteLeitura = !podeRole
    ? 'Seu perfil não permite editar a planilha orçamentária.'
    : cadeiaTrava
      ? `Somente leitura: ${cadeiaTrava.replace(/\s+[—–]\s+/g, ', ').replace(/\.$/, '')}.`
      : temAditivo
        ? 'A planilha de venda só muda pela tela de Aditivos.'
        : undefined

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
      const detalhe = (err as { message?: string } | null)?.message
      toast.error(
        `Não foi possível remover a alocação de ${node.codigo}. ${detalhe ?? 'Tente de novo.'}`
      )
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
    const nIndices = itensSelecionados.filter((n) => n.tipo === 'etapa').length
    const nReceitas = itensSelecionados.filter((n) => n.tipo === 'receita').length
    const breakdown = [
      nIndices > 0 ? contar(nIndices, 'índice', 'índices') : null,
      nReceitas > 0 ? contar(nReceitas, 'receita', 'receitas') : null
    ]
      .filter(Boolean)
      .join(' e ')

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
          .join(', ')}${bloqueadas.length > 4 ? '…' : ''}). Remova a alocação antes de excluir.`
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
      const detalhe = (err as { message?: string } | null)?.message
      toast.error(
        `Não foi possível conferir o que depende dos itens. ${detalhe ?? 'Tente de novo.'}`
      )
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
              {preview.descendentesEmCascata === 1 ? 'será apagado' : 'serão apagados'} junto: o que
              está dentro de um índice vai com ele.
            </p>
          ) : null}
          {preview.tarefasQueFicarOrfas > 0 ? (
            <p>
              <span className="text-warn">
                {contar(preview.tarefasQueFicarOrfas, 'tarefa', 'tarefas')} de planejamento
              </span>{' '}
              {preview.tarefasQueFicarOrfas === 1
                ? 'perde o vínculo com o item'
                : 'perdem o vínculo com o item'}
              , inclusive em linha de base. As tarefas <strong>não</strong> são apagadas: ficam sem
              item, e você pode vinculá-las de novo ou apagá-las depois no Planejamento.
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
            `Não foi possível excluir todos os itens (${total} de ${preview.idsOrdenadosParaDelete.length} excluídos). ${err.message}`
          )
          return
        }
        total += ids.length
      }
      toast.success(`${contar(total, 'item excluído', 'itens excluídos')}.`)
    } finally {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc', obraId] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade', obraId] })
      setBulkDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Planilha orçamentária"
        subtitle="Planilha de venda e os serviços em que ela é agrupada"
        actions={
          podePlanilha ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                <FileUp size={12} /> Importar planilha
              </Button>
              <Button variant="default" size="sm" onClick={() => handleNewChild(null)}>
                <Plus size={12} /> Novo item
              </Button>
            </>
          ) : null
        }
      />
      <CadeiaTravaBanner obraId={obraId} />
      {temAditivo && !cadeiaTrava ? (
        <div
          role="status"
          className="mx-5 mt-3 flex items-start gap-2 rounded border border-accent-line bg-accent-glow px-3 py-2 text-sm text-text"
        >
          <FilePlus2 size={14} className="mt-0.5 shrink-0 text-accent" />
          <span className="flex-1">
            Esta planilha tem aditivo: a planilha de venda só muda pela tela de Aditivos (a planilha
            inicial fica arquivada). Agrupamentos e serviços continuam editáveis.
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => void navigate({ to: '/orcamento/obra/aditivos' })}
          >
            Abrir os aditivos
          </Button>
        </div>
      ) : null}
      {error ? (
        <ErroConsulta
          erro={error}
          oQue="a planilha orçamentária"
          aoTentar={() => void refetch()}
          className="mx-5 mt-3"
        />
      ) : null}

      {/* Uma faixa só: com seleção, as ações da seleção; sem seleção, quanto da venda já está agrupado em serviços. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-10 px-5 py-1.5 border-b border-border bg-bg-panel text-sm">
        {podeRole && itensSelecionados.length > 0 ? (
          <>
            <span className="font-semibold text-text">
              {contar(itensSelecionados.length, 'item selecionado', 'itens selecionados')}
            </span>
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
            {podePlanilha ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => void handleBulkDelete()}
                disabled={bulkDeleting}
              >
                <Trash2 size={12} /> {bulkDeleting ? 'Excluindo…' : 'Excluir'}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              <X size={12} /> Limpar seleção
            </Button>
          </>
        ) : (
          <>
            <span className="text-text-muted">Agrupado em serviços</span>
            <div
              role="img"
              aria-label={`${fmtPct2(pctAgrupado)} da venda agrupada em serviços`}
              className="h-2 w-48 max-w-[40vw] bg-bg-elevated border border-border"
            >
              <div
                className={pctAgrupado >= 0.9999 ? 'h-full bg-success' : 'h-full bg-accent'}
                style={{ width: `${Math.min(100, pctAgrupado * 100)}%` }}
              />
            </div>
            <span className="tabular text-text">
              <strong className="font-semibold">{fmtPct2(pctAgrupado)}</strong>
              <span className="text-text-muted">
                {' '}
                · {fmtBRL(agrupado)} de {fmtBRL(totalRaizVenda)}
              </span>
            </span>
          </>
        )}
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          <PlanOrcTree
            obraId={obraId}
            flat={plan?.flat ?? []}
            estado={isLoading ? 'carregando' : error && !plan ? 'erro' : 'pronto'}
            podeEditar={podePlanilha}
            motivoSomenteLeitura={motivoSomenteLeitura}
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
            carregando={isLoading}
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
            title="Mostrar os serviços"
            aria-label="Mostrar os serviços"
            className="w-8 shrink-0 border-l border-border bg-bg-panel flex flex-col items-center gap-2 pt-2 text-text-muted hover:text-text hover:bg-bg-hover"
          >
            <ChevronsLeft size={14} />
            <span className="text-2xs font-semibold uppercase tracking-[0.08em] [writing-mode:vertical-rl]">
              Serviços ({plan?.servicos.length ?? 0})
            </span>
          </button>
        )}
      </div>
      {/* Totais: o lucro desconta os impostos da taxa vigente */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-2 border-t border-border bg-bg-panel text-xs text-text-muted">
        <div>
          {isLoading ? 'Carregando…' : contar(plan?.flat.length ?? 0, 'item', 'itens')}
          {' · '}
          {taxaVigente ? (
            <span>
              Taxa {taxaVigente.nome}: {fmtPct2(taxaPerc)}
            </span>
          ) : (
            <span className="text-warn font-medium">
              sem taxa vigente: o lucro está sem os impostos
            </span>
          )}
        </div>
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 tabular">
          <div className="flex gap-1.5">
            <dt>Venda</dt>
            <dd className="font-semibold text-text">{fmtBRL(totalRaizVenda)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Custo</dt>
            <dd className="font-semibold text-text">{fmtBRL(totalRaizCusto)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Impostos</dt>
            <dd className="font-semibold text-text">{fmtBRL(impostos)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Lucro</dt>
            <dd className={cn('font-semibold', lucro >= 0 ? 'text-success' : 'text-danger')}>
              {fmtBRL(lucro)}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt>Margem líquida</dt>
            <dd>
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
            </dd>
          </div>
        </dl>
      </div>

      {/* Dialogs */}
      <ItemDetailPanel
        open={detailOpen}
        onOpenChange={setDetailOpen}
        itemId={selectedId}
        obraId={obraId}
        podeEditar={plan?.servicos.some((s) => s.id === selectedId) ? podeServicos : podePlanilha}
        motivoSomenteLeitura={motivoSomenteLeitura}
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
