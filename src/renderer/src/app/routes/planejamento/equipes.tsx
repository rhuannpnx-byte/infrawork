import { useState, type ReactNode } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useEquipes } from '@/features/planejamento/hooks/equipes'
import { useTarefas } from '@/features/planejamento/hooks/tarefas'
import { usePlanejamentoAtivo } from '@/features/planejamento/hooks/planejamentos'
import { NewEquipeDialog } from '@/features/planejamento/modals/NewEquipeDialog'
import { EditEquipeDialog } from '@/features/planejamento/modals/EditEquipeDialog'
import { EquipeChip } from '@/features/planejamento/components/EquipeChip'
import type { Equipe } from '@/types/planejamento'

export function PlanejamentoEquipesPage(): ReactNode {
  return (
    <RequireObra pageTitle="Equipes">
      <EquipesInner />
    </RequireObra>
  )
}

function EquipesInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnly = role === 'apoio'

  const { data: equipes = [] } = useEquipes(obraId, { incluirInativas: true })
  const { data: ativo } = usePlanejamentoAtivo(obraId)
  const { data: tarefas = [] } = useTarefas(ativo?.id)

  const [novoOpen, setNovoOpen] = useState(false)
  const [editEq, setEditEq] = useState<Equipe | null>(null)

  // contagem de uso
  const usoEquipe = new Map<string, number>()
  for (const t of tarefas) {
    for (const e of t.equipes) {
      usoEquipe.set(e.id, (usoEquipe.get(e.id) ?? 0) + 1)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Equipes"
        subtitle={`${scope.obra?.nome ?? ''} — frentes de serviço para alocação no cronograma.`}
        actions={
          !readOnly ? (
            <Button size="sm" variant="default" onClick={() => setNovoOpen(true)}>
              <Plus size={11} /> Nova equipe
            </Button>
          ) : null
        }
      />
      <div className="flex-1 overflow-auto p-5">
        {equipes.length === 0 ? (
          <EmptyState
            icon="users"
            title="Nenhuma equipe cadastrada"
            description="Cadastre as frentes de serviço para alocar em tarefas (Pavimentação 01, Terraplanagem 02, etc.)."
            action={
              !readOnly ? (
                <Button variant="default" size="sm" onClick={() => setNovoOpen(true)}>
                  <Plus size={11} /> Cadastrar primeira
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="rounded border border-border bg-bg-panel overflow-hidden">
            <table className="w-full text-xs">
              <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2">Equipe</th>
                  <th className="text-left px-3 py-2">Tipo</th>
                  <th className="text-right px-3 py-2">Em uso</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="px-3 py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {equipes.map((e) => (
                  <tr key={e.id} className="border-b border-border/40 hover:bg-bg-hover">
                    <td className="px-3 py-2">
                      <EquipeChip nome={e.nome} cor={e.cor} />
                    </td>
                    <td className="px-3 py-2 font-mono text-text-muted">{e.tipo}</td>
                    <td className="px-3 py-2 font-mono text-text-muted text-right">
                      {usoEquipe.get(e.id) ?? 0} tarefa(s)
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {e.ativo ? (
                        <span className="text-emerald-400">Ativa</span>
                      ) : (
                        <span className="text-text-dim">Inativa</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => setEditEq(e)}
                          className="text-text-dim hover:text-accent"
                        >
                          <Pencil size={11} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewEquipeDialog open={novoOpen} onOpenChange={setNovoOpen} obraId={obraId} />
      <EditEquipeDialog
        open={!!editEq}
        onOpenChange={(o) => !o && setEditEq(null)}
        equipe={editEq}
      />
    </div>
  )
}
