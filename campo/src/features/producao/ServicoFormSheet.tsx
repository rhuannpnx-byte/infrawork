import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { PickerSheet } from '@/features/common/PickerSheet'
import { LabeledInput, NumericField, PickerField, ReadOnlyRow } from '@/features/common/fields'
import { parseNum } from '@/lib/numero'
import {
  estacaFinalTexto,
  estacaInicialTexto,
  nomePosicao,
  resolverLocal,
  rotuloLocal,
  tecladoPosicao,
} from '@/lib/estaca'
import type { LocalDto, ServicoDto } from '@/types/dtos'
import { novoApontamento, type ApontamentoDraft } from './producaoStore'

interface Props {
  servico: ServicoDto
  locais: LocalDto[]
  initial: ApontamentoDraft | null
  onSave: (draft: ApontamentoDraft) => void
  onDismiss: () => void
}

/**
 * Lançamento de um serviço. Os campos seguem a parametrização do serviço (Planejamento › Parametrização do
 * InfraWork Web): quantidade sempre; material (fixo, só a quantidade) quando o serviço controla material; local e
 * estacas (obrigatórios quando o serviço exige); observação quando habilitada.
 */
export function ServicoFormSheet({ servico, locais, initial, onSave, onDismiss }: Props) {
  const base = initial ?? novoApontamento(servico)
  const [qtd, setQtd] = useState(base.qtd != null ? String(base.qtd) : '')
  const [materialQtd, setMaterialQtd] = useState(
    base.materialQtd != null ? String(base.materialQtd) : '',
  )
  const [localId, setLocalId] = useState<string | null>(base.localId)
  const [estIni, setEstIni] = useState(base.estacaInicial)
  const [estFim, setEstFim] = useState(base.estacaFinal)
  const [obs, setObs] = useState(base.obs ?? '')
  const [picker, setPicker] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const local = locais.find((l) => l.id === localId) ?? null
  const mat = servico.controla_material ? servico.material : null

  function salvar() {
    setErro(null)
    const q = parseNum(qtd)
    if (q == null || q < 0) return setErro('Informe a quantidade executada.')
    const m = parseNum(materialQtd)
    if (mat && servico.material_obrigatorio && m == null)
      return setErro(`Informe a quantidade de ${mat.nome}.`)
    if (servico.exige_local && !local) return setErro('Este serviço exige o local do lançamento.')
    const r = resolverLocal(local, estIni, estFim)
    if (!r.ok) return setErro(r.erro)
    onSave({
      ...base,
      servico,
      qtd: q,
      materialQtd: mat ? m : null,
      localId: local?.id ?? null,
      localNome: local ? rotuloLocal(local) : null,
      estacaInicial: local?.tipo === 'eixo' ? estIni.trim() : '',
      estacaFinal: local?.tipo === 'eixo' ? estFim.trim() : '',
      posicaoInicioM: r.inicioM,
      posicaoFimM: r.fimM,
      obs: servico.habilita_obs ? obs.trim() || null : null,
    })
  }

  const itensPicker: (LocalDto | null)[] = servico.exige_local ? locais : [null, ...locais]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-veu sm:items-center sm:justify-center"
      onClick={onDismiss}
    >
      <div
        className="folha-flutuante flex max-h-[90vh] w-full flex-col rounded-t-2xl sm:max-w-md sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-center pb-1 pt-3 sm:hidden">
          <div className="h-1 w-12 rounded-full bg-border-strong" />
        </div>
        <div className="flex items-start justify-between border-b border-border px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1 pr-2">
            <p className="rotulo">Serviço · {servico.codigo}</p>
            <h2 className="mt-1 truncate text-lg font-semibold text-on-surface">
              {servico.descricao}
            </h2>
            <p className="mt-0.5 text-xs text-on-surface-dim">
              {[
                mat ? `material: ${mat.nome}` : null,
                servico.exige_local ? 'local obrigatório' : null,
                servico.habilita_obs ? null : 'sem observação',
              ]
                .filter(Boolean)
                .join(' · ') || 'quantidade do dia'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Fechar">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <NumericField
            label={`Quantidade executada (${servico.unidade ?? '—'}) *`}
            value={qtd}
            onChange={setQtd}
          />
          {mat && (
            <>
              <ReadOnlyRow
                label="Material"
                value={`${mat.nome}${mat.unidade ? ` (${mat.unidade})` : ''}`}
              />
              <NumericField
                label={`Quantidade de material${mat.unidade ? ` (${mat.unidade})` : ''}${servico.material_obrigatorio ? ' *' : ''}`}
                value={materialQtd}
                onChange={setMaterialQtd}
              />
            </>
          )}
          <PickerField
            label={`Local${servico.exige_local ? ' *' : ''}`}
            value={local ? rotuloLocal(local) : servico.exige_local ? 'Selecionar…' : 'Sem local'}
            onClick={() => setPicker(true)}
            empty={servico.exige_local && !local}
            hint={
              locais.length === 0
                ? 'A obra não tem locais cadastrados'
                : !local
                  ? 'Com o local, a produção cai na tarefa certa do cronograma'
                  : undefined
            }
          />
          {local?.tipo === 'eixo' && (
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput
                label={`${nomePosicao(local)} inicial *`}
                value={estIni}
                onChange={setEstIni}
                placeholder={estacaInicialTexto(local)}
                inputMode={tecladoPosicao(local)}
              />
              <LabeledInput
                label={`${nomePosicao(local)} final *`}
                value={estFim}
                onChange={setEstFim}
                placeholder={estacaFinalTexto(local)}
                inputMode={tecladoPosicao(local)}
              />
            </div>
          )}
          {servico.habilita_obs && (
            <LabeledInput label="Observação" value={obs} onChange={setObs} placeholder="Opcional" />
          )}
          {erro && (
            <p role="alert" className="text-sm text-bad">
              {erro}
            </p>
          )}
        </div>

        <div className="border-t border-border p-4 pb-safe-plus-4">
          <Button variant="primary" size="lg" onClick={salvar} className="w-full">
            {initial ? 'Atualizar lançamento' : 'Adicionar lançamento'}
          </Button>
        </div>
      </div>

      {picker && (
        <PickerSheet
          open
          title="Local"
          items={itensPicker}
          label={(l) => (l ? rotuloLocal(l) : 'Sem local')}
          sublabel={(l) => (l ? (l.tipo === 'area' ? 'área' : 'eixo') : null)}
          onPick={(l) => {
            setLocalId(l?.id ?? null)
            if (!l || l.tipo === 'area') {
              setEstIni('')
              setEstFim('')
            }
            setPicker(false)
          }}
          onDismiss={() => setPicker(false)}
          emptyMessage="A obra não tem locais cadastrados."
        />
      )}
    </div>
  )
}
