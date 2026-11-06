import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, HardHat, Pencil, Plus, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { Button } from '@/components/ui/button'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useEquipes } from '@/features/planejamento/hooks/equipes'
import { NewEquipeDialog } from '@/features/planejamento/modals/NewEquipeDialog'
import { EditEquipeDialog } from '@/features/planejamento/modals/EditEquipeDialog'
import { EquipeChip } from '@/features/planejamento/components/EquipeChip'
import { EncarregadoDialog } from '@/features/acompanhamento/components/lancamento/EncarregadoDialog'
import { useEncarregados } from '@/features/acompanhamento/hooks/lancamento'
import { useProdutividadeObra } from '@/features/acompanhamento/hooks/performance'
import type { Equipe } from '@/types/planejamento'
import type { Encarregado } from '@/types/acompanhamento'
import { formatNumber } from '@/lib/format'

export function AcompanhamentoEquipesPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Equipes & Encarregados">
      <RequireObra pageTitle="Equipes & Encarregados">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const readOnlyEquipes = role === 'apoio'

  const { data: equipes = [] } = useEquipes(obraId, { incluirInativas: true })
  const { data: encarregados = [] } = useEncarregados(obraId, true)
  const { data: produtividade = [] } = useProdutividadeObra(obraId)

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

  // Resumo de produção por equipe (todas as datas), vindo da view de produtividade.
  const resumoEquipe = new Map<
    string,
    { registros: number; servicos: number; ultima: string | null }
  >()
  for (const p of produtividade) {
    if (!p.equipe_id) continue
    const cur = resumoEquipe.get(p.equipe_id) ?? { registros: 0, servicos: 0, ultima: null }
    cur.registros += Number(p.registros ?? 0)
    cur.servicos += 1
    if (p.ultima_data && (!cur.ultima || p.ultima_data > cur.ultima)) cur.ultima = p.ultima_data
    resumoEquipe.set(p.equipe_id, cur)
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Equipes & Encarregados"
        subtitle={`${scope.obra?.nome ?? ''} — quem executa e quem responde pelo lançamento diário.`}
      />
      <div className="flex-1 overflow-auto p-5 grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        {/* Equipes */}
        <section className="min-w-0 rounded border border-border bg-bg-panel overflow-x-auto">
          <header className="px-3 py-2 border-b border-border flex items-center justify-between">
            <h3 className="text-xs font-semibold text-text inline-flex items-center gap-1.5">
              <Users size={12} /> Equipes
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void navigate({ to: '/planejamento/equipes' })}
                className="text-2xs font-mono text-text-dim hover:text-text inline-flex items-center gap-1"
                title="Produtividade por serviço e ordem das lanes"
              >
                planejamento <ArrowUpRight size={9} />
              </button>
              {!readOnlyEquipes ? (
                <Button size="sm" variant="secondary" onClick={() => setNovaEquipe(true)}>
                  <Plus size={11} /> Nova
                </Button>
              ) : null}
            </div>
          </header>
          {equipes.length === 0 ? (
            <div className="p-6 text-2xs font-mono text-text-dim text-center">
              Nenhuma equipe cadastrada.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-text-dim font-mono uppercase text-2xs bg-bg">
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-2">Equipe</th>
                  <th className="text-left px-2 py-2">Tipo</th>
                  <th className="text-left px-2 py-2">Encarregado</th>
                  <th className="text-right px-2 py-2">Lançamentos</th>
                  <th className="text-left px-2 py-2">Último</th>
                  <th className="text-left px-2 py-2">Status</th>
                  <th className="px-2 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {equipes.map((e) => {
                  const r = resumoEquipe.get(e.id)
                  return (
                    <tr key={e.id} className="border-b border-border/40 hover:bg-bg-hover">
                      <td className="px-2 py-2">
                        <EquipeChip nome={e.nome} cor={e.cor} />
                      </td>
                      <td className="px-2 py-2 font-mono text-text-muted">{e.tipo}</td>
                      <td className="px-2 py-2 text-text-muted whitespace-nowrap">
                        {e.encarregado_id ? (nomeEnc.get(e.encarregado_id) ?? '—') : '—'}
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
                          >
                            <Pencil size={11} />
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

        {/* Encarregados */}
        <section className="min-w-0 rounded border border-border bg-bg-panel overflow-x-auto">
          <header className="px-3 py-2 border-b border-border flex items-center justify-between">
            <h3 className="text-xs font-semibold text-text inline-flex items-center gap-1.5">
              <HardHat size={12} /> Encarregados
            </h3>
            <Button size="sm" variant="secondary" onClick={() => setNovoEnc(true)}>
              <Plus size={11} /> Novo
            </Button>
          </header>
          {encarregados.length === 0 ? (
            <div className="p-6 text-2xs font-mono text-text-dim text-center">
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
                  <tr key={en.id} className="border-b border-border/40 hover:bg-bg-hover">
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
                      >
                        <Pencil size={11} />
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

function fmtBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
