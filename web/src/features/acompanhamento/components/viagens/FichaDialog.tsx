/**
 * Ficha de viagens de um veículo no dia: cabeçalho (data, veículo, motorista, encarregado, equipe) e uma linha por
 * viagem. A nova viagem repete serviço, origem, destino, quantidade e máquina de carga da anterior. A DMT aparece
 * calculada (lib/dmt, a mesma regra do banco); o banco recalcula ao gravar e recompõe a produção do dia.
 */
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Campo } from '@/components/ui/campo'
import { Carregando, ErroConsulta } from '@/components/ui/estado'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { hojeLocalISO } from '@/lib/format/local-date'
import { formatMarcador, parseMarcador } from '@/lib/format/posicao'
import { formatNumber } from '@/lib/format/number'
import { contar } from '@/lib/rotulos'
import { cn } from '@/lib/utils'
import { useEquipes } from '@/features/planejamento/hooks/equipes'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { ctxObraTrecho } from '@/features/planejamento/lib/trecho'
import {
  parametroDe,
  useParametrosServicos,
  useServicosParametrizaveis
} from '@/features/planejamento/hooks/parametros'
import { useEncarregados } from '../../hooks/lancamento'
import {
  TIPO_LOCAL_LABEL,
  ehMaquinaDeCarga,
  useVeiculos,
  useVeiculosDaObra,
  useLocaisTransporte,
  useExcluirFicha,
  useSalvarFicha,
  type FichaInput,
  type FichaViagens
} from '../../hooks/viagens'
import { calcularDmt, pedeEstaca } from '../../lib/dmt'
import { parseQtd } from '../../lib/parse-qtd'
import { useConfirm } from '@/components/modals/ConfirmDialog'

interface LinhaViagem {
  id: string
  item: string
  origem: string
  destino: string
  estacaCarga: string
  estacaDescarga: string
  horaCarga: string
  horaDescarga: string
  /** na unidade do serviço */
  qtd: string
  mat: string
  dmtManual: boolean
  dmt: string
  nf: string
  carregador: string
}

type CampoViagem =
  'item' | 'origem' | 'destino' | 'estacaCarga' | 'estacaDescarga' | 'qtd' | 'dmt' | 'nf'

const TH = 'px-2 py-2 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'

const txtNum = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v).replace('.', ',')

export function FichaDialog({
  open,
  onOpenChange,
  obraId,
  ficha,
  podeExcluir = false
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  obraId: string
  /** edita; sem ficha, cria */
  ficha: FichaViagens | null
  podeExcluir?: boolean
}): ReactNode {
  if (!open) return null
  return (
    <Carregar onOpenChange={onOpenChange} obraId={obraId} ficha={ficha} podeExcluir={podeExcluir} />
  )
}

/** O formulário monta o estado inicial das linhas (estacas na unidade do trecho): espera os cadastros. */
function Carregar(props: {
  onOpenChange: (o: boolean) => void
  obraId: string
  ficha: FichaViagens | null
  podeExcluir: boolean
}): ReactNode {
  const transp = useLocaisTransporte(props.obraId)
  const trechos = useObraTrechos(props.obraId)
  const parametros = useParametrosServicos(props.obraId)
  if (!transp.data || !trechos.data || !parametros.data) {
    const erro = transp.error ?? trechos.error ?? parametros.error
    return (
      <Dialog open onOpenChange={props.onOpenChange} size="sm">
        <DialogHeader>
          <DialogTitle>Ficha de viagens</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {erro ? (
            <ErroConsulta
              erro={erro}
              oQue="os cadastros da ficha"
              aoTentar={() => {
                void transp.refetch()
                void trechos.refetch()
                void parametros.refetch()
              }}
            />
          ) : (
            <Carregando texto="Carregando locais, trechos e serviços…" />
          )}
        </DialogBody>
      </Dialog>
    )
  }
  return <Form {...props} />
}

