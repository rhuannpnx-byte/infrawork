import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Box, FileText, Link2, Trash2, Upload, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Segmentado } from '@/components/ui/segmentado'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { BarraAvanco } from '@/components/ui/indicador'
import { Carregando, ErroConsulta, Vazio } from '@/components/ui/estado'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { useAuthStore } from '@/stores/auth-store'
import { formatNumber } from '@/lib/format'
import { dataBR, toLocalISO } from '@/lib/format/local-date'
import {
  divisorMetrosPorUnidade,
  formatMarcadorCompacto,
  metrosToMarcador,
  parseMarcador
} from '@/lib/format/posicao'
import { contar } from '@/lib/rotulos'
import { useBaseline } from '@/features/planejamento/hooks/planejamentos'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { useProducao } from '@/features/acompanhamento/hooks/producao'
import { useCurvaSValor } from '@/features/acompanhamento/hooks/curva-valor'
import type { ObraTrecho } from '@/types/gerencial'
import {
  useAtivarModelo4D,
  useExcluirModelo4D,
  useModeloPronto,
  useModelos4D,
  usePlanoNoTempo,
  useServicosDaObra,
  useVinculos4D
} from '../hooks/modelo4d'
import { Estado4D, situacao, type Lancamento, type Situacao, type Vinculos } from '../lib/estado'
import { montarLancamentos } from '../lib/plano'
import { montarPrompt } from '../lib/prompt'
import { Cena4D, type Cena4DRef, type Modo4D } from './Cena4D'
import { ImportarModeloDialog, PromptModeloDialog, VincularModeloDialog } from './Dialogos4D'
import { DIA, LinhaDoTempo } from './LinhaDoTempo'

const fimDoDia = (t: number): number => {
  const d = new Date(t)
  d.setHours(23, 59, 59, 0)
  return d.getTime()
}

const ROTULO_SITUACAO: Record<Situacao, string> = {
  concluido: 'Concluído',
  adiantado: 'Adiantado',
  execucao: 'Em execução',
  atrasado: 'Atrasado',
  nao_iniciado: 'Não iniciado'
}
const COR_SITUACAO: Record<Situacao, string> = {
  concluido: 'bg-success',
  adiantado: 'bg-module-planejamento',
  execucao: 'bg-accent',
  atrasado: 'bg-danger',
  nao_iniciado: 'bg-text-faint'
}

