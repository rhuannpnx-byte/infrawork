import { useId, useState } from 'react'
import { flushSync } from 'react-dom'
import { Minus, Plus, X } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { LabeledInput, NumericField, ReadOnlyRow, RotuloCampo } from '@/features/common/fields'
import { focarPrimeiroInvalido, useFolha } from '@/features/common/useFolha'
import { cn } from '@/lib/cn'
import { formatNumero } from '@/lib/datas'
import {
  avancarPosicao,
  erroPosicaoFora,
  erroPosicaoVazia,
  faixaTexto,
  nomePosicao,
  tecladoPosicao,
} from '@/lib/estaca'
import { parseNum } from '@/lib/numero'
import { uuidv7 } from '@/lib/uuidv7'
import type { ViagemLocal } from '@/core/db/entities'
import type { CatalogoDto, LocalDto } from '@/types/dtos'
import { pontasDaViagem } from './pontasDaViagem'

interface Props {
  catalogo: CatalogoDto
  /** a viagem que está sendo repetida, e o número dela na ficha */
  viagem: ViagemLocal
  numero: number
  onAdd: (v: ViagemLocal) => void
  /** abre o formulário completo com o que já foi digitado aqui */
  onMaisCampos: (v: ViagemLocal) => void
  onDismiss: () => void
}

type Campo = 'estacaCarga' | 'estacaDescarga' | 'qtd' | 'nf' | 'dmt'
type Erros = Partial<Record<Campo, string>>

/**
 * Repetir uma viagem: no dia a dia a carga seguinte tem a mesma origem e o mesmo destino, e só a estaca anda. A
 * folha pede só o que muda — a estaca da ponta que é pista, com − e + de uma estaca; no serviço por peso, também o
 * peso e o ticket — e recalcula a DMT. O resto vem da viagem copiada; "Mais campos" abre o formulário completo.
 */
export function RepetirViagemSheet({
  catalogo,
  viagem,
  numero,
  onAdd,
  onMaisCampos,
  onDismiss,
}: Props) {
  const [estacaCarga, setEstacaCarga] = useState(viagem.estacaCarga ?? '')
  const [estacaDescarga, setEstacaDescarga] = useState(viagem.estacaDescarga ?? '')
  const [qtd, setQtd] = useState(viagem.quantidade > 0 ? String(viagem.quantidade) : '')
  const [nf, setNf] = useState('')
  const [erros, setErros] = useState<Erros>({})
  const limpar = (...campos: Campo[]) =>
    setErros((e) =>
      campos.some((c) => e[c])
        ? { ...e, ...Object.fromEntries(campos.map((c) => [c, undefined])) }
        : e,
    )
  const folhaRef = useFolha<HTMLFormElement>(true, onDismiss)
  const tituloId = useId()

  const servico = catalogo.servicos.find((s) => s.id === viagem.servicoId)
  const porPeso = servico?.medicao_viagem === 'peso'
  const pontas = pontasDaViagem(catalogo, viagem.origemId, viagem.destinoId)
  const { eixoCarga, eixoDescarga } = pontas
  const { pc, pd, ...calc } = pontas.dmt(estacaCarga, estacaDescarga)
  const dmtManual = !!viagem.dmtManual
  const unidade = viagem.unidade ?? servico?.unidade ?? ''

  /** a viagem nova com o que está digitado (sem horas nem ticket da copiada) */
  function montar(): ViagemLocal {
    const q = porPeso ? parseNum(qtd) : viagem.quantidade
    return {
      ...viagem,
      id: uuidv7(),
      horaCarga: null,
      horaDescarga: null,
      quantidade: q ?? 0,
      nfTicket: porPeso ? nf.trim() || null : null,
      estacaCarga: eixoCarga ? estacaCarga.trim() : null,
      estacaCargaM: pc,
      estacaDescarga: eixoDescarga ? estacaDescarga.trim() : null,
      estacaDescargaM: pd,
      // DMT ajustada à mão continua a da viagem copiada; a calculada segue as estacas novas
      ...(dmtManual ? {} : { dmtKm: calc.km, dmtVia: calc.via }),
    }
  }

  function adicionar() {
    const novos: Erros = {}
    if (eixoCarga && pc == null)
      novos.estacaCarga = estacaCarga.trim()
        ? erroPosicaoFora(eixoCarga)
        : erroPosicaoVazia(eixoCarga)
    if (eixoDescarga && pd == null)
      novos.estacaDescarga = estacaDescarga.trim()
        ? erroPosicaoFora(eixoDescarga)
        : erroPosicaoVazia(eixoDescarga)
    if (porPeso) {
      const q = parseNum(qtd)
      if (q == null || q <= 0) novos.qtd = 'Informe a quantidade da viagem.'
      if (!nf.trim()) novos.nf = 'Informe o ticket da balança.'
    }
    if (!dmtManual && calc.km == null && !novos.estacaCarga && !novos.estacaDescarga)
      novos.dmt = calc.motivo ?? 'Sem DMT.'
    flushSync(() => setErros(novos))
    if (Object.values(novos).some(Boolean)) return focarPrimeiroInvalido(folhaRef.current)
    onAdd(montar())
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-veu sm:items-center sm:justify-center"
      onClick={onDismiss}
    >
      <form
        ref={folhaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          adicionar()
        }}
        className="folha-flutuante flex max-h-[90dvh] w-full flex-col rounded-t-2xl focus-visible:ring-0 sm:max-w-md sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-center pb-1 pt-3 sm:hidden">
          <div className="h-1 w-12 rounded-full bg-border-strong" />
        </div>
        <div className="flex items-start justify-between border-b border-border px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1 pr-2">
            <p className="rotulo">Repetir a viagem #{numero}</p>
            <h2 id={tituloId} className="mt-1 truncate text-lg font-semibold text-on-surface">
              {viagem.servicoNome}
            </h2>
            <p className="mt-0.5 truncate text-xs text-on-surface-dim">
              {(viagem.origemNome ?? '—') + ' → ' + (viagem.destinoNome ?? '—')}
              {porPeso ? '' : ` · ${formatNumero(viagem.quantidade, 2)} ${unidade}`}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onDismiss} aria-label="Fechar">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {eixoCarga && (
            <CampoPosicao
              eixo={eixoCarga}
              rotulo={`${nomePosicao(eixoCarga)} de carga *`}
              valor={estacaCarga}
              anterior={viagem.estacaCarga ?? null}
              onChange={(v) => {
                setEstacaCarga(v)
                limpar('estacaCarga', 'dmt')
              }}
              erro={erros.estacaCarga}
            />
          )}
          {eixoDescarga && (
            <CampoPosicao
              eixo={eixoDescarga}
              rotulo={`${nomePosicao(eixoDescarga)} de descarga *`}
              valor={estacaDescarga}
              anterior={viagem.estacaDescarga ?? null}
              onChange={(v) => {
                setEstacaDescarga(v)
                limpar('estacaDescarga', 'dmt')
              }}
              erro={erros.estacaDescarga}
            />
          )}
          {porPeso && (
            <>
              <NumericField
                label={`Quantidade (${unidade || 'un'}) *`}
                value={qtd}
                onChange={(v) => {
                  setQtd(v)
                  limpar('qtd')
                }}
                erro={erros.qtd}
              />
              <LabeledInput
                label="Ticket da balança *"
                value={nf}
                onChange={(v) => {
                  setNf(v)
                  limpar('nf')
                }}
                erro={erros.nf}
              />
            </>
          )}
          <div>
            <ReadOnlyRow
              label="DMT (km)"
              value={
                dmtManual
                  ? `${formatNumero(viagem.dmtKm ?? 0, 3)} · ajustada, a mesma da viagem copiada`
                  : calc.km != null
                    ? `${formatNumero(calc.km, 3)} · ${calc.via === 'rota' ? 'distância fixa' : 'pelo eixo'}`
                    : 'Sem DMT'
              }
            />
            {erros.dmt ? (
              <p role="alert" className="mt-1 text-xs text-bad">
                {erros.dmt} Abra "Mais campos" para informar a DMT.
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2 border-t border-border p-4 pb-safe-plus-4">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => onMaisCampos(montar())}
            className="px-4"
          >
            Mais campos
          </Button>
          <Button type="submit" variant="primary" size="lg" className="min-w-0 flex-1">
            Adicionar viagem
          </Button>
        </div>
      </form>
    </div>
  )
}

