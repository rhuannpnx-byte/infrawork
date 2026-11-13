import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { PlusCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { BarraFiltros, Filtro } from '@/components/ui/filtros'
import { Segmentado } from '@/components/ui/segmentado'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { Secao } from '@/components/ui/secao'
import { ErroConsulta } from '@/components/ui/estado'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { formatNumber } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import {
  useProducaoPerformance,
  useProdutividadeObra,
  usePerfHistorico
} from '@/features/acompanhamento/hooks/performance'
import { addDiasISO, hojeLocalISO } from '@/lib/format/local-date'
import {
  servicosDisponiveis,
  contarSemServico,
  construirSeries,
  construirSerieGeral,
  valoresDiariosObra,
  eixoDias,
  codigosDoServico,
  type Dimensao
} from '@/features/acompanhamento/lib/performance-calc'
import { media } from '@/features/acompanhamento/lib/estatistica'
import { ProdutividadeDiariaChart } from '@/features/acompanhamento/components/performance/ProdutividadeDiariaChart'
import { ComparativoEntidades } from '@/features/acompanhamento/components/performance/ComparativoEntidades'
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

function rangeDe(
  preset: Preset,
  customDe: string | null,
  customAte: string | null
): { de: string; ate: string } {
  const ate = hojeLocalISO()
  if (preset === 'custom' && customDe && customAte) return { de: customDe, ate: customAte }
  const dias = preset === '90d' ? 90 : preset === '180d' ? 180 : 30
  return { de: addDiasISO(ate, -(dias - 1)), ate }
}

const dataBR = (iso: string): string => iso.split('-').reverse().join('/')

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

  const consulta = useProducaoPerformance(obraId, de, ate)
  const { data: prods = [], isLoading } = consulta
  const { data: produtividade = [] } = useProdutividadeObra(obraId)

  const servicos = useMemo(() => servicosDisponiveis(prods), [prods])
  const semServico = useMemo(() => contarSemServico(prods), [prods])

  // serviço default = o primeiro (mais "alto" no código)
  useEffect(() => {
    if (servicos.length === 0) {
      setServicoSel(null)
      return
    }
    if (!servicoSel || !servicos.some((s) => s.id === servicoSel)) setServicoSel(servicos[0].id)
  }, [servicos, servicoSel])

  const servicoAtual = servicos.find((s) => s.id === servicoSel) ?? null
  const unidade = servicoAtual?.unidade ?? null

  const series = useMemo(
    () => (servicoSel ? construirSeries(prods, servicoSel, dimensao) : []),
    [prods, servicoSel, dimensao]
  )
  const serieGeral = useMemo(() => construirSerieGeral(series), [series])

  // Benchmark histórico: mesma(s) chave(s) de serviço em outras obras da empresa.
  const codigos = useMemo(
    () => (servicoSel ? codigosDoServico(prods, servicoSel) : []),
    [prods, servicoSel]
  )
  const { data: historico = null } = usePerfHistorico(codigos, obraId)

  // entidadeSel === null → visão "Geral" (todas). Se a entidade some, volta p/ Geral.
  useEffect(() => {
    if (entidadeSel && !series.some((s) => s.key === entidadeSel)) setEntidadeSel(null)
  }, [series, entidadeSel])

  // foco = entidade selecionada, ou a série Geral quando nenhuma está escolhida
  const entidadeFocada = entidadeSel
    ? (series.find((s) => s.key === entidadeSel) ?? serieGeral)
    : serieGeral
  const ehGeral = !entidadeSel
  const mediaObra = useMemo(() => media(valoresDiariosObra(series)), [series])

  const cpuMeta = useMemo(() => {
    if (!servicoSel) return null
    const row = produtividade.find(
      (p) => p.servico_id === servicoSel && p.producao_diaria_meta != null
    )
    return row?.producao_diaria_meta != null ? Number(row.producao_diaria_meta) : null
  }, [produtividade, servicoSel])

  const ehEquipe = dimensao === 'equipe'
  const labelDim = ehEquipe ? 'equipe' : 'encarregado'
  const notaFoco = ehEquipe
    ? 'Clique numa equipe para focar.'
    : 'Clique num encarregado para focar.'

  // clique numa entidade alterna o foco: a mesma de novo volta para "Geral"
  const toggleEntidade = (key: string): void => setEntidadeSel((cur) => (cur === key ? null : key))

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Performance de equipes e encarregados"
        subtitle="Produtividade, tendência e comparação com o histórico"
      />

      <BarraFiltros>
        <Segmentado
          rotulo="Agrupar por"
          tamanho="sm"
          valor={dimensao}
          aoMudar={setDimensao}
          opcoes={[
            { valor: 'equipe', rotulo: 'Equipes' },
            { valor: 'encarregado', rotulo: 'Encarregados' }
          ]}
        />
        <Filtro rotulo="Serviço">
          <div className="w-[320px] max-w-full">
            <Select
              aria-label="Serviço"
              value={servicoSel ?? ''}
              onChange={(e) => setServicoSel(e.target.value || null)}
              className="h-7"
              disabled={servicos.length === 0}
            >
              {servicos.length === 0 ? (
                <option value="">Sem serviço com produção</option>
              ) : (
                servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.codigo ? `${s.codigo} ` : ''}
                    {s.nome}
                    {s.unidade ? ` (${s.unidade})` : ''}
                  </option>
                ))
              )}
            </Select>
          </div>
        </Filtro>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <span>Período</span>
          <Segmentado
            rotulo="Período"
            tamanho="sm"
            valor={preset === 'custom' ? null : preset}
            aoMudar={setPreset}
            opcoes={[
              { valor: '30d', rotulo: '30 dias' },
              { valor: '90d', rotulo: '90 dias' },
              { valor: '180d', rotulo: '180 dias' }
            ]}
          />
          <DateRangePopover
            from={preset === 'custom' ? customDe : null}
            to={preset === 'custom' ? customAte : null}
            placeholder="Outro período"
            onChange={(f, t) => {
              if (f || t) {
                setCustomDe(f)
                setCustomAte(t)
                setPreset('custom')
              } else setPreset('90d')
            }}
          />
        </div>
      </BarraFiltros>

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {isLoading ? (
          <div className="space-y-4" role="status" aria-label="Carregando a produção do período">
            <PulseBlock h={84} />
            <PulseBlock h={300} />
          </div>
        ) : consulta.error ? (
          <ErroConsulta
            erro={consulta.error}
            oQue="a produção do período"
            aoTentar={() => void consulta.refetch()}
          />
        ) : servicos.length === 0 ? (
          <EmptyState
            icon="bar-chart-3"
            title="Sem produção neste período"
            description="A análise usa os lançamentos de produção de cada serviço. Escolha um período maior ou lance a produção para ver a performance por equipe e por encarregado."
            action={
              <Button onClick={() => navigateActiveTab('/acompanhamento/lancar')}>
                <PlusCircle size={14} /> Lançar produção
              </Button>
            }
          />
        ) : (
          <>
            {/* Foco: todas ou uma entidade; vale para os indicadores, a produção diária e o mapa de calor */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
              <span>
                Em foco:{' '}
                <strong className="font-semibold text-text">
                  {ehGeral
                    ? ehEquipe
                      ? 'todas as equipes'
                      : 'todos os encarregados'
                    : entidadeFocada?.nome}
                </strong>
              </span>
              {ehGeral ? (
                <span>
                  {ehEquipe
                    ? 'Clique numa equipe no ranking ou na tabela para focar.'
                    : 'Clique num encarregado no ranking ou na tabela para focar.'}
                </span>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setEntidadeSel(null)}>
                  {ehEquipe ? 'Ver todas' : 'Ver todos'}
                </Button>
              )}
            </div>

            <KpisEntidade
              media={entidadeFocada?.media ?? 0}
              mediana={entidadeFocada?.mediana ?? 0}
              melhorDia={entidadeFocada?.melhorDia ?? 0}
              melhorData={entidadeFocada?.melhorData ?? null}
              dias={entidadeFocada?.dias ?? 0}
              unidade={unidade}
              cpuMeta={cpuMeta}
              histP50={historico?.p50 ?? null}
              tendencia={entidadeFocada?.tendencia ?? null}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Secao
                titulo="Produção diária"
                nota={`${ehGeral ? 'Produção geral' : (entidadeFocada?.nome ?? '')}, de ${dataBR(de)} a ${dataBR(ate)}`}
                className="lg:col-span-2"
              >
                <ProdutividadeDiariaChart
                  serie={entidadeFocada}
                  dias={dias}
                  cpuMeta={cpuMeta}
                  historico={historico}
                  unidade={unidade}
                />
              </Secao>
              <Secao
                titulo="Mapa de calor"
                nota={ehGeral ? 'Produção geral' : entidadeFocada?.nome}
              >
                <MapaCalorProducao
                  porDia={entidadeFocada?.porDia ?? new Map()}
                  dias={dias}
                  unidade={unidade}
                />
              </Secao>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Secao titulo={`Ranking por ${labelDim}: média por dia`} nota={notaFoco}>
                <RankingEntidades
                  series={series}
                  metrica="media"
                  cpuMeta={cpuMeta}
                  unidade={unidade}
                  selectedKey={entidadeSel}
                  onSelect={toggleEntidade}
                />
              </Secao>
              <Secao titulo={`Ranking por ${labelDim}: total no período`} nota={notaFoco}>
                <RankingEntidades
                  series={series}
                  metrica="total"
                  cpuMeta={null}
                  unidade={unidade}
                  selectedKey={entidadeSel}
                  onSelect={toggleEntidade}
                />
              </Secao>
            </div>

            <Secao
              titulo={`Comparativo entre ${ehEquipe ? 'equipes' : 'encarregados'}`}
              nota="Produção de cada dia ao longo do período."
            >
              <ComparativoEntidades
                series={series}
                dias={dias}
                dimensao={dimensao}
                cpuMeta={cpuMeta}
                historico={historico}
                mediaObra={mediaObra}
                unidade={unidade}
                selectedKey={entidadeSel}
                onSelect={toggleEntidade}
              />
            </Secao>

            {semServico > 0 ? (
              <p className="text-sm text-text-muted">
                {contar(
                  semServico,
                  'lançamento do período ficou de fora',
                  'lançamentos do período ficaram de fora'
                )}{' '}
                porque o item do orçamento foi removido.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function KpisEntidade(props: {
  media: number
  mediana: number
  melhorDia: number
  melhorData: string | null
  dias: number
  unidade: string | null
  cpuMeta: number | null
  histP50: number | null
  tendencia: { slope: number; r2: number; rotulo: string; pctPorDia: number } | null
}): ReactNode {
  const un = props.unidade ?? ''
  const deltaHist = props.histP50 && props.histP50 > 0 ? props.media / props.histP50 - 1 : null
  const adCpu = props.cpuMeta && props.cpuMeta > 0 ? props.media / props.cpuMeta : null
  const t = props.tendencia
  const tendRotulo =
    t?.rotulo === 'subindo' ? 'Subindo' : t?.rotulo === 'caindo' ? 'Caindo' : 'Estável'
  return (
    <FaixaIndicadores rotulo="Indicadores da seleção em foco">
      <Indicador
        rotulo="Média por dia"
        valor={formatNumber(props.media, 1)}
        unidade={un}
        tamanho="sm"
      >
        {deltaHist != null ? (
          <span>
            <span className={deltaHist >= 0 ? 'text-success' : 'text-danger'}>
              {deltaHist >= 0 ? '+' : '−'}
              {formatNumber(Math.abs(deltaHist) * 100, 1)}%
            </span>{' '}
            sobre a mediana histórica
          </span>
        ) : null}
      </Indicador>
      <Indicador
        rotulo="Mediana por dia"
        valor={formatNumber(props.mediana, 1)}
        unidade={un}
        tamanho="sm"
      />
      <Indicador
        rotulo="Melhor dia"
        valor={formatNumber(props.melhorDia, 1)}
        unidade={un}
        tamanho="sm"
      >
        {props.melhorData ? <span className="tabular">{dataBR(props.melhorData)}</span> : null}
      </Indicador>
      <Indicador
        rotulo="Dias trabalhados"
        valor={formatNumber(props.dias, 0)}
        unidade={props.dias === 1 ? 'dia' : 'dias'}
        tamanho="sm"
      />
      <Indicador
        rotulo="Aderência à meta"
        valor={adCpu == null ? '—' : `${formatNumber(adCpu * 100, 0)}%`}
        tamanho="sm"
      >
        <span>
          {props.cpuMeta != null
            ? `Meta da composição: ${formatNumber(props.cpuMeta, 0)} ${un} por dia`
            : 'Sem meta da composição'}
        </span>
      </Indicador>
      <Indicador rotulo="Tendência" valor={tendRotulo} tamanho="sm">
        {t ? (
          <span title="R² mostra o quanto a produção acompanha a linha de tendência (1 = acompanha à risca).">
            {t.pctPorDia >= 0 ? '+' : '−'}
            {formatNumber(Math.abs(t.pctPorDia) * 100, 1)}% por dia, R² {formatNumber(t.r2, 2)}
          </span>
        ) : null}
      </Indicador>
    </FaixaIndicadores>
  )
}
