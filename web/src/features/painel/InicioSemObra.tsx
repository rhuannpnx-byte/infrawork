import { useMemo, type ReactNode } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Secao } from '@/components/ui/secao'
import { BarraAvanco } from '@/components/ui/indicador'
import { ErroConsulta, EstadoConsulta, Vazio } from '@/components/ui/estado'
import { PulseBlock } from '@/components/ui/PulseBlock'
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
import { useCarteira, type ObraNaCarteira } from './carteira'

const ORDEM_STATUS = ['em_andamento', 'planejamento', 'paralisado', 'concluido']
const VARIANTE_STATUS: Record<string, BadgeProps['variant']> = {
  em_andamento: 'accent',
  planejamento: 'default',
  paralisado: 'warn',
  concluido: 'success'
}
const PODE_LANCAR = ['god', 'adm', 'engenheiro', 'apoio']
/** Sem lançamento por mais que isso, numa obra em andamento, pede atenção. */
const DIAS_SEM_LANCAR = 7

const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000)

const pct = (v: number): string => `${formatNumber(v * 100, v > 0 && v < 0.1 ? 1 : 0)}%`

/** Início sem obra escolhida: as obras da empresa e o que pede atenção nelas; o God escolhe antes a empresa. */
export function InicioSemObra(): ReactNode {
  const { precisaSelecionarEmpresa } = useCurrentScope()
  return (
    <div className="h-full w-full overflow-auto bg-bg">
      <div className="max-w-[1400px] mx-auto px-5 py-5 flex flex-col gap-4">
        {precisaSelecionarEmpresa ? <EscolherEmpresa /> : <Carteira />}
      </div>
    </div>
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
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.01em] text-text">Escolha a empresa</h1>
          <p className="mt-1 text-sm text-text-muted">
            Seu acesso é geral. As obras aparecem depois que você escolhe a empresa.
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigateActiveTab('/gerencial/empresas')}>
          <Plus size={14} /> Cadastrar empresa
        </Button>
      </header>
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