/** Posição no eixo com − e + de um passo (uma estaca), para andar sem abrir o teclado. */
function CampoPosicao({
  eixo,
  rotulo,
  valor,
  anterior,
  onChange,
  erro,
}: {
  eixo: LocalDto
  rotulo: string
  valor: string
  /** a estaca da viagem copiada, mostrada embaixo como referência */
  anterior: string | null
  onChange: (v: string) => void
  erro?: string
}) {
  const id = useId()
  // o passo dito no botão: uma estaca; em km e em metros, 20 m; na unidade própria do local, 1 unidade
  const umPasso =
    eixo.unidade_espaco_padrao === 'estaca'
      ? 'uma estaca'
      : eixo.unidade_espaco_padrao === 'custom'
        ? `1 ${nomePosicao(eixo).toLowerCase()}`
        : '20 m'
  const menos = avancarPosicao(eixo, valor, -1)
  const mais = avancarPosicao(eixo, valor, 1)
  const motivo = valor.trim() ? `Fora do eixo (${faixaTexto(eixo)})` : 'Preencha o campo primeiro'
  const passo = (v: string | null, rotuloBotao: string, icone: React.ReactNode) => (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      disabled={v === null}
      aria-label={rotuloBotao}
      title={v === null ? motivo : rotuloBotao}
      onClick={() => v !== null && onChange(v)}
      className="h-12 w-14"
    >
      {icone}
    </Button>
  )
  return (
    <div>
      <RotuloCampo htmlFor={id}>{rotulo}</RotuloCampo>
      <div className="mt-1 flex items-center gap-2">
        {passo(menos, `Voltar ${umPasso}`, <Minus className="h-5 w-5" />)}
        <Input
          id={id}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          inputMode={tecladoPosicao(eixo)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-required
          aria-invalid={erro ? true : undefined}
          aria-describedby={`${id}-apoio`}
          className={cn(
            'tabular h-12 min-w-0 flex-1 text-center text-lg font-semibold',
            erro && 'border-bad focus-visible:border-bad',
          )}
        />
        {passo(mais, `Avançar ${umPasso}`, <Plus className="h-5 w-5" />)}
      </div>
      {erro ? (
        <p id={`${id}-apoio`} role="alert" className="mt-1 text-xs text-bad">
          {erro}
        </p>
      ) : (
        <p id={`${id}-apoio`} className="mt-1 text-xs text-on-surface-dim">
          {anterior ? `Na viagem copiada: ${anterior}. ` : ''}Eixo de {faixaTexto(eixo)}.
        </p>
      )}
    </div>
  )
}
