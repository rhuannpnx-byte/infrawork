import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Secao } from '@/components/ui/secao'
import { BarraAvanco, FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { ErroConsulta, EstadoConsulta, Vazio } from '@/components/ui/estado'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { Segmentado } from '@/components/ui/segmentado'
import { contar } from '@/lib/rotulos'
import { formatNumber } from '@/lib/format'
import { dataBR, hojeLocalISO } from '@/lib/format/local-date'
import { cn } from '@/lib/utils'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { useAuthStore } from '@/stores/auth-store'
import { useObraStore } from '@/stores/obra-store'
import { useUIStore } from '@/stores/ui-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useEmpresas } from '@/features/gerencial/hooks'
import { rotuloStatusObra } from '@/features/gerencial/lib/status-obra'
import type { AuthObra } from '@/types/auth'
import { useCarteira, type AtividadeRecente, type ObraNaCarteira } from './carteira'
import { MapaTracado } from './MapaTracado'

/** Página da obra aberta pelo cartão. */
const ROTA_PAINEL = '/acompanhamento/painel'
const ORDEM_STATUS = ['em_andamento', 'planejamento', 'paralisado', 'concluido']
/** Cor do ponto da situação, no selo sobre a imagem. */
const PONTO_STATUS: Record<string, string> = {
  em_andamento: 'bg-success',
  planejamento: 'bg-[color:var(--na-foto)]',
  paralisado: 'bg-warn',
  concluido: 'bg-accent'
}
const PODE_LANCAR = ['god', 'adm', 'engenheiro', 'apoio']
/** Sem lançamento por mais que isso, numa obra em andamento, pede atenção. */
const DIAS_SEM_LANCAR = 7
const DIAS_ATIVIDADE = 7

const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000)

