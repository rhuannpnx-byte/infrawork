import { useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { PickerSheet } from '@/features/common/PickerSheet'
import { LabeledInput, NumericField, PickerField, ReadOnlyRow } from '@/features/common/fields'
import { parseNum } from '@/lib/numero'
import { estacaFinalTexto, estacaInicialTexto, estacaParaMetros, nomePosicao } from '@/lib/estaca'
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
  const [erro, setErro] = useState<string | null>(null)

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
    setErro(null)
    if (!servico) return setErro('Escolha o serviço.')
    if (!origem || !destino) return setErro('Escolha a origem e o destino.')
    const faixa = (e: LocalDto): string => `${estacaInicialTexto(e)} – ${estacaFinalTexto(e)}`
    if (eixoCarga && pc == null)
      return setErro(
        estacaCarga.trim()
          ? `${nomePosicao(eixoCarga)} de carga "${estacaCarga}" inválido (${faixa(eixoCarga)}).`
          : `Informe ${nomePosicao(eixoCarga).toLowerCase()} de carga.`,
      )
    if (eixoDescarga && pd == null)
      return setErro(
        estacaDescarga.trim()
          ? `${nomePosicao(eixoDescarga)} de descarga "${estacaDescarga}" inválido (${faixa(eixoDescarga)}).`
          : `Informe ${nomePosicao(eixoDescarga).toLowerCase()} de descarga.`,
      )
    const q = parseNum(qtd)
    if (q == null || q <= 0) return setErro('Informe a quantidade da viagem.')
    if (porPeso && !nf.trim()) return setErro('Informe o ticket da balança.')
    const ajustada = parseNum(dmt)
    if (dmtManual && (ajustada == null || ajustada < 0))
      return setErro('Informe a DMT ajustada (km).')
    if (!dmtManual && calc.km == null) return setErro(calc.motivo ?? 'Sem DMT.')
    const m = parseNum(matQtd)
    if (pedeMaterial && servico.material_obrigatorio && m == null)
      return setErro(`Informe a quantidade de ${servico.material?.nome ?? 'material'}.`)
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
      className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center"
      onClick={onDismiss}
    >
      <div
        className="card-surface flex max-h-[90vh] w-full flex-col rounded-t-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-center pb-1 pt-3 sm:hidden">
          <div className="h-1 w-12 rounded-full bg-on-surface-muted" />
        </div>
        <div className="flex items-start justify-between border-b border-border px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-xs font-bold uppercase text-accent">
              {nova ? 'Nova viagem' : 'Editar viagem'}
            </p>
            <h2 className="mt-1 truncate text-lg font-bold text-on-surface">
              {servico?.descricao ?? 'Escolha o serviço'}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Fechar">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <PickerField
            label="SERVIÇO *"
            value={servico ? `${servico.codigo} ${servico.descricao}` : 'Selecionar…'}
            onClick={() => setPicker('servico')}
            empty={!servico}
          />
          <div className="grid grid-cols-2 gap-3">
            <PickerField
              label="ORIGEM *"
              value={origem?.nome ?? 'Selecionar…'}
              onClick={() => setPicker('origem')}
              empty={!origem}
            />
            <PickerField
              label="DESTINO *"
              value={destino?.nome ?? 'Selecionar…'}
              onClick={() => setPicker('destino')}
              empty={!destino}
            />
          </div>
          {(eixoCarga || eixoDescarga) && (
            <div className="grid grid-cols-2 gap-3">
              {eixoCarga ? (
                <LabeledInput
                  label={`${nomePosicao(eixoCarga)} de carga *`}
                  value={estacaCarga}
                  onChange={setEstacaCarga}
                  placeholder={estacaInicialTexto(eixoCarga)}
                />
              ) : (
                <div />
              )}
              {eixoDescarga ? (
                <LabeledInput
                  label={`${nomePosicao(eixoDescarga)} de descarga *`}
                  value={estacaDescarga}
                  onChange={setEstacaDescarga}
                  placeholder={estacaInicialTexto(eixoDescarga)}
                />
              ) : null}
            </div>
          )}
          {maquinas.length > 0 && (
            <PickerField
              label="CARREGADO POR"
              value={carregador ? rotuloVeiculo(carregador) : 'Opcional'}
              onClick={() => setPicker('carregador')}
              empty={!carregador}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <TimeField label="Hora carga" value={horaCarga} onChange={setHoraCarga} />
            <TimeField label="Hora descarga" value={horaDescarga} onChange={setHoraDescarga} />
          </div>
          <NumericField
            label={`Quantidade (${unidadeServico}) *${capacidade != null && !porPeso ? ` · caçamba ${formatNumero(capacidade, 1)} m³` : ''}`}
            value={qtd}
            onChange={setQtd}
          />
          {servico?.controla_material &&
            (pedeMaterial ? (
              <NumericField
                label={`${servico.material?.nome ?? 'Material'} (${servico.material?.unidade ?? ''})${servico.material_obrigatorio ? ' *' : ''}`}
                value={matQtd}
                onChange={setMatQtd}
              />
            ) : (
              <ReadOnlyRow
                label="MATERIAL"
                value={`${servico.material?.nome ?? '—'} = quantidade da viagem`}
              />
            ))}
          <div>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                {dmtManual ? (
                  <NumericField label="DMT ajustada (km) *" value={dmt} onChange={setDmt} />
                ) : (
                  <ReadOnlyRow
                    label="DMT (km)"
                    value={
                      calc.km != null
                        ? `${formatNumero(calc.km, 3)} · ${calc.via === 'rota' ? 'distância fixa' : 'pelo eixo'}`
                        : 'sem DMT'
                    }
                  />
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={dmtManual ? 'Voltar à DMT calculada' : 'Ajustar a DMT'}
                onClick={() => {
                  setDmt(dmtManual ? '' : txt(calc.km))
                  setDmtManual(!dmtManual)
                }}
                className={dmtManual ? 'text-accent' : ''}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
            {!dmtManual && calc.km == null && calc.motivo && (
              <p className="mt-1 text-xs text-warn">{calc.motivo}</p>
            )}
            {dmtManual && calc.km != null && (
              <p className="mt-1 text-xs text-on-surface-dim">
                Calculada: {formatNumero(calc.km, 3)} km
              </p>
            )}
          </div>
          <LabeledInput
            label={porPeso ? 'Ticket da balança *' : 'NF / ticket'}
            value={nf}
            onChange={setNf}
            placeholder={porPeso ? '' : 'Opcional'}
          />
          {erro && <p className="text-sm text-bad">{erro}</p>}
        </div>

        <div className="border-t border-border p-4 pb-safe-plus-4">
          <Button variant="primary" size="lg" onClick={salvar} className="w-full">
            {nova ? 'Adicionar viagem' : 'Atualizar viagem'}
          </Button>
        </div>
      </div>

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
            } else {
              if (l.id !== destinoId) setEstacaDescarga('')
              setDestinoId(l.id)
            }
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          emptyMessage="Nenhuma origem/destino cadastrado (Acompanhamento › Origens e destinos)."
        />
      )}
    </div>
  )
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-xs font-medium uppercase text-on-surface-dim">{label}</label>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-touch w-full rounded-lg border border-border bg-surface-1 px-3 text-on-surface focus-visible:border-accent focus-visible:outline-none"
      />
    </div>
  )
}
