import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, HardHat, Pencil, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { formatNumber } from '@/lib/format'
import { useEquipes, useReorderEquipes } from '@/features/planejamento/hooks/equipes'
import { useTarefas } from '@/features/planejamento/hooks/tarefas'
import { usePlanejamentoAtivo } from '@/features/planejamento/hooks/planejamentos'
import { NewEquipeDialog } from '@/features/planejamento/modals/NewEquipeDialog'
import { EditEquipeDialog } from '@/features/planejamento/modals/EditEquipeDialog'
import { EquipeChip } from '@/features/planejamento/components/EquipeChip'
import { EncarregadoDialog } from '@/features/acompanhamento/components/lancamento/EncarregadoDialog'
import { useEncarregados } from '@/features/acompanhamento/hooks/lancamento'
import { useProdutividadeObra } from '@/features/acompanhamento/hooks/performance'
import type { Equipe } from '@/types/planejamento'
import type { Encarregado } from '@/types/acompanhamento'

const fmtBR = (iso: string): string => iso.split('-').reverse().join('/')

/**
 * Equipes e encarregados da obra numa tela só (Planejamento › Equipes e Acompanhamento › Equipes & Encarregados):
 * ordem (prioridade no cronograma), uso nas tarefas do plano, encarregado e lançamentos.
 */
