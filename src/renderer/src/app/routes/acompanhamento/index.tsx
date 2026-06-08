import { type ReactNode, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  RefreshCw, Link2, Link2Off, AlertTriangle, Activity, Camera,
  Gauge, Users, TrendingUp, BarChart3, X, ChevronDown, Search, Check
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { KPICard } from '@/components/charts/KPICard'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { formatNumber, formatDateTimeShort } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  useAcompanhamentoLink,
  useSyncManual,
  useDesvincular,
  useReativarVinculo
} from '@/features/acompanhamento/hooks'
import { useDashboardResumo, useProducoesDashboard } from '@/features/acompanhamento/hooks/dashboard'
import { useFotosGeo } from '@/features/acompanhamento/hooks/fotos'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { useDashboardFiltrosStore, periodoDias } from '@/features/acompanhamento/stores/dashboard-filtros'
import { useMapaPrefsStore } from '@/features/acompanhamento/stores/mapa-prefs'
import { agruparSequencias, producaoSemFoto } from '@/features/acompanhamento/lib/sequencia-ataque'
import { CurvaSAcompanhamento } from '@/features/acompanhamento/components/dashboard/CurvaSAcompanhamento'
import { TopServicosBar } from '@/features/acompanhamento/components/dashboard/TopServicosBar'
import { RankingProdutividade } from '@/features/acompanhamento/components/dashboard/RankingProdutividade'
import { MapaFotosDashboard } from '@/features/acompanhamento/components/dashboard/MapaFotosDashboard'
import { FrentesAtivasLista } from '@/features/acompanhamento/components/dashboard/FrentesAtivasLista'
import { TimelineApontamentos } from '@/features/acompanhamento/components/dashboard/TimelineApontamentos'
import { CalendarHeatmap } from '@/features/acompanhamento/components/dashboard/CalendarHeatmap'
import { AlertasLateral } from '@/features/acompanhamento/components/dashboard/AlertasLateral'
import { PrevistoRealizadoPainel } from '@/features/acompanhamento/components/dashboard/PrevistoRealizadoPainel'
import { AderenciaServicos } from '@/features/acompanhamento/components/dashboard/AderenciaServicos'
import { PorEncarregado } from '@/features/acompanhamento/components/dashboard/PorEncarregado'
import { SYNC_STATUS_LABEL } from '@/types/acompanhamento'
import { useConfirm } from '@/components/modals/ConfirmDialog'

export function AcompanhamentoIndex(): ReactNode {
  return (
    <RequireObra pageTitle="Acompanhamento">
      <DashboardAcompanhamento />
    </RequireObra>
  )
}

function fmtDataHora(s: string | null): string {
  return formatDateTimeShort(s)
}