function Carteira(): ReactNode {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const empresaPerfil = useAuthStore((s) => s.empresa)
  const setObraId = useObraStore((s) => s.setObraId)
  const openModal = useUIStore((s) => s.openModal)
  const { obrasNaEmpresa, empresaId, isGod } = useCurrentScope()
  const { data: empresas = [] } = useEmpresas()
  const interno = !!role && role !== 'cliente'
  const podeLancar = !!role && PODE_LANCAR.includes(role)
  const podeCadastrar = role === 'god' || role === 'adm'
  const hoje = hojeLocalISO()

  const empresaNome =
    empresaPerfil?.nome ?? empresas.find((e) => e.id === empresaId)?.nome ?? 'Obras'
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
  const carteira = useCarteira(ids, interno)

  const abrir = (obraId: string, rota?: string): void => {
    setObraId(obraId)
    if (rota) navigateActiveTab(rota)
  }

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

  const emAndamento = obras.filter((o) => o.status === 'em_andamento').length

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-[-0.01em] text-text truncate">
            {empresaNome}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {obras.length > 0
              ? `${contar(obras.length, 'obra', 'obras')}${emAndamento ? `, ${emAndamento} em andamento` : ''}. Escolha uma obra para abrir o painel dela.`
              : 'Nenhuma obra para mostrar.'}
          </p>
        </div>
        {isGod || podeCadastrar ? (
          <div className="flex flex-wrap gap-2">
            {isGod ? (
              <Button variant="secondary" onClick={() => openModal('projectSwitcher')}>
                Trocar empresa
              </Button>
            ) : null}
            {podeCadastrar ? (
              <Button variant="secondary" onClick={() => navigateActiveTab('/gerencial/obras')}>
                <Plus size={14} /> Cadastrar obra
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {carteira.erro ? (
        <ErroConsulta
          erro={carteira.erro}
          oQue="a situação das obras"
          aoTentar={carteira.tentarDeNovo}
        />
      ) : null}

      {obras.length === 0 ? (
        <Secao titulo="Obras" className="max-w-[900px]">
          <Vazio
            className="py-0"
            acao={
              podeCadastrar ? (
                <Button onClick={() => navigateActiveTab('/gerencial/obras')}>
                  <Plus size={14} /> Cadastrar obra
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
        <div className="flex flex-wrap items-start gap-4">
          <Secao
            titulo="Obras"
            nota={interno ? 'avanço e prazo pela linha de base vigente' : undefined}
            semRecuo
            className="flex-[3_1_640px]"
          >
            <ListaObras
              obras={obras}
              carteira={carteira.porObra}
              carregando={carteira.carregandoSituacao}
              interno={interno}
              podeLancar={podeLancar}
              hoje={hoje}
              aoAbrir={abrir}
            />
          </Secao>
          {interno ? (
            <Secao titulo="Pede atenção" semRecuo className="flex-[1_1_320px]">
              {carteira.carregandoSituacao ? (
                <div className="flex flex-col gap-3 px-4 pb-4">
                  <PulseBlock h={14} w="80%" />
                  <PulseBlock h={14} w="60%" />
                </div>
              ) : pendencias.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-text-muted">
                  Nada pendente: nenhum alerta crítico, serviço atrasado ou obra em andamento
                  parada.
                </p>
              ) : (
                <ul>
                  {pendencias.map((p) => (
                    <li key={`${p.obraId}-${p.rota}`} className="border-t border-border">
                      <button
                        type="button"
                        onClick={() => abrir(p.obraId, p.rota)}
                        className="group w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-bg-hover focus-visible:outline-none focus-visible:bg-bg-active"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'mt-[7px] size-2 shrink-0 rounded-[1px]',
                            p.tom === 'danger' ? 'bg-danger' : 'bg-warn'
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-text">
                            <span className="sr-only">
                              {p.tom === 'danger' ? 'Crítico: ' : 'Aviso: '}
                            </span>
                            <span className="tabular font-semibold text-accent">{p.codigo}</span>{' '}
                            {p.texto}
                          </span>
                          <span className="block text-xs text-text-muted">{p.acao}</span>
                        </span>
                        <ArrowRight
                          size={13}
                          aria-hidden
                          className="mt-1 shrink-0 text-text-dim group-hover:text-text"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          ) : null}
        </div>
      )}
    </>
  )
}

function ListaObras({
  obras,
  carteira,
  carregando,
  interno,
  podeLancar,
  hoje,
  aoAbrir
}: {
  obras: AuthObra[]
  carteira: Map<string, ObraNaCarteira>
  carregando: boolean
  interno: boolean
  podeLancar: boolean
  hoje: string
  aoAbrir: (obraId: string, rota?: string) => void
}): ReactNode {
  // larguras fixas: cada linha é uma grade própria, e só assim o cabeçalho e as linhas ficam alinhados
  const colunas = interno
    ? podeLancar
      ? 'md:grid-cols-[minmax(0,1fr)_10rem_8.5rem_9.5rem_5.5rem]'
      : 'md:grid-cols-[minmax(0,1fr)_10rem_8.5rem_9.5rem]'
    : 'md:grid-cols-[minmax(0,1fr)]'
  const rotulo = 'text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

  return (
    <div>
      {interno ? (
        <div
          aria-hidden
          className={cn('hidden md:grid gap-x-3 px-4 py-2 border-y border-border', colunas, rotulo)}
        >
          <span>Obra</span>
          <span>Avanço físico</span>
          <span>Serviços</span>
          <span>Último lançamento</span>
          {podeLancar ? <span /> : null}
        </div>
      ) : null}
      <ul>
        {obras.map((o) => {
          const c = carteira.get(o.id)
          const local = [c?.rodovia, c?.trecho].filter(Boolean).join(' · ')
          const extensao = c?.extensaoKm ? `${formatNumber(c.extensaoKm, 1)} km` : null
          return (
            <li
              key={o.id}
              className={cn(
                'relative grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 items-center border-t border-border hover:bg-bg-hover',
                // no computador o cabeçalho das colunas já fecha a primeira linha
                interno && 'md:first:border-t-0',
                colunas
              )}
            >
              <div className="col-span-2 md:col-span-1 min-w-0">
                <button
                  type="button"
                  onClick={() => aoAbrir(o.id)}
                  className="flex max-w-full items-baseline gap-2 text-left focus-visible:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent"
                >
                  <span className="tabular font-semibold text-accent shrink-0">{o.codigo}</span>
                  <span className="truncate text-sm font-semibold text-text">{o.nome}</span>
                </button>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-text-muted">
                  <Badge variant={VARIANTE_STATUS[o.status] ?? 'outline'} className="shrink-0">
                    {rotuloStatusObra(o.status)}
                  </Badge>
                  {local || extensao ? (
                    <span
                      className="truncate"
                      title={[local, extensao].filter(Boolean).join(' · ')}
                    >
                      {[local, extensao].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </div>
              </div>
              {interno ? (
                <>
                  <Celula rotulo="Avanço físico" carregando={carregando}>
                    {!c || c.semLinhaBase || c.avancoPct == null ? (
                      <span className="text-sm text-text-dim">sem linha de base</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <BarraAvanco valor={c.avancoPct} className="flex-1" />
                        <span className="w-10 text-right text-sm font-semibold tabular text-text">
                          {pct(c.avancoPct)}
                        </span>
                      </span>
                    )}
                  </Celula>
                  <Celula rotulo="Serviços" carregando={carregando}>
                    <SituacaoServicos c={c} />
                  </Celula>
                  <Celula rotulo="Último lançamento" carregando={carregando}>
                    <UltimoLancamento c={c} hoje={hoje} emAndamento={o.status === 'em_andamento'} />
                  </Celula>
                  {podeLancar ? (
                    <div className="col-span-2 md:col-span-1 relative z-10">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => aoAbrir(o.id, '/acompanhamento/lancar')}
                        aria-label={`Lançar produção na obra ${o.codigo}`}
                        title="Lançar produção"
                      >
                        <Plus size={13} /> Lançar
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Celula({
  rotulo,
  carregando,
  children
}: {
  rotulo: string
  carregando: boolean
  children: ReactNode
}): ReactNode {
  return (
    <div className="min-w-0">
      <span className="block md:sr-only text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
        {rotulo}
      </span>
      {carregando ? <PulseBlock h={12} w="70%" /> : children}
    </div>
  )
}

function SituacaoServicos({ c }: { c: ObraNaCarteira | undefined }): ReactNode {
  if (!c || c.semLinhaBase) return <span className="text-sm text-text-dim">—</span>
  return (
    <span className="block text-sm leading-tight">
      {c.atrasados > 0 ? (
        <span className="block font-semibold text-danger">
          {contar(c.atrasados, 'atrasado', 'atrasados')}
        </span>
      ) : c.emRisco > 0 ? (
        <span className="block font-semibold text-warn">{c.emRisco} em risco</span>
      ) : (
        <span className="block font-semibold text-success">em dia</span>
      )}
      <span className="block text-xs text-text-muted">
        {c.atrasados > 0 && c.emRisco > 0
          ? `${c.emRisco} em risco · ${contar(c.servicos, 'serviço', 'serviços')}`
          : contar(c.servicos, 'serviço', 'serviços')}
      </span>
    </span>
  )
}

function UltimoLancamento({
  c,
  hoje,
  emAndamento
}: {
  c: ObraNaCarteira | undefined
  hoje: string
  emAndamento: boolean
}): ReactNode {
  if (!c?.ultimaProducao) return <span className="text-sm text-text-dim">nenhum</span>
  const dias = diasEntre(c.ultimaProducao, hoje)
  const parado = emAndamento && dias >= DIAS_SEM_LANCAR
  return (
    <span className="block text-sm leading-tight">
      <span className="block font-semibold tabular text-text">{dataBR(c.ultimaProducao)}</span>
      <span className={cn('block text-xs', parado ? 'font-semibold text-warn' : 'text-text-muted')}>
        {dias <= 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${formatNumber(dias, 0)} dias`}
      </span>
    </span>
  )
}
