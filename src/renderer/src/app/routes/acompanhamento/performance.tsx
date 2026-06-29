import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Users, HardHat, Gauge, CalendarRange, Trophy, Activity, Flame, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { KPICard } from '@/components/charts/KPICard'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'
import {
  useProducaoPerformance,
  useProdutividadeObra,
  usePerfHistorico
} from '@/features/acompanhamento/hooks/performance'
import {
  servicosDisponiveis,
  contarSemServico,
  construirSeries,
  construirSerieGeral,
  valoresDiariosObra,
  sigaIdsDoServico,
  eixoDias,
  COR,
  type Dimensao
} from '@/features/acompanhamento/lib/performance-calc'
import { media } from '@/features/acompanhamento/lib/estatistica'
import { ProdutividadeDiariaChart } from '@/features/acompanhamento/components/performance/ProdutividadeDiariaChart'
import { ComparativoEntidades } from '@/features/acompanhamento/components/performance/ComparativoEntidades'
import { BenchmarkHistorico } from '@/features/acompanhamento/components/performance/BenchmarkHistorico'
import { MapaCalorProducao } from '@/features/acompanhamento/components/performance/MapaCalorProducao'
import { RankingEntidades } from '@/features/acompanhamento/components/performance/RankingEntidades'

export function AcompanhamentoPerformancePage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Performance">
      <RequireObra pageTitle="Performance">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

type Preset = '30d' | '90d' | '180d' | 'custom'