const somarDias = (iso: string, dias: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

const pct = (v: number): string => `${formatNumber(v * 100, v > 0 && v < 0.1 ? 1 : 0)}%`

const quando = (iso: string, hoje: string): string => {
  const d = diasEntre(iso, hoje)
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : d < 7 ? `há ${d} dias` : dataBR(iso)
}

function saudacao(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

function dataPorExtenso(): string {
  const t = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date())
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Início: a home da carteira de obras da empresa. O God escolhe antes a empresa. */
export function Inicio(): ReactNode {
  const { precisaSelecionarEmpresa } = useCurrentScope()
  return (
    <div className="h-full w-full overflow-auto bg-bg">
      <div className="max-w-[1400px] mx-auto px-5 py-6 flex flex-col gap-5">
        {precisaSelecionarEmpresa ? <EscolherEmpresa /> : <Home />}
      </div>
    </div>
  )
}

function Saudacao({ complemento, acoes }: { complemento: string; acoes?: ReactNode }): ReactNode {
  const nome = useAuthStore((s) => s.profile?.nome ?? '')
  const primeiro = nome.trim().split(/\s+/)[0] ?? ''
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-[-0.01em] text-text">
          {saudacao()}
          {primeiro ? `, ${primeiro}` : ''}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {dataPorExtenso()}
          {complemento ? ` · ${complemento}` : ''}
        </p>
      </div>
      {acoes ? <div className="flex flex-wrap gap-2">{acoes}</div> : null}
    </header>
  )
}

function EscolherEmpresa(): ReactNode {
  const setEmpresaId = useObraStore((s) => s.setEmpresaId)
  const obras = useAuthStore((s) => s.obras)
  const consulta = useEmpresas()
  const ativas = useMemo(() => (consulta.data ?? []).filter((e) => e.ativo), [consulta.data])
  const obrasPorEmpresa = useMemo(() => {
    const n = new Map<string, number>()
    for (const o of obras) n.set(o.empresa_id, (n.get(o.empresa_id) ?? 0) + 1)
    return n
  }, [obras])

  return (
    <>
      <Saudacao
        complemento="escolha a empresa para ver as obras"
        acoes={
          <Button variant="secondary" onClick={() => navigateActiveTab('/gerencial/empresas')}>
            <Plus size={14} /> Cadastrar empresa
          </Button>
        }
      />
      <Secao titulo="Empresas" semRecuo className="max-w-[900px]">
        <EstadoConsulta
          consulta={consulta}
          oQue="as empresas"
          vazio={ativas.length === 0}
          textoVazio="Nenhuma empresa ativa. Cadastre a primeira em Gerencial › Empresas."
          className="px-4 pb-4 pt-0"
        >
          <ul>
            {ativas.map((e) => (
              <li key={e.id} className="border-t border-border">
                <button
                  type="button"
                  onClick={() => setEmpresaId(e.id)}
                  className="group w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover focus-visible:outline-none focus-visible:bg-bg-active"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text">{e.nome}</span>
                    {e.cnpj ? (
                      <span className="block text-xs tabular text-text-dim">{e.cnpj}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm text-text-muted tabular">
                    {contar(obrasPorEmpresa.get(e.id) ?? 0, 'obra', 'obras')}
                  </span>
                  <ArrowRight
                    size={14}
                    className="shrink-0 text-text-dim group-hover:text-text"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        </EstadoConsulta>
      </Secao>
    </>
  )
}

interface Pendencia {
  obraId: string
  codigo: string
  tom: 'danger' | 'warn'
  texto: string
  acao: string
  rota: string
}

function Home(): ReactNode {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const empresaPerfil = useAuthStore((s) => s.empresa)
  const setObraId = useObraStore((s) => s.setObraId)
  const openModal = useUIStore((s) => s.openModal)
  const { obrasNaEmpresa, empresaId, obraId, isGod } = useCurrentScope()
  const { data: empresas = [] } = useEmpresas()
  const interno = !!role && role !== 'cliente'
  const podeLancar = !!role && PODE_LANCAR.includes(role)
  const podeCadastrar = role === 'god' || role === 'adm'
  const hoje = hojeLocalISO()
  const [filtro, setFiltro] = useState<string>('todas')

  const empresaNome = empresaPerfil?.nome ?? empresas.find((e) => e.id === empresaId)?.nome ?? ''
  const obras = useMemo(
    () =>
      [...obrasNaEmpresa].sort((a, b) => {
        const sa = ORDEM_STATUS.indexOf(a.status)
        const sb = ORDEM_STATUS.indexOf(b.status)
        return (
          (sa < 0 ? 99 : sa) - (sb < 0 ? 99 : sb) ||
          a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true })
        )
      }),
    [obrasNaEmpresa]
  )
  const ids = useMemo(() => obras.map((o) => o.id), [obras])
  const carteira = useCarteira(ids, interno, somarDias(hoje, -(DIAS_ATIVIDADE - 1)))
  const codigoDe = useMemo(() => new Map(obras.map((o) => [o.id, o.codigo])), [obras])

  const abrir = (id: string, rota: string): void => {
    setObraId(id)
    navigateActiveTab(rota)
  }

  const statusPresentes = useMemo(
    () => ORDEM_STATUS.filter((s) => obras.some((o) => o.status === s)),
    [obras]
  )
  const visiveis = filtro === 'todas' ? obras : obras.filter((o) => o.status === filtro)

  const indicadores = useMemo(() => {
    let somaAvanco = 0
    let comLinhaBase = 0
    let alertas = 0
    let obrasComAlerta = 0
    let ultimaProducao: string | null = null
    for (const o of obras) {
      const c = carteira.porObra.get(o.id)
      if (!c) continue
      if (!c.semLinhaBase && c.avancoPct != null) {
        somaAvanco += c.avancoPct
        comLinhaBase++
      }
      alertas += c.alertasCriticos
      if (c.alertasCriticos > 0) obrasComAlerta++
      if (c.ultimaProducao && (!ultimaProducao || c.ultimaProducao > ultimaProducao))
        ultimaProducao = c.ultimaProducao
    }
    return {
      emAndamento: obras.filter((o) => o.status === 'em_andamento').length,
      avancoMedio: comLinhaBase ? somaAvanco / comLinhaBase : null,
      comLinhaBase,
      alertas,
      obrasComAlerta,
      ultimaProducao
    }
  }, [obras, carteira.porObra])

  const pendencias = useMemo(() => {
    if (carteira.carregandoSituacao) return []
    const lista: Pendencia[] = []
    for (const o of obras) {
      const c = carteira.porObra.get(o.id)
      if (!c) continue
      const base = { obraId: o.id, codigo: o.codigo }
      if (c.alertasCriticos > 0)
        lista.push({
          ...base,
          tom: 'danger',
          texto: contar(c.alertasCriticos, 'alerta crítico aberto', 'alertas críticos abertos'),
          acao: 'Ver os alertas',
          rota: '/acompanhamento/alertas'
        })
      if (c.atrasados > 0)
        lista.push({
          ...base,
          tom: 'danger',
          texto: contar(c.atrasados, 'serviço atrasado', 'serviços atrasados'),
          acao: 'Ver previsto e realizado',
          rota: '/acompanhamento/comparativo'
        })
      if (o.status !== 'em_andamento') continue
      const dias = c.ultimaProducao ? diasEntre(c.ultimaProducao, hoje) : null
      if (c.semLinhaBase)
        lista.push({
          ...base,
          tom: 'warn',
          texto: 'em andamento sem linha de base vigente',
          acao: 'Abrir o cronograma',
          rota: '/planejamento/cronograma'
        })
      else if (dias == null)
        lista.push({
          ...base,
          tom: 'warn',
          texto: 'nenhuma produção lançada',
          acao: podeLancar ? 'Lançar produção' : 'Ver a produção',
          rota: podeLancar ? '/acompanhamento/lancar' : '/acompanhamento/producao'
        })
      else if (dias >= DIAS_SEM_LANCAR)
        lista.push({
          ...base,
          tom: 'warn',
          texto: `há ${formatNumber(dias, 0)} dias sem lançamento`,
          acao: 'Ver a produção',
          rota: '/acompanhamento/producao'
        })
    }
    return lista.sort((a, b) => (a.tom === b.tom ? 0 : a.tom === 'danger' ? -1 : 1))
  }, [obras, carteira.porObra, carteira.carregandoSituacao, hoje, podeLancar])

  const acoes =
    isGod || podeCadastrar ? (
      <>
        {isGod ? (
          <Button variant="secondary" onClick={() => openModal('projectSwitcher')}>
            Trocar empresa
          </Button>
        ) : null}
        {podeCadastrar ? (
          <Button onClick={() => navigateActiveTab('/gerencial/obras')}>
            <Plus size={14} /> Nova obra
          </Button>
        ) : null}
      </>
    ) : undefined

  return (
    <>
      <Saudacao complemento={empresaNome} acoes={acoes} />

      {carteira.erro ? (
        <ErroConsulta
          erro={carteira.erro}
          oQue="a situação das obras"
          aoTentar={carteira.tentarDeNovo}
        />
      ) : null}

      {obras.length === 0 ? (
        <Secao titulo="Suas obras" className="max-w-[900px]">
          <Vazio
            className="py-0"
            acao={
              podeCadastrar ? (
                <Button onClick={() => navigateActiveTab('/gerencial/obras')}>
                  <Plus size={14} /> Nova obra
                </Button>
              ) : undefined
            }
          >
            {podeCadastrar
              ? 'Nenhuma obra cadastrada nesta empresa. Cadastre a obra e depois importe a planilha orçamentária.'
              : 'Nenhuma obra liberada para o seu usuário. Peça ao administrador da empresa para liberar o acesso.'}
          </Vazio>
        </Secao>
      ) : (
        <>
          {interno ? (
            <FaixaIndicadores rotulo="Resumo da carteira">
              <Indicador
                rotulo="Obras em andamento"
                valor={formatNumber(indicadores.emAndamento, 0)}
              >
                <span>de {contar(obras.length, 'obra', 'obras')} da empresa</span>
              </Indicador>
              <Indicador
                rotulo="Avanço físico médio"
                carregando={carteira.carregandoSituacao}
                valor={indicadores.avancoMedio == null ? '—' : pct(indicadores.avancoMedio)}
              >
                {indicadores.avancoMedio == null ? (
                  <span>nenhuma obra com linha de base vigente</span>
                ) : (
                  <>
                    <BarraAvanco valor={indicadores.avancoMedio} />
                    <span>
                      média de {contar(indicadores.comLinhaBase, 'obra', 'obras')} com linha de base
                    </span>
                  </>
                )}
              </Indicador>
              <Indicador
                rotulo="Alertas críticos"
                carregando={carteira.carregandoSituacao}
                valor={formatNumber(indicadores.alertas, 0)}
                tom={indicadores.alertas > 0 ? 'danger' : 'neutro'}
              >
                {indicadores.alertas > 0 ? (
                  <span>em {contar(indicadores.obrasComAlerta, 'obra', 'obras')}</span>
                ) : (
                  <span className="font-semibold text-success">nenhum aberto</span>
                )}
              </Indicador>
              <Indicador
                rotulo={`Lançamentos em ${DIAS_ATIVIDADE} dias`}
                carregando={carteira.carregandoAtividade || carteira.carregandoSituacao}
                titulo="Produção lançada com data nos últimos 7 dias, em todas as obras"
                valor={
                  carteira.lancamentosPeriodo == null
                    ? '—'
                    : formatNumber(carteira.lancamentosPeriodo, 0)
                }
                tom={carteira.lancamentosPeriodo === 0 ? 'warn' : 'neutro'}
              >
                <span>
                  {indicadores.ultimaProducao
                    ? `última produção ${quando(indicadores.ultimaProducao, hoje)}`
                    : 'nenhuma produção lançada'}
                </span>
              </Indicador>
            </FaixaIndicadores>
          ) : null}

          <div
            className={cn(
              'grid items-start gap-5',
              interno && 'lg:grid-cols-[minmax(0,1fr)_340px]'
            )}
          >
            <section aria-label="Suas obras" className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h2 className="text-lg font-semibold text-text">
                  Suas obras{' '}
                  <span className="text-sm font-normal text-text-muted tabular">
                    {visiveis.length}
                  </span>
                </h2>
                {statusPresentes.length > 1 ? (
                  <Segmentado
                    rotulo="Filtrar obras pela situação"
                    tamanho="sm"
                    valor={filtro}
                    aoMudar={setFiltro}
                    opcoes={[
                      { valor: 'todas', rotulo: 'Todas' },
                      ...statusPresentes.map((s) => ({ valor: s, rotulo: rotuloStatusObra(s) }))
                    ]}
                  />
                ) : null}
              </div>
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                {visiveis.map((o) => (
                  <CartaoObra
                    key={o.id}
                    obra={o}
                    c={carteira.porObra.get(o.id)}
                    carregando={carteira.carregandoSituacao}
                    emUso={o.id === obraId}
                    interno={interno}
                    podeLancar={podeLancar}
                    hoje={hoje}
                    aoAbrir={abrir}
                  />
                ))}
              </div>
            </section>

            {interno ? (
              <div className="flex min-w-0 flex-col gap-4">
                <Secao titulo="Pendências" semRecuo>
                  {carteira.carregandoSituacao ? (
                    <Esqueleto />
                  ) : pendencias.length === 0 ? (
                    <p className="px-4 pb-4 text-sm text-text-muted">
                      Nada pendente: nenhum alerta crítico, serviço atrasado ou obra em andamento
                      parada.
                    </p>
                  ) : (
                    <ul>
                      {pendencias.map((p) => (
                        <li key={`${p.obraId}-${p.rota}`} className="border-t border-border">
                          <ItemLista
                            onClick={() => abrir(p.obraId, p.rota)}
                            marca={
                              <span
                                aria-hidden
                                className={cn(
                                  'mt-[7px] size-2 shrink-0 rounded-[1px]',
                                  p.tom === 'danger' ? 'bg-danger' : 'bg-warn'
                                )}
                              />
                            }
                            titulo={
                              <>
                                <span className="sr-only">
                                  {p.tom === 'danger' ? 'Crítico: ' : 'Aviso: '}
                                </span>
                                <span className="tabular font-semibold text-accent">
                                  {p.codigo}
                                </span>{' '}
                                {p.texto}
                              </>
                            }
                            detalhe={p.acao}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </Secao>
                <Secao titulo="Atividade recente" nota="últimos lançamentos" semRecuo>
                  {carteira.carregandoAtividade ? (
                    <Esqueleto />
                  ) : carteira.atividade.length === 0 ? (
                    <p className="px-4 pb-4 text-sm text-text-muted">
                      Nenhuma produção lançada nas obras desta empresa.
                    </p>
                  ) : (
                    <ul>
                      {carteira.atividade.map((a) => (
                        <li key={a.id} className="border-t border-border">
                          <Atividade
                            a={a}
                            codigo={codigoDe.get(a.obra_id) ?? ''}
                            hoje={hoje}
                            aoAbrir={() => abrir(a.obra_id, '/acompanhamento/producao')}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </Secao>
              </div>
            ) : null}
          </div>
        </>
      )}
    </>
  )
}

function CartaoObra({
  obra,
  c,
  carregando,
  emUso,
  interno,
  podeLancar,
  hoje,
  aoAbrir
}: {
  obra: AuthObra
  c: ObraNaCarteira | undefined
  carregando: boolean
  emUso: boolean
  interno: boolean
  podeLancar: boolean
  hoje: string
  aoAbrir: (obraId: string, rota: string) => void
}): ReactNode {
  const local = [c?.rodovia, c?.trecho].filter(Boolean).join(' · ')
  const extensao = c?.extensaoKm ? `${formatNumber(c.extensaoKm, 1)} km` : null
  const dias = c?.ultimaProducao ? diasEntre(c.ultimaProducao, hoje) : null
  const parado = obra.status === 'em_andamento' && dias != null && dias >= DIAS_SEM_LANCAR

  return (
    <article
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded border bg-bg-panel transition-colors hover:border-border-accent',
        emUso ? 'border-accent' : 'border-border'
      )}
    >
      <MapaTracado tracados={c?.tracados ?? []} rotulo={`Traçado da obra ${obra.codigo}`}>
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <SeloSobreMapa>
            <span
              aria-hidden
              className={cn(
                'size-1.5 rounded-full',
                PONTO_STATUS[obra.status] ?? 'bg-[color:var(--na-foto)]'
              )}
            />
            {rotuloStatusObra(obra.status)}
          </SeloSobreMapa>
          {emUso ? <SeloSobreMapa>obra em uso</SeloSobreMapa> : null}
        </div>
        {interno && c && c.alertasCriticos > 0 ? (
          <div className="absolute right-2 top-2">
            <SeloSobreMapa>
              <span aria-hidden className="size-1.5 rounded-full bg-danger" />
              {contar(c.alertasCriticos, 'alerta crítico', 'alertas críticos')}
            </SeloSobreMapa>
          </div>
        ) : null}
      </MapaTracado>

      <div className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-3.5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2 text-xs text-text-muted">
            <span className="shrink-0 tabular font-semibold text-accent">{obra.codigo}</span>
            {extensao ? <span className="shrink-0 tabular">{extensao}</span> : null}
          </div>
          <h3 className="mt-0.5 text-base font-semibold leading-snug text-text">
            <button
              type="button"
              onClick={() => aoAbrir(obra.id, ROTA_PAINEL)}
              className="line-clamp-2 text-left focus-visible:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent"
            >
              {obra.nome}
            </button>
          </h3>
          {local ? (
            <p className="mt-0.5 truncate text-xs text-text-dim" title={local}>
              {local}
            </p>
          ) : null}
        </div>

        {interno ? (
          <div className="mt-auto">
            {carregando ? (
              <div className="flex flex-col gap-2">
                <PulseBlock h={10} w="100%" />
                <PulseBlock h={10} w="55%" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                    Avanço físico
                  </span>
                  <span className="text-sm font-semibold tabular text-text">
                    {!c || c.semLinhaBase || c.avancoPct == null ? '—' : pct(c.avancoPct)}
                  </span>
                </div>
                <BarraAvanco
                  valor={!c || c.semLinhaBase ? 0 : (c.avancoPct ?? 0)}
                  tom={c && c.atrasados > 0 ? 'danger' : 'accent'}
                  className="mt-1.5"
                />
                <p className="mt-1.5 text-xs">
                  {!c || c.semLinhaBase ? (
                    <span className="text-text-dim">sem linha de base vigente</span>
                  ) : c.atrasados > 0 ? (
                    <span className="font-semibold text-danger">
                      {contar(c.atrasados, 'serviço atrasado', 'serviços atrasados')}
                      {c.emRisco > 0 ? `, ${c.emRisco} em risco` : ''}
                    </span>
                  ) : c.emRisco > 0 ? (
                    <span className="font-semibold text-warn">
                      {contar(c.emRisco, 'serviço em risco', 'serviços em risco')}
                    </span>
                  ) : (
                    <span className="font-semibold text-success">
                      {contar(c.servicos, 'serviço', 'serviços')} em dia
                    </span>
                  )}
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>

      {interno ? (
        <footer className="flex min-h-11 items-center justify-between gap-2 border-t border-border px-4 py-1.5 text-xs text-text-muted">
          <span className="min-w-0 truncate">
            {carregando ? (
              <PulseBlock h={10} w={120} />
            ) : c?.ultimaProducao ? (
              <>
                Último lançamento{' '}
                <span className={cn('font-semibold', parado ? 'text-warn' : 'text-text')}>
                  {quando(c.ultimaProducao, hoje)}
                </span>
              </>
            ) : (
              'Nenhuma produção lançada'
            )}
          </span>
          {podeLancar ? (
            <Button
              variant="ghost"
              size="sm"
              className="relative z-10 -mr-2 shrink-0"
              onClick={() => aoAbrir(obra.id, '/acompanhamento/lancar')}
              aria-label={`Lançar produção na obra ${obra.codigo}`}
              title="Lançar produção"
            >
              <Plus size={13} /> Lançar
            </Button>
          ) : null}
        </footer>
      ) : null}
    </article>
  )
}

/** Selo legível sobre a imagem de satélite e sobre o papel quadriculado. */
function SeloSobreMapa({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-[color:var(--sobre-foto)] px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.06em] text-[color:var(--na-foto)]">
      {children}
    </span>
  )
}

function ItemLista({
  onClick,
  marca,
  titulo,
  detalhe
}: {
  onClick: () => void
  marca: ReactNode
  titulo: ReactNode
  detalhe: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-bg-hover focus-visible:outline-none focus-visible:bg-bg-active"
    >
      {marca}
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-text">{titulo}</span>
        <span className="block truncate text-xs text-text-muted">{detalhe}</span>
      </span>
      <ArrowRight
        size={13}
        aria-hidden
        className="mt-1 shrink-0 text-text-dim group-hover:text-text"
      />
    </button>
  )
}

function Atividade({
  a,
  codigo,
  hoje,
  aoAbrir
}: {
  a: AtividadeRecente
  codigo: string
  hoje: string
  aoAbrir: () => void
}): ReactNode {
  const qtd = Number(a.qtd ?? 0)
  // a view devolve "—" quando o lançamento não tem encarregado nem equipe
  const nome = (v: string | null): string | null => (v && v.trim() !== '—' ? v : null)
  const quem = nome(a.encarregado_display_nome) ?? nome(a.equipe_display_nome)
  return (
    <ItemLista
      onClick={aoAbrir}
      marca={<span aria-hidden className="mt-[7px] size-2 shrink-0 rounded-full bg-success" />}
      titulo={
        <span className="flex min-w-0 gap-1.5">
          <span className="shrink-0 tabular font-semibold text-accent">{codigo}</span>
          <span className="truncate">{a.servico_display_nome ?? 'Serviço'}</span>
        </span>
      }
      detalhe={[
        `${formatNumber(qtd, Number.isInteger(qtd) ? 0 : 2)} ${a.unidade ?? ''}`.trim(),
        quem,
        quando(a.data, hoje)
      ]
        .filter(Boolean)
        .join(' · ')}
    />
  )
}

function Esqueleto(): ReactNode {
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <PulseBlock h={14} w="80%" />
      <PulseBlock h={14} w="60%" />
      <PulseBlock h={14} w="70%" />
    </div>
  )
}
