import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Calendar, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import {
  useCalendario,
  useUpdateCalendarioBitmask,
  useExcecoes,
  useUpsertExcecao,
  useDeleteExcecao,
  useFatoresMes,
  useUpsertFatorMes,
  useDeleteFatorMes
} from '@/features/planejamento/hooks/calendario'
import { CalendarioMensalView } from '@/features/planejamento/components/CalendarioMensalView'
import { ImportarFeriadosNacionaisDialog } from '@/features/planejamento/modals/ImportarFeriadosNacionaisDialog'
import { fmtMesAnoBRDoISO } from '@/features/planejamento/lib/dates'

export function PlanejamentoCalendarioPage(): ReactNode {
  return (
    <RequireObra pageTitle="Calendário">
      <CalendarioInner />
    </RequireObra>
  )
}

function CalendarioInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnly = role === 'apoio'

  const { data: calendario = null } = useCalendario(obraId)
  const { data: excecoes = [] } = useExcecoes(obraId)
  const { data: fatores = [] } = useFatoresMes(obraId)

  const updBitmask = useUpdateCalendarioBitmask()
  const upsertExc = useUpsertExcecao()
  const delExc = useDeleteExcecao()
  const upsertFator = useUpsertFatorMes()
  const delFator = useDeleteFatorMes()

  const [importarOpen, setImportarOpen] = useState(false)

  // Form fator
  const [novoMes, setNovoMes] = useState('')
  const [novoFator, setNovoFator] = useState(1.0)
  const [novoMotivo, setNovoMotivo] = useState('')

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Calendário"
        subtitle={`${scope.obra?.nome ?? ''} — dias úteis, feriados e fator de produtividade mensal.`}
        actions={
          !readOnly ? (
            <Button size="sm" variant="default" onClick={() => setImportarOpen(true)}>
              <Calendar size={11} /> Importar feriados nacionais
            </Button>
          ) : null
        }
      />
      <div className="flex-1 overflow-auto">
        <CalendarioMensalView
          obraId={obraId}
          calendario={calendario}
          excecoes={excecoes}
          onChangeBitmask={async (b) => {
            await updBitmask.mutateAsync({ obra_id: obraId, bitmask: b })
          }}
          onAddExcecao={async (data, motivo, ehUtil) => {
            await upsertExc.mutateAsync({ obra_id: obraId, data, motivo, eh_util: ehUtil })
            toast.success('Exceção registrada.')
          }}
          onRemoveExcecao={async (id) => {
            await delExc.mutateAsync({ id, obra_id: obraId })
          }}
          readOnly={readOnly}
        />

        <div className="px-4 pb-6">
          <div className="rounded border border-border bg-bg-panel">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <div className="text-2xs font-mono text-text-dim uppercase">
                Fator de produtividade mensal
              </div>
              <div className="text-2xs text-text-dim font-mono">
                1.0 = produtividade normal · 0.5 = metade · 1.5 = ganho
              </div>
            </div>

            {!readOnly ? (
              <div className="grid grid-cols-4 gap-2 p-3 border-b border-border bg-bg/40">
                <div>
                  <Input
                    type="month"
                    value={novoMes}
                    onChange={(e) => setNovoMes(e.target.value)}
                    placeholder="2026-12"
                  />
                </div>
                <div>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="2.0"
                    value={novoFator}
                    onChange={(e) => setNovoFator(Number(e.target.value))}
                  />
                </div>
                <Input
                  value={novoMotivo}
                  onChange={(e) => setNovoMotivo(e.target.value)}
                  placeholder="Motivo (chuva, etc.)"
                />
                <Button
                  size="sm"
                  variant="default"
                  disabled={!novoMes}
                  onClick={async () => {
                    const ano_mes = `${novoMes}-01`
                    await upsertFator.mutateAsync({
                      obra_id: obraId,
                      ano_mes,
                      fator: novoFator,
                      motivo: novoMotivo || null
                    })
                    setNovoMes('')
                    setNovoFator(1.0)
                    setNovoMotivo('')
                    toast.success('Fator salvo.')
                  }}
                >
                  <Plus size={11} /> Adicionar
                </Button>
              </div>
            ) : null}

            {fatores.length === 0 ? (
              <div className="p-4 text-2xs text-text-dim italic">
                Nenhum fator personalizado. Todos os meses usam 1.0 (default).
              </div>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead className="text-text-dim uppercase text-2xs">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-1.5">Mês</th>
                    <th className="text-right px-3 py-1.5">Fator</th>
                    <th className="text-left px-3 py-1.5">Motivo</th>
                    <th className="px-3 py-1.5 w-12" />
                  </tr>
                </thead>
                <tbody>
                  {fatores.map((f) => (
                    <tr key={f.ano_mes} className="border-b border-border/40">
                      <td className="px-3 py-1.5">{fmtMesAnoBRDoISO(f.ano_mes)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {f.fator.toFixed(2)}×
                      </td>
                      <td className="px-3 py-1.5 text-text-muted">{f.motivo ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right">
                        {!readOnly ? (
                          <IconButton
                            size="sm"
                            variant="danger"
                            aria-label="Remover fator de produtividade"
                            onClick={() =>
                              delFator.mutate({ obra_id: obraId, ano_mes: f.ano_mes })
                            }
                          >
                            <Trash2 size={11} />
                          </IconButton>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <ImportarFeriadosNacionaisDialog
        open={importarOpen}
        onOpenChange={setImportarOpen}
        obraId={obraId}
      />
    </div>
  )
}