function rangeDe(preset: Preset, customDe: string | null, customAte: string | null): { de: string; ate: string } {
  const hoje = new Date()
  const ate = hoje.toISOString().slice(0, 10)
  if (preset === 'custom' && customDe && customAte) return { de: customDe, ate: customAte }
  const dias = preset === '90d' ? 90 : preset === '180d' ? 180 : 30
  const d = new Date(hoje)
  d.setDate(d.getDate() - (dias - 1))
  return { de: d.toISOString().slice(0, 10), ate }
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!

  const [preset, setPreset] = useState<Preset>('90d')
  const [customDe, setCustomDe] = useState<string | null>(null)
  const [customAte, setCustomAte] = useState<string | null>(null)
  const [dimensao, setDimensao] = useState<Dimensao>('equipe')
  const [servicoSel, setServicoSel] = useState<string | null>(null)
  const [entidadeSel, setEntidadeSel] = useState<string | null>(null)

  const { de, ate } = rangeDe(preset, customDe, customAte)
  const dias = useMemo(() => eixoDias(de, ate), [de, ate])

  const { data: prods = [], isLoading } = useProducaoPerformance(obraId, de, ate)
  const { data: produtividade = [] } = useProdutividadeObra(obraId)

  const servicos = useMemo(() => servicosDisponiveis(prods), [prods])
  const semServico = useMemo(() => contarSemServico(prods), [prods])

  // serviço default = o primeiro (mais "alto" no código)
  useEffect(() => {
    if (servicos.length === 0) { setServicoSel(null); return }
    if (!servicoSel || !servicos.some((s) => s.id === servicoSel)) setServicoSel(servicos[0].id)
  }, [servicos, servicoSel])

  const servicoAtual = servicos.find((s) => s.id === servicoSel) ?? null
  const unidade = servicoAtual?.unidade ?? null

  const series = useMemo(
    () => (servicoSel ? construirSeries(prods, servicoSel, dimensao) : []),
    [prods, servicoSel, dimensao]
  )
  const serieGeral = useMemo(() => construirSerieGeral(series), [series])

  // entidadeSel === null → visão "Geral" (todas). Se a entidade some, volta p/ Geral.
  useEffect(() => {
    if (entidadeSel && !series.some((s) => s.key === entidadeSel)) setEntidadeSel(null)
  }, [series, entidadeSel])

  // foco = entidade selecionada, ou a série Geral quando nenhuma está escolhida
  const entidadeFocada = entidadeSel ? series.find((s) => s.key === entidadeSel) ?? serieGeral : serieGeral
  const ehGeral = !entidadeSel
  const mediaObra = useMemo(() => media(valoresDiariosObra(series)), [series])

  const cpuMeta = useMemo(() => {
    if (!servicoSel) return null
    const row = produtividade.find(
      (p) => p.servico_planejamento_id === servicoSel && p.producao_diaria_cpu != null
    )
    return row?.producao_diaria_cpu ?? null
  }, [produtividade, servicoSel])

  const sigaIds = useMemo(() => (servicoSel ? sigaIdsDoServico(prods, servicoSel) : []), [prods, servicoSel])
  const { data: historico, isLoading: histLoading } = usePerfHistorico(sigaIds, obraId)

  const labelDim = dimensao === 'equipe' ? 'equipe' : 'encarregado'

  // clique numa entidade alterna o foco: a mesma de novo volta para "Geral"
  const toggleEntidade = (key: string): void => setEntidadeSel((cur) => (cur === key ? null : key))

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Performance de equipes & encarregados"
        subtitle={`${scope.obra?.nome ?? ''} · produtividade, tendência e benchmark histórico`}
      />

      {/* Barra de filtros */}
      <div className="px-5 py-2 border-b border-border flex flex-wrap items-center gap-3">
        {/* dimensão */}
        <div className="flex items-center gap-1 rounded border border-border p-0.5">
          <FiltroBtn ativo={dimensao === 'equipe'} onClick={() => setDimensao('equipe')}>
            <Users size={11} /> Equipes
          </FiltroBtn>
          <FiltroBtn ativo={dimensao === 'encarregado'} onClick={() => setDimensao('encarregado')}>
            <HardHat size={11} /> Encarregados
          </FiltroBtn>
        </div>

        {/* serviço */}
        <select
          value={servicoSel ?? ''}
          onChange={(e) => setServicoSel(e.target.value || null)}
          className="h-7 rounded border border-border bg-bg-panel px-2 text-xs text-text font-mono max-w-[320px]"
          disabled={servicos.length === 0}
        >
          {servicos.length === 0 ? (
            <option value="">Sem serviços vinculados</option>
          ) : (
            servicos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo ? `${s.codigo} — ` : ''}{s.nome}{s.unidade ? ` (${s.unidade})` : ''}
              </option>
            ))
          )}
        </select>

        {/* período */}
        <div className="flex items-center gap-1 ml-auto">
          {(['30d', '90d', '180d'] as const).map((p) => (
            <FiltroBtn key={p} ativo={preset === p} onClick={() => setPreset(p)}>
              {p === '30d' ? '30 dias' : p === '90d' ? '90 dias' : '180 dias'}
            </FiltroBtn>
          ))}
          <DateRangePopover
            from={preset === 'custom' ? customDe : null}
            to={preset === 'custom' ? customAte : null}
            onChange={(f, t) => {
              if (f || t) { setCustomDe(f); setCustomAte(t); setPreset('custom') }
              else setPreset('90d')
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <PulseBlock key={i} h={80} />)}</div>
            <PulseBlock h={300} />
          </div>
        ) : servicos.length === 0 ? (
          <div className="flex-1 flex items-center justify-center pt-10">
            <EmptyState
              icon="bar-chart-3"
              title="Sem serviços vinculados para analisar"
              description="A análise usa a produção do SIGA vinculada a serviços do orçamento. Vincule serviços em Administração → Equipes para liberar a performance por equipe/encarregado."
            />
          </div>
        ) : (
          <>
            {/* Foco: Geral (todas) ou uma entidade — controla KPIs, gráfico diário e mapa de calor */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xs font-mono uppercase text-text-dim">Foco:</span>
              <FiltroBtn ativo={ehGeral} onClick={() => setEntidadeSel(null)}>Geral (todas)</FiltroBtn>
              {entidadeFocada && !ehGeral ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-2xs font-mono bg-accent text-white">
                  <span className="size-2 rounded-sm" style={{ background: COR.realizado }} />
                  {entidadeFocada.nome}
                </span>
              ) : null}
              <span className="text-2xs font-mono text-text-dim">· clique numa {labelDim} no ranking/tabela para focar</span>
            </div>

            <KpisEntidade
              nome={entidadeFocada?.nome ?? '—'}
              labelDim={labelDim}
              media={entidadeFocada?.media ?? 0}
              mediana={entidadeFocada?.mediana ?? 0}
              melhorDia={entidadeFocada?.melhorDia ?? 0}
              melhorData={entidadeFocada?.melhorData ?? null}
              dias={entidadeFocada?.dias ?? 0}
              spark={entidadeFocada?.valores ?? []}
              unidade={unidade}
              cpuMeta={cpuMeta}
              histP50={historico?.p50 ?? null}
              tendencia={entidadeFocada?.tendencia ?? null}
            />

            {/* Produção diária (gráfico, 2/3) + mapa de calor (1/3) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded border border-border bg-bg-panel p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-text flex items-center gap-1.5">
                    <Activity size={12} className="text-accent" />
                    Produção diária — {entidadeFocada?.nome ?? '—'}
                  </div>
                  <div className="text-2xs font-mono text-text-dim">{de.split('-').reverse().join('/')} → {ate.split('-').reverse().join('/')}</div>
                </div>
                <ProdutividadeDiariaChart serie={entidadeFocada} dias={dias} cpuMeta={cpuMeta} historico={historico ?? null} unidade={unidade} />
              </div>
              <div className="rounded border border-border bg-bg-panel p-3 flex flex-col">
                <div className="text-xs font-semibold text-text flex items-center gap-1.5 mb-2">
                  <Flame size={12} className="text-accent" />
                  Mapa de calor — {ehGeral ? 'produção geral' : entidadeFocada?.nome}
                </div>
                <MapaCalorProducao porDia={entidadeFocada?.porDia ?? new Map()} dias={dias} unidade={unidade} />
              </div>
            </div>

            {/* Ranking horizontal por entidade (média/dia) */}
            <div className="rounded border border-border bg-bg-panel p-3">
              <div className="text-xs font-semibold text-text flex items-center gap-1.5 mb-2">
                <Trophy size={12} className="text-accent" />
                Ranking de produtividade por {labelDim} · média/dia — clique para focar
              </div>
              <RankingEntidades
                series={series}
                cpuMeta={cpuMeta}
                unidade={unidade}
                selectedKey={entidadeSel}
                onSelect={toggleEntidade}
              />
            </div>

            {/* Comparativo no tempo + Benchmark histórico */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded border border-border bg-bg-panel p-3">
                <div className="text-xs font-semibold text-text flex items-center gap-1.5 mb-2">
                  <Users size={12} className="text-accent" />
                  Comparativo {dimensao === 'equipe' ? 'entre equipes' : 'entre encarregados'} no tempo · clique para focar
                </div>
                <ComparativoEntidades
                  series={series}
                  dias={dias}
                  dimensao={dimensao}
                  cpuMeta={cpuMeta}
                  historico={historico ?? null}
                  mediaObra={mediaObra}
                  unidade={unidade}
                  selectedKey={entidadeSel}
                  onSelect={toggleEntidade}
                />
              </div>
              <BenchmarkHistorico
                historico={historico}
                loading={histLoading}
                mediaObra={mediaObra}
                unidade={unidade}
              />
            </div>

            {semServico > 0 ? (
              <div className="text-2xs font-mono text-text-dim">
                {formatNumber(semServico, 0)} apontamento(s) do período ignorado(s) por não terem serviço vinculado ao orçamento.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function FiltroBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded text-2xs font-mono transition-colors',
        ativo ? 'bg-accent text-white' : 'text-text-muted hover:text-text hover:bg-bg-hover'
      )}
    >
      {children}
    </button>
  )
}

