import { useId, useState } from 'react'
import { flushSync } from 'react-dom'
import { Pencil, X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { PickerSheet } from '@/features/common/PickerSheet'
import {
  LabeledInput,
  NumericField,
  PickerField,
  ReadOnlyRow,
  TimeField,
} from '@/features/common/fields'
import { focarPrimeiroInvalido, useFolha } from '@/features/common/useFolha'
import { parseNum } from '@/lib/numero'
import {
  erroPosicaoFora,
  erroPosicaoVazia,
  estacaInicialTexto,
  estacaParaMetros,
  nomePosicao,
  tecladoPosicao,
} from '@/lib/estaca'
import { formatNumero } from '@/lib/datas'
import { calcularDmt, pedeEstaca, type LocalDmt } from '@/lib/dmt'
import type { ViagemLocal } from '@/core/db/entities'
import type { CatalogoDto, LocalDto, OrigemDestinoDto, ServicoDto } from '@/types/dtos'
import { ehMaquinaDeCarga, rotuloVeiculo } from '@/lib/frota'

const TIPO_LOCAL: Record<OrigemDestinoDto['tipo'], string> = {
  jazida: 'Jazida',
  caixa_emprestimo: 'Caixa de empréstimo',
  usina: 'Usina',
  central: 'Central de concreto',
  bota_fora: 'Bota-fora',
  deposito: 'Depósito',
  pista: 'Pista',
  outro: 'Outro',
}

interface Props {
  catalogo: CatalogoDto
  /** viagem em edição, ou o modelo da nova (serviço/origem/destino da anterior) */
  inicial: ViagemLocal
  nova: boolean
  /** capacidade do caminhão em m³ (só como referência ao lado da quantidade) */
  capacidade: number | null
  onSave: (v: ViagemLocal) => void
  onDismiss: () => void
}

type Campo =
  | 'servico'
  | 'origem'
  | 'destino'
  | 'estacaCarga'
  | 'estacaDescarga'
  | 'qtd'
  | 'material'
  | 'dmt'
  | 'nf'
type Erros = Partial<Record<Campo, string>>

const txt = (n: number | null | undefined): string => (n != null ? String(n) : '')

/**
 * Uma viagem: serviço (lançado por viagens), origem e destino, a estaca de carga e/ou de descarga quando a ponta é a
 * pista, horários, quantidade na unidade do serviço (o apontador aplica o empolamento/densidade dele), material quando
 * a unidade difere e NF/ticket (obrigatório quando o serviço é medido por peso). A DMT aparece calculada (pelo eixo ou distância fixa do par) e pode
 * ser ajustada; o banco recalcula ao sincronizar.
 */
export function ViagemFormSheet({ catalogo, inicial, nova, capacidade, onSave, onDismiss }: Props) {
  const servicos = catalogo.servicos.filter((s) => s.modo_lancamento === 'viagens')
  const [servicoId, setServicoId] = useState(inicial.servicoId)
  const [origemId, setOrigemId] = useState(inicial.origemId)
  const [destinoId, setDestinoId] = useState(inicial.destinoId)
  const [estacaCarga, setEstacaCarga] = useState(inicial.estacaCarga ?? '')
  const [estacaDescarga, setEstacaDescarga] = useState(inicial.estacaDescarga ?? '')
  const [horaCarga, setHoraCarga] = useState(inicial.horaCarga ?? '')
  const [horaDescarga, setHoraDescarga] = useState(inicial.horaDescarga ?? '')
  const [qtd, setQtd] = useState(inicial.quantidade > 0 ? String(inicial.quantidade) : '')
  const [matQtd, setMatQtd] = useState(txt(inicial.materialQtd))
  const [dmtManual, setDmtManual] = useState(!!inicial.dmtManual)
  const [dmt, setDmt] = useState(inicial.dmtManual ? txt(inicial.dmtKm) : '')
  const [nf, setNf] = useState(inicial.nfTicket ?? '')
  const [carregadorId, setCarregadorId] = useState(inicial.carregadorId ?? null)
  const maquinas = catalogo.veiculos.filter(ehMaquinaDeCarga)
  const carregador = maquinas.find((v) => v.id === carregadorId) ?? null
  const [picker, setPicker] = useState<'servico' | 'origem' | 'destino' | 'carregador' | null>(null)
  // erro de cada campo, mostrado embaixo dele depois de tentar salvar; some quando o campo muda
  const [erros, setErros] = useState<Erros>({})
  const limpar = (...campos: Campo[]) =>
    setErros((e) =>
      campos.some((c) => e[c])
        ? { ...e, ...Object.fromEntries(campos.map((c) => [c, undefined])) }
        : e,
    )
  const folhaRef = useFolha<HTMLFormElement>(true, onDismiss)
  const tituloId = useId()

  const servico: ServicoDto | undefined = servicos.find((s) => s.id === servicoId)
  const porPeso = servico?.medicao_viagem === 'peso'
  const origem = catalogo.origens_destinos.find((l) => l.id === origemId) ?? null
  const destino = catalogo.origens_destinos.find((l) => l.id === destinoId) ?? null
  const tipoTrecho = (id: string): 'eixo' | 'area' | null =>
    catalogo.locais.find((t) => t.id === id)?.tipo ?? null
  const paraDmt = (l: OrigemDestinoDto | null): LocalDmt | null =>
    l && {
      id: l.id,
      nome: l.nome,
      tipo: l.tipo,
      trecho_id: l.trecho_id,
      estaca_acesso_m: l.estaca_acesso_m ?? null,
      distancia_acesso_km: l.distancia_acesso_km ?? 0,
    }
  /** eixo da ponta na pista (pede a estaca da viagem) */
  const eixoDa = (l: OrigemDestinoDto | null): LocalDto | null =>
    l && pedeEstaca(paraDmt(l), tipoTrecho)
      ? (catalogo.locais.find((t) => t.id === l.trecho_id) ?? null)
      : null
  const eixoCarga = eixoDa(origem)
  const eixoDescarga = eixoDa(destino)
  const metros = (eixo: LocalDto | null, t: string): number | null =>
    eixo && t.trim() ? estacaParaMetros(eixo, t) : null
  const pc = metros(eixoCarga, estacaCarga)
  const pd = metros(eixoDescarga, estacaDescarga)

  const calc = calcularDmt({
    origem: paraDmt(origem),
    destino: paraDmt(destino),
    estacaCarga: pc,
    estacaDescarga: pd,
    rotas: catalogo.rotas,
    tipoTrecho,
  })
  const pedeMaterial =
    !!servico?.controla_material &&
    (servico.material?.unidade ?? '').toLowerCase() !== (servico.unidade ?? '').toLowerCase()

  function salvar() {
    const q = parseNum(qtd)
    const ajustada = parseNum(dmt)
    const m = parseNum(matQtd)
    const novos: Erros = {}
    if (!servico) novos.servico = 'Escolha o serviço.'
    if (!origem) novos.origem = 'Escolha a origem.'
    if (!destino) novos.destino = 'Escolha o destino.'
    if (eixoCarga && pc == null)
      novos.estacaCarga = estacaCarga.trim()
        ? erroPosicaoFora(eixoCarga)
        : erroPosicaoVazia(eixoCarga)
    if (eixoDescarga && pd == null)
      novos.estacaDescarga = estacaDescarga.trim()
        ? erroPosicaoFora(eixoDescarga)
        : erroPosicaoVazia(eixoDescarga)
    if (q == null || q <= 0) novos.qtd = 'Informe a quantidade da viagem.'
    if (porPeso && !nf.trim()) novos.nf = 'Informe o ticket da balança.'
    if (dmtManual && (ajustada == null || ajustada < 0)) novos.dmt = 'Informe a DMT ajustada (km).'
    // sem origem, destino ou estaca o próprio campo já acusa; a DMT só acusa quando falta o cadastro
    if (
      !dmtManual &&
      calc.km == null &&
      !novos.origem &&
      !novos.destino &&
      !novos.estacaCarga &&
      !novos.estacaDescarga
    )
      novos.dmt = calc.motivo ?? 'Sem DMT.'
    if (servico && pedeMaterial && servico.material_obrigatorio && m == null)
      novos.material = `Informe a quantidade de ${servico.material?.nome ?? 'material'}.`
    flushSync(() => setErros(novos))
    if (!servico || !origem || !destino || q == null || Object.values(novos).some(Boolean))
      return focarPrimeiroInvalido(folhaRef.current)
    onSave({
      ...inicial,
      servicoId: servico.id,
      servicoNome: servico.descricao,
      unidade: servico.unidade,
      origemId: origem.id,
      origemNome: origem.nome,
      destinoId: destino.id,
      destinoNome: destino.nome,
      horaCarga: horaCarga || null,
      horaDescarga: horaDescarga || null,
      quantidade: q,
      materialQtd: pedeMaterial ? m : null,
      dmtKm: dmtManual ? ajustada : calc.km,
      dmtManual,
      dmtVia: dmtManual ? 'manual' : calc.via,
      nfTicket: nf.trim() || null,
      estacaCarga: eixoCarga ? estacaCarga.trim() : null,
      estacaCargaM: pc,
      estacaDescarga: eixoDescarga ? estacaDescarga.trim() : null,
      estacaDescargaM: pd,
      trechoId: undefined,
      estaca: undefined,
      posicaoM: undefined,
      carregadorId: carregador?.id ?? null,
      carregadorNome: carregador ? rotuloVeiculo(carregador) : null,
    })
  }

  const unidadeServico = servico?.unidade ?? 'un'
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-veu sm:items-center sm:justify-center"
      onClick={onDismiss}
    >
      {/* formulário: o Enter (ou o "Ir" do teclado do celular) num campo grava */}
      <form
        ref={folhaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          salvar()
        }}
        className="folha-flutuante flex max-h-[90vh] w-full flex-col rounded-t-2xl focus-visible:ring-0 sm:max-w-md sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-center pb-1 pt-3 sm:hidden">
          <div className="h-1 w-12 rounded-full bg-border-strong" />
        </div>
        <div className="flex items-start justify-between border-b border-border px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1 pr-2">
            <p className="rotulo">{nova ? 'Nova viagem' : 'Editar viagem'}</p>
            <h2 id={tituloId} className="mt-1 truncate text-lg font-semibold text-on-surface">
              {servico?.descricao ?? 'Escolha o serviço'}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onDismiss} aria-label="Fechar">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <PickerField
            label="Serviço *"
            value={servico ? `${servico.codigo} ${servico.descricao}` : 'Selecionar…'}
            onClick={() => setPicker('servico')}
            empty={!servico}
            erro={erros.servico}
          />
          <div className="grid grid-cols-2 gap-3">
            <PickerField
              label="Origem *"
              value={origem?.nome ?? 'Selecionar…'}
              onClick={() => setPicker('origem')}
              empty={!origem}
              erro={erros.origem}
            />
            <PickerField
              label="Destino *"
              value={destino?.nome ?? 'Selecionar…'}
              onClick={() => setPicker('destino')}
              empty={!destino}
              erro={erros.destino}
            />
          </div>
          {(eixoCarga || eixoDescarga) && (
            <div className="grid grid-cols-2 gap-3">
              {eixoCarga ? (
                <LabeledInput
                  label={`${nomePosicao(eixoCarga)} de carga *`}
                  value={estacaCarga}
                  onChange={(v) => {
                    setEstacaCarga(v)
                    limpar('estacaCarga', 'dmt')
                  }}
                  placeholder={estacaInicialTexto(eixoCarga)}
                  inputMode={tecladoPosicao(eixoCarga)}
                  erro={erros.estacaCarga}
                />
              ) : (
                <div />
              )}
              {eixoDescarga ? (
                <LabeledInput
                  label={`${nomePosicao(eixoDescarga)} de descarga *`}
                  value={estacaDescarga}
                  onChange={(v) => {
                    setEstacaDescarga(v)
                    limpar('estacaDescarga', 'dmt')
                  }}
                  placeholder={estacaInicialTexto(eixoDescarga)}
                  inputMode={tecladoPosicao(eixoDescarga)}
                  erro={erros.estacaDescarga}
                />
              ) : null}
            </div>
          )}
          {maquinas.length > 0 && (
            <PickerField
              label="Carregado por"
              value={carregador ? rotuloVeiculo(carregador) : 'Opcional'}
              onClick={() => setPicker('carregador')}
              opcional={!carregador}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <TimeField label="Hora da carga" value={horaCarga} onChange={setHoraCarga} />
            <TimeField label="Hora da descarga" value={horaDescarga} onChange={setHoraDescarga} />
          </div>
          <NumericField
            label={`Quantidade (${unidadeServico}) *`}
            value={qtd}
            onChange={(v) => {
              setQtd(v)
              limpar('qtd')
            }}
            erro={erros.qtd}
            hint={
              capacidade != null && !porPeso
                ? `Caçamba de ${formatNumero(capacidade, 1)} m³`
                : undefined
            }
          />
          {servico?.controla_material &&
            (pedeMaterial ? (
              <NumericField
                label={`${servico.material?.nome ?? 'Material'} (${servico.material?.unidade ?? ''})${servico.material_obrigatorio ? ' *' : ''}`}
                value={matQtd}
                onChange={(v) => {
                  setMatQtd(v)
                  limpar('material')
                }}
                erro={erros.material}
              />
            ) : (
              <ReadOnlyRow
                label="Material"
                value={`${servico.material?.nome ?? '—'}: a quantidade da viagem`}
              />
            ))}
          <div>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {dmtManual ? (
                  <NumericField
                    label="DMT ajustada (km) *"
                    value={dmt}
                    onChange={(v) => {
                      setDmt(v)
                      limpar('dmt')
                    }}
                    erro={erros.dmt}
                    hint={calc.km != null ? `Calculada: ${formatNumero(calc.km, 3)} km` : undefined}
                  />
                ) : (
                  <ReadOnlyRow
                    label="DMT (km)"
                    value={
                      calc.km != null
                        ? `${formatNumero(calc.km, 3)} · ${calc.via === 'rota' ? 'distância fixa' : 'pelo eixo'}`
                        : 'Sem DMT'
                    }
                  />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={dmtManual ? 'Voltar à DMT calculada' : 'Ajustar a DMT'}
                aria-pressed={dmtManual}
                aria-describedby={!dmtManual && erros.dmt ? `${tituloId}-dmt` : undefined}
                data-invalido={!dmtManual && erros.dmt ? 'true' : undefined}
                onClick={() => {
                  setDmt(dmtManual ? '' : txt(calc.km))
                  setDmtManual(!dmtManual)
                  limpar('dmt')
                }}
                className={dmtManual ? 'mt-5 text-accent' : 'mt-1.5'}
              >
                <Pencil className="h-5 w-5" />
              </Button>
            </div>
            {!dmtManual &&
              calc.km == null &&
              (erros.dmt ? (
                <p id={`${tituloId}-dmt`} role="alert" className="mt-1 text-xs text-bad">
                  {erros.dmt} Toque no lápis para informar a DMT.
                </p>
              ) : (
                calc.motivo && <p className="mt-1 text-xs text-warn">{calc.motivo}</p>
              ))}
          </div>
          <LabeledInput
            label={porPeso ? 'Ticket da balança *' : 'NF / ticket'}
            value={nf}
            onChange={(v) => {
              setNf(v)
              limpar('nf')
            }}
            placeholder={porPeso ? '' : 'Opcional'}
            erro={erros.nf}
          />
        </div>

        <div className="border-t border-border p-4 pb-safe-plus-4">
          <Button type="submit" variant="primary" size="lg" className="w-full">
            {nova ? 'Adicionar viagem' : 'Atualizar viagem'}
          </Button>
        </div>
      </form>

      {picker === 'servico' && (
        <PickerSheet
          open
          title="Serviço"
          items={servicos}
          label={(s) => `${s.codigo} ${s.descricao}`}
          sublabel={(s) =>
            `${s.unidade ?? ''} · por ${s.medicao_viagem === 'peso' ? 'peso' : 'volume'}`
          }
          onPick={(s) => {
            setServicoId(s.id)
            limpar('servico', 'nf', 'material')
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          emptyMessage="Nenhum serviço da obra é lançado por viagens."
        />
      )}
      {picker === 'carregador' && (
        <PickerSheet
          open
          title="Carregado por"
          items={maquinas}
          label={rotuloVeiculo}
          sublabel={(v) => v.modelo ?? ''}
          onPick={(v) => {
            setCarregadorId(v.id)
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          emptyMessage="Nenhuma escavadeira ou carregadeira na frota da obra."
        />
      )}
      {(picker === 'origem' || picker === 'destino') && (
        <PickerSheet
          open
          title={picker === 'origem' ? 'Origem' : 'Destino'}
          items={catalogo.origens_destinos}
          label={(l) => l.nome}
          sublabel={(l) => TIPO_LOCAL[l.tipo] ?? l.tipo}
          onPick={(l) => {
            if (picker === 'origem') {
              if (l.id !== origemId) setEstacaCarga('')
              setOrigemId(l.id)
              limpar('origem', 'estacaCarga', 'dmt')
            } else {
              if (l.id !== destinoId) setEstacaDescarga('')
              setDestinoId(l.id)
              limpar('destino', 'estacaDescarga', 'dmt')
            }
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          emptyMessage="Nenhuma origem ou destino cadastrado. Peça ao escritório para cadastrar em Acompanhamento › Origens e destinos."
        />
      )}
    </div>
  )
}
