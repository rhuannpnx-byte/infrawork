import { useMemo, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { buildServicoTree, useServicos } from '@/features/orcamento/hooks/servicos'
import { ServicosTree } from '@/features/orcamento/components/ServicosTree'
import { NewServicoDialog } from '@/features/orcamento/modals/NewServicoDialog'

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
  const obraId = scope.obraId!
  const { data: servicos = [], isLoading, error } = useServicos(obraId)
  const [openNew, setOpenNew] = useState(false)
  const [parentInicial, setParentInicial] = useState<string | null>(null)

  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'
  const tree = useMemo(() => buildServicoTree(servicos), [servicos])

  const abrirNovo = (parentId: string | null): void => {
    setParentInicial(parentId)
    setOpenNew(true)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Serviços"
        subtitle="Catálogo hierárquico de serviços da obra. Códigos no estilo 01.02.03; folhas têm unidade."
        actions={
          podeEditar ? (
            <Button variant="default" size="sm" onClick={() => abrirNovo(null)}>
              <Plus size={11} /> Novo serviço (raiz)
            </Button>
          ) : null
        }
      />
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="text-xs text-text-muted font-mono">Carregando…</div>
        ) : tree.length === 0 ? (
          <EmptyState
            icon="list-tree"
            title="Nenhum serviço"
            description="Comece cadastrando os índices raiz e depois as folhas."
            action={
              podeEditar ? (
                <Button variant="default" size="sm" onClick={() => abrirNovo(null)}>
                  <Plus size={11} /> Criar primeiro
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="rounded border border-border bg-bg-panel p-3">
            <ServicosTree nodes={tree} onAddChild={abrirNovo} />
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
    </div>
  )
}
