import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { PickerSheet } from '@/features/common/PickerSheet'
import { LabeledInput, NumericField, PickerField, ReadOnlyRow } from '@/features/common/fields'
import { parseNum } from '@/lib/numero'
import { estacaFinalTexto, estacaInicialTexto, estacaParaMetros } from '@/lib/estaca'
import { formatNumero } from '@/lib/datas'
import type { ViagemLocal } from '@/core/db/entities'
import type { CatalogoDto, OrigemDestinoDto, ServicoDto } from '@/types/dtos'

const TIPO_LOCAL: Record<OrigemDestinoDto['tipo'], string> = {
  jazida: 'Jazida',
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
  capacidade: number | null
  onSave: (v: ViagemLocal) => void
  onDismiss: () => void
}

/**
 * Uma viagem: serviço (lançado por viagens), origem, destino, estaca quando uma das pontas é a pista (eixo),
 * horários, quantidade (na unidade do serviço; padrão = capacidade do caminhão), material quando a unidade difere,
 * DMT (padrão = rota cadastrada) e NF/ticket.
 */
export function ViagemFormSheet({ catalogo, inicial, nova, capacidade, onSave, onDismiss }: Props) {
  const servicos = catalogo.servicos.filter((s) => s.modo_lancamento === 'viagens')
  const [servicoId, setServicoId] = useState(inicial.servicoId)
  const [origemId, setOrigemId] = useState(inicial.origemId)
  const [destinoId, setDestinoId] = useState(inicial.destinoId)
  const [estaca, setEstaca] = useState(inicial.estaca ?? '')
  const [horaCarga, setHoraCarga] = useState(inicial.horaCarga ?? '')
  const [horaDescarga, setHoraDescarga] = useState(inicial.horaDescarga ?? '')
  const [qtd, setQtd] = useState(
    inicial.quantidade > 0 ? String(inicial.quantidade) : capacidade ? String(capacidade) : '',
  )
  const [matQtd, setMatQtd] = useState(
    inicial.materialQtd != null ? String(inicial.materialQtd) : '',
  )
  const [dmt, setDmt] = useState(inicial.dmtKm != null ? String(inicial.dmtKm) : '')
  const [nf, setNf] = useState(inicial.nfTicket ?? '')
  const [picker, setPicker] = useState<'servico' | 'origem' | 'destino' | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const servico: ServicoDto | undefined = servicos.find((s) => s.id === servicoId)
  const origem = catalogo.origens_destinos.find((l) => l.id === origemId) ?? null
  const destino = catalogo.origens_destinos.find((l) => l.id === destinoId) ?? null
  // a estaca vale para a ponta que está na pista: o destino (aterro, base) ou, senão, a origem (corte)
  const eixoDe = (l: OrigemDestinoDto | null) =>
    catalogo.locais.find((t) => t.id === l?.trecho_id && t.tipo === 'eixo') ?? null
  const eixo = eixoDe(destino) ?? eixoDe(origem)
  const pontaNaPista = eixoDe(destino) ? 'descarga' : 'carga'
  const rota = catalogo.rotas.find((r) => r.origem_id === origemId && r.destino_id === destinoId)
  const pedeMaterial =
    !!servico?.controla_material &&
    (servico.material?.unidade ?? '').toLowerCase() !== (servico.unidade ?? '').toLowerCase()

  function salvar() {
    setErro(null)
    if (!servico) return setErro('Escolha o serviço.')
    const q = parseNum(qtd)
    if (q == null || q <= 0) return setErro('Informe a quantidade da viagem.')
    let posicaoM: number | null = null
    if (eixo && estaca.trim()) {
      posicaoM = estacaParaMetros(eixo, estaca)
      if (posicaoM == null)
        return setErro(
          `Estaca "${estaca}" inválida (${estacaInicialTexto(eixo)} – ${estacaFinalTexto(eixo)}).`,
        )
    }
    const m = parseNum(matQtd)
    if (pedeMaterial && servico.material_obrigatorio && m == null)
      return setErro(`Informe a quantidade de ${servico.material?.nome ?? 'material'}.`)
    onSave({
      ...inicial,
      servicoId: servico.id,
      servicoNome: servico.descricao,
      unidade: servico.unidade,
      origemId,
      origemNome: origem?.nome ?? null,
      destinoId,
      destinoNome: destino?.nome ?? null,
      horaCarga: horaCarga || null,
      horaDescarga: horaDescarga || null,
      quantidade: q,
      materialQtd: pedeMaterial ? m : null,
      dmtKm: parseNum(dmt) ?? rota?.dmt_km ?? null,
      nfTicket: nf.trim() || null,
      trechoId: eixo?.id ?? destino?.trecho_id ?? origem?.trecho_id ?? null,
      estaca: eixo ? estaca.trim() || null : null,
      posicaoM,
    })
  }

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
              label="ORIGEM"
              value={origem?.nome ?? 'Selecionar…'}
              onClick={() => setPicker('origem')}
              empty={!origem}
            />
            <PickerField
              label="DESTINO"
              value={destino?.nome ?? 'Selecionar…'}
              onClick={() => setPicker('destino')}
              empty={!destino}
            />
          </div>
          {eixo && (
            <LabeledInput
              label={`Estaca de ${pontaNaPista} (${eixo.nome})`}
              value={estaca}
              onChange={setEstaca}
              placeholder={`${estacaInicialTexto(eixo)} – ${estacaFinalTexto(eixo)}`}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <TimeField label="Hora carga" value={horaCarga} onChange={setHoraCarga} />
            <TimeField label="Hora descarga" value={horaDescarga} onChange={setHoraDescarga} />
          </div>
          <NumericField
            label={`Quantidade (${servico?.unidade ?? '—'}) *`}
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
          <NumericField
            label={`DMT (km)${rota ? ` · rota: ${formatNumero(rota.dmt_km, 1)}` : ''}`}
            value={dmt}
            onChange={setDmt}
          />
          <LabeledInput label="NF / ticket" value={nf} onChange={setNf} placeholder="Opcional" />
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
          sublabel={(s) => s.unidade}
          onPick={(s) => {
            setServicoId(s.id)
            setPicker(null)
          }}
          onDismiss={() => setPicker(null)}
          emptyMessage="Nenhum serviço da obra é lançado por viagens."
        />
      )}
      {(picker === 'origem' || picker === 'destino') && (
        <PickerSheet
          open
          title={picker === 'origem' ? 'Origem' : 'Destino'}
          items={catalogo.origens_destinos}
          label={(l) => l.nome}
          sublabel={(l) => TIPO_LOCAL[l.tipo]}
          onPick={(l) => {
            if (picker === 'origem') setOrigemId(l.id)
            else setDestinoId(l.id)
            setEstaca('')
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
