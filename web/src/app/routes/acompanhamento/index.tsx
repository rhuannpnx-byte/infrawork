import { AvisoSemLinhaDeBase } from '@/features/acompanhamento/components/AvisoSemLinhaDeBase'
import { type ReactNode, useEffect, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { Button } from '@/components/ui/button'
import { Segmentado } from '@/components/ui/segmentado'
import { FiltroUnico } from '@/components/ui/filtros'
import { Secao } from '@/components/ui/secao'
import { BarraAvanco, FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { ErroConsulta, EstadoConsulta } from '@/components/ui/estado'
import { CurvaS, reaisCurto } from '@/components/charts/CurvaS'
import { useCurvaSValor } from '@/features/acompanhamento/hooks/curva-valor'
import { useProducao } from '@/features/acompanhamento/hooks/producao'
import { useBaseline } from '@/features/planejamento/hooks/planejamentos'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { FaixaObra } from '@/features/painel/FaixaObra'
import { useFaixasPrevistas } from '@/features/painel/faixas-previstas'
import { contar } from '@/lib/rotulos'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'
import {
  useDashboardResumo,
  useProducoesDashboard
} from '@/features/acompanhamento/hooks/dashboard'
import { useFotosGeo } from '@/features/acompanhamento/hooks/fotos'
import {
  useDashboardFiltrosStore,
  periodoDias
} from '@/features/acompanhamento/stores/dashboard-filtros'
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

export function AcompanhamentoIndex(): ReactNode {
  // O cliente não vê o dashboard: para ele o módulo abre no calendário previsto e executado.
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const navigate = useNavigate()
  useEffect(() => {
    if (role === 'cliente') void navigate({ to: '/acompanhamento/calendario', replace: true })
  }, [role, navigate])
  if (role === 'cliente') return null

  return (
    <RequireObra pageTitle="Acompanhamento">
      <DashboardAcompanhamento />
    </RequireObra>
  )
}

function DashboardAcompanhamento(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!

  const periodo = useDashboardFiltrosStore((s) => s.periodo)
  const setPeriodo = useDashboardFiltrosStore((s) => s.setPeriodo)
  const dataDe = useDashboardFiltrosStore((s) => s.data_de)
  const dataAte = useDashboardFiltrosStore((s) => s.data_ate)
  const setCustomRange = useDashboardFiltrosStore((s) => s.setCustomRange)
  const servicoItemId = useDashboardFiltrosStore((s) => s.servico_item_id)
  const setServicoItem = useDashboardFiltrosStore((s) => s.setServicoItem)

  const janela = useMemo(() => {
    if (periodo === 'custom' && dataDe && dataAte) {
      return { dias: diffDias(dataDe, dataAte), de: dataDe, ate: dataAte }
    }
    const dias = periodoDias(periodo)
    const fim = new Date()
    fim.setHours(0, 0, 0, 0)
    const ini = new Date(fim)
    ini.setDate(ini.getDate() - dias + 1)
    return { dias, de: iso(ini), ate: iso(fim) }
  }, [periodo, dataDe, dataAte])

  const consultaResumo = useDashboardResumo(obraId, janela.dias)
  const curvaValor = useCurvaSValor(obraId)
  const { data: linhaBase } = useBaseline(obraId)
  const { data: trechosObra = [] } = useObraTrechos(obraId)
  const { data: producaoObra = [] } = useProducao(obraId)
  const { data: faixasPrevistas = [] } = useFaixasPrevistas(linhaBase?.id)
  const { data: resumo, isLoading: loadingResumo } = consultaResumo
  const { data: prodsDash = [] } = useProducoesDashboard(
    obraId,
    janela.de,
    janela.ate,
    servicoItemId
  )
  const { data: fotosGeo = [] } = useFotosGeo(obraId)
  const mostrarSeqMapa = useMapaPrefsStore((s) => s.mostrarSequenciaAtaque)
  const sequenciasMapa = useMemo(
    () => (mostrarSeqMapa ? agruparSequencias(fotosGeo, prodsDash) : []),
    [mostrarSeqMapa, fotosGeo, prodsDash]
  )
  const avisosSemFotoMapa = useMemo(
    () => (mostrarSeqMapa ? producaoSemFoto(fotosGeo, prodsDash) : []),
    [mostrarSeqMapa, fotosGeo, prodsDash]
  )

  const servicoSelecionado = servicoItemId
    ? (resumo?.previsto_realizado ?? []).find((p) => p.item_orcamentario_id === servicoItemId)
    : null

  const r = resumo?.resumo

  const listaServicos = (resumo?.previsto_realizado ?? [])
    .filter((p) => p.qtd_plan && p.qtd_plan > 0)
    .map((p) => ({ id: p.item_orcamentario_id, label: `${p.codigo} · ${p.descricao}` }))

  // Produção e ritmo só fazem sentido para um serviço (uma unidade). Sem filtro, o indicador é de dias com produção.
  const ritmo = useMemo(() => {
    let total = 0
    const dias = new Set<string>()
    for (const p of resumo?.curva_s ?? []) {
      if (servicoItemId && p.item_orcamentario_id !== servicoItemId) continue
      const real = Number(p.realizado_dia ?? 0)
      if (real > 0) {
        total += real
        dias.add(p.data)
      }
    }
    return { total, dias: dias.size, porDia: dias.size > 0 ? total / dias.size : 0 }
  }, [resumo, servicoItemId])

  const criticos = r?.alertas_criticos ?? 0
  const curvaFiltrada = (resumo?.curva_s ?? []).filter(
    (p) => !servicoItemId || p.item_orcamentario_id === servicoItemId
  )
  // o resumo falhou e não há dado anterior: os blocos que dependem dele saem, em vez de dizer "nenhum"
  const semResumo = !!consultaResumo.error && !resumo
  // enquanto o resumo carrega, o bloco mostra o esqueleto e não o texto de vazio
  const comResumo = (altura: number, bloco: ReactNode): ReactNode =>
    loadingResumo ? <PulseBlock h={altura} /> : semResumo ? null : bloco

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Dashboard" />
      <AvisoSemLinhaDeBase obraId={obraId} />

      <div className="flex-1 overflow-auto">
        <div className="sticky top-0 z-20 bg-bg border-b border-border px-5 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-muted">Período</span>
            <Segmentado
              rotulo="Período"
              tamanho="sm"
              valor={periodo === 'custom' ? null : periodo}
              aoMudar={setPeriodo}
              opcoes={[
                { valor: '7d', rotulo: '7 dias' },
                { valor: '30d', rotulo: '30 dias' },
                { valor: '90d', rotulo: '90 dias' }
              ]}
            />
            <DateRangePopover
              from={periodo === 'custom' ? dataDe : null}
              to={periodo === 'custom' ? dataAte : null}
              onChange={(de, ate) => {
                if (de || ate) setCustomRange(de, ate)
                else setPeriodo('30d')
              }}
              placeholder="Outro período"
            />
          </div>
          <FiltroUnico
            rotulo="Serviço"
            todos="Todos os serviços"
            opcoes={listaServicos.map((o) => ({ valor: o.id, rotulo: o.label }))}
            valor={servicoItemId}
            aoMudar={setServicoItem}
          />
          {servicoItemId ? (
            <Button variant="ghost" size="sm" onClick={() => setServicoItem(null)}>
              <X size={12} /> Limpar
            </Button>
          ) : null}
        </div>

        <div className="p-5 flex flex-col gap-6">
          {consultaResumo.error ? (
            <ErroConsulta
              erro={consultaResumo.error}
              oQue="o resumo da obra"
              aoTentar={() => void consultaResumo.refetch()}
            />
          ) : null}

          {semResumo ? null : (
            <FaixaIndicadores rotulo="Indicadores do período">
              <Indicador
                rotulo="Avanço físico"
                carregando={loadingResumo}
                valor={
                  r?.avanco_pct != null ? `${formatNumber(Number(r.avanco_pct) * 100, 1)}%` : '—'
                }
              >
                {r?.avanco_pct != null ? <BarraAvanco valor={Number(r.avanco_pct)} /> : null}
                <span>
                  {r?.avanco_pct == null ? 'sem linha de base vigente' : 'ponderado pela receita'}
                </span>
              </Indicador>
              {servicoSelecionado ? (
                <>
                  <Indicador
                    rotulo="Produção no período"
                    carregando={loadingResumo}
                    valor={formatNumber(ritmo.total, 0)}
                    unidade={servicoSelecionado.unidade ?? undefined}
                  >
                    <span>{contar(ritmo.dias, 'dia trabalhado', 'dias trabalhados')}</span>
                  </Indicador>
                  <Indicador
                    rotulo="Ritmo"
                    carregando={loadingResumo}
                    valor={formatNumber(ritmo.porDia, 0)}
                    unidade={`${servicoSelecionado.unidade ?? ''}/dia`}
                  >
                    <span>
                      {ritmo.dias > 0 ? 'média por dia trabalhado' : 'sem produção no período'}
                    </span>
                  </Indicador>
                </>
              ) : (
                <Indicador
                  rotulo="Dias com produção"
                  carregando={loadingResumo}
                  valor={formatNumber(ritmo.dias, 0)}
                  unidade={`de ${janela.dias}`}
                >
                  <span>escolha um serviço para ver a produção e o ritmo</span>
                </Indicador>
              )}
              <Indicador
                rotulo="Equipes hoje"
                carregando={loadingResumo}
                valor={formatNumber(r?.equipes_ativas_hoje ?? 0, 0)}
              >
                <span>{r?.equipes_ativas_semana ?? 0} nesta semana</span>
              </Indicador>
              <Indicador
                rotulo="Cobertura de fotos"
                carregando={loadingResumo}
                valor={
                  r?.cobertura_fotografica_pct != null
                    ? `${formatNumber(Number(r.cobertura_fotografica_pct) * 100, 0)}%`
                    : '—'
                }
              >
                <span>{contar(r?.fotos_com_geo ?? 0, 'foto com GPS', 'fotos com GPS')}</span>
              </Indicador>
              <Indicador
                rotulo="Alertas críticos"
                carregando={loadingResumo}
                tom={criticos > 0 ? 'danger' : 'neutro'}
                valor={formatNumber(criticos, 0)}
              >
                <span>
                  {contar(r?.alertas_abertos_total ?? 0, 'alerta aberto', 'alertas abertos')}
                </span>
              </Indicador>
            </FaixaIndicadores>
          )}

          <Grupo titulo="Prazo e avanço">
            <div
              className={
                semResumo
                  ? 'grid grid-cols-1 gap-3'
                  : 'grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3'
              }
            >
              <Secao
                titulo="Curva S"
                nota={
                  servicoSelecionado
                    ? `${servicoSelecionado.codigo} · ${servicoSelecionado.descricao}`
                    : 'valor previsto e executado, acumulados por semana'
                }
              >
                {servicoSelecionado ? (
                  loadingResumo ? (
                    <PulseBlock h={280} />
                  ) : (
                    <CurvaSAcompanhamento
                      pontos={curvaFiltrada}
                      unidade={servicoSelecionado.unidade}
                    />
                  )
                ) : (
                  <EstadoConsulta
                    consulta={curvaValor}
                    oQue="a curva S"
                    vazio={curvaValor.pontos.length === 0}
                    textoVazio="A curva S aparece quando a obra tem linha de base vigente com o cronograma calculado."
                  >
                    <CurvaS
                      pontos={curvaValor.pontos}
                      formatar={reaisCurto}
                      rotuloRealizado="Executado"
                    />
                  </EstadoConsulta>
                )}
              </Secao>
              {comResumo(
                352,
                <AlertasLateral
                  alertas={resumo?.alertas_criticos ?? []}
                  obraId={obraId}
                  altura={352}
                />
              )}
            </div>
            <FaixaObra producao={producaoObra} trechos={trechosObra} previsto={faixasPrevistas} />
          </Grupo>

          {semResumo ? null : (
            <Grupo titulo="Serviços">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {comResumo(
                  220,
                  <PrevistoRealizadoPainel
                    curvaS={resumo?.curva_s ?? []}
                    prevReal={resumo?.previsto_realizado ?? []}
                    filtroItemId={servicoItemId}
                    periodoDias={janela.dias}
                    dataDeCustom={periodo === 'custom' ? dataDe : null}
                    dataAteCustom={periodo === 'custom' ? dataAte : null}
                    valor={curvaValor.pontos}
                    altura={220}
                  />
                )}
                {comResumo(
                  220,
                  <AderenciaServicos
                    itens={resumo?.previsto_realizado ?? []}
                    curvaS={resumo?.curva_s ?? []}
                    dataAte={janela.ate}
                    selectedId={servicoItemId}
                    onPick={setServicoItem}
                    altura={220}
                  />
                )}
                {comResumo(
                  220,
                  <TopServicosBar
                    itens={resumo?.previsto_realizado ?? []}
                    limit={6}
                    selectedId={servicoItemId}
                    onPick={setServicoItem}
                    altura={220}
                  />
                )}
              </div>
            </Grupo>
          )}

          <Grupo titulo="Equipes e frentes">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {comResumo(
                240,
                <RankingProdutividade itens={resumo?.produtividade_equipes ?? []} altura={240} />
              )}
              <PorEncarregado producoes={prodsDash} filtroItemId={servicoItemId} altura={240} />
              {comResumo(240, <FrentesAtivasLista frentes={resumo?.frentes ?? []} altura={240} />)}
            </div>
          </Grupo>

          <Grupo titulo="Registros de campo">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {comResumo(
                240,
                <TimelineApontamentos itens={resumo?.ultimos_apontamentos ?? []} altura={240} />
              )}
              {comResumo(240, <CalendarHeatmap data={resumo?.cobertura_mes ?? []} altura={240} />)}
            </div>
            <MapaFotosDashboard
              fotos={fotosGeo}
              sequencias={sequenciasMapa}
              avisosSemFoto={avisosSemFotoMapa}
              altura={420}
            />
          </Grupo>
        </div>
      </div>
    </div>
  )
}

/** Grupo de blocos do dashboard, com o rótulo de seção sobre uma linha. */
function Grupo({ titulo, children }: { titulo: string; children: ReactNode }): ReactNode {
  return (
    <section aria-label={titulo} className="flex flex-col gap-3">
      <h2 className="flex items-center gap-3 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
        {titulo}
        <span aria-hidden className="h-px flex-1 bg-border-strong" />
      </h2>
      {children}
    </section>
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
