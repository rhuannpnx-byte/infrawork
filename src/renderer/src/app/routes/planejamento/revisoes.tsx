import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Star, Archive, Trash2, Copy } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import {
  usePlanejamentos,
  useDeletePlanejamento,
  useUpdatePlanejamento,
  useCopiarPlanejamento
} from '@/features/planejamento/hooks/planejamentos'
import { NewPlanejamentoDialog } from '@/features/planejamento/modals/NewPlanejamentoDialog'
import { PromoverBaselineDialog } from '@/features/planejamento/modals/PromoverBaselineDialog'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { STATUS_LABEL, type Planejamento } from '@/types/planejamento'
import { useConfirm } from '@/components/modals/ConfirmDialog'

export function PlanejamentoRevisoesPage(): ReactNode {
  return (
    <RequireObra pageTitle="Revisões">
      <RevisoesInner />
    </RequireObra>
  )
}

function RevisoesInner(): ReactNode {
  const navigate = useNavigate()
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnly = role === 'apoio'

  const { data: planejamentos = [] } = usePlanejamentos(obraId)
  const del = useDeletePlanejamento()
  const upd = useUpdatePlanejamento()
  const copiar = useCopiarPlanejamento()
  const confirm = useConfirm()

  const [novoOpen, setNovoOpen] = useState(false)
  const [promoverPlan, setPromoverPlan] = useState<Planejamento | null>(null)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Revisões"
        subtitle={`${scope.obra?.nome ?? ''} — todas as versões do cronograma desta obra.`}
        actions={
          !readOnly ? (
            <Button size="sm" variant="default" onClick={() => setNovoOpen(true)}>
              <Plus size={11} /> Nova revisão
            </Button>
          ) : null
        }
      />
      <div className="flex-1 overflow-auto p-5">
        {planejamentos.length === 0 ? (
          <EmptyState
            icon="history"
            title="Nenhuma revisão criada"
            description="Crie a primeira revisão do cronograma com data de início da obra."
            action={
              !readOnly ? (
                <Button variant="default" size="sm" onClick={() => setNovoOpen(true)}>
                  <Plus size={11} /> Criar primeira revisão
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="rounded border border-border bg-bg-panel overflow-hidden">
            <table className="w-full text-xs">
              <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2">Nome</th>
                  <th className="text-left px-3 py-2">Data início</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Criada em</th>
                  <th className="px-3 py-2 w-40" />
                </tr>
              </thead>
              <tbody>
                {planejamentos.map((p) => (
                  <tr key={p.id} className="border-b border-border/40 hover:bg-bg-hover">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-text hover:text-accent text-left"
                        onClick={() => navigate({ to: '/planejamento/revisoes/$id', params: { id: p.id } })}
                      >
                        {p.is_baseline ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Star size={10} className="text-amber-400 fill-amber-400" />
                            <span className="text-accent font-semibold">{p.nome}</span>
                          </span>
                        ) : (
                          p.nome
                        )}
                      </button>
                      {p.descricao ? (
                        <div className="text-2xs text-text-dim font-mono mt-0.5">{p.descricao}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-muted">
                      {fmtDataBR(p.data_referencia_inicio)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <span
                        className={
                          p.status === 'ativo'
                            ? 'text-emerald-400'
                            : p.status === 'arquivado'
                              ? 'text-text-dim'
                              : 'text-amber-400'
                        }
                      >
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-text-muted">
                      {fmtDataBR(p.created_at.slice(0, 10))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {!readOnly ? (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                const nome = prompt(`Nome da cópia de "${p.nome}":`, `${p.nome} (cópia)`)
                                if (!nome?.trim()) return
                                try {
                                  await copiar.mutateAsync({
                                    origem_id: p.id,
                                    nome_novo: nome.trim(),
                                    obra_id: obraId
                                  })
                                  toast.success('Cópia criada.')
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : 'Falha ao copiar'
                                  )
                                }
                              }}
                              title="Copiar para nova revisão"
                              className="text-text-dim hover:text-accent"
                            >
                              <Copy size={11} />
                            </button>
                            {!p.is_baseline ? (
                              <IconButton
                                size="sm"
                                aria-label="Promover a baseline"
                                title="Promover a baseline"
                                onClick={() => setPromoverPlan(p)}
                                className="hover:text-warn"
                              >
                                <Star size={11} />
                              </IconButton>
                            ) : null}
                            {p.status !== 'arquivado' ? (
                              <IconButton
                                size="sm"
                                aria-label="Arquivar revisão"
                                title="Arquivar"
                                onClick={async () => {
                                  await upd.mutateAsync({
                                    id: p.id,
                                    obra_id: obraId,
                                    status: 'arquivado'
                                  })
                                  toast.success('Arquivada.')
                                }}
                              >
                                <Archive size={11} />
                              </IconButton>
                            ) : (
                              <IconButton
                                size="sm"
                                variant="accent"
                                aria-label="Reativar revisão"
                                title="Reativar"
                                onClick={async () => {
                                  await upd.mutateAsync({
                                    id: p.id,
                                    obra_id: obraId,
                                    status: 'ativo'
                                  })
                                  toast.success('Reativada.')
                                }}
                              >
                                <Archive size={11} />
                              </IconButton>
                            )}
                            {!p.is_baseline ? (
                              <IconButton
                                size="sm"
                                variant="danger"
                                aria-label="Excluir revisão"
                                title="Excluir"
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: `Excluir "${p.nome}"?`,
                                    description: 'Sem volta. As tarefas e dependências da revisão são removidas.',
                                    confirmLabel: 'Excluir',
                                    variant: 'danger'
                                  })
                                  if (!ok) return
                                  try {
                                    await del.mutateAsync({ id: p.id, obra_id: obraId })
                                    toast.success('Excluída.')
                                  } catch (err) {
                                    toast.error(
                                      err instanceof Error ? err.message : 'Falha ao excluir'
                                    )
                                  }
                                }}
                              >
                                <Trash2 size={11} />
                              </IconButton>
                            ) : null}
                          </>
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

      <NewPlanejamentoDialog
        open={novoOpen}
        onOpenChange={setNovoOpen}
        obraId={obraId}
        onCreated={() => navigate({ to: '/planejamento/cronograma' })}
      />
      <PromoverBaselineDialog
        open={!!promoverPlan}
        onOpenChange={(o) => !o && setPromoverPlan(null)}
        planejamento={promoverPlan}
        obraId={obraId}
      />
    </div>
  )
}