function Form({
  onOpenChange,
  obraId,
  ficha,
  podeExcluir
}: {
  onOpenChange: (o: boolean) => void
  obraId: string
  ficha: FichaViagens | null
  podeExcluir: boolean
}): ReactNode {
  const { data: servicos = [] } = useServicosParametrizaveis(obraId)
  const { data: parametros } = useParametrosServicos(obraId)
  const { data: daObra = [] } = useVeiculosDaObra(obraId)
  // ficha antiga pode citar veículo que saiu da obra: busca só esses
  const citados = [
    ficha?.veiculo_id ?? '',
    ...(ficha?.viagens ?? []).map((v) => v.carregador_id ?? '')
  ]
  const { data: extras = [] } = useVeiculos(
    citados.filter((id) => id && !daObra.some((v) => v.id === id))
  )
  const frota = [...daObra, ...extras]
  const { data: transp } = useLocaisTransporte(obraId)
  const { data: trechos = [] } = useObraTrechos(obraId)
  const { data: equipes = [] } = useEquipes(obraId)
  const { data: encarregados = [] } = useEncarregados(obraId)
  const salvar = useSalvarFicha()
  const excluir = useExcluirFicha()
  const confirm = useConfirm()

  const servicosViagem = servicos.filter(
    (s) => parametroDe(parametros, s.id).modo_lancamento === 'viagens'
  )
  const todosLocais = transp?.locais ?? []
  const locais = todosLocais.filter((l) => l.ativo)
  const rotas = transp?.rotas ?? []
  const localDe = (id: string): (typeof todosLocais)[number] | undefined =>
    todosLocais.find((l) => l.id === id)
  const trechoDe = (id: string | null | undefined): (typeof trechos)[number] | undefined =>
    trechos.find((t) => t.id === id)
  const tipoTrecho = (id: string): 'eixo' | 'area' | null => trechoDe(id)?.tipo ?? null
  /** eixo da ponta na pista (pede a estaca da viagem) */
  const eixoDaPonta = (localId: string): (typeof trechos)[number] | null => {
    const l = localDe(localId)
    return l && pedeEstaca(l, tipoTrecho) ? (trechoDe(l.trecho_id) ?? null) : null
  }
  const lerEstaca = (txt: string, eixo: (typeof trechos)[number] | null): number | null => {
    if (!eixo || !txt.trim()) return null
    return parseMarcador(txt.trim(), ctxObraTrecho(eixo)).metros
  }

  const caminhoes = daObra.filter((v) => !ehMaquinaDeCarga(v))
  const maquinas = daObra.filter(ehMaquinaDeCarga)
  // ficha antiga com veículo que saiu da obra: continua aparecendo
  const comAtual = (lista: typeof daObra, id: string): typeof daObra => {
    const atual = id && !lista.some((v) => v.id === id) ? frota.find((v) => v.id === id) : undefined
    return atual ? [...lista, atual] : lista
  }
  const rotulo = (v: (typeof daObra)[number]): string =>
    `${v.prefixo}${v.placa ? ` · ${v.placa}` : ''}${v.proprietario === 'terceiro' ? ' · terceiro' : ''}`

  const [data, setData] = useState(ficha?.data ?? hojeLocalISO())
  const [veiculo, setVeiculo] = useState(ficha?.veiculo_id ?? '')
  const [motorista, setMotorista] = useState(ficha?.motorista ?? '')
  const [encarregado, setEncarregado] = useState(ficha?.encarregado_id ?? '')
  const [equipe, setEquipe] = useState(ficha?.equipe_id ?? '')
  const [obs, setObs] = useState(ficha?.obs ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [linhas, setLinhas] = useState<LinhaViagem[]>(() =>
    (ficha?.viagens ?? []).map((v) => {
      const ec = eixoDaPonta(v.origem_id ?? '')
      const ed = eixoDaPonta(v.destino_id ?? '')
      return {
        id: v.id,
        item: v.item_orcamentario_id,
        origem: v.origem_id ?? '',
        destino: v.destino_id ?? '',
        estacaCarga: ec ? formatMarcador(v.estaca_carga_m, ctxObraTrecho(ec)) : '',
        estacaDescarga: ed ? formatMarcador(v.estaca_descarga_m, ctxObraTrecho(ed)) : '',
        horaCarga: v.hora_carga?.slice(0, 5) ?? '',
        horaDescarga: v.hora_descarga?.slice(0, 5) ?? '',
        qtd: txtNum(v.quantidade),
        mat: txtNum(v.material_qtd),
        dmtManual: v.dmt_manual,
        dmt: v.dmt_manual ? txtNum(v.dmt_km) : '',
        nf: v.nf_ticket ?? '',
        carregador: v.carregador_id ?? ''
      }
    })
  )
  const fichaId = useMemo(() => ficha?.id ?? crypto.randomUUID(), [ficha?.id])
  const capacidade = frota.find((v) => v.id === veiculo)?.capacidade_m3 ?? null

  const nova = (): void =>
    setLinhas((ls) => {
      const ult = ls[ls.length - 1]
      return [
        ...ls,
        {
          id: crypto.randomUUID(),
          item: ult?.item ?? servicosViagem[0]?.id ?? '',
          origem: ult?.origem ?? '',
          destino: ult?.destino ?? '',
          estacaCarga: ult?.estacaCarga ?? '',
          estacaDescarga: ult?.estacaDescarga ?? '',
          horaCarga: '',
          horaDescarga: '',
          qtd: ult?.qtd ?? '',
          mat: '',
          dmtManual: false,
          dmt: '',
          nf: '',
          carregador: ult?.carregador ?? ''
        }
      ]
    })
  const setLinha = (i: number, patch: Partial<LinhaViagem>): void =>
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))

  /** DMT da linha, como o banco vai calcular */
  const calculo = (
    l: LinhaViagem
  ): {
    dmt: ReturnType<typeof calcularDmt>
    par: ReturnType<typeof parametroDe>
  } => {
    const par = parametroDe(parametros, l.item)
    return {
      par,
      dmt: calcularDmt({
        origem: localDe(l.origem),
        destino: localDe(l.destino),
        estacaCarga: lerEstaca(l.estacaCarga, eixoDaPonta(l.origem)),
        estacaDescarga: lerEstaca(l.estacaDescarga, eixoDaPonta(l.destino)),
        rotas,
        tipoTrecho
      })
    }
  }

  // total por unidade: serviços de unidades diferentes não se somam
  const totais = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of linhas) {
      const q = parseQtd(l.qtd)
      if (q === null) continue
      const un = servicos.find((x) => x.id === l.item)?.unidade ?? ''
      m.set(un, (m.get(un) ?? 0) + q)
    }
    return [...m.entries()]
  }, [linhas, servicos])

  /** Confere a ficha: erros por campo (`id da viagem:campo`) e as viagens prontas para gravar. */
  const conferir = (): { erros: Record<string, string>; viagens: FichaInput['viagens'] } => {
    const erros: Record<string, string> = {}
    const viagens: FichaInput['viagens'] = []
    if (data > hojeLocalISO()) erros.data = 'A data não pode ser no futuro.'
    if (!linhas.length) erros.viagens = 'Inclua ao menos uma viagem.'
    for (const l of linhas) {
      const marcar = (c: CampoViagem, msg: string): void => {
        erros[`${l.id}:${c}`] = msg
      }
      if (!l.item) marcar('item', 'Escolha o serviço.')
      if (!l.origem) marcar('origem', 'Escolha a origem.')
      if (!l.destino) marcar('destino', 'Escolha o destino.')
      const ec = eixoDaPonta(l.origem)
      const ed = eixoDaPonta(l.destino)
      const pc = lerEstaca(l.estacaCarga, ec)
      const pd = lerEstaca(l.estacaDescarga, ed)
      const faltaCarga = !!ec && pc === null
      const faltaDescarga = !!ed && pd === null
      if (faltaCarga) marcar('estacaCarga', 'Informe a estaca de carga.')
      if (faltaDescarga) marcar('estacaDescarga', 'Informe a estaca de descarga.')
      const { dmt, par } = calculo(l)
      const q = parseQtd(l.qtd)
      if (q === null || q <= 0) marcar('qtd', 'Informe a quantidade.')
      if (par.medicao_viagem === 'peso' && !l.nf.trim())
        marcar('nf', 'Informe o ticket da balança.')
      const manual = l.dmtManual ? parseQtd(l.dmt) : null
      if (l.dmtManual && (manual === null || manual < 0))
        marcar('dmt', 'Informe a DMT ajustada, em km.')
      // sem origem, destino ou estaca o motivo da DMT só repetiria o erro do outro campo
      else if (
        !l.dmtManual &&
        dmt.km === null &&
        l.origem &&
        l.destino &&
        !faltaCarga &&
        !faltaDescarga
      )
        marcar('dmt', dmt.motivo ?? 'Não há DMT para este trajeto.')
      viagens.push({
        id: l.id,
        item_orcamentario_id: l.item,
        origem_id: l.origem,
        destino_id: l.destino,
        hora_carga: l.horaCarga || null,
        hora_descarga: l.horaDescarga || null,
        quantidade: q ?? 0,
        material_qtd: parseQtd(l.mat),
        dmt_manual: l.dmtManual,
        dmt_km: l.dmtManual ? manual : null,
        nf_ticket: l.nf.trim() || null,
        estaca_carga_m: pc,
        estaca_descarga_m: pd,
        obs: null,
        carregador_id: l.carregador || null
      })
    }
    return { erros, viagens }
  }

  // os erros aparecem nos campos depois da primeira tentativa de gravar
  const erros = tentou ? conferir().erros : {}
  const nErros = Object.keys(erros).length
  const resumoErros =
    nErros === 0
      ? null
      : (erros.viagens ??
        `Confira ${contar(nErros, 'campo marcado', 'campos marcados')} antes de gravar.`)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setErro(null)
    setTentou(true)
    const conferida = conferir()
    if (Object.keys(conferida.erros).length > 0) {
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      )
      return
    }
    const { viagens } = conferida
    try {
      await salvar.mutateAsync({
        id: fichaId,
        obra_id: obraId,
        data,
        veiculo_id: veiculo || null,
        motorista: motorista.trim() || null,
        encarregado_id: encarregado || null,
        equipe_id: equipe || null,
        obs: obs.trim() || null,
        viagens,
        versao: ficha?.updated_at ?? null
      })
      toast.success(`Ficha gravada: ${contar(viagens.length, 'viagem', 'viagens')}.`)
      onOpenChange(false)
    } catch (err) {
      setErro(
        `Não foi possível gravar a ficha.${err instanceof Error && err.message ? ` ${err.message}` : ''}`
      )
    }
  }

  const opcoesLocal = (atual: string): ReactNode => (
    <>
      <option value="">—</option>
      {(atual && !locais.some((x) => x.id === atual) && localDe(atual)
        ? [...locais, localDe(atual)!]
        : locais
      ).map((x) => (
        <option key={x.id} value={x.id}>
          {x.nome} ({TIPO_LOCAL_LABEL[x.tipo]})
        </option>
      ))}
    </>
  )
  /** Atributos de erro de um campo da viagem e a mensagem que vai abaixo dele. */
  const erroDe = (
    l: LinhaViagem,
    c: CampoViagem
  ): { attrs: { 'aria-invalid'?: true; 'aria-describedby'?: string }; msg: ReactNode } => {
    const texto = erros[`${l.id}:${c}`]
    if (!texto) return { attrs: {}, msg: null }
    const id = `erro-${l.id}-${c}`
    return {
      attrs: { 'aria-invalid': true, 'aria-describedby': id },
      msg: (
        <p id={id} className="mt-0.5 text-xs font-medium text-danger">
          {texto}
        </p>
      )
    }
  }
  const celulaEstaca = (
    l: LinhaViagem,
    c: 'estacaCarga' | 'estacaDescarga',
    eixo: (typeof trechos)[number] | null,
    onChange: (v: string) => void,
    rotuloAria: string
  ): ReactNode => {
    if (!eixo)
      return (
        <span
          className="text-xs text-text-muted"
          title="Fora da pista vale a estaca do acesso cadastrada no local."
        >
          Pelo acesso
        </span>
      )
    const er = erroDe(l, c)
    return (
      <>
        <Input
          value={l[c]}
          onChange={(e) => onChange(e.target.value)}
          placeholder={formatMarcador(0, ctxObraTrecho(eixo))}
          aria-label={rotuloAria}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          className="tabular"
          {...er.attrs}
        />
        {er.msg}
      </>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange} size="full" disableDismiss={salvar.isPending}>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{ficha ? 'Editar ficha de viagens' : 'Nova ficha de viagens'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 space-y-4 overflow-auto">
          <DialogErrorBanner message={erro ?? resumoErros} />
          {!servicosViagem.length ? (
            <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text">
              Nenhum serviço está configurado para lançamento por viagens. Marque os serviços em
              Planejamento, na página Parametrização.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Campo rotulo="Data" erro={erros.data}>
              <Input
                type="date"
                value={data}
                max={hojeLocalISO()}
                onChange={(e) => setData(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Veículo" className="col-span-2">
              <Select value={veiculo} onChange={(e) => setVeiculo(e.target.value)}>
                <option value="">—</option>
                {comAtual(caminhoes, veiculo).map((v) => (
                  <option key={v.id} value={v.id}>
                    {rotulo(v)}
                    {v.capacidade_m3 ? ` · ${txtNum(v.capacidade_m3)} m³` : ''}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Motorista">
              <Input value={motorista} onChange={(e) => setMotorista(e.target.value)} />
            </Campo>
            <Campo rotulo="Encarregado">
              <Select value={encarregado} onChange={(e) => setEncarregado(e.target.value)}>
                <option value="">—</option>
                {encarregados.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.apelido ?? x.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Equipe">
              <Select value={equipe} onChange={(e) => setEquipe(e.target.value)}>
                <option value="">—</option>
                {equipes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          </div>

          <section aria-label="Viagens da ficha" className="rounded border border-border">
            <div
              tabIndex={0}
              role="region"
              aria-label="Tabela das viagens"
              className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
              <table className="w-full min-w-[1560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-elevated text-left">
                    <th scope="col" className={cn(TH, 'w-10')}>
                      Nº
                    </th>
                    <th scope="col" className={cn(TH, 'min-w-[200px]')}>
                      Serviço
                    </th>
                    <th scope="col" className={cn(TH, 'min-w-[160px]')}>
                      Origem
                    </th>
                    <th scope="col" className={cn(TH, 'w-32')} title="Quando a origem é a pista">
                      Estaca de carga
                    </th>
                    <th scope="col" className={cn(TH, 'min-w-[160px]')}>
                      Destino
                    </th>
                    <th scope="col" className={cn(TH, 'w-32')} title="Quando o destino é a pista">
                      Estaca de descarga
                    </th>
                    <th scope="col" className={cn(TH, 'min-w-[140px]')}>
                      Carregado por
                    </th>
                    <th scope="col" className={cn(TH, 'w-28')}>
                      Hora da carga
                    </th>
                    <th scope="col" className={cn(TH, 'w-28')}>
                      Hora da descarga
                    </th>
                    <th
                      scope="col"
                      className={cn(TH, 'w-32')}
                      title="Na unidade do serviço, já com o empolamento ou a densidade que você aplica"
                    >
                      Quantidade
                    </th>
                    <th scope="col" className={cn(TH, 'w-28')}>
                      Material
                    </th>
                    <th scope="col" className={cn(TH, 'w-36')}>
                      DMT (km)
                    </th>
                    <th scope="col" className={cn(TH, 'w-32')}>
                      Nota ou ticket
                    </th>
                    <th scope="col" className="w-10">
                      <span className="sr-only">Remover</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => {
                    const { par, dmt } = calculo(l)
                    const sv = servicos.find((s) => s.id === l.item)
                    const pedeMaterial =
                      par.controla_material &&
                      (par.material_unidade ?? '').toLowerCase() !==
                        (sv?.unidade ?? '').toLowerCase()
                    const peso = par.medicao_viagem === 'peso'
                    const n = i + 1
                    const eItem = erroDe(l, 'item')
                    const eOrigem = erroDe(l, 'origem')
                    const eDestino = erroDe(l, 'destino')
                    const eQtd = erroDe(l, 'qtd')
                    const eDmt = erroDe(l, 'dmt')
                    const eNf = erroDe(l, 'nf')
                    return (
                      <tr key={l.id} className="border-b border-border align-top last:border-b-0">
                        <td className="px-2 py-2.5 tabular text-text-muted">{n}</td>
                        <td className="px-2 py-1.5">
                          <Select
                            value={l.item}
                            onChange={(e) => setLinha(i, { item: e.target.value })}
                            aria-label={`Serviço da viagem ${n}`}
                            {...eItem.attrs}
                          >
                            <option value="">—</option>
                            {servicosViagem.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.codigo} {s.descricao}
                              </option>
                            ))}
                          </Select>
                          {eItem.msg}
                        </td>
                        <td className="px-2 py-1.5">
                          <Select
                            value={l.origem}
                            onChange={(e) => setLinha(i, { origem: e.target.value })}
                            aria-label={`Origem da viagem ${n}`}
                            {...eOrigem.attrs}
                          >
                            {opcoesLocal(l.origem)}
                          </Select>
                          {eOrigem.msg}
                        </td>
                        <td className="px-2 py-1.5">
                          {celulaEstaca(
                            l,
                            'estacaCarga',
                            eixoDaPonta(l.origem),
                            (v) => setLinha(i, { estacaCarga: v }),
                            `Estaca de carga da viagem ${n}`
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Select
                            value={l.destino}
                            onChange={(e) => setLinha(i, { destino: e.target.value })}
                            aria-label={`Destino da viagem ${n}`}
                            {...eDestino.attrs}
                          >
                            {opcoesLocal(l.destino)}
                          </Select>
                          {eDestino.msg}
                        </td>
                        <td className="px-2 py-1.5">
                          {celulaEstaca(
                            l,
                            'estacaDescarga',
                            eixoDaPonta(l.destino),
                            (v) => setLinha(i, { estacaDescarga: v }),
                            `Estaca de descarga da viagem ${n}`
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Select
                            value={l.carregador}
                            onChange={(e) => setLinha(i, { carregador: e.target.value })}
                            aria-label={`Máquina que carregou a viagem ${n}`}
                          >
                            <option value="">—</option>
                            {comAtual(maquinas, l.carregador).map((x) => (
                              <option key={x.id} value={x.id}>
                                {rotulo(x)}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="time"
                            value={l.horaCarga}
                            onChange={(e) => setLinha(i, { horaCarga: e.target.value })}
                            aria-label={`Hora da carga da viagem ${n}`}
                            className="tabular"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="time"
                            value={l.horaDescarga}
                            onChange={(e) => setLinha(i, { horaDescarga: e.target.value })}
                            aria-label={`Hora da descarga da viagem ${n}`}
                            className="tabular"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            inputMode="decimal"
                            value={l.qtd}
                            onChange={(e) => setLinha(i, { qtd: e.target.value })}
                            placeholder={sv?.unidade ?? ''}
                            aria-label={`Quantidade da viagem ${n}${sv?.unidade ? `, em ${sv.unidade}` : ''}`}
                            className="tabular"
                            {...eQtd.attrs}
                          />
                          {eQtd.msg}
                          {capacidade && !peso ? (
                            <div className="mt-0.5 text-xs text-text-muted tabular">
                              Caçamba: {txtNum(capacidade)} m³
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">
                          {pedeMaterial ? (
                            <Input
                              inputMode="decimal"
                              value={l.mat}
                              onChange={(e) => setLinha(i, { mat: e.target.value })}
                              placeholder={par.material_unidade ?? ''}
                              aria-label={`Material da viagem ${n}${par.material_unidade ? `, em ${par.material_unidade}` : ''}`}
                              className="tabular"
                            />
                          ) : (
                            <span className="inline-block py-1.5 text-xs text-text-muted">
                              {par.controla_material ? 'Igual à quantidade' : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex min-h-8 items-center gap-1">
                            {l.dmtManual ? (
                              <Input
                                inputMode="decimal"
                                value={l.dmt}
                                onChange={(e) => setLinha(i, { dmt: e.target.value })}
                                placeholder={dmt.km !== null ? txtNum(dmt.km) : 'km'}
                                aria-label={`DMT ajustada da viagem ${n}, em km`}
                                className="w-20 tabular"
                                {...eDmt.attrs}
                              />
                            ) : (
                              <span
                                className={cn(
                                  'tabular',
                                  dmt.km === null ? 'text-warn' : 'text-text'
                                )}
                                title={dmt.motivo ?? undefined}
                              >
                                {dmt.km !== null ? formatNumber(dmt.km, 3) : 'Sem DMT'}
                              </span>
                            )}
                            <IconButton
                              size="sm"
                              variant="accent"
                              aria-label={
                                l.dmtManual
                                  ? `Voltar ao cálculo da DMT da viagem ${n}`
                                  : `Ajustar a DMT da viagem ${n}`
                              }
                              title={l.dmtManual ? 'Voltar ao cálculo' : 'Ajustar a DMT'}
                              aria-pressed={l.dmtManual}
                              onClick={() =>
                                setLinha(i, {
                                  dmtManual: !l.dmtManual,
                                  dmt: l.dmtManual ? '' : txtNum(dmt.km)
                                })
                              }
                              className={cn('ml-auto shrink-0', l.dmtManual && 'text-accent')}
                            >
                              <Pencil size={13} />
                            </IconButton>
                          </div>
                          {eDmt.msg}
                          <div className="mt-0.5 text-xs text-text-muted tabular">
                            {l.dmtManual
                              ? `Ajustada. Calculada: ${dmt.km !== null ? formatNumber(dmt.km, 3) : '—'}`
                              : dmt.via === 'rota'
                                ? 'Distância fixa'
                                : dmt.via === 'geometria'
                                  ? 'Pelo eixo'
                                  : ''}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            value={l.nf}
                            onChange={(e) => setLinha(i, { nf: e.target.value })}
                            placeholder={peso ? 'Obrigatório' : ''}
                            aria-label={`Nota ou ticket da viagem ${n}`}
                            aria-required={peso || undefined}
                            {...eNf.attrs}
                          />
                          {eNf.msg}
                        </td>
                        <td className="px-1 py-1.5">
                          <IconButton
                            size="sm"
                            variant="danger"
                            aria-label={`Remover a viagem ${n}`}
                            title="Remover a viagem"
                            onClick={() => setLinhas((ls) => ls.filter((_, k) => k !== i))}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </td>
                      </tr>
                    )
                  })}
                  {linhas.length === 0 ? (
                    <tr>
                      <td
                        colSpan={14}
                        className={cn(
                          'px-3 py-4 text-sm',
                          erros.viagens ? 'font-medium text-danger' : 'text-text-muted'
                        )}
                      >
                        {erros.viagens ??
                          'Nenhuma viagem na ficha. Use Adicionar viagem para lançar a primeira.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-border px-2 py-2">
              <Button type="button" size="sm" variant="secondary" onClick={nova}>
                <Plus size={13} /> Adicionar viagem
              </Button>
              <span className="ml-auto text-sm text-text-muted tabular">
                {contar(linhas.length, 'viagem', 'viagens')}
                {totais.length > 0 ? (
                  <>
                    , total de{' '}
                    <strong className="font-semibold text-text">
                      {totais.map(([un, q]) => `${formatNumber(q, 2)} ${un}`.trim()).join(' e ')}
                    </strong>
                  </>
                ) : null}
              </span>
            </div>
          </section>
          <Campo rotulo="Observação">
            <Input value={obs} onChange={(e) => setObs(e.target.value)} />
          </Campo>
        </DialogBody>
        <DialogFooter>
          {ficha && podeExcluir ? (
            <Button
              type="button"
              variant="danger"
              className="mr-auto"
              disabled={excluir.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Excluir esta ficha?',
                  description: `Ficha de ${ficha.data.split('-').reverse().join('/')} com ${contar(ficha.viagens.length, 'viagem', 'viagens')}. A produção do dia será recalculada.`,
                  confirmLabel: 'Excluir',
                  variant: 'danger'
                })
                if (!ok) return
                excluir.mutate(ficha.id, {
                  onSuccess: () => {
                    toast.success('Ficha excluída.')
                    onOpenChange(false)
                  },
                  onError: (e) => setErro(`Não foi possível excluir a ficha. ${e.message}`)
                })
              }}
            >
              <Trash2 size={13} /> {excluir.isPending ? 'Excluindo…' : 'Excluir ficha'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={salvar.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={salvar.isPending}>
            {salvar.isPending ? 'Gravando…' : 'Gravar ficha'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
