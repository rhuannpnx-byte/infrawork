import { useMemo, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Secao } from '@/components/ui/secao'
import { BarraAvanco, FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { EstadoConsulta } from '@/components/ui/estado'
import { CurvaS, reaisCurto } from '@/components/charts/CurvaS'
import { contar } from '@/lib/rotulos'
import { formatNumber } from '@/lib/format'
import { hojeLocalISO } from '@/lib/format/local-date'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { useAuthStore } from '@/stores/auth-store'
import { useObra } from '@/features/gerencial/hooks'
import { rotuloStatusObra } from '@/features/gerencial/lib/status-obra'
import { ProntidaoObra } from '@/features/gerencial/components/ProntidaoObra'
import { useBaseline } from '@/features/planejamento/hooks/planejamentos'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { usePrevistoXRealizado } from '@/features/acompanhamento/hooks/comparativo'
import { useDashboardResumo } from '@/features/acompanhamento/hooks/dashboard'
import { useProducao } from '@/features/acompanhamento/hooks/producao'
import { useCurvaSValor } from '@/features/acompanhamento/hooks/curva-valor'
import {
  STATUS_COMP_LABEL,
  type PrevistoRealizadoItem,
  type StatusComparativo
} from '@/types/acompanhamento'
import { FaixaObra } from './FaixaObra'

const dataBR = (iso: string | null | undefined): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'

const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000)

const pct = (v: number | null | undefined, casas = 1): string =>
  v == null ? '—' : `${formatNumber(Number(v) * 100, casas)}%`

const VARIANTE: Record<StatusComparativo, BadgeProps['variant']> = {
  sem_plano: 'outline',
  nao_iniciado: 'default',
  em_andamento: 'accent',
  no_prazo: 'success',
  adiantado: 'success',
  concluido: 'success',
  em_risco: 'warn',
  atrasado: 'danger'
}
const ORDEM: StatusComparativo[] = [
  'atrasado',
  'em_risco',
  'em_andamento',
  'no_prazo',
  'adiantado',
  'concluido',
  'nao_iniciado',
  'sem_plano'
]