const pct = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`

export function Pagina4D({
  obraId,
  obraRotulo
}: {
  obraId: string
  obraRotulo: string
}): ReactNode {
  const papel = useAuthStore((s) => s.profile?.role ?? null)
  const planeja = papel === 'god' || papel === 'adm' || papel === 'engenheiro'

  const modelos = useModelos4D(obraId)
  const registro = modelos.data?.find((m) => m.ativo) ?? modelos.data?.[0] ?? null
  const pronto = useModeloPronto(registro)
  const gravados = useVinculos4D(registro?.id)
  const trechos = useObraTrechos(obraId)
  const servicos = useServicosDaObra(obraId)
  const linhaBase = useBaseline(obraId)
  const plano = usePlanoNoTempo(linhaBase.data?.id)
  const producao = useProducao(obraId, {})
  const curva = useCurvaSValor(obraId)
  const ativar = useAtivarModelo4D()
  const excluir = useExcluirModelo4D()

  const [importar, setImportar] = useState(false)
  const [vincular, setVincular] = useState(false)
  const [prompt, setPrompt] = useState(false)
  const [modo, setModo] = useState<Modo4D>('comparar')
  const [de, setDe] = useState<string | null>(null)
  const [ate, setAte] = useState<string | null>(null)
  const [ocultas, setOcultas] = useState<ReadonlySet<string>>(new Set())
  const [mostrarFalta, setMostrarFalta] = useState(true)
  const [exagero, setExagero] = useState('1')
  const [selecionada, setSelecionada] = useState<number | null>(null)
  const [estaca, setEstaca] = useState('')
  const [erroEstaca, setErroEstaca] = useState<string | null>(null)
  const [tocando, setTocando] = useState(false)
  const [velocidade, setVelocidade] = useState(30)
  const [hoje] = useState(() => fimDoDia(Date.now()))
  const [t, setT] = useState(hoje)
  const cena = useRef<Cena4DRef>(null)

  const locais = useMemo(() => trechos.data ?? [], [trechos.data])
  const vinculos = useMemo<Vinculos>(() => {
    const eixos: Vinculos['eixos'] = {}
    for (const e of gravados.data?.eixos ?? []) {
      const l = locais.find((x) => x.id === e.trecho_id)
      if (l)
        eixos[e.eixo] = {
          ...l,
          comprimento_m: l.comprimento_m == null ? null : Number(l.comprimento_m)
        }
    }
    return {
      eixos,
      classes: Object.fromEntries(
        (gravados.data?.classes ?? []).map((c) => [c.classe, c.item_orcamentario_id])
      )
    }
  }, [gravados.data, locais])

  const lancamentos = useMemo<Lancamento[]>(
    () => montarLancamentos(producao.data ?? []),
    [producao.data]
  )

  const temVinculo =
    Object.keys(vinculos.eixos).length > 0 && Object.keys(vinculos.classes).length > 0
  const estado = useMemo(() => {
    if (!pronto.data || !temVinculo) return null
    return new Estado4D(
      pronto.data,
      plano.data?.trechos ?? [],
      lancamentos,
      vinculos,
      plano.data?.perfis
    )
  }, [pronto.data, temVinculo, plano.data, lancamentos, vinculos])

  const [inicio, fim] = useMemo<[number, number]>(() => {
    const dias = lancamentos.map((l) => l.dia)
    const a = Math.min(estado && Number.isFinite(estado.inicio) ? estado.inicio : Infinity, ...dias)
    const b = Math.max(
      estado && Number.isFinite(estado.fim) ? estado.fim : -Infinity,
      ...dias,
      hoje
    )
    const ini = Number.isFinite(a) ? a : hoje - 30 * DIA
    const d = new Date(ini)
    d.setHours(0, 0, 0, 0)
    return [d.getTime(), fimDoDia(b)]
  }, [estado, lancamentos, hoje])

  // a simulação anda `velocidade` dias de obra por segundo e para no fim
  useEffect(() => {
    if (!tocando) return
    let antes = performance.now()
    const id = window.setInterval(() => {
      const agora = performance.now()
      const passo = ((agora - antes) / 1000) * velocidade * DIA
      antes = agora
      setT((x) => {
        const n = x + passo
        if (n >= fim) {
          setTocando(false)
          return fim
        }
        return n
      })
    }, 50)
    return () => window.clearInterval(id)
  }, [tocando, velocidade, fim])

  const instante = fimDoDia(Math.max(inicio, Math.min(fim, t)))
  const periodo = useMemo<[number, number] | null>(
    () =>
      de && ate
        ? [new Date(`${de}T00:00:00`).getTime(), fimDoDia(new Date(`${ate}T12:00:00`).getTime())]
        : null,
    [de, ate]
  )

  const resumo = useMemo(() => {
    const m = new Map<string, { previsto: number; realizado: number; total: number }>()
    for (const r of estado?.resumo(instante) ?? []) m.set(r.item_id, r)
    return m
  }, [estado, instante])

  const texto = useMemo(
    () =>
      montarPrompt({
        obra: obraRotulo,
        locais: locais.map((l) => ({
          ...l,
          comprimento_m: l.comprimento_m == null ? null : Number(l.comprimento_m)
        })),
        servicos: servicos.data ?? [],
        plano: plano.data?.trechos ?? []
      }),
    [obraRotulo, locais, servicos.data, plano.data]
  )

  const modelo = pronto.data
  const eixoLocal = (ie: number): ObraTrecho | undefined => {
    const id = modelo?.modelo.eixos[ie]?.id
    return id ? (vinculos.eixos[id] as ObraTrecho | undefined) : undefined
  }

  function irParaEstaca(): void {
    if (!modelo) return
    const l = eixoLocal(0)
    const txt = estaca.trim()
    if (!txt) return
    let s: number | null = null
    if (l) {
      const r = parseMarcador(txt, l)
      if (r.metros != null) s = metrosToMarcador(r.metros, l) * divisorMetrosPorUnidade(l)
    } else {
      const n = Number(txt.replace(',', '.'))
      if (Number.isFinite(n)) s = n * 20
    }
    if (s == null) {
      setErroEstaca(
        l ? 'Posição fora do local ou em formato que não entendi.' : 'Digite o número da estaca.'
      )
      return
    }
    setErroEstaca(null)
    cena.current?.irPara(0, s)
  }

  const acoes = planeja ? (
    <>
      <Button variant="secondary" onClick={() => setPrompt(true)}>
        <FileText size={14} aria-hidden /> Prompt do modelo
      </Button>
      {registro ? (
        <Button variant="secondary" onClick={() => setVincular(true)}>
          <Link2 size={14} aria-hidden /> Vincular ao plano
        </Button>
      ) : null}
      <Button onClick={() => setImportar(true)}>
        <Upload size={14} aria-hidden /> Importar modelo
      </Button>
    </>
  ) : null

  const dialogos = (
    <>
      <ImportarModeloDialog
        open={importar}
        onOpenChange={setImportar}
        obraId={obraId}
        trechos={locais}
        servicos={servicos.data ?? []}
      />
      {registro ? (
        <VincularModeloDialog
          open={vincular}
          onOpenChange={setVincular}
          registro={registro}
          atuais={gravados.data}
          trechos={locais}
          servicos={servicos.data ?? []}
        />
      ) : null}
      <PromptModeloDialog
        open={prompt}
        onOpenChange={setPrompt}
        texto={texto}
        semLinhaBase={!linhaBase.isLoading && !linhaBase.data}
      />
    </>
  )

  const titulo = (
    <PageHeader
      title="Acompanhamento 4D"
      subtitle="A obra em 3D no tempo: o previsto do plano e o realizado dos lançamentos, pela estaca."
      actions={
        <>
          <Badge variant="accent">beta</Badge>
          {acoes}
        </>
      }
    />
  )

  if (modelos.isLoading) {
    return (
      <div className="flex h-full flex-col">
        {titulo}
        <Carregando className="px-5" />
      </div>
    )
  }
  if (modelos.error) {
    return (
      <div className="flex h-full flex-col">
        {titulo}
        <ErroConsulta
          erro={modelos.error}
          oQue="os modelos da obra"
          aoTentar={() => void modelos.refetch()}
          className="m-5"
        />
      </div>
    )
  }
  if (!registro) {
    return (
      <div className="flex h-full flex-col">
        {titulo}
        <Vazio
          className="px-5"
          acao={
            planeja ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setImportar(true)}>
                  <Upload size={14} aria-hidden /> Importar modelo
                </Button>
                <Button variant="secondary" onClick={() => setPrompt(true)}>
                  <FileText size={14} aria-hidden /> Gerar o prompt do modelo
                </Button>
              </div>
            ) : undefined
          }
        >
          Esta obra ainda não tem modelo 3D. Importe o HTML da construção digital ou um arquivo no
          contrato infrawork-4d. Para gerar o modelo já ligado aos serviços do plano, use o prompt.
          {planeja ? '' : ' Quem planeja a obra faz a importação.'}
        </Vazio>
        {dialogos}
      </div>
    )
  }

  const classes = modelo?.modelo.classes ?? []
  const disciplinas = [...new Set(classes.map((c) => c.disciplina))]
  const servicoDe = (
    classeId: string
  ): { codigo: string; descricao: string; unidade: string | null } | undefined =>
    servicos.data?.find((s) => s.id === vinculos.classes[classeId])
  const semEstaca = estado?.semEstaca.length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {titulo}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-bg-panel px-5 py-2">
        <Segmentado
          rotulo="O que a cena mostra"
          valor={modo}
          aoMudar={setModo}
          tamanho="sm"
          opcoes={[
            { valor: 'previsto', rotulo: 'Previsto', titulo: 'A obra como o plano prevê na data' },
            {
              valor: 'realizado',
              rotulo: 'Realizado',
              titulo: 'A obra como foi lançada até a data'
            },
            {
              valor: 'comparar',
              rotulo: 'Comparar',
              titulo: 'Cada peça na cor da situação: previsto contra realizado'
            }
          ]}
        />
        <DateRangePopover
          from={de}
          to={ate}
          onChange={(a, b) => {
            setDe(a)
            setAte(b)
          }}
          placeholder="Destacar um período"
        />
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            irParaEstaca()
          }}
        >
          <Input
            aria-label="Ir para a estaca"
            aria-invalid={erroEstaca ? true : undefined}
            title={erroEstaca ?? undefined}
            placeholder="Ir para a estaca"
            value={estaca}
            onChange={(e) => {
              setEstaca(e.target.value)
              setErroEstaca(null)
            }}
            className="h-7 w-36 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm">
            Ir
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => cena.current?.vistaGeral()}
          >
            Vista geral
          </Button>
        </form>
        <Segmentado
          rotulo="Exagero vertical"
          valor={exagero}
          aoMudar={setExagero}
          tamanho="sm"
          opcoes={[
            { valor: '1', rotulo: '1×', titulo: 'Relevo na escala real' },
            {
              valor: '3',
              rotulo: '3×',
              titulo: 'Relevo três vezes mais alto, para ler cortes e aterros'
            }
          ]}
        />
        <label className="flex items-center gap-1.5 text-sm text-text">
          <input
            type="checkbox"
            checked={mostrarFalta}
            onChange={(e) => setMostrarFalta(e.target.checked)}
            className="accent-[color:var(--accent)]"
          />
          Mostrar o que falta
        </label>
        {(modelos.data?.length ?? 0) > 1 ? (
          <div className="ml-auto flex items-center gap-1">
            <div className="w-56">
              <Select
                aria-label="Modelo em uso"
                className="h-7 text-sm"
                value={registro.id}
                disabled={!planeja || ativar.isPending}
                title={planeja ? undefined : 'Só quem planeja a obra troca o modelo em uso'}
                onChange={(e) => ativar.mutate(e.target.value)}
              >
                {modelos.data!.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome} · {dataBR(m.created_at.slice(0, 10))}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
        {planeja ? (
          <IconButton
            aria-label="Excluir este modelo"
            className={(modelos.data?.length ?? 0) > 1 ? '' : 'ml-auto'}
            disabled={excluir.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  `Excluir o modelo "${registro.nome}"? Os vínculos dele também saem.`
                )
              )
                return
              excluir.mutate(registro.id, {
                onSuccess: () => toast.success('Modelo excluído.'),
                onError: (e) => toast.error(`O modelo não foi excluído: ${e.message}`)
              })
            }}
          >
            <Trash2 size={14} />
          </IconButton>
        ) : null}
      </div>

      {!gravados.isLoading && !temVinculo ? (
        <Aviso
          acao={
            planeja ? (
              <Button size="sm" variant="secondary" onClick={() => setVincular(true)}>
                Vincular ao plano
              </Button>
            ) : null
          }
        >
          O modelo ainda não está ligado ao plano: a cena aparece sem previsto nem realizado.
        </Aviso>
      ) : !linhaBase.isLoading && !linhaBase.data ? (
        <Aviso>A obra não tem linha de base vigente: só o realizado aparece.</Aviso>
      ) : semEstaca > 0 ? (
        <Aviso
          acao={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigateActiveTab('/acompanhamento/producao')}
            >
              Ver a produção
            </Button>
          }
        >
          {contar(semEstaca, 'lançamento', 'lançamentos')} sem estaca{' '}
          {semEstaca === 1 ? 'não aparece' : 'não aparecem'} na cena (entram só nos percentuais).
        </Aviso>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Camadas e avanço"
          className="hidden w-72 shrink-0 overflow-y-auto border-r border-border bg-bg-panel px-3 py-3 md:block"
        >
          {disciplinas.map((d) => (
            <div key={d} className="mb-3">
              <h3 className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                {d}
              </h3>
              <ul className="mt-1 flex flex-col gap-1.5">
                {classes
                  .filter((c) => c.disciplina === d)
                  .map((c) => {
                    const s = servicoDe(c.id)
                    const r = s ? resumo.get(vinculos.classes[c.id]!) : undefined
                    return (
                      <li key={c.id}>
                        <label className="flex items-start gap-2 text-sm text-text">
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-[color:var(--accent)]"
                            checked={!ocultas.has(c.id)}
                            onChange={(e) => {
                              const n = new Set(ocultas)
                              if (e.target.checked) n.delete(c.id)
                              else n.add(c.id)
                              setOcultas(n)
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate" title={c.nome}>
                              {c.nome}
                            </span>
                            {c.contexto ? null : s ? (
                              <span
                                className="block truncate text-xs text-text-muted"
                                title={`${s.codigo} · ${s.descricao}`}
                              >
                                {s.codigo}
                                {r && r.total > 0
                                  ? ` · previsto ${pct(r.previsto / r.total)} · realizado ${pct(r.realizado / r.total)}`
                                  : ' · fora da linha de base'}
                              </span>
                            ) : (
                              <span className="block text-xs text-text-muted">
                                sem serviço vinculado
                              </span>
                            )}
                          </span>
                        </label>
                        {r && r.total > 0 ? (
                          <BarraAvanco
                            className="ml-5 mt-1"
                            valor={r.realizado / r.total}
                            marca={r.previsto / r.total}
                            tom={r.realizado + 1e-9 >= r.previsto ? 'success' : 'danger'}
                          />
                        ) : null}
                      </li>
                    )
                  })}
              </ul>
            </div>
          ))}
        </aside>

        <div className="relative min-w-0 flex-1">
          {pronto.isLoading ? (
            <Carregando texto="Montando o modelo…" className="px-5" />
          ) : pronto.error ? (
            <ErroConsulta
              erro={pronto.error}
              oQue="o arquivo do modelo"
              aoTentar={() => void pronto.refetch()}
              className="m-5"
            />
          ) : modelo ? (
            <>
              <Cena4D
                ref={cena}
                modelo={modelo}
                estado={estado}
                t={instante}
                modo={modo}
                periodo={periodo}
                ocultas={ocultas}
                mostrarFalta={mostrarFalta}
                exagero={Number(exagero)}
                selecionada={selecionada}
                aoEscolher={setSelecionada}
                rotulo={`Modelo 3D da obra em ${dataBR(toLocalISO(new Date(instante)))}`}
              />
              <Legenda modo={modo} mostrarFalta={mostrarFalta} comEstado={!!estado} />
              {selecionada != null && modelo.pecas[selecionada] ? (
                <Ficha
                  i={selecionada}
                  estado={estado}
                  modelo={modelo}
                  local={eixoLocal(modelo.pecas[selecionada].eixo)}
                  servico={servicoDe(classes[modelo.pecas[selecionada].classe].id)}
                  instante={instante}
                  aoFechar={() => setSelecionada(null)}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <LinhaDoTempo
        inicio={inicio}
        fim={fim}
        hoje={hoje}
        t={instante}
        aoMudar={(x) => {
          setTocando(false)
          setT(fimDoDia(x))
        }}
        tocando={tocando}
        aoAlternar={() => {
          if (!tocando && instante >= fim) setT(inicio)
          setTocando((v) => !v)
        }}
        velocidade={velocidade}
        aoVelocidade={setVelocidade}
        curva={curva.pontos}
      />
      {dialogos}
    </div>
  )
}

function Aviso({ children, acao }: { children: ReactNode; acao?: ReactNode }): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-warn/10 px-5 py-1.5 text-sm text-text">
      <AlertTriangle size={14} className="shrink-0 text-warn" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {acao}
    </div>
  )
}

function Legenda({
  modo,
  mostrarFalta,
  comEstado
}: {
  modo: Modo4D
  mostrarFalta: boolean
  comEstado: boolean
}): ReactNode {
  if (!comEstado) return null
  const itens: [string, string][] =
    modo === 'comparar'
      ? [
          [COR_SITUACAO.concluido, 'Concluído'],
          [COR_SITUACAO.adiantado, 'Adiantado'],
          [COR_SITUACAO.execucao, 'Em execução'],
          [COR_SITUACAO.atrasado, 'Atrasado']
        ]
      : [[COR_SITUACAO.execucao, modo === 'previsto' ? 'Frente prevista' : 'Em execução']]
  return (
    <ul
      aria-label="Legenda"
      className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded border border-border bg-bg-panel px-2.5 py-1.5 text-xs text-text"
    >
      {modo === 'comparar' ? null : (
        <li className="flex items-center gap-1.5">
          <Box size={12} className="text-text-muted" aria-hidden /> pronto, na cor do material
        </li>
      )}
      {itens.map(([cor, rotulo]) => (
        <li key={rotulo} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-sm ${cor}`} aria-hidden /> {rotulo}
        </li>
      ))}
      {mostrarFalta ? (
        <li className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm border border-border-strong bg-bg-elevated"
            aria-hidden
          />{' '}
          falta fazer
        </li>
      ) : null}
    </ul>
  )
}

