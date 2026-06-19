import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { History, Play, AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useSessao, useGrupos, useJobs, useCriarBackfill } from '@/features/whatsapp/hooks'
import type { WhatsAppJobStatus } from '@/types/whatsapp'

const JOB_BADGE: Record<WhatsAppJobStatus, 'outline' | 'warn' | 'success' | 'danger'> = {
  pendente: 'outline',
  rodando: 'warn',
  concluido: 'success',
  erro: 'danger'
}

export function WhatsAppBackfillPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm']} pageTitle="WhatsApp — Backfill">
      <BackfillInner />
    </RequireRole>
  )
}

function BackfillInner(): ReactNode {
  const { data: sessao } = useSessao()
  const { data: grupos } = useGrupos(sessao?.id)
  const monitorados = useMemo(
    () => (grupos ?? []).filter((g) => g.monitorar && g.obra_id),
    [grupos]
  )
  const grupoIds = useMemo(() => monitorados.map((g) => g.id), [monitorados])
  const { data: jobs } = useJobs(grupoIds)
  const criar = useCriarBackfill()

  const [grupoId, setGrupoId] = useState('')
  const [limite, setLimite] = useState(500)

  const nomeGrupo = (id: string): string =>
    monitorados.find((g) => g.id === id)?.nome ?? id.slice(0, 8)

  const onCriar = async (): Promise<void> => {
    if (!grupoId) {
      toast.error('Selecione um grupo.')
      return
    }
    try {
      await criar.mutateAsync({ grupo_id: grupoId, limite })
      toast.success('Backfill enfileirado. O agente processará o histórico disponível.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar job')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="WhatsApp — Backfill"
        subtitle="Processa o histórico de um grupo monitorado."
      />
      <div className="flex-1 overflow-auto p-5 space-y-4 max-w-3xl">
        {monitorados.length === 0 ? (
          <EmptyState
            icon="history"
            title="Nenhum grupo monitorado"
            description="Marque grupos para monitorar e vincule a uma obra na aba Grupos antes de rodar o backfill."
          />
        ) : (
          <>
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-2xs flex items-start gap-2 font-mono text-text-muted">
              <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
              <span>
                O WhatsApp disponibiliza histórico limitado e a mídia de mensagens antigas pode já
                ter expirado. O backfill sobe apenas o que o aparelho conseguir sincronizar.
              </span>
            </div>

            <div className="rounded border border-border bg-bg-panel p-4 flex items-end gap-3">
              <div className="flex-1">
                <label className="text-2xs font-mono uppercase text-text-dim block mb-1">
                  Grupo
                </label>
                <Select value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
                  <option value="">— selecione —</option>
                  {monitorados.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nome ?? g.wa_group_jid}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-32">
                <label className="text-2xs font-mono uppercase text-text-dim block mb-1">
                  Limite de fotos
                </label>
                <Input
                  type="number"
                  min={1}
                  value={limite}
                  onChange={(e) => setLimite(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <Button size="sm" variant="default" onClick={onCriar} disabled={criar.isPending}>
                <Play size={12} /> Iniciar
              </Button>
            </div>

            <div className="rounded border border-border bg-bg-panel overflow-hidden">
              <table className="w-full text-xs">
                <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2">Grupo</th>
                    <th className="text-center px-3 py-2 w-24">Status</th>
                    <th className="text-center px-3 py-2 w-40">Progresso</th>
                    <th className="text-right px-3 py-2 w-36">Criado</th>
                  </tr>
                </thead>
                <tbody>
                  {(jobs ?? []).map((j) => (
                    <tr key={j.id} className="border-b border-border/40">
                      <td className="px-3 py-2 text-text flex items-center gap-2">
                        <History size={12} className="text-text-dim" />
                        {nomeGrupo(j.grupo_id)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant={JOB_BADGE[j.status]}>{j.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-text-dim">
                        {j.progresso
                          ? `${j.progresso.subidas ?? 0} subidas / ${j.progresso.processadas ?? 0}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-text-dim">
                        {new Date(j.criado_em).toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                  {(jobs ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-text-dim italic">
                        Nenhum backfill ainda.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