function KpisEntidade(props: {
  nome: string
  labelDim: string
  media: number
  mediana: number
  melhorDia: number
  melhorData: string | null
  dias: number
  spark: number[]
  unidade: string | null
  cpuMeta: number | null
  histP50: number | null
  tendencia: { slope: number; r2: number; rotulo: string; pctPorDia: number } | null
}): ReactNode {
  const un = props.unidade ?? ''
  const deltaHist = props.histP50 && props.histP50 > 0 ? props.media / props.histP50 - 1 : undefined
  const adCpu = props.cpuMeta && props.cpuMeta > 0 ? props.media / props.cpuMeta : null
  const t = props.tendencia
  const tendRotulo = t?.rotulo === 'subindo' ? 'Subindo' : t?.rotulo === 'caindo' ? 'Caindo' : 'Estável'
  const TendIcon = t?.rotulo === 'subindo' ? TrendingUp : t?.rotulo === 'caindo' ? TrendingDown : Minus
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <KPICard
        label="Média/dia"
        value={formatNumber(props.media, 1)}
        unit={un}
        delta={deltaHist}
        hint={deltaHist != null ? 'vs mediana histórica' : props.nome}
        spark={props.spark.length > 1 ? props.spark : undefined}
        icon={<Gauge size={11} />}
      />
      <KPICard label="Mediana/dia" value={formatNumber(props.mediana, 1)} unit={un} icon={<Activity size={11} />} />
      <KPICard label="Melhor dia" value={formatNumber(props.melhorDia, 1)} unit={un}
        hint={props.melhorData ? props.melhorData.split('-').reverse().join('/') : undefined} icon={<Trophy size={11} />} />
      <KPICard label="Dias trabalhados" value={formatNumber(props.dias, 0)} unit="dias" icon={<CalendarRange size={11} />} />
      <KPICard label="Aderência CPU" value={adCpu == null ? '—' : `${formatNumber(adCpu * 100, 0)}%`}
        hint={props.cpuMeta != null ? `meta ${formatNumber(props.cpuMeta, 0)} ${un}/dia` : 'sem CPU'} icon={<Gauge size={11} />} />
      <KPICard label="Tendência" value={tendRotulo}
        hint={t ? `R² ${t.r2.toFixed(2)} · ${t.pctPorDia >= 0 ? '+' : ''}${formatNumber(t.pctPorDia * 100, 1)}%/dia` : undefined}
        icon={<TendIcon size={11} />} />
    </div>
  )
}