function DashboardAcompanhamento(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const podeVincular = role === 'god' || role === 'adm'
  const navigate = useNavigate()

  const periodo = useDashboardFiltrosStore((s) => s.periodo)
  const setPeriodo = useDashboardFiltrosStore((s) => s.setPeriodo)
  const dataDe = useDashboardFiltrosStore((s) => s.data_de)
  const dataAte = useDashboardFiltrosStore((s) => s.data_ate)
  const setCustomRange = useDashboardFiltrosStore((s) => s.setCustomRange)
  const servicoItemId = useDashboardFiltrosStore((s) => s.servico_item_id)
  const setServicoItem = useDashboardFiltrosStore((s) => s.setServicoItem)

  // Janela efetiva
  const janela = useMemo(() => {
    if (periodo === 'custom' && dataDe && dataAte) {
      return { dias: diffDias(dataDe, dataAte), de: dataDe, ate: dataAte }
    }
    const dias = periodoDias(periodo)
    const fim = new Date(); fim.setHours(0, 0, 0, 0)
    const ini = new Date(fim); ini.setDate(ini.getDate() - dias + 1)
    return { dias, de: iso(ini), ate: iso(fim) }
  }, [periodo, dataDe, dataAte])

  const { data: link, isLoading: loadingLink } = useAcompanhamentoLink(obraId)
  const { data: resumo, isLoading: loadingResumo } = useDashboardResumo(
    link?.ativo ? obraId : null,
    janela.dias
  )
  const { data: prodsDash = [] } = useProducoesDashboard(
    link?.ativo ? obraId : null,
    janela.de,
    janela.ate,
    servicoItemId
  )
  // Mini-mapa: fotos geo enriquecidas + trechos (KMZ) + sequência de ataque,
  // herdando as preferências da engrenagem (consistência com a página dedicada).
  const { data: fotosGeo = [] } = useFotosGeo(link?.ativo ? obraId : null)
  const { data: trechosMapa = [] } = useObraTrechos(link?.ativo ? obraId : null)
  const mostrarSeqMapa = useMapaPrefsStore((s) => s.mostrarSequenciaAtaque)
  const sequenciasMapa = useMemo(
    () => (mostrarSeqMapa ? agruparSequencias(fotosGeo, prodsDash, trechosMapa) : []),
    [mostrarSeqMapa, fotosGeo, prodsDash, trechosMapa]
  )
  const avisosSemFotoMapa = useMemo(
    () => (mostrarSeqMapa ? producaoSemFoto(fotosGeo, prodsDash) : []),
    [mostrarSeqMapa, fotosGeo, prodsDash]
  )
  const sync = useSyncManual()
  const desvincular = useDesvincular()
  const reativar = useReativarVinculo()
  const confirm = useConfirm()

  const servicoSelecionado = servicoItemId
    ? (resumo?.previsto_realizado ?? []).find((p) => p.item_orcamentario_id === servicoItemId)
    : null

  if (loadingLink) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Acompanhamento" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 p-5 space-y-3">
          <div className="grid grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <PulseBlock key={i} h={88} />)}
          </div>
          <PulseBlock h={280} />
        </div>
      </div>
    )
  }

  if (!link) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Acompanhamento" subtitle={scope.obra?.nome ?? ''} />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="link"
            title="Obra não vinculada ao SIGA"
            description={
              podeVincular
                ? 'Vincule esta obra a um projeto do ERP SIGA para começar a importar produção e fotos automaticamente.'
                : 'A vinculação ao ERP SIGA é feita por um ADM ou GOD. Solicite que faça a vinculação para começar a receber dados.'
            }
            action={
              podeVincular ? (
                <Button variant="default" size="sm" onClick={() => navigate({ to: '/acompanhamento/vincular' })}>
                  <Link2 size={11} /> Vincular agora
                </Button>
              ) : undefined
            }
          />
        </div>
      </div>
    )
  }

  const r = resumo?.resumo
  const sincronizando = sync.isPending || link.ultimo_sync_status === 'rodando'

  // Lista de serviços para o seletor (todos do baseline)
  const listaServicos = (resumo?.previsto_realizado ?? [])
    .filter((p) => p.qtd_plan && p.qtd_plan > 0)
    .map((p) => ({ id: p.item_orcamentario_id, label: `${p.codigo} — ${p.descricao}` }))


  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Dashboard"
        subtitle={`${scope.obra?.nome ?? ''} · SIGA ${link.siga_projeto_codigo}${link.siga_projeto_nome ? ' (' + link.siga_projeto_nome + ')' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-2xs font-mono text-text-dim mr-2">
              <span className={cn(
                'size-1.5 rounded-full',
                link.ultimo_sync_status === 'ok' ? 'bg-emerald-400' :
                link.ultimo_sync_status === 'erro' ? 'bg-red-400' :
                link.ultimo_sync_status === 'rodando' ? 'bg-amber-400 animate-pulse' :
                'bg-text-dim'
              )} />
              {link.ultimo_sync_status ? SYNC_STATUS_LABEL[link.ultimo_sync_status] : 'Sem sync'}
              <span className="ml-1">· {fmtDataHora(link.ultimo_sync_em)}</span>
            </div>
            {link.ativo && (
              <Button
                size="sm"
                variant="default"
                onClick={async () => {
                  try {
                    const r2 = await sync.mutateAsync({ obra_id: obraId })
                    const item = r2.sincronizados[0]
                    if (item?.erro) toast.error(`Sync com erro: ${item.erro}`)
                    else {
                      const s = item?.stats ?? {}
                      toast.success(`Sync OK em ${r2.duracao_ms}ms: ${s.producao_atualizadas ?? 0} prod, ${s.fotos_atualizadas ?? 0} fotos`)
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Falha ao sincronizar')
                  }
                }}
                disabled={sincronizando}
              >
                <RefreshCw size={11} className={sincronizando ? 'animate-spin' : ''} />
                {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
              </Button>
            )}
            {podeVincular && link.ativo && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Desvincular obra do SIGA?',
                    description: 'O histórico de produção e fotos será mantido. Você pode reativar depois sem perder dados.',
                    confirmLabel: 'Desvincular',
                    variant: 'warn'
                  })
                  if (!ok) return
                  await desvincular.mutateAsync({ id: link.id, obra_id: obraId })
                  toast.success('Vínculo desativado.')
                }}
              >
                <Link2Off size={11} /> Desvincular
              </Button>
            )}
            {podeVincular && !link.ativo && (
              <Button
                size="sm"
                variant="default"
                onClick={async () => {
                  await reativar.mutateAsync({ id: link.id, obra_id: obraId })
                  toast.success('Vínculo reativado.')
                }}
              >
                <Link2 size={11} /> Reativar
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        {/* Filtros sticky */}
        <div className="sticky top-0 z-20 bg-bg border-b border-border px-5 py-2 flex flex-wrap items-center gap-3">
          <span className="text-2xs font-mono uppercase text-text-dim">Período</span>
          {(['7d', '30d', '90d'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className={cn(
                'px-2 py-0.5 rounded text-2xs font-mono border transition-colors',
                periodo === p
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-text-dim hover:text-text hover:border-border-strong'
              )}
            >
              {p === '7d' ? 'Última semana' : p === '30d' ? 'Últimos 30d' : 'Últimos 90d'}
            </button>
          ))}
          <DateRangePopover
            from={periodo === 'custom' ? dataDe : null}
            to={periodo === 'custom' ? dataAte : null}
            onChange={(de, ate) => {
              if (de || ate) setCustomRange(de, ate)
              else setPeriodo('30d')
            }}
            placeholder="Personalizado"
          />

          <span className="ml-2 h-4 w-px bg-border" />

          <span className="text-2xs font-mono uppercase text-text-dim">Serviço</span>
          <ServicoSelect
            value={servicoItemId}
            onChange={setServicoItem}
            opcoes={listaServicos}
          />
          {servicoItemId && (
            <button
              onClick={() => setServicoItem(null)}
              className="text-2xs text-text-dim hover:text-danger inline-flex items-center gap-0.5"
              title="Limpar filtro de serviço"
            >
              <X size={9} /> limpar
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {!link.ativo && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-mono text-amber-300">
              Vínculo desativado. Sync automático pausado.
            </div>
          )}
          {link.ultimo_sync_status === 'erro' && link.ultimo_sync_erro && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-red-300 mb-1">Último sync falhou</div>
                <div className="font-mono text-red-200/90 whitespace-pre-wrap">{link.ultimo_sync_erro}</div>
              </div>
            </div>
          )}

          {servicoSelecionado && (
            <div className="rounded border border-accent/40 bg-accent/5 px-3 py-1.5 text-2xs font-mono text-accent inline-flex items-center gap-2">
              <span>Filtro de serviço:</span>
              <strong>{servicoSelecionado.codigo} — {servicoSelecionado.descricao}</strong>
              <button onClick={() => setServicoItem(null)} className="hover:text-danger" title="Limpar">
                <X size={11} />
              </button>
            </div>
          )}

          {/* ─── KPIs ─── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {loadingResumo ? (
              Array.from({ length: 6 }).map((_, i) => <PulseBlock key={i} h={92} />)
            ) : (
              <>
                <KPICard
                  icon={<Gauge size={11} />}
                  label="Avanço físico"
                  value={r?.avanco_pct != null ? `${(Number(r.avanco_pct) * 100).toFixed(1)}%` : '—'}
                  hint={r?.avanco_pct == null ? 'sem baseline ativo' : 'ponderado por receita'}
                />
                {(() => {
                  // Compute total + dias_trabalhados respeitando o filtro de servico.
                  // Velocidade = total / dias com producao > 0 dentro da janela
                  // (dias TRABALHADOS, nao dias do calendario).
                  const pontos = (resumo?.curva_s ?? []).filter(
                    (p) => !servicoItemId || p.item_orcamentario_id === servicoItemId
                  )
                  let totalProd = 0
                  const diasComProd = new Set<string>()
                  for (const p of pontos) {
                    const real = Number(p.realizado_dia ?? 0)
                    if (real > 0) {
                      totalProd += real
                      diasComProd.add(p.data)
                    }
                  }
                  const diasTrabalhados = diasComProd.size
                  const velocidade = diasTrabalhados > 0 ? totalProd / diasTrabalhados : 0
                  return (
                    <>
                      <KPICard
                        icon={<Activity size={11} />}
                        label={`Produção ${periodo === 'custom' ? 'período' : periodo}`}
                        value={formatNumber(totalProd, 0)}
                        hint={`${diasTrabalhados} ${diasTrabalhados === 1 ? 'dia trabalhado' : 'dias trabalhados'}`}
                      />
                      <KPICard
                        icon={<TrendingUp size={11} />}
                        label="Velocidade"
                        value={formatNumber(velocidade, 0)}
                        unit="/dia trab."
                        hint={diasTrabalhados > 0 ? 'média por dia trabalhado' : 'sem produção no período'}
                      />
                    </>
                  )
                })()}
                <KPICard
                  icon={<Users size={11} />}
                  label="Equipes hoje"
                  value={String(r?.equipes_ativas_hoje ?? 0)}
                  hint={`${r?.equipes_ativas_semana ?? 0} esta semana`}
                />
                <KPICard
                  icon={<Camera size={11} />}
                  label="Cobertura fotos"
                  value={r?.cobertura_fotografica_pct != null
                    ? `${(Number(r.cobertura_fotografica_pct) * 100).toFixed(0)}%`
                    : '—'}
                  hint={`${r?.fotos_com_geo ?? 0} com GPS`}
                />
                <KPICard
                  icon={<AlertTriangle size={11} />}
                  label="Alertas críticos"
                  value={String(r?.alertas_criticos ?? 0)}
                  hint={`${r?.alertas_abertos_total ?? 0} alertas abertos`}
                />
              </>
            )}
          </div>

          {/* ─── Hero curva-S + Alertas lateral ─── */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-3">
            <div className="rounded border border-border bg-bg-panel p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-text flex items-center gap-1.5">
                  <BarChart3 size={11} /> Curva-S · Realizado × Previsto
                  {servicoSelecionado && (
                    <span className="text-2xs font-mono text-accent ml-1">
                      · {servicoSelecionado.codigo} {servicoSelecionado.descricao}
                    </span>
                  )}
                </h3>
              </div>
              {loadingResumo
                ? <PulseBlock h={280} />
                : <CurvaSAcompanhamento
                    pontos={(resumo?.curva_s ?? []).filter((p) => !servicoItemId || p.item_orcamentario_id === servicoItemId)}
                  />}
            </div>
            <AlertasLateral
              alertas={resumo?.alertas_criticos ?? []}
              obraId={obraId}
              altura={316}
            />
          </div>

          {/* ─── Previsto x Realizado + Aderência por serviço ─── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <PrevistoRealizadoPainel
              curvaS={resumo?.curva_s ?? []}
              prevReal={resumo?.previsto_realizado ?? []}
              filtroItemId={servicoItemId}
              periodoDias={janela.dias}
              dataDeCustom={periodo === 'custom' ? dataDe : null}
              dataAteCustom={periodo === 'custom' ? dataAte : null}
              altura={200}
            />
            <AderenciaServicos
              itens={resumo?.previsto_realizado ?? []}
              curvaS={resumo?.curva_s ?? []}
              dataAte={janela.ate}
              selectedId={servicoItemId}
              onPick={setServicoItem}
              altura={200}
            />
            <TopServicosBar
              itens={resumo?.previsto_realizado ?? []}
              limit={6}
              selectedId={servicoItemId}
              onPick={setServicoItem}
              altura={200}
            />
          </div>

          {/* ─── Produtividade equipe + Encarregados + Frentes ─── */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <RankingProdutividade itens={resumo?.produtividade_equipes ?? []} altura={220} />
            <PorEncarregado producoes={prodsDash} filtroItemId={servicoItemId} altura={220} />
            <FrentesAtivasLista frentes={resumo?.frentes ?? []} altura={220} />
          </div>

          {/* ─── Timeline + Cobertura fotográfica ─── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TimelineApontamentos itens={resumo?.ultimos_apontamentos ?? []} altura={220} />
            <CalendarHeatmap data={resumo?.cobertura_mes ?? []} altura={220} />
          </div>

          {/* ─── Mapa de fotos (full-width na parte inferior) ─── */}
          <MapaFotosDashboard
            fotos={fotosGeo}
            trechos={trechosMapa}
            sequencias={sequenciasMapa}
            avisosSemFoto={avisosSemFotoMapa}
            altura={420}
          />
        </div>
      </div>
    </div>
  )
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function diffDias(de: string, ate: string): number {
  const a = new Date(de + 'T00:00:00')
  const b = new Date(ate + 'T00:00:00')
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1)
}

/** Combobox custom para serviços — substitui o <select> nativo que renderiza branco em Electron. */
function ServicoSelect({
  value,
  onChange,
  opcoes
}: {
  value: string | null
  onChange: (id: string | null) => void
  opcoes: Array<{ id: string; label: string }>
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState('')
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return opcoes
    return opcoes.filter((o) => o.label.toLowerCase().includes(q))
  }, [opcoes, busca])
  const selecionado = value ? opcoes.find((o) => o.id === value) : null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded border text-2xs font-mono min-w-[240px] max-w-[300px]',
          value
            ? 'border-accent/50 text-text bg-accent/5 hover:border-accent'
            : 'border-border text-text-dim hover:text-text hover:border-border-strong'
        )}
      >
        <span className="flex-1 text-left truncate">
          {selecionado ? selecionado.label : 'Todos os serviços'}
        </span>
        <ChevronDown size={11} className="shrink-0 text-text-dim" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => { setOpen(false); setBusca('') }} />
          <div className="absolute top-full mt-1 left-0 z-40 bg-bg-elevated border border-border-strong rounded shadow-xl w-[340px] max-h-[320px] overflow-hidden flex flex-col">
            <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5">
              <Search size={11} className="text-text-dim" />
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar serviço…"
                className="bg-transparent flex-1 text-2xs font-mono text-text outline-none placeholder:text-text-dim"
              />
            </div>
            <div className="overflow-auto flex-1 p-1">
              <button
                onClick={() => { onChange(null); setOpen(false); setBusca('') }}
                className={cn(
                  'w-full text-left px-2 py-1 rounded text-2xs font-mono flex items-center gap-1.5',
                  value == null ? 'bg-accent/15 text-accent' : 'text-text-dim hover:bg-bg-hover hover:text-text'
                )}
              >
                {value == null && <Check size={10} />}
                {value != null && <span className="size-2.5 shrink-0" />}
                — Todos os serviços —
              </button>
              {filtradas.length === 0 && (
                <div className="text-2xs font-mono text-text-dim p-2 text-center">sem resultados</div>
              )}
              {filtradas.map((o) => {
                const sel = value === o.id
                return (
                  <button
                    key={o.id}
                    onClick={() => { onChange(o.id); setOpen(false); setBusca('') }}
                    className={cn(
                      'w-full text-left px-2 py-1 rounded text-2xs font-mono flex items-center gap-1.5',
                      sel ? 'bg-accent/15 text-accent' : 'text-text hover:bg-bg-hover'
                    )}
                  >
                    {sel ? <Check size={10} /> : <span className="size-2.5 shrink-0" />}
                    <span className="truncate">{o.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
