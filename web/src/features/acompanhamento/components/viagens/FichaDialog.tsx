/**
 * Ficha de viagens de um veículo no dia (o "carreteiro" do Monito): cabeçalho (data, veículo, motorista, encarregado,
 * equipe, km) e uma linha por viagem (serviço por viagens, origem, destino, estaca de descarga na pista, horas,
 * quantidade, material, DMT, NF/ticket). A nova viagem repete o serviço, a origem e o destino da anterior (o
 * "padrão do dia"). Gravada pela RPC do app de campo; a produção do dia é recomposta no banco.
 */
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
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
  useFrota,
  useLocaisTransporte,
  useExcluirFicha,
  useSalvarFicha,
  type FichaInput,
  type FichaViagens
} from '../../hooks/viagens'
import { parseQtd } from '../../lib/parse-qtd'
import { useConfirm } from '@/components/modals/ConfirmDialog'

interface LinhaViagem {
  id: string
  item: string
  origem: string
  destino: string
  estaca: string
  horaCarga: string
  horaDescarga: string
  qtd: string
  mat: string
  dmt: string
  nf: string
}

const txtNum = (v: number | null): string =>
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
    <Form
      onOpenChange={onOpenChange}
      obraId={obraId}
      empresaId={empresaId}
      ficha={ficha}
      podeExcluir={podeExcluir}
    />
  )
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
  const locais = (transp?.locais ?? []).filter((l) => l.ativo)
  const rotas = transp?.rotas ?? []
  const localDe = (id: string): (typeof locais)[number] | undefined =>
    locais.find((l) => l.id === id)
  // a estaca vale para a ponta que está na pista: o destino (aterro, base) ou, senão, a origem (corte)
  const eixoDoLocal = (id: string): (typeof trechos)[number] | null => {
    const t = trechos.find((x) => x.id === localDe(id)?.trecho_id)
    return t && t.tipo === 'eixo' ? t : null
  }
  const eixoDaViagem = (origem: string, destino: string): (typeof trechos)[number] | null =>
    eixoDoLocal(destino) ?? eixoDoLocal(origem)

  const [data, setData] = useState(ficha?.data ?? hojeLocalISO())
  const [veiculo, setVeiculo] = useState(ficha?.veiculo_id ?? '')
  const [motorista, setMotorista] = useState(ficha?.motorista ?? '')
  const [encarregado, setEncarregado] = useState(ficha?.encarregado_id ?? '')
  const [equipe, setEquipe] = useState(ficha?.equipe_id ?? '')
  const [kmIni, setKmIni] = useState(txtNum(ficha?.km_inicial ?? null))
  const [kmFim, setKmFim] = useState(txtNum(ficha?.km_final ?? null))
  const [obs, setObs] = useState(ficha?.obs ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<LinhaViagem[]>(() =>
    (ficha?.viagens ?? []).map((v) => {
      const t = trechos.find((x) => x.id === v.trecho_id)
      return {
        id: v.id,
        item: v.item_orcamentario_id,
        origem: v.origem_id ?? '',
        destino: v.destino_id ?? '',
        estaca:
          t && v.posicao_inicio_m !== null
            ? formatMarcador(v.posicao_inicio_m, ctxObraTrecho(t))
            : '',
        horaCarga: v.hora_carga?.slice(0, 5) ?? '',
        horaDescarga: v.hora_descarga?.slice(0, 5) ?? '',
        qtd: txtNum(v.quantidade),
        mat: txtNum(v.material_qtd),
        dmt: txtNum(v.dmt_km),
        nf: v.nf_ticket ?? ''
      }
    })
  )
  const fichaId = useMemo(() => ficha?.id ?? crypto.randomUUID(), [ficha?.id])

  const nova = (): void =>
    setLinhas((ls) => {
      const ult = ls[ls.length - 1]
      const cap = frota.find((v) => v.id === veiculo)?.capacidade_m3
      return [
        ...ls,
        {
          id: crypto.randomUUID(),
          item: ult?.item ?? servicosViagem[0]?.id ?? '',
          origem: ult?.origem ?? '',
          destino: ult?.destino ?? '',
          estaca: '',
          horaCarga: '',
          horaDescarga: '',
          qtd: ult?.qtd ?? (cap ? txtNum(cap) : ''),
          mat: '',
          dmt: '',
          nf: ''
        }
      ]
    })
  const setLinha = (i: number, patch: Partial<LinhaViagem>): void =>
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))

  const total = linhas.reduce((s, l) => s + (parseQtd(l.qtd) ?? 0), 0)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setErro(null)
    if (data > hojeLocalISO()) return setErro('A data não pode ser no futuro.')
    if (!linhas.length) return setErro('Inclua ao menos uma viagem.')
    const viagens: FichaInput['viagens'] = []
    for (const [k, l] of linhas.entries()) {
      const n = k + 1
      const q = parseQtd(l.qtd)
      if (!l.item) return setErro(`Viagem ${n}: escolha o serviço.`)
      if (q == null || q <= 0) return setErro(`Viagem ${n}: informe a quantidade.`)
      const eixo = eixoDaViagem(l.origem, l.destino)
      let pos: number | null = null
      if (eixo && l.estaca.trim()) {
        const p = parseMarcador(l.estaca.trim(), ctxObraTrecho(eixo))
        if (p.metros === null) return setErro(`Viagem ${n}: estaca "${l.estaca}" inválida.`)
        pos = p.metros
      }
      viagens.push({
        id: l.id,
        item_orcamentario_id: l.item,
        origem_id: l.origem || null,
        destino_id: l.destino || null,
        hora_carga: l.horaCarga || null,
        hora_descarga: l.horaDescarga || null,
        quantidade: q,
        material_qtd: parseQtd(l.mat),
        dmt_km: parseQtd(l.dmt),
        nf_ticket: l.nf.trim() || null,
        trecho_id: eixo?.id ?? null,
        posicao_inicio_m: pos,
        posicao_fim_m: pos,
        obs: null
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
        km_inicial: parseQtd(kmIni),
        km_final: parseQtd(kmFim),
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
  return (
    <Dialog open onOpenChange={onOpenChange} size="xl" disableDismiss={salvar.isPending}>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{ficha ? 'Editar ficha de viagens' : 'Nova ficha de viagens'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={erro} />
          {!servicosViagem.length ? (
            <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              Nenhum serviço está parametrizado para viagens (Planejamento › Parametrização).
            </p>
          ) : null}
          <div className="grid grid-cols-4 gap-3 lg:grid-cols-8">
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
                {frota
                  .filter((v) => v.ativo || v.id === veiculo)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.prefixo}
                      {v.placa ? ` · ${v.placa}` : ''}
                      {v.proprietario === 'terceiro' ? ' · terceiro' : ''}
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
            <div>
              <Label>Km inicial</Label>
              <Input
                inputMode="decimal"
                value={kmIni}
                onChange={(e) => setKmIni(e.target.value)}
                className={`${campo} font-mono`}
              />
            </div>
            <div>
              <Label>Km final</Label>
              <Input
                inputMode="decimal"
                value={kmFim}
                onChange={(e) => setKmFim(e.target.value)}
                className={`${campo} font-mono`}
              />
            </div>
          </div>

          <div className="rounded border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-2xs font-mono uppercase tracking-wider text-text-dim">
                  <th className="w-8 px-2 py-1.5 font-normal">#</th>
                  <th className="px-2 py-1.5 font-normal">Serviço</th>
                  <th className="px-2 py-1.5 font-normal">Origem</th>
                  <th className="px-2 py-1.5 font-normal">Destino</th>
                  <th className="w-28 px-2 py-1.5 font-normal" title="Na pista: a estaca da descarga (ou do corte, quando a origem é a pista)">Estaca</th>
                  <th className="w-24 px-2 py-1.5 font-normal">Carga</th>
                  <th className="w-24 px-2 py-1.5 font-normal">Descarga</th>
                  <th className="w-24 px-2 py-1.5 font-normal">Qtd</th>
                  <th className="w-24 px-2 py-1.5 font-normal">Material</th>
                  <th className="w-20 px-2 py-1.5 font-normal">DMT km</th>
                  <th className="w-24 px-2 py-1.5 font-normal">NF/ticket</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => {
                  const par = parametroDe(parametros, l.item)
                  const sv = servicos.find((s) => s.id === l.item)
                  const eixo = eixoDaViagem(l.origem, l.destino)
                  const rota = rotas.find(
                    (r) => r.origem_id === l.origem && r.destino_id === l.destino
                  )
                  const pedeMaterial =
                    par.controla_material &&
                    (par.material_unidade ?? '').toLowerCase() !== (sv?.unidade ?? '').toLowerCase()
                  return (
                    <tr key={l.id} className="border-b border-border/50 last:border-b-0">
                      <td className="px-2 py-1 font-mono text-2xs text-text-dim">{i + 1}</td>
                      <td className="px-2 py-1">
                        <Select
                          value={l.item}
                          onChange={(e) => setLinha(i, { item: e.target.value })}
                          className={campo}
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
                        >
                          <option value="">—</option>
                          {locais.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.nome} ({TIPO_LOCAL_LABEL[x.tipo]})
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={l.destino}
                          onChange={(e) => setLinha(i, { destino: e.target.value })}
                          className={campo}
                        >
                          <option value="">—</option>
                          {locais.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.nome} ({TIPO_LOCAL_LABEL[x.tipo]})
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        {eixo ? (
                          <Input
                            value={l.estaca}
                            onChange={(e) => setLinha(i, { estaca: e.target.value })}
                            placeholder={formatMarcador(0, ctxObraTrecho(eixo))}
                            className={`${campo} font-mono`}
                          />
                        ) : (
                          <span className="text-2xs text-text-dim">—</span>
                        )}
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
                          value={l.qtd}
                          onChange={(e) => setLinha(i, { qtd: e.target.value })}
                          placeholder={sv?.unidade ?? ''}
                          className={`${campo} font-mono`}
                        />
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
                        <Input
                          inputMode="decimal"
                          value={l.dmt}
                          onChange={(e) => setLinha(i, { dmt: e.target.value })}
                          placeholder={rota ? txtNum(rota.dmt_km) : ''}
                          className={`${campo} font-mono`}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={l.nf}
                          onChange={(e) => setLinha(i, { nf: e.target.value })}
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
