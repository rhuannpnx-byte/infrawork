import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useEquipes, useReorderEquipes } from '@/features/planejamento/hooks/equipes'
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
  const reorder = useReorderEquipes()

  const [novoOpen, setNovoOpen] = useState(false)
  const [editEq, setEditEq] = useState<Equipe | null>(null)

  const usoEquipe = new Map<string, number>()
  for (const t of tarefas)
    for (const e of t.equipes) usoEquipe.set(e.id, (usoEquipe.get(e.id) ?? 0) + 1)

  const mover = async (idx: number, delta: number): Promise<void> => {
    const j = idx + delta
    if (j < 0 || j >= equipes.length) return
    const ids = equipes.map((e) => e.id)
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    try {
      await reorder.mutateAsync({ obra_id: obraId, ids })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reordenar')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Equipes"
        subtitle={`${scope.obra?.nome ?? ''} — equipes nomeadas: a mesma equipe não trabalha em duas tarefas ao mesmo tempo (o cronograma as sequencia pela prioridade). A produção vem da composição do serviço.`}
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
            description="Cadastre as equipes (Pavimentação 01, Terraplenagem 02…) e atribua às tarefas em Propriedades › Equipes: o cronograma não deixa a mesma equipe em duas tarefas ao mesmo tempo."
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
                  <th className="px-3 py-2 w-16 text-left">Ordem</th>
                  <th className="text-left px-3 py-2">Equipe</th>
                  <th className="text-left px-3 py-2">Tipo</th>
                  <th className="text-right px-3 py-2">Em uso</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="px-3 py-2 w-40" />
                </tr>
              </thead>
              <tbody>
                {equipes.map((e, idx) => (
                  <tr key={e.id} className="border-b border-border/40 hover:bg-bg-hover">
                    <td className="px-3 py-2">
                      {!readOnly ? (
                        <span className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            className="text-text-dim hover:text-text disabled:opacity-30"
                            disabled={idx === 0 || reorder.isPending}
                            onClick={() => void mover(idx, -1)}
                            title="Subir"
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            type="button"
                            className="text-text-dim hover:text-text disabled:opacity-30"
                            disabled={idx === equipes.length - 1 || reorder.isPending}
                            onClick={() => void mover(idx, 1)}
                            title="Descer"
                          >
                            <ArrowDown size={11} />
                          </button>
                          <span className="font-mono text-text-dim ml-1">{idx + 1}</span>
                        </span>
                      ) : (
                        <span className="font-mono text-text-dim">{idx + 1}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <EquipeChip nome={e.nome} cor={e.cor} />
                    </td>
                    <td className="px-3 py-2 font-mono text-text-muted">{e.tipo}</td>
                    <td className="px-3 py-2 font-mono text-text-muted text-right">
                      {usoEquipe.get(e.id) ?? 0} tarefa(s)
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {e.ativo ? (
                        <span className="text-success">Ativa</span>
                      ) : (
                        <span className="text-text-dim">Inativa</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        {!readOnly ? (
                          <button
                            type="button"
                            onClick={() => setEditEq(e)}
                            className="text-text-dim hover:text-accent"
                            title="Editar"
                          >
                            <Pencil size={11} />
                          </button>
                        ) : null}
                      </div>
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
