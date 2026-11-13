import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EstadoConsulta } from '@/components/ui/estado'
import { IconButton } from '@/components/ui/IconButton'
import { Secao } from '@/components/ui/secao'
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
import { dataBR as fmtBR } from '@/lib/format/local-date'

const CABECALHO =
  'border-y border-border bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

/**
 * Equipes e encarregados da obra numa tela só (Planejamento › Equipes e Acompanhamento › Equipes e encarregados):
 * ordem (prioridade no cronograma), uso nas tarefas do plano, encarregado e lançamentos.
 */
export function EquipesEncarregados(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnlyEquipes = role === 'apoio'

  const consultaEquipes = useEquipes(obraId, { incluirInativas: true })
  const consultaEncarregados = useEncarregados(obraId, true)
  const equipes = consultaEquipes.data ?? []
  const encarregados = consultaEncarregados.data ?? []
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
      toast.error(
        `Não foi possível mudar a ordem das equipes.${e instanceof Error ? ` ${e.message}` : ''}`
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Equipes e encarregados"
        subtitle="Quem executa e quem responde pelo lançamento."
      />
      <div className="flex-1 space-y-5 overflow-auto p-5">
        <Secao
          titulo="Equipes"
          nota="A ordem é a prioridade no cronograma: a mesma equipe não trabalha em duas tarefas ao mesmo tempo."
          semRecuo
          acoes={
            <>
              <span role="status" aria-live="polite" className="text-sm text-text-muted">
                {reorder.isPending ? 'Salvando a ordem…' : ''}
              </span>
              {!readOnlyEquipes ? (
                <Button size="sm" variant="secondary" onClick={() => setNovaEquipe(true)}>
                  <Plus size={12} /> Nova equipe
                </Button>
              ) : null}
            </>
          }
        >
          <EstadoConsulta
            consulta={consultaEquipes}
            oQue="as equipes"
            vazio={equipes.length === 0}
            textoVazio="Nenhuma equipe cadastrada. Cadastre as equipes (Pavimentação 01, Terraplenagem 02…) com o encarregado de cada uma: o lançamento preenche o encarregado pela equipe."
            className="mx-4 mb-4"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm" aria-busy={reorder.isPending}>
                <thead>
                  <tr className={CABECALHO}>
                    <th className="w-24 px-3 py-2 text-left font-semibold">Ordem</th>
                    <th className="px-2 py-2 text-left font-semibold">Equipe</th>
                    <th className="px-2 py-2 text-left font-semibold">Tipo</th>
                    <th className="px-2 py-2 text-left font-semibold">Encarregado</th>
                    <th className="px-2 py-2 text-right font-semibold">Tarefas no plano</th>
                    <th className="px-2 py-2 text-right font-semibold">Lançamentos</th>
                    <th className="px-2 py-2 text-left font-semibold">Último lançamento</th>
                    <th className="px-2 py-2 text-left font-semibold">Situação</th>
                    <th className="w-12 px-2 py-2">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {equipes.map((e, idx) => {
                    const r = resumoEquipe.get(e.id)
                    return (
                      <tr
                        key={e.id}
                        className="border-b border-border last:border-b-0 hover:bg-bg-hover"
                      >
                        <td className="px-3 py-1">
                          <span className="inline-flex items-center">
                            <span className="w-6 tabular text-text-muted">{idx + 1}</span>
                            {!readOnlyEquipes ? (
                              <>
                                <IconButton
                                  size="sm"
                                  disabled={idx === 0 || reorder.isPending}
                                  onClick={() => void mover(idx, -1)}
                                  aria-label={`Subir a equipe ${e.nome} na ordem`}
                                  title="Subir na ordem"
                                >
                                  <ArrowUp size={14} />
                                </IconButton>
                                <IconButton
                                  size="sm"
                                  disabled={idx === equipes.length - 1 || reorder.isPending}
                                  onClick={() => void mover(idx, 1)}
                                  aria-label={`Descer a equipe ${e.nome} na ordem`}
                                  title="Descer na ordem"
                                >
                                  <ArrowDown size={14} />
                                </IconButton>
                              </>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-2 py-1">
                          <EquipeChip nome={e.nome} cor={e.cor} />
                        </td>
                        <td className="px-2 py-1 text-text-muted">{e.tipo}</td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {e.encarregado_id ? (
                            <span className="text-text-muted">
                              {nomeEnc.get(e.encarregado_id) ?? '—'}
                            </span>
                          ) : (
                            <span className="text-warn">Sem encarregado</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular text-text-muted">
                          {usoEquipe.get(e.id) ?? 0}
                        </td>
                        <td className="px-2 py-1 text-right tabular text-text-muted">
                          {r ? formatNumber(r.registros, 0) : '0'}
                        </td>
                        <td className="px-2 py-1 tabular text-text-muted">
                          {r?.ultima ? fmtBR(r.ultima) : '—'}
                        </td>
                        <td className="px-2 py-1">
                          <Badge variant={e.ativo ? 'success' : 'outline'}>
                            {e.ativo ? 'Ativa' : 'Inativa'}
                          </Badge>
                        </td>
                        <td className="px-2 py-1 text-right">
                          {!readOnlyEquipes ? (
                            <IconButton
                              size="sm"
                              variant="accent"
                              onClick={() => setEditEq(e)}
                              aria-label={`Editar a equipe ${e.nome}`}
                              title="Editar a equipe"
                            >
                              <Pencil size={14} />
                            </IconButton>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </EstadoConsulta>
        </Secao>

        <Secao
          titulo="Encarregados"
          semRecuo
          acoes={
            <Button size="sm" variant="secondary" onClick={() => setNovoEnc(true)}>
              <Plus size={12} /> Novo encarregado
            </Button>
          }
        >
          <EstadoConsulta
            consulta={consultaEncarregados}
            oQue="os encarregados"
            vazio={encarregados.length === 0}
            textoVazio="Nenhum encarregado cadastrado. Cadastre aqui ou direto no formulário de lançamento."
            className="mx-4 mb-4"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className={CABECALHO}>
                    <th className="px-4 py-2 text-left font-semibold">Nome</th>
                    <th className="px-2 py-2 text-left font-semibold">Apelido</th>
                    <th className="px-2 py-2 text-left font-semibold">Equipes</th>
                    <th className="px-2 py-2 text-left font-semibold">Telefone</th>
                    <th className="px-2 py-2 text-left font-semibold">Situação</th>
                    <th className="w-12 px-2 py-2">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {encarregados.map((en) => (
                    <tr
                      key={en.id}
                      className="border-b border-border last:border-b-0 hover:bg-bg-hover"
                    >
                      <td className="px-4 py-1 text-text">{en.nome}</td>
                      <td className="px-2 py-1 text-text-muted">{en.apelido ?? '—'}</td>
                      <td className="px-2 py-1">
                        <div className="flex flex-wrap gap-1">
                          {(equipesDe.get(en.id) ?? []).map((q) => (
                            <EquipeChip key={q.id} nome={q.nome} cor={q.cor} />
                          ))}
                          {equipesDe.has(en.id) ? null : <span className="text-text-dim">—</span>}
                        </div>
                      </td>
                      <td className="px-2 py-1 tabular text-text-muted">{en.telefone ?? '—'}</td>
                      <td className="px-2 py-1">
                        <Badge variant={en.ativo ? 'success' : 'outline'}>
                          {en.ativo ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <IconButton
                          size="sm"
                          variant="accent"
                          onClick={() => setEditEnc(en)}
                          aria-label={`Editar o encarregado ${en.nome}`}
                          title="Editar o encarregado"
                        >
                          <Pencil size={14} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </EstadoConsulta>
        </Secao>
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