export function EquipesEncarregados(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnlyEquipes = role === 'apoio'

  const { data: equipes = [] } = useEquipes(obraId, { incluirInativas: true })
  const { data: encarregados = [] } = useEncarregados(obraId, true)
  const { data: produtividade = [] } = useProdutividadeObra(obraId)
  const { data: ativo } = usePlanejamentoAtivo(obraId)
  const { data: tarefas = [] } = useTarefas(ativo?.id)
  const reorder = useReorderEquipes()

  const [novaEquipe, setNovaEquipe] = useState(false)
  const [editEq, setEditEq] = useState<Equipe | null>(null)
  const [novoEnc, setNovoEnc] = useState(false)
  const [editEnc, setEditEnc] = useState<Encarregado | null>(null)

  const nomeEnc = new Map(encarregados.map((en) => [en.id, en.nome]))
  const equipesDe = new Map<string, Equipe[]>()
  for (const e of equipes) {
    if (!e.encarregado_id || !e.ativo) continue
    equipesDe.set(e.encarregado_id, [...(equipesDe.get(e.encarregado_id) ?? []), e])
  }
  const usoEquipe = new Map<string, number>()
  for (const t of tarefas)
    for (const e of t.equipes) usoEquipe.set(e.id, (usoEquipe.get(e.id) ?? 0) + 1)
  const resumoEquipe = new Map<string, { registros: number; ultima: string | null }>()
  for (const p of produtividade) {
    if (!p.equipe_id) continue
    const cur = resumoEquipe.get(p.equipe_id) ?? { registros: 0, ultima: null }
    cur.registros += Number(p.registros ?? 0)
    if (p.ultima_data && (!cur.ultima || p.ultima_data > cur.ultima)) cur.ultima = p.ultima_data
    resumoEquipe.set(p.equipe_id, cur)
  }

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
        title="Equipes & Encarregados"
        subtitle="Quem executa e quem responde pelo lançamento. A ordem é a prioridade no cronograma: a mesma equipe não trabalha em duas tarefas ao mesmo tempo."
      />
      <div className="flex-1 overflow-auto p-5 space-y-5">
        <section className="min-w-0 rounded border border-border bg-bg-panel overflow-x-auto">
          <header className="px-3 py-2 border-b border-border flex items-center justify-between">
            <h3 className="text-md font-semibold text-text inline-flex items-center gap-1.5">
              <Users size={12} /> Equipes
            </h3>
            {!readOnlyEquipes ? (
              <Button size="sm" variant="secondary" onClick={() => setNovaEquipe(true)}>
                <Plus size={12} /> Nova equipe
              </Button>
            ) : null}
          </header>
          {equipes.length === 0 ? (
            <div className="p-6 text-2xs text-text-dim text-center">
              Nenhuma equipe. Cadastre as equipes (Pavimentação 01, Terraplenagem 02…) com o
              encarregado de cada uma: o lançamento preenche o encarregado pela equipe.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
                <tr className="border-b border-border">
                  <th className="px-2 py-2 w-16 text-left">Ordem</th>
                  <th className="text-left px-2 py-2">Equipe</th>
                  <th className="text-left px-2 py-2">Tipo</th>
                  <th className="text-left px-2 py-2">Encarregado</th>
                  <th className="text-right px-2 py-2">Tarefas no plano</th>
                  <th className="text-right px-2 py-2">Lançamentos</th>
                  <th className="text-left px-2 py-2">Último</th>
                  <th className="text-left px-2 py-2">Status</th>
                  <th className="px-2 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {equipes.map((e, idx) => {
                  const r = resumoEquipe.get(e.id)
                  return (
                    <tr key={e.id} className="border-b border-border hover:bg-bg-hover">
                      <td className="px-2 py-2">
                        <span className="inline-flex items-center gap-0.5">
                          {!readOnlyEquipes ? (
                            <>
                              <button
                                type="button"
                                className="text-text-dim hover:text-text disabled:opacity-30"
                                disabled={idx === 0 || reorder.isPending}
                                onClick={() => void mover(idx, -1)}
                                title="Subir"
                              >
                                <ArrowUp size={12} />
                              </button>
                              <button
                                type="button"
                                className="text-text-dim hover:text-text disabled:opacity-30"
                                disabled={idx === equipes.length - 1 || reorder.isPending}
                                onClick={() => void mover(idx, 1)}
                                title="Descer"
                              >
                                <ArrowDown size={12} />
                              </button>
                            </>
                          ) : null}
                          <span className="font-mono text-text-dim ml-1">{idx + 1}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <EquipeChip nome={e.nome} cor={e.cor} />
                      </td>
                      <td className="px-2 py-2 font-mono text-text-muted">{e.tipo}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {e.encarregado_id ? (
                          <span className="text-text-muted">
                            {nomeEnc.get(e.encarregado_id) ?? '—'}
                          </span>
                        ) : (
                          <span className="text-warn">sem encarregado</span>
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-text-muted text-right">
                        {usoEquipe.get(e.id) ?? 0}
                      </td>
                      <td className="px-2 py-2 font-mono text-text-muted text-right">
                        {r ? formatNumber(r.registros, 0) : '0'}
                      </td>
                      <td className="px-2 py-2 font-mono text-text-dim">
                        {r?.ultima ? fmtBR(r.ultima) : '—'}
                      </td>
                      <td className="px-2 py-2 font-mono">
                        {e.ativo ? (
                          <span className="text-success">Ativa</span>
                        ) : (
                          <span className="text-text-dim">Inativa</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {!readOnlyEquipes ? (
                          <button
                            type="button"
                            onClick={() => setEditEq(e)}
                            className="text-text-dim hover:text-accent"
                            title="Editar"
                          >
                            <Pencil size={12} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="min-w-0 rounded border border-border bg-bg-panel overflow-x-auto">
          <header className="px-3 py-2 border-b border-border flex items-center justify-between">
            <h3 className="text-md font-semibold text-text inline-flex items-center gap-1.5">
              <HardHat size={12} /> Encarregados
            </h3>
            <Button size="sm" variant="secondary" onClick={() => setNovoEnc(true)}>
              <Plus size={12} /> Novo encarregado
            </Button>
          </header>
          {encarregados.length === 0 ? (
            <div className="p-6 text-2xs text-text-dim text-center">
              Nenhum encarregado. Eles também podem ser criados direto no formulário de lançamento.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2">Nome</th>
                  <th className="text-left px-3 py-2">Apelido</th>
                  <th className="text-left px-3 py-2">Equipes</th>
                  <th className="text-left px-3 py-2">Telefone</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {encarregados.map((en) => (
                  <tr key={en.id} className="border-b border-border hover:bg-bg-hover">
                    <td className="px-3 py-2 text-text">{en.nome}</td>
                    <td className="px-3 py-2 text-text-muted">{en.apelido ?? '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(equipesDe.get(en.id) ?? []).map((q) => (
                          <EquipeChip key={q.id} nome={q.nome} cor={q.cor} />
                        ))}
                        {equipesDe.has(en.id) ? null : <span className="text-text-dim">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-text-muted">{en.telefone ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">
                      {en.ativo ? (
                        <span className="text-success">Ativo</span>
                      ) : (
                        <span className="text-text-dim">Inativo</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setEditEnc(en)}
                        className="text-text-dim hover:text-accent"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <NewEquipeDialog open={novaEquipe} onOpenChange={setNovaEquipe} obraId={obraId} />
      <EditEquipeDialog
        open={!!editEq}
        onOpenChange={(o) => !o && setEditEq(null)}
        equipe={editEq}
      />
      <EncarregadoDialog open={novoEnc} onOpenChange={setNovoEnc} obraId={obraId} />
      <EncarregadoDialog
        open={!!editEnc}
        onOpenChange={(o) => !o && setEditEnc(null)}
        obraId={obraId}
        encarregado={editEnc}
      />
    </div>
  )
}
