import { useMemo, useState, type ReactNode, useEffect } from 'react'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useCadeiaTrava } from '@/features/planejamento/hooks/planejamentos'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Search, X, FoldVertical, UnfoldVertical, Upload, Trash2 } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Carregando, ErroConsulta } from '@/components/ui/estado'
import { RequireObra } from '@/components/layout/RequireObra'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { buildServicoTree, useServicos } from '@/features/orcamento/hooks/servicos'
import { previewCascadeServicos } from '@/features/orcamento/hooks/cascade'
import { supabase } from '@/lib/supabase/client'
import { contar } from '@/lib/rotulos'
import { ServicosTree } from '@/features/orcamento/components/ServicosTree'
import { NewServicoDialog } from '@/features/orcamento/modals/NewServicoDialog'
import { ServicoCpuLinksDialog } from '@/features/orcamento/modals/ServicoCpuLinksDialog'
import type { Servico, ServicoTreeNode } from '@/types/orcamento'

export function ServicosPage(): ReactNode {
  return (
    <RequireObra pageTitle="Serviços">
      <ServicosInner />
    </RequireObra>
  )
}

function ServicosInner(): ReactNode {
  const scope = useCurrentScope()
  const role = useAuthStore((s) => s.profile?.role)
  const navigate = useNavigate()
  const obraId = scope.obraId!
  const { data: servicos = [], isLoading, error, refetch } = useServicos(obraId)
  const [openNew, setOpenNew] = useState(false)
  const [parentInicial, setParentInicial] = useState<string | null>(null)

  const [searchRaw, setSearchRaw] = useState('')
  const [search, setSearch] = useState('')
  // Debounce 200ms — evita re-render por keystroke em árvores grandes.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchRaw), 200)
    return () => clearTimeout(id)
  }, [searchRaw])

  const { data: cadeiaTrava } = useCadeiaTrava(obraId)
  const podeEditar = (role === 'god' || role === 'adm' || role === 'engenheiro') && !cadeiaTrava
  const tree = useMemo(() => buildServicoTree(servicos), [servicos])

  // Seleção em lote pra excluir.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const onToggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Painel de vínculo de CPUs (servico-agregador). Abre ao clicar numa folha.
  const [linksOpenFor, setLinksOpenFor] = useState<Servico | null>(null)

  const confirm = useConfirm()
  const qc = useQueryClient()
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const handleBulkDelete = async (): Promise<void> => {
    if (selectedIds.size === 0) return
    let preview
    try {
      preview = await previewCascadeServicos(
        Array.from(selectedIds),
        servicos.map((s) => ({ id: s.id, parent_id: s.parent_id, nivel: s.nivel }))
      )
    } catch (err) {
      toast.error(
        `Não foi possível conferir onde os serviços são usados. ${err instanceof Error ? err.message : ''}`.trim()
      )
      return
    }

    if (preview.bloqueado) {
      await confirm({
        title: 'Não é possível excluir',
        description: (
          <div className="space-y-2">
            <p>Os serviços selecionados estão em uso no orçamento.</p>
            {preview.itensOrcamentoBloqueando > 0 ? (
              <p>
                <strong className="font-semibold text-text">
                  {contar(
                    preview.itensOrcamentoBloqueando,
                    'item da planilha orçamentária usa',
                    'itens da planilha orçamentária usam'
                  )}
                </strong>{' '}
                esses serviços. Remova{' '}
                {preview.itensOrcamentoBloqueando === 1 ? 'esse item' : 'esses itens'} da planilha e
                tente de novo.
              </p>
            ) : null}
          </div>
        ),
        confirmLabel: 'Entendi',
        cancelLabel: 'Fechar',
        variant: 'warn'
      })
      return
    }

    const ok = await confirm({
      title: `Excluir ${contar(selectedIds.size, 'serviço', 'serviços')}?`,
      description: (
        <div className="space-y-2">
          {preview.descendentesEmCascata > 0 ? (
            <p>
              <strong className="font-semibold text-text">
                {contar(
                  preview.descendentesEmCascata,
                  'serviço de dentro dos grupos',
                  'serviços de dentro dos grupos'
                )}
              </strong>{' '}
              também {preview.descendentesEmCascata === 1 ? 'será excluído' : 'serão excluídos'}.
            </p>
          ) : null}
          {preview.vinculosCpuLink > 0 ? (
            <p>
              {contar(
                preview.vinculosCpuLink,
                'vínculo com composição será removido',
                'vínculos com composições serão removidos'
              )}
              .
            </p>
          ) : null}
          {preview.cpusOrfanizadas > 0 ? (
            <p>
              {contar(
                preview.cpusOrfanizadas,
                'composição ficará sem serviço',
                'composições ficarão sem serviço'
              )}
              . Elas continuam em Composições, de onde podem ser excluídas.
            </p>
          ) : null}
          <p>
            Ao todo,{' '}
            <strong className="font-semibold text-text">
              {contar(preview.totalParaApagar, 'serviço será excluído', 'serviços serão excluídos')}
            </strong>
            . Não dá para desfazer.
          </p>
        </div>
      ),
      confirmLabel: preview.totalParaApagar === 1 ? 'Excluir serviço' : 'Excluir serviços',
      variant: 'danger'
    })
    if (!ok) return
    // Limpa seleção imediatamente — UX responsiva.
    const idsParaApagar = preview.idsOrdenadosParaDelete
    setSelectedIds(new Set())
    setBulkDeleting(true)

    try {
      // Agrupa por nível pra apagar folhas-primeiro (FK servico.parent_id é RESTRICT).
      // 1 query por nível em vez de N queries por servico.
      const nivelById = new Map<string, number>()
      for (const s of servicos) nivelById.set(s.id, s.nivel ?? 0)
      const porNivel = new Map<number, string[]>()
      for (const id of idsParaApagar) {
        const nv = nivelById.get(id) ?? 0
        const arr = porNivel.get(nv) ?? []
        arr.push(id)
        porNivel.set(nv, arr)
      }
      const niveisDesc = [...porNivel.keys()].sort((a, b) => b - a)
      let total = 0
      for (const nv of niveisDesc) {
        const ids = porNivel.get(nv)!
        const { error: err } = await supabase.from('servico').delete().in('id', ids)
        if (err) {
          console.error('[servico bulk delete] nivel', nv, err)
          toast.error(
            `Não foi possível excluir todos os serviços (${total} de ${idsParaApagar.length} excluídos). ${err.message}`
          )
          return
        }
        total += ids.length
      }
      toast.success(`${contar(total, 'serviço excluído', 'serviços excluídos')}.`)
    } finally {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servicos'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servico-custo-agregado'] })
      setBulkDeleting(false)
    }
  }

  // Counters
  const counters = useMemo(() => {
    let total = 0
    let ativos = 0
    for (const s of servicos) {
      total++
      if (s.ativo) ativos++
    }
    return { total, ativos, inativos: total - ativos }
  }, [servicos])

  // Expansão controlada com default derivado: `null` = ainda não foi mexido,
  // usa default (primeiros 2 níveis abertos). Qualquer interação (toggle / expand-all /
  // collapse-all) materializa o estado. Evita `setState` em effect (regra
  // react-hooks/set-state-in-effect do react-compiler).
  const defaultExpanded = useMemo(() => {
    const next = new Set<string>()
    const walk = (n: ServicoTreeNode, depth: number): void => {
      if (depth < 2) next.add(n.id)
      for (const c of n.children) walk(c, depth + 1)
    }
    for (const r of tree) walk(r, 0)
    return next
  }, [tree])
  const [expandedOverride, setExpandedOverride] = useState<Set<string> | null>(null)
  const expandedIds = expandedOverride ?? defaultExpanded

  const allIds = useMemo(() => {
    const ids = new Set<string>()
    const walk = (n: ServicoTreeNode): void => {
      ids.add(n.id)
      for (const c of n.children) walk(c)
    }
    for (const r of tree) walk(r)
    return ids
  }, [tree])

  const expandAll = (): void => setExpandedOverride(new Set(allIds))
  const collapseAll = (): void => setExpandedOverride(new Set())
  const onToggleExpand = (id: string): void => {
    setExpandedOverride((prev) => {
      const base = prev ?? defaultExpanded
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const abrirNovo = (parentId: string | null): void => {
    setParentInicial(parentId)
    setOpenNew(true)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Serviços"
        subtitle="Lista em árvore: cada serviço pode reunir várias composições"
        actions={
          podeEditar ? (
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                    <X size={12} aria-hidden /> Limpar seleção
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void handleBulkDelete()}
                    disabled={bulkDeleting}
                  >
                    <Trash2 size={12} aria-hidden />{' '}
                    {bulkDeleting
                      ? 'Excluindo…'
                      : `Excluir ${contar(selectedIds.size, 'selecionado', 'selecionados')}`}
                  </Button>
                </>
              ) : null}
              <Button
                variant="default"
                size="sm"
                onClick={() => abrirNovo(null)}
                title="Cria um serviço ou grupo no primeiro nível da árvore"
              >
                <Plus size={12} aria-hidden /> Novo serviço
              </Button>
            </div>
          ) : null
        }
      />
      <CadeiaTravaBanner obraId={obraId} />
      {error ? (
        <div className="px-5 pt-3">
          <ErroConsulta erro={error} oQue="os serviços" aoTentar={() => void refetch()} compacto />
        </div>
      ) : null}

      {!isLoading && tree.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2 border-b border-border bg-bg-panel">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search
              size={14}
              aria-hidden
              className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
            />
            <Input
              type="search"
              aria-label="Buscar serviço por código ou nome"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder="Buscar por código ou nome…"
              className="pl-7 pr-8 [&::-webkit-search-cancel-button]:hidden"
            />
            {searchRaw ? (
              <button
                type="button"
                onClick={() => setSearchRaw('')}
                className="absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-text-muted hover:text-text hover:bg-bg-hover"
                aria-label="Limpar a busca"
                title="Limpar a busca"
              >
                <X size={12} aria-hidden />
              </button>
            ) : null}
          </div>

          <p className="text-sm text-text-muted tabular">
            <strong className="font-semibold text-text">
              {contar(counters.total, 'serviço', 'serviços')}
            </strong>
            {counters.inativos > 0
              ? `, ${contar(counters.ativos, 'ativo', 'ativos')} e ${contar(counters.inativos, 'inativo', 'inativos')}`
              : counters.total === 1
                ? ', ativo'
                : ', todos ativos'}
          </p>

          <div className="flex-1" />

          <Button variant="secondary" size="sm" onClick={expandAll}>
            <UnfoldVertical size={12} aria-hidden /> Expandir tudo
          </Button>
          <Button variant="secondary" size="sm" onClick={collapseAll}>
            <FoldVertical size={12} aria-hidden /> Recolher tudo
          </Button>
        </div>
      ) : null}

      <div className="flex-1 overflow-auto p-5">
        {isLoading ? (
          <Carregando />
        ) : tree.length === 0 ? (
          error ? null : (
            <EmptyState
              icon="list-tree"
              title="Nenhum serviço cadastrado"
              description={
                podeEditar
                  ? 'Os serviços são a base do orçamento. Crie os grupos (1, 2, 3…) e, dentro deles, os serviços com unidade (m³, t, km). Se preferir, importe pela planilha orçamentária.'
                  : 'Esta obra ainda não tem serviços. O cadastro é feito por engenheiro ou administrador.'
              }
              action={
                podeEditar ? (
                  <div className="flex items-center gap-2">
                    <Button variant="default" size="sm" onClick={() => abrirNovo(null)}>
                      <Plus size={12} aria-hidden /> Criar o primeiro serviço
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate({ to: '/orcamento/obra/plan-orc' })}
                    >
                      <Upload size={12} aria-hidden /> Importar pela planilha
                    </Button>
                  </div>
                ) : null
              }
            />
          )
        ) : (
          <div className="rounded border border-border bg-bg-panel p-2">
            <ServicosTree
              nodes={tree}
              onAddChild={abrirNovo}
              filter={search}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              selectedIds={podeEditar ? selectedIds : null}
              onToggleSelect={podeEditar ? onToggleSelect : undefined}
              somenteLeitura={!podeEditar}
              onSelect={(id) => {
                const s = servicos.find((x) => x.id === id)
                if (s && s.unidade !== null) setLinksOpenFor(s)
              }}
            />
          </div>
        )}
      </div>

      <NewServicoDialog
        open={openNew}
        onOpenChange={(o) => {
          setOpenNew(o)
          if (!o) setParentInicial(null)
        }}
        obraId={obraId}
        parentIdInicial={parentInicial}
      />
      <ServicoCpuLinksDialog
        open={linksOpenFor !== null}
        onOpenChange={(o) => {
          if (!o) setLinksOpenFor(null)
        }}
        servico={linksOpenFor}
        obraId={obraId}
      />
    </div>
  )
}
