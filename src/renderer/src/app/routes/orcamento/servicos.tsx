import { useMemo, useState, type ReactNode, useEffect } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  X,
  FoldVertical,
  UnfoldVertical,
  FolderTree,
  Upload,
  Trash2
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { RequireObra } from '@/components/layout/RequireObra'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { buildServicoTree, useServicos } from '@/features/orcamento/hooks/servicos'
import { previewCascadeServicos } from '@/features/orcamento/hooks/cascade'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { ServicosTree } from '@/features/orcamento/components/ServicosTree'
import { NewServicoDialog } from '@/features/orcamento/modals/NewServicoDialog'
import { ServicoCpuLinksDialog } from '@/features/orcamento/modals/ServicoCpuLinksDialog'
import { PromoverCpusOrfasDialog } from '@/features/orcamento/modals/PromoverCpusOrfasDialog'
import { useCpusOrfas } from '@/features/orcamento/hooks/servico-links'
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
  const { data: servicos = [], isLoading, error } = useServicos(obraId)
  const [openNew, setOpenNew] = useState(false)
  const [parentInicial, setParentInicial] = useState<string | null>(null)

  const [searchRaw, setSearchRaw] = useState('')
  const [search, setSearch] = useState('')
  // Debounce 200ms — evita re-render por keystroke em árvores grandes.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchRaw), 200)
    return () => clearTimeout(id)
  }, [searchRaw])

  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'
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
  const [promoverOpen, setPromoverOpen] = useState(false)
  const { data: cpusOrfas = [] } = useCpusOrfas(obraId)

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
      toast.error(err instanceof Error ? err.message : 'Falha ao avaliar dependências')
      return
    }

    if (preview.bloqueado) {
      await confirm({
        title: 'Exclusão bloqueada',
        description: (
          <div className="space-y-2 text-xs">
            <p>Os serviços selecionados estão em uso:</p>
            <ul className="ml-4 list-disc text-text-muted">
              {preview.itensOrcamentoBloqueando > 0 ? (
                <li>
                  <span className="text-warn">
                    {preview.itensOrcamentoBloqueando} item(ns) orçamentário(s)
                  </span>{' '}
                  apontam pra esses serviços — remova-os do orçamento primeiro.
                </li>
              ) : null}
            </ul>
          </div>
        ),
        confirmLabel: 'OK',
        cancelLabel: 'Fechar',
        variant: 'warn'
      })
      return
    }

    const ok = await confirm({
      title: `Excluir ${selectedIds.size} serviço(s)?`,
      description: (
        <div className="space-y-2 text-xs">
          {preview.descendentesEmCascata > 0 ? (
            <p>
              <span className="text-warn">{preview.descendentesEmCascata} sub-serviço(s)</span>{' '}
              serão apagados em cascata.
            </p>
          ) : null}
          {preview.vinculosCpuLink > 0 ? (
            <p>
              <span className="text-text-dim">{preview.vinculosCpuLink} vínculo(s) com CPU</span>{' '}
              dentro desses serviços serão removidos (CASCADE).
            </p>
          ) : null}
          {preview.cpusOrfanizadas > 0 ? (
            <p>
              <span className="text-text-dim">{preview.cpusOrfanizadas} CPU(s)</span> ficarão sem
              servico-dono (órfãs). Você pode promovê-las depois com o botão &quot;Promover CPUs
              órfãs&quot; ou apagá-las manualmente em Composições.
            </p>
          ) : null}
          <p className="text-text-dim">
            Total a apagar: <strong>{preview.totalParaApagar}</strong> serviço(s).
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
    const idsParaApagar = preview.idsOrdenadosParaDelete
    setSelectedIds(new Set())
    setBulkDeleting(true)
    const t0 = performance.now()

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
            `Falha no nível ${nv}: ${err.message}. Apagados antes: ${total}/${idsParaApagar.length}.`
          )
          return
        }
        total += ids.length
      }
      const ms = Math.round(performance.now() - t0)
      toast.success(`${total} serviço(s) excluído(s) em ${ms}ms.`)
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
        subtitle="Catálogo hierárquico. Cada serviço-folha pode agregar N composições (CPUs) com fator de conversão."
        actions={
          podeEditar ? (
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                    title="Limpar seleção"
                  >
                    <X size={11} /> {selectedIds.size} selecionado(s)
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
              {cpusOrfas.length > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPromoverOpen(true)}
                  title="Cria 1 serviço por CPU sem dono"
                >
                  <Upload size={11} /> Promover {cpusOrfas.length} CPU(s) órfã(s)
                </Button>
              ) : null}
              <Button variant="default" size="sm" onClick={() => abrirNovo(null)}>
                <Plus size={11} /> Novo serviço (raiz)
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

      {/* Toolbar funcional: busca + contadores + expand/collapse all */}
      {!isLoading && tree.length > 0 ? (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-panel">
          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
            />
            <input
              type="text"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder="Buscar por código ou nome…"
              className="w-full pl-7 pr-7 h-7 bg-bg border border-border rounded text-xs text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
            />
            {searchRaw ? (
              <button
                type="button"
                onClick={() => setSearchRaw('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-dim hover:text-text"
                title="Limpar"
              >
                <X size={11} />
              </button>
            ) : null}
          </div>

          {/* Counters */}
          <div className="flex items-center gap-2 text-2xs font-mono text-text-dim">
            <span>
              <strong className="text-text">{counters.total}</strong>{' '}
              {counters.total === 1 ? 'serviço' : 'serviços'}
            </span>
            <span className="text-text-faint">·</span>
            <span>
              <strong className="text-success">{counters.ativos}</strong> ativos
            </span>
            {counters.inativos > 0 ? (
              <>
                <span className="text-text-faint">·</span>
                <span>
                  <strong className="text-warn">{counters.inativos}</strong> inativos
                </span>
              </>
            ) : null}
          </div>

          <div className="flex-1" />

          {/* Expand / Collapse all */}
          <button
            type="button"
            onClick={expandAll}
            className="h-7 px-2 inline-flex items-center gap-1.5 text-2xs font-mono text-text-muted hover:text-text border border-border hover:border-border-strong rounded"
            title="Expandir tudo"
          >
            <UnfoldVertical size={12} /> Expandir tudo
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="h-7 px-2 inline-flex items-center gap-1.5 text-2xs font-mono text-text-muted hover:text-text border border-border hover:border-border-strong rounded"
            title="Colapsar tudo"
          >
            <FoldVertical size={12} /> Colapsar tudo
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="text-xs text-text-muted font-mono">Carregando…</div>
        ) : tree.length === 0 ? (
          <ServicosEmptyState
            podeEditar={!!podeEditar}
            onCriarRaiz={() => abrirNovo(null)}
            onImportar={() => navigate({ to: '/orcamento/obra/plan-orc' })}
          />
        ) : (
          <div className="rounded border border-border bg-bg-panel p-3">
            <ServicosTree
              nodes={tree}
              onAddChild={abrirNovo}
              filter={search}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              selectedIds={podeEditar ? selectedIds : null}
              onToggleSelect={podeEditar ? onToggleSelect : undefined}
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
      <PromoverCpusOrfasDialog open={promoverOpen} onOpenChange={setPromoverOpen} obraId={obraId} />
    </div>
  )
}

interface EmptyStateProps {
  podeEditar: boolean
  onCriarRaiz: () => void
  onImportar: () => void
}
function ServicosEmptyState({ podeEditar, onCriarRaiz, onImportar }: EmptyStateProps): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center text-center max-w-md mx-auto py-12">
      <div className="w-16 h-16 rounded-full bg-bg-elevated border border-border flex items-center justify-center mb-4">
        <FolderTree size={28} className="text-text-dim" />
      </div>
      <h2 className="text-base font-semibold text-text mb-1">Sem serviços cadastrados</h2>
      <p className="text-xs text-text-muted leading-relaxed mb-5">
        O catálogo de serviços é a base do orçamento. Comece criando os{' '}
        <span className="text-text">índices raiz</span> (1, 2, 3…) e depois adicione{' '}
        <span className="text-text">folhas</span> com unidade (m³, t, km, etc). Alternativamente,
        importe direto da planilha orçamentária.
      </p>
      {podeEditar ? (
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={onCriarRaiz}>
            <Plus size={11} /> Criar serviço-raiz
          </Button>
          <Button variant="outline" size="sm" onClick={onImportar}>
            <Upload size={11} /> Importar planilha
          </Button>
        </div>
      ) : (
        <p className="text-2xs text-text-faint italic">
          Você não tem permissão pra criar serviços. Solicite ao engenheiro/admin.
        </p>
      )}
    </div>
  )
}
