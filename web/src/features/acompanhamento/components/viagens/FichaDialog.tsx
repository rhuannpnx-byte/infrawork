/**
 * Ficha de viagens de um veículo no dia: cabeçalho (data, veículo, motorista, encarregado, equipe) e uma linha por
 * viagem. A nova viagem repete serviço, origem, destino e máquina de carga da anterior. A DMT e a quantidade aparecem
 * calculadas (lib/dmt, a mesma regra do banco); o banco recalcula ao gravar e recompõe a produção do dia.
 */
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { hojeLocalISO } from '@/lib/format/local-date'
import { formatMarcador, parseMarcador } from '@/lib/format/posicao'
import { formatNumber } from '@/lib/format/number'
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
  useFrota,
  useVeiculosDaObra,
  useLocaisTransporte,
  useExcluirFicha,
  useSalvarFicha,
  type FichaInput,
  type FichaViagens
} from '../../hooks/viagens'
import { calcularDmt, pedeEstaca, quantidadeDaViagem } from '../../lib/dmt'
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
  /** volume (m³) ou peso (t), conforme a medição do serviço */
  bruto: string
  mat: string
  dmtManual: boolean
  dmt: string
  nf: string
  carregador: string
}

const txtNum = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v).replace('.', ',')

export function FichaDialog({
  open,
  onOpenChange,
  obraId,
  empresaId,
  ficha,
  podeExcluir = false
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  obraId: string
  empresaId: string | null
  /** edita; sem ficha, cria */
  ficha: FichaViagens | null
  podeExcluir?: boolean
}): ReactNode {
  if (!open) return null
  return (
    <Carregar
      onOpenChange={onOpenChange}
      obraId={obraId}
      empresaId={empresaId}
      ficha={ficha}
      podeExcluir={podeExcluir}
    />
  )
}

/** O formulário monta o estado inicial das linhas (estacas na unidade do trecho): espera os cadastros. */
function Carregar(props: {
  onOpenChange: (o: boolean) => void
  obraId: string
  empresaId: string | null
  ficha: FichaViagens | null
  podeExcluir: boolean
}): ReactNode {
  const transp = useLocaisTransporte(props.obraId)
  const trechos = useObraTrechos(props.obraId)
  const parametros = useParametrosServicos(props.obraId)
  if (!transp.data || !trechos.data || !parametros.data) return null
  return <Form {...props} />
}