function Ficha({
  i,
  estado,
  modelo,
  local,
  servico,
  instante,
  aoFechar
}: {
  i: number
  estado: Estado4D | null
  modelo: NonNullable<ReturnType<typeof useModeloPronto>['data']>
  local: ObraTrecho | undefined
  servico: { codigo: string; descricao: string; unidade: string | null } | undefined
  instante: number
  aoFechar: () => void
}): ReactNode {
  const p = modelo.pecas[i]
  const c = modelo.modelo.classes[p.classe]
  const vinculada = !!estado?.vinculada[i]
  const dados = useMemo(() => {
    if (!estado || !vinculada) return null
    const prev = new Float32Array(modelo.pecas.length)
    const real = new Float32Array(modelo.pecas.length)
    estado.calcularEm(instante, prev, real)
    return {
      prev: prev[i],
      real: real[i],
      janela: estado.janelaPrevista(i),
      lancamentos: estado.lancamentosDaPeca(i).sort((a, b) => b.dia - a.dia)
    }
  }, [estado, vinculada, modelo, instante, i])

  const pos = (m: number): string => (local ? formatMarcadorCompacto(Math.max(0, m), local) : '')
  const onde =
    vinculada && estado && local
      ? estado.m1[i] - estado.m0[i] > 0.5
        ? `${pos(estado.m0[i])} a ${pos(estado.m1[i])}`
        : pos(estado.m0[i])
      : p.s1 - p.s0 > 0.5
        ? `est. ${formatNumber(p.s0 / 20, 1)} a ${formatNumber(p.s1 / 20, 1)}`
        : `est. ${formatNumber(p.s0 / 20, 1)}`
  const dia = (t: number): string => dataBR(toLocalISO(new Date(t)))
  const sit = dados ? situacao(dados.prev, dados.real) : null

  return (
    <section
      aria-label="Elemento escolhido"
      className="absolute right-3 top-3 max-h-[calc(100%-1.5rem)] w-72 overflow-y-auto rounded border border-border bg-bg-panel p-3 shadow-[var(--sombra-flutuante)]"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text">{p.nome ?? c.nome}</h3>
          <p className="text-xs text-text-muted">
            {p.nome ? `${c.nome} · ` : ''}
            {onde}
          </p>
        </div>
        <IconButton aria-label="Fechar a ficha" onClick={aoFechar}>
          <X size={14} />
        </IconButton>
      </div>

      {!dados ? (
        <p className="mt-2 text-sm text-text-muted">
          {c.contexto
            ? 'Elemento de contexto: não entra no 4D.'
            : 'Classe sem serviço vinculado: aparece só como contexto.'}
        </p>
      ) : (
        <dl className="mt-2 flex flex-col gap-2 text-sm">
          {sit ? (
            <div className="flex items-center gap-1.5">
              <span className={`size-2.5 rounded-sm ${COR_SITUACAO[sit]}`} aria-hidden />
              <span className="font-medium text-text">{ROTULO_SITUACAO[sit]}</span>
              <span className="text-text-muted">em {dia(instante)}</span>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-text-muted">Serviço</dt>
            <dd className="text-text">
              {servico ? `${servico.codigo} · ${servico.descricao}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Previsto</dt>
            <dd className="text-text">
              {dados.janela
                ? dia(dados.janela[0]) === dia(dados.janela[1])
                  ? `${dia(dados.janela[0])} · ${pct(dados.prev)} na data`
                  : `${dia(dados.janela[0])} a ${dia(dados.janela[1])} · ${pct(dados.prev)} na data`
                : 'A linha de base não passa por esta estaca.'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Realizado</dt>
            <dd className="text-text">
              {pct(dados.real)} na data
              {dados.lancamentos.length
                ? ` · ${contar(dados.lancamentos.length, 'lançamento', 'lançamentos')} nesta estaca`
                : ' · nenhum lançamento nesta estaca'}
            </dd>
          </div>
          {dados.lancamentos.length ? (
            <ul className="divide-y divide-border border-t border-border text-xs">
              {dados.lancamentos.slice(0, 6).map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-2 py-1">
                  <span className="text-text-muted tabular">{dia(l.dia)}</span>
                  <span className="truncate text-text-muted">
                    {l.inicio_m != null && l.fim_m != null
                      ? `${pos(l.inicio_m)} a ${pos(l.fim_m)}`
                      : ''}
                  </span>
                  <span className="shrink-0 text-text tabular">
                    {formatNumber(l.quantidade, 2)} {servico?.unidade ?? ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </dl>
      )}
    </section>
  )
}
