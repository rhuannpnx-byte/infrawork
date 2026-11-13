import { useState, type ReactNode } from 'react'
import { CadeiaTravaBanner } from '@/features/orcamento/components/CadeiaTravaBanner'
import { useCadeiaTrava } from '@/features/planejamento/hooks/planejamentos'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { ErroConsulta } from '@/components/ui/estado'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useIndireto, totalIndireto } from '@/features/orcamento/hooks/indireto'
import { IndiretoTable } from '@/features/orcamento/components/IndiretoTable'
import { NewIndiretoDialog } from '@/features/orcamento/modals/NewIndiretoDialog'
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
  const { data: indiretos = [], isLoading, error, refetch } = useIndireto(obraId)
  const [openNew, setOpenNew] = useState(false)

  const { data: cadeiaTrava, isLoading: travaCarregando } = useCadeiaTrava(obraId)
  const podeEditar =
    (role === 'god' || role === 'adm' || role === 'engenheiro') && !travaCarregando && !cadeiaTrava
  const total = totalIndireto(indiretos)

  const botaoNovo = podeEditar ? (
    <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
      <Plus size={12} aria-hidden /> Novo custo indireto
    </Button>
  ) : null

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Custos indiretos"
        subtitle="Mobilização, administração local e outros"
        actions={botaoNovo}
      />
      <CadeiaTravaBanner obraId={obraId} />
      {error ? (
        <div className="px-5 pt-3">
          <ErroConsulta
            erro={error}
            oQue="os custos indiretos"
            aoTentar={() => void refetch()}
            compacto
          />
        </div>
      ) : null}
      {error && indiretos.length === 0 ? null : indiretos.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="briefcase"
            title="Nenhum custo indireto cadastrado"
            description={
              podeEditar
                ? 'Cadastre mobilização, desmobilização, administração local e os demais custos que não entram nas composições.'
                : 'Esta obra ainda não tem mobilização, administração local nem outros custos indiretos cadastrados.'
            }
            action={botaoNovo}
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
          <div className="flex items-baseline justify-end gap-2 px-4 py-2 border-t border-border bg-bg-panel text-sm">
            <span className="text-text-muted">Total efetivo</span>
            <span className="tabular text-md font-semibold text-text">{fmtBRL(total)}</span>
          </div>
        </>
      )}

      <NewIndiretoDialog open={openNew} onOpenChange={setOpenNew} obraId={obraId} />
    </div>
  )
}