function Form({
  onOpenChange,
  obraId,
  empresaId,
  ficha,
  podeExcluir
}: {
  onOpenChange: (o: boolean) => void
  obraId: string
  empresaId: string | null
  ficha: FichaViagens | null
  podeExcluir: boolean
}): ReactNode {
  const { data: servicos = [] } = useServicosParametrizaveis(obraId)
  const { data: parametros } = useParametrosServicos(obraId)
  const { data: frota = [] } = useFrota(empresaId)
  const { data: daObra = [] } = useVeiculosDaObra(obraId)
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
  const [linhas, setLinhas] = useState<LinhaViagem[]>(() =>
    (ficha?.viagens ?? []).map((v) => {
      const ec = eixoDaPonta(v.origem_id ?? '')
      const ed = eixoDaPonta(v.destino_id ?? '')
      const peso = parametroDe(parametros, v.item_orcamentario_id).medicao_viagem === 'peso'
      return {
        id: v.id,
        item: v.item_orcamentario_id,
        origem: v.origem_id ?? '',
        destino: v.destino_id ?? '',
        estacaCarga: ec ? formatMarcador(v.estaca_carga_m, ctxObraTrecho(ec)) : '',
        estacaDescarga: ed ? formatMarcador(v.estaca_descarga_m, ctxObraTrecho(ed)) : '',
        horaCarga: v.hora_carga?.slice(0, 5) ?? '',
        horaDescarga: v.hora_descarga?.slice(0, 5) ?? '',
        bruto: txtNum(peso ? v.peso_t : v.volume_m3),
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
          bruto: ult?.bruto ?? '',
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

  /** DMT e quantidade da linha, como o banco vai calcular */
  const calculo = (
    l: LinhaViagem
  ): {
    dmt: ReturnType<typeof calcularDmt>
    qtd: ReturnType<typeof quantidadeDaViagem>
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
      }),
      qtd: quantidadeDaViagem({
        medicao: par.medicao_viagem,
        fator: par.fator_viagem,
        volume: par.medicao_viagem === 'volume' ? parseQtd(l.bruto) : null,
        peso: par.medicao_viagem === 'peso' ? parseQtd(l.bruto) : null,
        capacidade
      })
    }
  }

  const total = linhas.reduce((s, l) => s + (calculo(l).qtd.quantidade ?? 0), 0)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setErro(null)
    if (data > hojeLocalISO()) return setErro('A data não pode ser no futuro.')
    if (!linhas.length) return setErro('Inclua ao menos uma viagem.')
    const viagens: FichaInput['viagens'] = []
    for (const [k, l] of linhas.entries()) {
      const n = k + 1
      if (!l.item) return setErro(`Viagem ${n}: escolha o serviço.`)
      if (!l.origem || !l.destino) return setErro(`Viagem ${n}: escolha a origem e o destino.`)
      const ec = eixoDaPonta(l.origem)
      const ed = eixoDaPonta(l.destino)
      const pc = lerEstaca(l.estacaCarga, ec)
      const pd = lerEstaca(l.estacaDescarga, ed)
      if (ec && pc === null) return setErro(`Viagem ${n}: informe a estaca de carga.`)
      if (ed && pd === null) return setErro(`Viagem ${n}: informe a estaca de descarga.`)
      const { dmt, qtd, par } = calculo(l)
      if (qtd.quantidade === null)
        return setErro(
          par.medicao_viagem === 'peso'
            ? `Viagem ${n}: informe o peso líquido do ticket (t).`
            : `Viagem ${n}: informe o volume da caçamba (o caminhão não tem capacidade cadastrada).`
        )
      if (par.medicao_viagem === 'peso' && !l.nf.trim())
        return setErro(`Viagem ${n}: informe o ticket da balança.`)
      const manual = l.dmtManual ? parseQtd(l.dmt) : null
      if (l.dmtManual && (manual === null || manual < 0))
        return setErro(`Viagem ${n}: informe a DMT ajustada (km).`)
      if (!l.dmtManual && dmt.km === null) return setErro(`Viagem ${n}: ${dmt.motivo}`)
      const bruto = parseQtd(l.bruto)
      viagens.push({
        id: l.id,
        item_orcamentario_id: l.item,
        origem_id: l.origem,
        destino_id: l.destino,
        hora_carga: l.horaCarga || null,
        hora_descarga: l.horaDescarga || null,
        volume_m3: par.medicao_viagem === 'volume' ? bruto : null,
        peso_t: par.medicao_viagem === 'peso' ? bruto : null,
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
        viagens
      })
      toast.success(`Ficha gravada: ${viagens.length} viagem(ns).`)
      onOpenChange(false)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao gravar a ficha')
    }
  }

  const campo = 'h-8 text-xs'
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
  const celulaEstaca = (
    eixo: (typeof trechos)[number] | null,
    valor: string,
    onChange: (v: string) => void,
    rotuloAria: string
  ): ReactNode =>
    eixo ? (
      <Input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={formatMarcador(0, ctxObraTrecho(eixo))}
        aria-label={rotuloAria}
        className={`${campo} font-mono`}
      />
    ) : (
      <span className="text-2xs text-text-dim" title="Fora da pista: vale a estaca do acesso">
        acesso
      </span>
    )

  return (
    <Dialog open onOpenChange={onOpenChange} size="full" disableDismiss={salvar.isPending}>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{ficha ? 'Editar ficha de viagens' : 'Nova ficha de viagens'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 space-y-3 overflow-auto">
          <DialogErrorBanner message={erro} />
          {!servicosViagem.length ? (
            <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              Nenhum serviço está parametrizado para viagens (Planejamento › Parametrização).
            </p>
          ) : null}
          <div className="grid grid-cols-4 gap-3 lg:grid-cols-6">
            <div>
              <Label>Data</Label>
              <Input
                type="date"
                value={data}
                max={hojeLocalISO()}
                onChange={(e) => setData(e.target.value)}
                className={campo}
              />
            </div>
            <div className="col-span-2">
              <Label>Veículo</Label>
              <Select
                value={veiculo}
                onChange={(e) => setVeiculo(e.target.value)}
                className={campo}
              >
                <option value="">—</option>
                {comAtual(caminhoes, veiculo).map((v) => (
                  <option key={v.id} value={v.id}>
                    {rotulo(v)}
                    {v.capacidade_m3 ? ` · ${txtNum(v.capacidade_m3)} m³` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Motorista</Label>
              <Input
                value={motorista}
                onChange={(e) => setMotorista(e.target.value)}
                className={campo}
              />
            </div>
            <div>
              <Label>Encarregado</Label>
              <Select
                value={encarregado}
                onChange={(e) => setEncarregado(e.target.value)}
                className={campo}
              >
                <option value="">—</option>
                {encarregados.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.apelido ?? x.nome}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Equipe</Label>
              <Select value={equipe} onChange={(e) => setEquipe(e.target.value)} className={campo}>
                <option value="">—</option>
                {equipes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[1500px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-2xs font-mono uppercase tracking-wider text-text-dim">
                  <th className="w-8 px-2 py-1.5 font-normal">#</th>
                  <th className="min-w-[200px] px-2 py-1.5 font-normal">Serviço</th>
                  <th className="min-w-[160px] px-2 py-1.5 font-normal">Origem</th>
                  <th className="w-28 px-2 py-1.5 font-normal" title="Quando a origem é a pista">
                    Est. carga
                  </th>
                  <th className="min-w-[160px] px-2 py-1.5 font-normal">Destino</th>
                  <th className="w-28 px-2 py-1.5 font-normal" title="Quando o destino é a pista">
                    Est. descarga
                  </th>
                  <th className="min-w-[140px] px-2 py-1.5 font-normal">Carregado por</th>
                  <th className="w-24 px-2 py-1.5 font-normal">Carga</th>
                  <th className="w-24 px-2 py-1.5 font-normal">Descarga</th>
                  <th
                    className="w-32 px-2 py-1.5 font-normal"
                    title="Volume da caçamba (m³) ou peso do ticket (t), conforme a parametrização do serviço"
                  >
                    Volume / peso
                  </th>
                  <th className="w-24 px-2 py-1.5 font-normal">Material</th>
                  <th className="w-32 px-2 py-1.5 font-normal">DMT km</th>
                  <th className="w-24 px-2 py-1.5 font-normal">NF/ticket</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => {
                  const { par, dmt, qtd } = calculo(l)
                  const sv = servicos.find((s) => s.id === l.item)
                  const pedeMaterial =
                    par.controla_material &&
                    (par.material_unidade ?? '').toLowerCase() !== (sv?.unidade ?? '').toLowerCase()
                  const peso = par.medicao_viagem === 'peso'
                  return (
                    <tr key={l.id} className="border-b border-border/50 last:border-b-0">
                      <td className="px-2 py-1 font-mono text-2xs text-text-dim">{i + 1}</td>
                      <td className="px-2 py-1">
                        <Select
                          value={l.item}
                          onChange={(e) => setLinha(i, { item: e.target.value })}
                          className={campo}
                          aria-label="Serviço"
                        >
                          <option value="">—</option>
                          {servicosViagem.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.codigo} {s.descricao}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={l.origem}
                          onChange={(e) => setLinha(i, { origem: e.target.value })}
                          className={campo}
                          aria-label="Origem"
                        >
                          {opcoesLocal(l.origem)}
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        {celulaEstaca(
                          eixoDaPonta(l.origem),
                          l.estacaCarga,
                          (v) => setLinha(i, { estacaCarga: v }),
                          'Estaca de carga'
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={l.destino}
                          onChange={(e) => setLinha(i, { destino: e.target.value })}
                          className={campo}
                          aria-label="Destino"
                        >
                          {opcoesLocal(l.destino)}
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        {celulaEstaca(
                          eixoDaPonta(l.destino),
                          l.estacaDescarga,
                          (v) => setLinha(i, { estacaDescarga: v }),
                          'Estaca de descarga'
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={l.carregador}
                          onChange={(e) => setLinha(i, { carregador: e.target.value })}
                          className={campo}
                          aria-label="Carregado por"
                        >
                          <option value="">—</option>
                          {comAtual(maquinas, l.carregador).map((x) => (
                            <option key={x.id} value={x.id}>
                              {rotulo(x)}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="time"
                          value={l.horaCarga}
                          onChange={(e) => setLinha(i, { horaCarga: e.target.value })}
                          className={campo}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="time"
                          value={l.horaDescarga}
                          onChange={(e) => setLinha(i, { horaDescarga: e.target.value })}
                          className={campo}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          inputMode="decimal"
                          value={l.bruto}
                          onChange={(e) => setLinha(i, { bruto: e.target.value })}
                          placeholder={peso ? 't' : capacidade ? `${txtNum(capacidade)} m³` : 'm³'}
                          aria-label={peso ? 'Peso do ticket (t)' : 'Volume da caçamba (m³)'}
                          className={`${campo} font-mono`}
                        />
                        <div className="mt-0.5 font-mono text-2xs text-text-dim">
                          {qtd.quantidade !== null
                            ? `= ${formatNumber(qtd.quantidade, 2)} ${sv?.unidade ?? ''}`
                            : peso
                              ? 'peso do ticket'
                              : 'volume'}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        {pedeMaterial ? (
                          <Input
                            inputMode="decimal"
                            value={l.mat}
                            onChange={(e) => setLinha(i, { mat: e.target.value })}
                            placeholder={par.material_unidade ?? ''}
                            className={`${campo} font-mono`}
                          />
                        ) : (
                          <span className="text-2xs text-text-dim">
                            {par.controla_material ? '= qtd' : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1">
                          {l.dmtManual ? (
                            <Input
                              inputMode="decimal"
                              value={l.dmt}
                              onChange={(e) => setLinha(i, { dmt: e.target.value })}
                              placeholder={dmt.km !== null ? txtNum(dmt.km) : 'km'}
                              aria-label="DMT ajustada (km)"
                              className={`${campo} w-20 font-mono`}
                            />
                          ) : (
                            <span
                              className={cn(
                                'font-mono text-xs',
                                dmt.km === null ? 'text-warn' : 'text-text'
                              )}
                              title={dmt.motivo ?? undefined}
                            >
                              {dmt.km !== null ? formatNumber(dmt.km, 3) : 'sem DMT'}
                            </span>
                          )}
                          <button
                            type="button"
                            title={l.dmtManual ? 'Voltar ao cálculo' : 'Ajustar a DMT'}
                            onClick={() =>
                              setLinha(i, {
                                dmtManual: !l.dmtManual,
                                dmt: l.dmtManual ? '' : txtNum(dmt.km)
                              })
                            }
                            className={cn(
                              'ml-auto shrink-0 hover:text-accent',
                              l.dmtManual ? 'text-accent' : 'text-text-dim'
                            )}
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                        <div className="mt-0.5 text-2xs text-text-dim">
                          {l.dmtManual
                            ? `ajustada · calc. ${dmt.km !== null ? formatNumber(dmt.km, 3) : '—'}`
                            : dmt.via === 'rota'
                              ? 'distância fixa'
                              : dmt.via === 'geometria'
                                ? 'pelo eixo'
                                : ''}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={l.nf}
                          onChange={(e) => setLinha(i, { nf: e.target.value })}
                          placeholder={peso ? 'obrigatório' : ''}
                          className={campo}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <button
                          type="button"
                          title="Remover viagem"
                          onClick={() => setLinhas((ls) => ls.filter((_, k) => k !== i))}
                          className="flex items-center justify-center text-text-dim hover:text-danger"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="flex items-center gap-3 border-t border-border px-2 py-1.5">
              <Button type="button" size="sm" variant="ghost" onClick={nova}>
                <Plus size={12} /> Viagem
              </Button>
              <span className="ml-auto font-mono text-2xs text-text-muted">
                {linhas.length} viagem(ns) · total {formatNumber(total, 2)}
              </span>
            </div>
          </div>
          <div>
            <Label>Observação</Label>
            <Input value={obs} onChange={(e) => setObs(e.target.value)} className={campo} />
          </div>
        </DialogBody>
        <DialogFooter>
          {ficha && podeExcluir ? (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-danger"
              disabled={excluir.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Excluir esta ficha?',
                  description: `${ficha.data.split('-').reverse().join('/')} · ${ficha.viagens.length} viagem(ns). A produção do dia é recalculada.`,
                  confirmLabel: 'Excluir',
                  variant: 'danger'
                })
                if (!ok) return
                excluir.mutate(ficha.id, {
                  onSuccess: () => {
                    toast.success('Ficha excluída.')
                    onOpenChange(false)
                  },
                  onError: (e) => setErro(e.message)
                })
              }}
            >
              <Trash2 size={12} /> Excluir ficha
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" disabled={salvar.isPending}>
            Gravar ficha
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
