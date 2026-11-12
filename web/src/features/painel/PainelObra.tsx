import { useMemo, type ReactNode } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
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

        <section
          aria-label="Situação da obra"
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-bg-panel border border-border rounded"
        >
          {interno ? (
            <Indicador rotulo="Avanço físico" valor={pct(resumo?.avanco_pct)}>
              <div className="h-1.5 bg-bg-elevated border border-border">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(Number(resumo?.avanco_pct ?? 0), 1) * 100}%` }}
                />
              </div>
              <span>
                {resumo?.avanco_pct == null
                  ? 'sem linha de base vigente'
                  : 'ponderado pela receita'}
              </span>
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
                {contagem.atrasados} atrasado{contagem.atrasados > 1 ? 's' : ''}
                {contagem.risco > 0 ? ` e ${contagem.risco} em risco` : ''}
              </span>
            ) : contagem.risco > 0 ? (
              <span className="text-warn font-semibold">{contagem.risco} em risco</span>
            ) : servicos.length > 0 ? (
              <span className="text-success font-semibold">nenhum atrasado</span>
            ) : null}
            <span>
              {contagem.andamento} em andamento · {contagem.concluidos} concluído
              {contagem.concluidos === 1 ? '' : 's'}
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
                {formatNumber(resumo.lancamentos_total, 0)}{' '}
                {resumo.lancamentos_total === 1 ? 'lançamento' : 'lançamentos'} em{' '}
                {formatNumber(resumo.dias_com_apontamento, 0)}{' '}
                {resumo.dias_com_apontamento === 1 ? 'dia' : 'dias'}
              </span>
            ) : null}
          </Indicador>
        </section>

        {interno ? <FaixaObra producao={producao} trechos={trechos} /> : null}

        <div className="flex flex-wrap items-start gap-4">
          <section
            aria-label="Serviços"
            className="flex-[3_1_520px] min-w-0 bg-bg-panel border border-border rounded"
          >
            <CabecalhoBloco
              titulo="Serviços"
              nota="a marca escura é o previsto até hoje"
              acao="Ver previsto e realizado"
              rota="/acompanhamento/comparativo"
            />
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
          </section>

          {interno ? (
            <div className="flex-[2_1_320px] min-w-0 flex flex-col gap-4">
              <section
                aria-label="Pede atenção"
                className="bg-bg-panel border border-border rounded"
              >
                <CabecalhoBloco
                  titulo="Pede atenção"
                  acao="Ver alertas"
                  rota="/acompanhamento/alertas"
                />
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
              </section>

              <section
                aria-label="Últimos lançamentos"
                className="bg-bg-panel border border-border rounded"
              >
                <CabecalhoBloco
                  titulo="Últimos lançamentos"
                  acao="Ver produção"
                  rota="/acompanhamento/producao"
                />
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
              </section>
            </div>
          ) : null}
        </div>

        {interno ? <ProntidaoObra obraId={obraId} titulo="Prontidão da obra" /> : null}
      </div>
    </div>
  )
}

function Indicador({
  rotulo,
  valor,
  children
}: {
  rotulo: string
  valor: string
  children?: ReactNode
}): ReactNode {
  return (
    <div className="px-4 py-3 min-w-0 flex flex-col gap-1 border-b xl:border-b-0 border-r border-border last:border-r-0 text-sm text-text-muted">
      <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
        {rotulo}
      </span>
      <span className="text-3xl font-semibold tabular leading-tight text-text">{valor}</span>
      {children}
    </div>
  )
}

function CabecalhoBloco({
  titulo,
  nota,
  acao,
  rota
}: {
  titulo: string
  nota?: string
  acao: string
  rota: string
}): ReactNode {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-lg font-semibold text-text">{titulo}</h2>
        {nota ? <span className="text-sm text-text-muted">{nota}</span> : null}
      </div>
      <button
        type="button"
        onClick={() => navigateActiveTab(rota)}
        className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline rounded"
      >
        {acao} <ArrowRight size={13} />
      </button>
    </div>
  )
}

function LinhaServico({ s }: { s: PrevistoRealizadoItem }): ReactNode {
  const real = Math.min(Number(s.pct_avanco ?? 0), 1) * 100
  const esperado = s.pct_esperado_hoje == null ? null : Math.min(Number(s.pct_esperado_hoje), 1)
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
        <div className="relative h-2 bg-bg-elevated border border-border">
          <div className="h-full bg-accent" style={{ width: `${real}%` }} />
          {esperado != null ? (
            <span
              className="absolute -top-1 -bottom-1 w-0.5 bg-text"
              style={{ left: `${esperado * 100}%` }}
            />
          ) : null}
        </div>
      </td>
      <td className="px-2 py-2 text-right tabular text-text-muted">{pct(s.pct_esperado_hoje)}</td>
      <td className="px-2 py-2 text-right tabular font-semibold text-text">{pct(s.pct_avanco)}</td>
      <td className="pl-2 pr-4 py-2">
        <Badge variant={VARIANTE[s.status]}>{STATUS_COMP_LABEL[s.status]}</Badge>
      </td>
    </tr>
  )
}
