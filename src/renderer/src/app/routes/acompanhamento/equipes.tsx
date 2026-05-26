import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Link2Off } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import {
  useMatchingSugestoes, useConfirmarMatch
} from '@/features/acompanhamento/hooks/matching'
import { useEquipes } from '@/features/planejamento/hooks/equipes'
import { MatchStatusBadge } from '@/features/acompanhamento/components/equipes/MatchStatusBadge'
import { unidadesEquivalentes, exibirUnidade } from '@/features/acompanhamento/lib/unidades'
import { TabPill } from '@/components/ui/TabPill'
import { cn } from '@/lib/utils'

type Tab = 'equipes' | 'encarregados' | 'servicos'

export function AcompanhamentoEquipesPage(): ReactNode {
  return (
    <RequireObra pageTitle="Equipes & Vínculos">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const [tab, setTab] = useState<Tab>('equipes')
  const { data: sugestoes, isLoading, refetch } = useMatchingSugestoes(obraId)
  const { data: equipesPlan = [] } = useEquipes(obraId)
  const confirmar = useConfirmarMatch()

  const equipesNaoVinc = useMemo(
    () => (sugestoes?.equipes ?? []).filter((e) => !e.match_atual?.equipe_id),
    [sugestoes]
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Vínculos SIGA × Planejamento"
        subtitle={`${scope.obra?.nome ?? ''}`}
        actions={
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>
            <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} /> Recalcular sugestões
          </Button>
        }
      />

      {equipesNaoVinc.length > 0 && (
        <div className="px-5 pt-3">
          <div className="rounded border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-mono text-amber-300">
            {equipesNaoVinc.length} equipe(s) sem vínculo. Vincule para aproveitar comparações previsto×realizado.
          </div>
        </div>
      )}

      <div className="border-b border-border px-5 flex items-center gap-4 bg-bg-panel" role="tablist">
        {(['equipes', 'encarregados', 'servicos'] as Tab[]).map((t) => (
          <TabPill key={t} active={tab === t} onClick={() => setTab(t)}>
            {t === 'equipes' ? 'Equipes' : t === 'encarregados' ? 'Encarregados' : 'Serviços'}
            <span className="text-text-dim ml-2">
              ({tab === t ? (sugestoes?.[t]?.length ?? 0) : ''})
            </span>
          </TabPill>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-5">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <PulseBlock key={i} h={60} />)}
          </div>
        )}

        {!isLoading && tab === 'equipes' && (
          <table className="w-full text-xs">
            <thead className="text-text-dim text-2xs font-mono uppercase">
              <tr>
                <th className="text-left px-2 py-1.5">Nome SIGA</th>
                <th className="text-left px-2 py-1.5">Status</th>
                <th className="text-left px-2 py-1.5">Vincular</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(sugestoes?.equipes ?? []).map((eq) => {
                const top = eq.candidatos[0]
                const matchAtual = eq.match_atual
                const vinculadoNome = matchAtual?.equipe_id
                  ? equipesPlan.find((e) => e.id === matchAtual.equipe_id)?.nome ?? '—'
                  : null
                return (
                  <tr key={eq.siga_nome} className="hover:bg-bg-hover/50">
                    <td className="px-2 py-2">
                      <span className="font-mono text-text">{eq.siga_nome}</span>
                    </td>
                    <td className="px-2 py-2">
                      <MatchStatusBadge
                        vinculadoA={vinculadoNome}
                        origem={matchAtual?.origem ?? null}
                        sugestao={!vinculadoNome && top ? { nome: top.nome, confianca: top.confianca } : null}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono w-[220px]"
                        value={matchAtual?.equipe_id ?? ''}
                        onChange={async (e) => {
                          const v = e.target.value || null
                          try {
                            await confirmar.mutateAsync({
                              obra_id: obraId,
                              matches: [{ tipo: 'equipe', siga_nome: eq.siga_nome, equipe_id: v }],
                              origem: 'manual'
                            })
                            toast.success(v ? 'Vínculo salvo' : 'Marcado como não vincular')
                          } catch (er) { toast.error(er instanceof Error ? er.message : 'Erro') }
                        }}
                      >
                        <option value="">— Sem vínculo —</option>
                        {equipesPlan.filter((e) => e.ativo).map((e) => (
                          <option key={e.id} value={e.id}>{e.nome}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {top && !matchAtual?.equipe_id && (
                        <Button size="sm" variant="ghost"
                          onClick={async () => {
                            try {
                              await confirmar.mutateAsync({
                                obra_id: obraId,
                                matches: [{ tipo: 'equipe', siga_nome: eq.siga_nome, equipe_id: top.id, confianca: top.confianca }],
                                origem: 'manual'
                              })
                              toast.success('Sugestão aceita')
                            } catch (er) { toast.error(er instanceof Error ? er.message : 'Erro') }
                          }}
                        >
                          Aceitar sugestão
                        </Button>
                      )}
                      {matchAtual?.equipe_id && (
                        <Button size="sm" variant="ghost"
                          onClick={async () => {
                            try {
                              await confirmar.mutateAsync({
                                obra_id: obraId,
                                matches: [{ tipo: 'equipe', siga_nome: eq.siga_nome, equipe_id: null }],
                                origem: 'manual'
                              })
                              toast.success('Desvinculado')
                            } catch (er) { toast.error(er instanceof Error ? er.message : 'Erro') }
                          }}
                        >
                          <Link2Off size={11} /> Desvincular
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {(sugestoes?.equipes ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-2 py-6 text-center text-text-dim text-2xs font-mono">Sem equipes detectadas</td></tr>
              )}
            </tbody>
          </table>
        )}

        {!isLoading && tab === 'encarregados' && (
          <table className="w-full text-xs">
            <thead className="text-text-dim text-2xs font-mono uppercase">
              <tr>
                <th className="text-left px-2 py-1.5">Nome SIGA</th>
                <th className="text-left px-2 py-1.5">Apelido canônico</th>
                <th className="text-left px-2 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(sugestoes?.encarregados ?? []).map((enc) => {
                const vinc = enc.match_atual?.origem === 'manual'
                return (
                  <tr key={enc.siga_nome} className="hover:bg-bg-hover/50">
                    <td className="px-2 py-2 font-mono text-text">{enc.siga_nome}</td>
                    <td className="px-2 py-2">
                      <input
                        defaultValue={enc.apelido_canonico_sugerido}
                        className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono w-[260px]"
                        onBlur={async (e) => {
                          if (e.target.value === enc.apelido_canonico_sugerido && vinc) return
                          try {
                            await confirmar.mutateAsync({
                              obra_id: obraId,
                              matches: [{ tipo: 'encarregado', siga_nome: enc.siga_nome, apelido_canonico: e.target.value }],
                              origem: 'manual'
                            })
                            toast.success('Encarregado vinculado')
                          } catch (er) { toast.error(er instanceof Error ? er.message : 'Erro') }
                        }}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <MatchStatusBadge
                        vinculadoA={vinc ? enc.apelido_canonico_sugerido : null}
                        origem={enc.match_atual?.origem ?? null}
                        sugestao={!vinc ? { nome: enc.apelido_canonico_sugerido, confianca: 1 } : null}
                      />
                    </td>
                  </tr>
                )
              })}
              {(sugestoes?.encarregados ?? []).length === 0 && (
                <tr><td colSpan={3} className="px-2 py-6 text-center text-text-dim text-2xs font-mono">Sem encarregados detectados</td></tr>
              )}
            </tbody>
          </table>
        )}

        {!isLoading && tab === 'servicos' && (
          <ServicosTable
            servicos={sugestoes?.servicos ?? []}
            obraId={obraId}
            onConfirm={confirmar.mutateAsync}
          />
        )}
      </div>
    </div>
  )
}

function ServicosTable({
  servicos,
  obraId,
  onConfirm
}: {
  servicos: NonNullable<ReturnType<typeof useMatchingSugestoes>['data']>['servicos']
  obraId: string
  onConfirm: ReturnType<typeof useConfirmarMatch>['mutateAsync']
}): ReactNode {
  return (
    <table className="w-full text-xs">
      <thead className="text-text-dim text-2xs font-mono uppercase">
        <tr>
          <th className="text-left px-2 py-1.5">Serviço SIGA</th>
          <th className="text-left px-2 py-1.5">Unidade SIGA</th>
          <th className="text-left px-2 py-1.5">Status</th>
          <th className="text-left px-2 py-1.5">Vincular ao serviço do orçamento</th>
          <th className="text-left px-2 py-1.5">Unidade plano</th>
          <th className="text-left px-2 py-1.5" title="Multiplicador aplicado à qtd do SIGA antes de comparar com o plano (ex.: 2.4 para m²→T)">
            Fator conversão
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {servicos.map((srv) => (
          <ServicoLinha key={srv.siga_id} srv={srv} obraId={obraId} onConfirm={onConfirm} />
        ))}
        {servicos.length === 0 && (
          <tr><td colSpan={6} className="px-2 py-6 text-center text-text-dim text-2xs font-mono">Sem serviços detectados</td></tr>
        )}
      </tbody>
    </table>
  )
}

function ServicoLinha({
  srv,
  obraId,
  onConfirm
}: {
  srv: NonNullable<ReturnType<typeof useMatchingSugestoes>['data']>['servicos'][number]
  obraId: string
  onConfirm: ReturnType<typeof useConfirmarMatch>['mutateAsync']
}): ReactNode {
  const top = srv.candidatos[0]
  const matchAtual = srv.match_atual
  const vinculado = matchAtual?.servico_id ?? null
  const candidatoSelecionado = vinculado ? srv.candidatos.find((c) => c.id === vinculado) : null
  const unidadeOrcamento = candidatoSelecionado?.unidade_orcamento ?? null
  const fatorAtual = matchAtual?.fator_conversao ?? 1
  const [fatorDraft, setFatorDraft] = useState<string>(String(fatorAtual))
  const fatorDiff = Number(fatorDraft) !== fatorAtual && !Number.isNaN(Number(fatorDraft)) && Number(fatorDraft) > 0
  const unidadeDifere = !!unidadeOrcamento && !!srv.siga_unidade_nome
    && !unidadesEquivalentes(unidadeOrcamento, srv.siga_unidade_nome)

  async function salvarVinculo(novoServicoId: string | null): Promise<void> {
    const cand = novoServicoId ? srv.candidatos.find((c) => c.id === novoServicoId) : null
    try {
      await onConfirm({
        obra_id: obraId,
        matches: [{
          tipo: 'servico',
          siga_id: srv.siga_id,
          siga_nome: srv.siga_nome,
          servico_id: novoServicoId,
          item_orcamentario_id: cand?.item_orcamentario_id ?? null,
          fator_conversao: Number(fatorDraft) > 0 ? Number(fatorDraft) : 1,
          siga_unidade_id: srv.siga_unidade_id,
          siga_unidade_nome: srv.siga_unidade_nome
        }],
        origem: 'manual'
      })
      toast.success(novoServicoId ? 'Vínculo salvo' : 'Marcado como não vincular')
    } catch (er) { toast.error(er instanceof Error ? er.message : 'Erro') }
  }

  async function salvarFator(): Promise<void> {
    if (!vinculado) { toast.error('Vincule primeiro a um serviço do orçamento'); return }
    const v = Number(fatorDraft)
    if (!Number.isFinite(v) || v <= 0) { toast.error('Fator deve ser número positivo'); return }
    try {
      await onConfirm({
        obra_id: obraId,
        matches: [{
          tipo: 'servico',
          siga_id: srv.siga_id,
          siga_nome: srv.siga_nome,
          servico_id: vinculado,
          item_orcamentario_id: candidatoSelecionado?.item_orcamentario_id ?? matchAtual?.item_orcamentario_id ?? null,
          fator_conversao: v,
          siga_unidade_id: srv.siga_unidade_id,
          siga_unidade_nome: srv.siga_unidade_nome
        }],
        origem: 'manual'
      })
      toast.success(`Fator atualizado: ×${v}`)
    } catch (er) { toast.error(er instanceof Error ? er.message : 'Erro') }
  }

  return (
    <tr className="hover:bg-bg-hover/50 align-top">
      <td className="px-2 py-2">
        <div className="font-mono text-text">{srv.siga_nome}</div>
        <div className="text-2xs font-mono text-text-dim">id {srv.siga_id}</div>
      </td>
      <td className="px-2 py-2">
        {srv.siga_unidade_nome ? (
          <span
            className={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono border',
              unidadeDifere
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-bg/40 text-text-dim border-border'
            )}
            title={`SIGA: ${srv.siga_unidade_nome}`}
          >
            {exibirUnidade(srv.siga_unidade_nome)}
          </span>
        ) : <span className="text-2xs font-mono text-text-dim">—</span>}
      </td>
      <td className="px-2 py-2">
        <MatchStatusBadge
          vinculadoA={vinculado ? candidatoSelecionado?.nome ?? 'vinculado' : null}
          origem={matchAtual?.origem ?? null}
          sugestao={!vinculado && top ? { nome: top.nome, confianca: top.confianca } : null}
        />
      </td>
      <td className="px-2 py-2">
        <select
          className="bg-bg border border-border rounded px-2 py-1 text-xs font-mono w-[320px]"
          value={vinculado ?? ''}
          onChange={(e) => salvarVinculo(e.target.value || null)}
        >
          <option value="">— Sem vínculo —</option>
          {srv.candidatos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome} {c.motivo === 'referencia_externa' ? '(ref. externa)' : `(${Math.round(c.confianca * 100)}%)`}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        {unidadeOrcamento ? (
          <span
            className={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono border',
              unidadeDifere
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            )}
            title={`Orçamento: ${unidadeOrcamento}`}
          >
            {exibirUnidade(unidadeOrcamento)}
          </span>
        ) : <span className="text-2xs font-mono text-text-dim">—</span>}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step="0.0001"
            min="0.0001"
            value={fatorDraft}
            onChange={(e) => setFatorDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void salvarFator() }}
            disabled={!vinculado}
            className={cn(
              'bg-bg border rounded px-2 py-1 text-xs font-mono w-[88px] tabular-nums',
              fatorDiff ? 'border-amber-500/60' : 'border-border',
              !vinculado && 'opacity-40 cursor-not-allowed'
            )}
            title="Multiplicador aplicado a qtd_real_SIGA antes do comparativo com o plano"
          />
          {fatorDiff && (
            <button
              onClick={() => void salvarFator()}
              className="text-2xs font-mono px-1.5 py-0.5 rounded border border-amber-500/60 text-amber-300 hover:bg-amber-500/10"
            >
              salvar
            </button>
          )}
          {unidadeDifere && !fatorDiff && fatorAtual === 1 && (
            <span className="text-2xs font-mono text-amber-300" title="Unidades divergentes: ajuste o fator">
              ⚠
            </span>
          )}
        </div>
        {srv.siga_unidade_nome && unidadeOrcamento && (
          <div className="text-2xs font-mono text-text-dim mt-0.5">
            {exibirUnidade(srv.siga_unidade_nome)} → {exibirUnidade(unidadeOrcamento)}
            {!unidadeDifere && (
              <span className="ml-1 text-emerald-400" title="Unidades equivalentes">✓</span>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}