/** Tela inicial com obra selecionada: a situação da obra numa folha só. */
export function PainelObra({ obraId }: { obraId: string }): ReactNode {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const interno = !!role && role !== 'cliente'
  const hoje = hojeLocalISO()

  const { data: obra } = useObra(obraId)
  const { data: linhaBase } = useBaseline(interno ? obraId : null)
  const { data: trechos = [] } = useObraTrechos(interno ? obraId : null)
  const { data: servicos = [], isLoading: carregandoServicos } = usePrevistoXRealizado(obraId)
  const { data: painel } = useDashboardResumo(interno ? obraId : null, 30)
  const { data: producao = [] } = useProducao(obraId)
  const valor = useCurvaSValor(interno ? obraId : null)

  const resumo = painel?.resumo ?? null
  const termino = useMemo(() => {
    const fins = servicos.map((s) => s.data_fim_plan).filter((d): d is string => !!d)
    return fins.length ? fins.sort()[fins.length - 1] : (obra?.data_fim_planejada ?? null)
  }, [servicos, obra])
  const inicio = useMemo(() => {
    const inis = servicos.map((s) => s.data_inicio_plan).filter((d): d is string => !!d)
    return inis.length ? inis.sort()[0] : (obra?.data_inicio_planejada ?? null)
  }, [servicos, obra])

  const contagem = useMemo(() => {
    const c = { atrasados: 0, risco: 0, andamento: 0, concluidos: 0 }
    for (const s of servicos) {
      if (s.status === 'atrasado') c.atrasados++
      else if (s.status === 'em_risco') c.risco++
      else if (s.status === 'concluido') c.concluidos++
      else if (s.status !== 'nao_iniciado' && s.status !== 'sem_plano') c.andamento++
    }
    return c
  }, [servicos])

  const previstoPct = valor.total > 0 ? valor.previstoHoje / valor.total : null
  const ultimo = resumo?.data_ultima_producao ?? producao[0]?.data ?? null
  const diasSemLancar = ultimo ? diasEntre(ultimo, hoje) : null
  const tabela = useMemo(
    () =>
      [...servicos]
        .sort(
          (a, b) =>
            ORDEM.indexOf(a.status) - ORDEM.indexOf(b.status) ||
            a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true })
        )
        .slice(0, 8),
    [servicos]
  )
  const alertas = painel?.alertas_criticos ?? []
  const ultimos = painel?.ultimos_apontamentos ?? []

  const carimbo: Array<[string, string]> = [
    ['Obra', obra?.codigo ?? '—'],
    ['Trecho', [obra?.rodovia, obra?.trecho].filter(Boolean).join(' · ') || '—'],
    ['Extensão', obra?.extensao_km != null ? `${formatNumber(obra.extensao_km, 2)} km` : '—'],
    ['Linha de base', linhaBase?.nome ?? (interno ? 'Sem linha de base' : '—')],
    ['Situação', rotuloStatusObra(obra?.status)],
    ['Data de controle', dataBR(hoje)]
  ]

  return (
    <div className="h-full w-full overflow-auto bg-bg">
      <div className="max-w-[1400px] mx-auto px-5 py-5 flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <h1 className="text-3xl font-semibold tracking-[-0.01em] text-text">
            {obra?.nome ?? ' '}
          </h1>
          {interno ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => navigateActiveTab('/acompanhamento')}>
                Abrir o dashboard
              </Button>
              <Button onClick={() => navigateActiveTab('/acompanhamento/lancar')}>
                <Plus size={14} /> Lançar produção
              </Button>
            </div>
          ) : null}
        </header>

        <dl
          aria-label="Identificação da obra"
          className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 bg-bg-panel border border-border-strong"
        >
          {carimbo.map(([rotulo, valor]) => (
            <div key={rotulo} className="px-3 py-2 min-w-0 border-r border-b border-border -mb-px">
              <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                {rotulo}
              </dt>
              <dd className="text-sm font-semibold text-text tabular truncate" title={valor}>
                {valor}
              </dd>
            </div>
          ))}
        </dl>

        <FaixaIndicadores rotulo="Situação da obra">
          {interno ? (
            <Indicador rotulo="Avanço físico" valor={pct(resumo?.avanco_pct)}>
              <BarraAvanco valor={Number(resumo?.avanco_pct ?? 0)} marca={previstoPct} />
              <span>
                {resumo?.avanco_pct == null
                  ? 'sem linha de base vigente'
                  : previstoPct != null
                    ? `previsto até hoje: ${pct(previstoPct)}`
                    : 'ponderado pela receita'}
              </span>
            </Indicador>
          ) : null}
          {interno ? (
            <Indicador
              rotulo="Valor executado"
              carregando={valor.isLoading}
              valor={valor.total > 0 ? reaisCurto(valor.executado) : '—'}
            >
              {valor.total > 0 ? (
                <>
                  <span>de {reaisCurto(valor.total)} previstos na linha de base</span>
                  <span>previsto até hoje: {reaisCurto(valor.previstoHoje)}</span>
                </>
              ) : (
                <span>sem linha de base vigente</span>
              )}
            </Indicador>
          ) : null}
          <Indicador rotulo="Término previsto" valor={dataBR(termino)}>
            {termino ? (
              <span>
                {diasEntre(hoje, termino) >= 0
                  ? `faltam ${formatNumber(diasEntre(hoje, termino), 0)} dias`
                  : `venceu há ${formatNumber(-diasEntre(hoje, termino), 0)} dias`}
              </span>
            ) : null}
            {inicio ? <span>início em {dataBR(inicio)}</span> : null}
          </Indicador>
          <Indicador rotulo="Serviços" valor={formatNumber(servicos.length, 0)}>
            {contagem.atrasados > 0 ? (
              <span className="text-danger font-semibold">
                {contar(contagem.atrasados, 'atrasado', 'atrasados')}
                {contagem.risco > 0 ? ` e ${contagem.risco} em risco` : ''}
              </span>
            ) : contagem.risco > 0 ? (
              <span className="text-warn font-semibold">{contagem.risco} em risco</span>
            ) : servicos.length > 0 ? (
              <span className="text-success font-semibold">nenhum atrasado</span>
            ) : null}
            <span>
              {contagem.andamento} em andamento ·{' '}
              {contar(contagem.concluidos, 'concluído', 'concluídos')}
            </span>
          </Indicador>
          <Indicador rotulo="Último lançamento" valor={dataBR(ultimo)}>
            {diasSemLancar != null && diasSemLancar > 1 ? (
              <span className="text-warn font-semibold">
                há {formatNumber(diasSemLancar, 0)} dias sem lançamento
              </span>
            ) : diasSemLancar != null ? (
              <span className="text-success font-semibold">em dia</span>
            ) : (
              <span>nenhuma produção lançada</span>
            )}
            {resumo ? (
              <span>
                {contar(resumo.lancamentos_total, 'lançamento', 'lançamentos')} em{' '}
                {contar(resumo.dias_com_apontamento, 'dia', 'dias')}
              </span>
            ) : null}
          </Indicador>
        </FaixaIndicadores>

        {interno ? (
          <Secao
            titulo="Curva S"
            nota="valor previsto e executado, acumulados por semana"
            verMais={{ rotulo: 'Ver valor agregado', rota: '/acompanhamento/valor-agregado' }}
          >
            <EstadoConsulta
              consulta={valor}
              oQue="a curva S"
              vazio={valor.pontos.length === 0}
              textoVazio="A curva S aparece quando a obra tem linha de base vigente com o cronograma calculado."
            >
              <CurvaS
                pontos={valor.pontos}
                formatar={reaisCurto}
                rotuloRealizado="Executado"
                altura={220}
              />
            </EstadoConsulta>
          </Secao>
        ) : null}

        {interno ? <FaixaObra producao={producao} trechos={trechos} /> : null}

        <div className="flex flex-wrap items-start gap-4">
          <Secao
            titulo="Serviços"
            nota="a marca escura é o previsto até hoje"
            verMais={{ rotulo: 'Ver previsto e realizado', rota: '/acompanhamento/comparativo' }}
            semRecuo
            className="flex-[3_1_520px]"
          >
            {tabela.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-text-muted">
                {carregandoServicos
                  ? 'Carregando os serviços…'
                  : 'Sem linha de base vigente: o previsto aparece aqui quando o cronograma for travado como linha de base.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim border-y border-border">
                      <th className="text-left font-semibold px-4 py-2">Serviço</th>
                      <th className="text-left font-semibold px-2 py-2 w-[26%]">Avanço</th>
                      <th className="text-right font-semibold px-2 py-2">Previsto</th>
                      <th className="text-right font-semibold px-2 py-2">Executado</th>
                      <th className="text-left font-semibold pl-2 pr-4 py-2">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tabela.map((s) => (
                      <LinhaServico key={s.tarefa_id} s={s} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Secao>

          {interno ? (
            <div className="flex-[2_1_320px] min-w-0 flex flex-col gap-4">
              <Secao
                titulo="Pede atenção"
                verMais={{ rotulo: 'Ver alertas', rota: '/acompanhamento/alertas' }}
                semRecuo
              >
                {alertas.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-text-muted">Nenhum alerta crítico aberto.</p>
                ) : (
                  <ul>
                    {alertas.slice(0, 4).map((a) => (
                      <li key={a.id} className="px-4 py-2.5 border-t border-border">
                        <div className="text-sm font-semibold text-text">{a.titulo}</div>
                        {a.descricao ? (
                          <div className="text-sm text-text-muted">{a.descricao}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>

              <Secao
                titulo="Últimos lançamentos"
                verMais={{ rotulo: 'Ver produção', rota: '/acompanhamento/producao' }}
                semRecuo
              >
                {ultimos.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-text-muted">Nenhuma produção lançada.</p>
                ) : (
                  <ul>
                    {ultimos.slice(0, 6).map((u) => (
                      <li
                        key={u.id}
                        className="px-4 py-2 border-t border-border flex items-baseline justify-between gap-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-text">
                            {u.servico_display_nome}
                          </span>
                          <span className="block text-xs text-text-dim">
                            {dataBR(u.data)} · {u.equipe_display_nome}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm tabular font-semibold text-text">
                          {formatNumber(Number(u.qtd), 2)}{' '}
                          <span className="font-normal text-text-muted">{u.unidade ?? ''}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>
            </div>
          ) : null}
        </div>

        {interno ? <ProntidaoObra obraId={obraId} titulo="Prontidão da obra" /> : null}
      </div>
    </div>
  )
}

function LinhaServico({ s }: { s: PrevistoRealizadoItem }): ReactNode {
  const real = Number(s.pct_avanco ?? 0)
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2 max-w-0 w-[40%]">
        <span className="flex gap-2 min-w-0">
          <span className="tabular text-text-dim shrink-0">{s.codigo}</span>
          <span className="truncate text-text" title={s.descricao}>
            {s.descricao}
          </span>
        </span>
      </td>
      <td className="px-2 py-2">
        <BarraAvanco valor={real} marca={s.pct_esperado_hoje} />
      </td>
      <td className="px-2 py-2 text-right tabular text-text-muted">{pct(s.pct_esperado_hoje)}</td>
      <td className="px-2 py-2 text-right tabular font-semibold text-text">{pct(s.pct_avanco)}</td>
      <td className="pl-2 pr-4 py-2">
        <Badge variant={VARIANTE[s.status]}>{STATUS_COMP_LABEL[s.status]}</Badge>
      </td>
    </tr>
  )
}
