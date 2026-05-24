import { useState, type ReactNode } from 'react'
import { Plus, FileUp } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useIndireto, totalIndireto } from '@/features/orcamento/hooks/indireto'
import { IndiretoTable } from '@/features/orcamento/components/IndiretoTable'
import { NewIndiretoDialog } from '@/features/orcamento/modals/NewIndiretoDialog'
import { ImportIndiretoDialog } from '@/features/orcamento/modals/ImportIndiretoDialog'
import { fmtBRL } from '@/lib/money'

export function IndiretoPage(): ReactNode {
  return (
    <RequireObra pageTitle="Indireto">
      <Indireto />
    </RequireObra>
  )
}

function Indireto(): ReactNode {
  const scope = useCurrentScope()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!
  const { data: indiretos = [], isLoading, error } = useIndireto(obraId)
  const [openNew, setOpenNew] = useState(false)
  const [openImport, setOpenImport] = useState(false)

  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'
  const total = totalIndireto(indiretos)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Custos indiretos"
        subtitle={`${scope.obra?.nome ?? ''} — mobilização, administração local e outros`}
        actions={
          podeEditar ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpenImport(true)}>
                <FileUp size={11} /> Importar planilha
              </Button>
              <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                <Plus size={11} /> Novo indireto
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
      {indiretos.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="briefcase"
            title="Nenhum custo indireto"
            description="Lance mobilização, desmobilização, administração local etc."
            action={
              podeEditar ? (
                <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                  <Plus size={11} /> Novo indireto
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0">
            <IndiretoTable
              obraId={obraId}
              data={indiretos}
              loading={isLoading}
              podeEditar={podeEditar}
            />
          </div>
          <div className="flex items-center justify-end px-4 py-2 border-t border-border bg-bg-panel text-xs font-mono">
            <span className="text-text-dim mr-2">Total efetivo:</span>
            <span className="text-accent">{fmtBRL(total)}</span>
          </div>
        </>
      )}

      <NewIndiretoDialog open={openNew} onOpenChange={setOpenNew} obraId={obraId} />
      <ImportIndiretoDialog open={openImport} onOpenChange={setOpenImport} obraId={obraId} />
    </div>
  )
}
