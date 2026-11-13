/**
 * Novo/editar local: eixo (nome + unidade + estaca inicial + estaca final → comprimento e numeração; o mapa é
 * opcional) ou área (só o nome). Como no DynaRoad, a "road line" é só nome e estacas de início/fim.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogErrorBanner,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Segmentado } from '@/components/ui/segmentado'
import { cn } from '@/lib/utils'
import { formatNumber, parseNumero } from '@/lib/format'
import { metrosToMarcador } from '@/lib/format/posicao'
import { TRECHO_CORES_PADRAO, type ObraTrecho, type UnidadeEspacoPadrao } from '@/types/gerencial'
import { useCreateTrecho, useUpdateTrecho } from '../hooks/trechos'
import { ctxObraTrecho, eixoDeEstacas, rotuloUnidadeTrecho, temGeometria } from '../lib/trecho'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** null = novo local */
  trecho: ObraTrecho | null
  tipoNovo?: 'eixo' | 'area'
  proxOrdem?: number
  onSalvo?: (id: string) => void
}

const numTexto = (v: number): string => String(Math.round(v * 1000) / 1000).replace('.', ',')

type CampoComErro = 'nome' | 'divisor' | 'estIni' | 'estFim'

export function EixoDialog({
  open,
  onOpenChange,
  obraId,
  trecho,
  tipoNovo = 'eixo',
  proxOrdem = 0,
  onSalvo
}: Props): ReactNode {
  const criar = useCreateTrecho()
  const atualizar = useUpdateTrecho()
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<'eixo' | 'area'>(tipoNovo)
  const [unidade, setUnidade] = useState<UnidadeEspacoPadrao>('km')
  const [customLabel, setCustomLabel] = useState('')
  const [customDiv, setCustomDiv] = useState('100')
  const [estIni, setEstIni] = useState('0')
  const [estFim, setEstFim] = useState('')
  const [cor, setCor] = useState(TRECHO_CORES_PADRAO[0]!)
  const [erro, setErro] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)
  const comMapa = !!trecho && temGeometria(trecho)

  useEffect(() => {
    if (!open) return
    setErro(null)
    setTentou(false)
    if (trecho) {
      setNome(trecho.nome)
      setTipo(trecho.tipo)
      setUnidade(trecho.unidade_espaco_padrao)
      setCustomLabel(trecho.unidade_custom_label ?? '')
      setCustomDiv(String(trecho.unidade_custom_divisor_m ?? 100))
      setEstIni(numTexto(Number(trecho.marcador_valor_inicial ?? 0)))
      const comp = Number(trecho.comprimento_m ?? trecho.geometry_comprimento_m ?? 0)
      setEstFim(comp > 0 ? numTexto(metrosToMarcador(comp, ctxObraTrecho(trecho))) : '')
      setCor(trecho.cor)
    } else {
      setNome('')
      setTipo(tipoNovo)
      setUnidade('km')
      setCustomLabel('')
      setCustomDiv('100')
      setEstIni('0')
      setEstFim('')
      setCor(TRECHO_CORES_PADRAO[proxOrdem % TRECHO_CORES_PADRAO.length]!)
    }
  }, [open, trecho, tipoNovo, proxOrdem])

  const divisorCustom = parseNumero(customDiv)
  const ctx = useMemo(
    () => ({ unidade_espaco_padrao: unidade, unidade_custom_divisor_m: divisorCustom ?? 1 }),
    [unidade, divisorCustom]
  )
  const vIni = parseNumero(estIni)
  const vFim = parseNumero(estFim)
  const derivado =
    tipo === 'eixo' && vIni !== null && vFim !== null ? eixoDeEstacas(vIni, vFim, ctx) : null
  const rot = rotuloUnidadeTrecho(unidade, customLabel)
  const compMapa = comMapa ? Number(trecho!.geometry_comprimento_m ?? 0) : 0

  const n = nome.trim()
  const erros: Partial<Record<CampoComErro, string>> = {}
  if (!n) erros.nome = 'Dê um nome ao local.'
  if (tipo === 'eixo') {
    if (unidade === 'custom' && !(divisorCustom && divisorCustom > 0))
      erros.divisor = 'Informe quantos metros vale uma unidade.'
    if (vIni === null) erros.estIni = `Digite a estaca inicial como número, em ${rot}.`
    if (!comMapa) {
      if (vFim === null)
        erros.estFim = estFim.trim()
          ? `Digite a estaca final como número, em ${rot}.`
          : 'Informe a estaca final.'
      else if (vIni !== null && (!derivado || derivado.comprimento_m <= 0))
        erros.estFim = 'A estaca final precisa ser diferente da inicial.'
    }
  }
  const erroDe = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const salvar = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setErro(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      const custom =
        unidade === 'custom'
          ? {
              unidade_custom_label: customLabel.trim() || 'ref',
              unidade_custom_divisor_m: divisorCustom
            }
          : { unidade_custom_label: null, unidade_custom_divisor_m: null }
      if (!trecho) {
        const { id } = await criar.mutateAsync({
          obra_id: obraId,
          nome: n,
          ordem: proxOrdem,
          tipo,
          unidade_espaco_padrao: tipo === 'eixo' ? unidade : 'm',
          comprimento_m: tipo === 'eixo' ? derivado!.comprimento_m : null,
          marcador_valor_inicial: tipo === 'eixo' ? vIni! : 0,
          geometry_sentido: tipo === 'eixo' ? derivado!.geometry_sentido : 'natural',
          cor,
          ...(tipo === 'eixo' ? custom : {})
        })
        toast.success(tipo === 'eixo' ? 'Eixo criado.' : 'Área criada.')
        onSalvo?.(id)
      } else {
        await atualizar.mutateAsync({
          id: trecho.id,
          obra_id: obraId,
          nome: n,
          cor,
          ...(tipo === 'eixo'
            ? {
                unidade_espaco_padrao: unidade,
                ...custom,
                marcador_valor_inicial: vIni!,
                ...(comMapa
                  ? {}
                  : {
                      comprimento_m: derivado!.comprimento_m,
                      geometry_sentido: derivado!.geometry_sentido
                    })
              }
            : {})
        })
        toast.success('Local salvo.')
        onSalvo?.(trecho.id)
      }
      onOpenChange(false)
    } catch (e) {
      setErro(traduzir((e as Error).message))
    }
  }

  const pendente = criar.isPending || atualizar.isPending
  const rotuloTipo = tipo === 'eixo' ? 'eixo' : 'área'
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={pendente}>
      <form onSubmit={salvar} noValidate>
        <DialogHeader>
          <DialogTitle>
            {trecho ? `Editar ${trecho.tipo === 'eixo' ? 'eixo' : 'área'}` : 'Novo local'}
          </DialogTitle>
          <DialogDescription>
            {tipo === 'eixo'
              ? 'Um eixo é um estaqueamento: nome, unidade e as estacas inicial e final. O mapa (KML) é opcional.'
              : 'Uma área é um local sem estacas (obra de arte, jazida, canteiro): as tarefas ficam nela inteira.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={erro} />
          {!trecho ? (
            <Segmentado
              rotulo="Tipo do local"
              valor={tipo}
              aoMudar={setTipo}
              opcoes={[
                { valor: 'eixo', rotulo: 'Eixo, com estacas' },
                { valor: 'area', rotulo: 'Área, sem estacas' }
              ]}
            />
          ) : null}
          <Campo rotulo="Nome" obrigatorio erro={erroDe('nome')}>
            <Input
              autoFocus
              autoComplete="off"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={
                tipo === 'eixo' ? 'Ex.: BR-060 pista norte' : 'Ex.: Ponte do Córrego Fundo'
              }
            />
          </Campo>
          {tipo === 'eixo' ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Campo rotulo="Unidade" obrigatorio>
                  <Select
                    value={unidade}
                    onChange={(e) => setUnidade(e.target.value as UnidadeEspacoPadrao)}
                  >
                    <option value="km">Quilômetro (km)</option>
                    <option value="estaca">Estaca (20 m)</option>
                    <option value="m">Metro (m)</option>
                    <option value="custom">Personalizada</option>
                  </Select>
                </Campo>
                {unidade === 'custom' ? (
                  <>
                    <Campo rotulo="Nome da unidade" dica="Como aparece nas estacas.">
                      <Input
                        autoComplete="off"
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                        placeholder="Ex.: ref"
                      />
                    </Campo>
                    <Campo rotulo="Metros por unidade" obrigatorio erro={erroDe('divisor')}>
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        value={customDiv}
                        onChange={(e) => setCustomDiv(e.target.value)}
                        className="tabular text-right"
                      />
                    </Campo>
                  </>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Campo
                  rotulo={`Estaca inicial (${rot})`}
                  obrigatorio
                  erro={erroDe('estIni')}
                  dica="Valor no início do eixo."
                >
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    value={estIni}
                    onChange={(e) => setEstIni(e.target.value)}
                    className="tabular text-right"
                  />
                </Campo>
                <Campo
                  rotulo={`Estaca final (${rot})`}
                  obrigatorio={!comMapa}
                  erro={erroDe('estFim')}
                  dica={
                    comMapa
                      ? 'Vem do comprimento da linha do mapa.'
                      : 'Menor que a inicial, a numeração é decrescente.'
                  }
                >
                  <Input
                    inputMode="decimal"
                    autoComplete="off"
                    value={estFim}
                    disabled={comMapa}
                    onChange={(e) => setEstFim(e.target.value)}
                    placeholder={comMapa ? undefined : 'Ex.: 12,5'}
                    className="tabular text-right"
                  />
                </Campo>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-medium text-text">Comprimento</span>
                  <div className="tabular flex min-h-8 items-center text-sm text-text-muted">
                    {comMapa
                      ? `${formatNumber(compMapa, 0)} m, do mapa`
                      : derivado
                        ? `${formatNumber(derivado.comprimento_m, 0)} m, ${derivado.geometry_sentido === 'invertido' ? 'decrescente' : 'crescente'}`
                        : '—'}
                  </div>
                </div>
              </div>
            </>
          ) : null}
          <div className="flex flex-col gap-1">
            <span id="eixo-cor-rotulo" className="text-sm font-medium text-text">
              Cor no cronograma e no mapa
            </span>
            <div
              className="flex flex-wrap gap-1.5"
              role="radiogroup"
              aria-labelledby="eixo-cor-rotulo"
            >
              {TRECHO_CORES_PADRAO.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={c === cor}
                  aria-label={`Cor ${i + 1}`}
                  onClick={() => setCor(c)}
                  className={cn(
                    'h-7 w-7 rounded border-2',
                    c === cor ? 'border-text' : 'border-border-strong'
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={pendente}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pendente}>
            {pendente
              ? trecho
                ? 'Salvando…'
                : 'Criando…'
              : trecho
                ? 'Salvar'
                : `Criar ${rotuloTipo}`}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

function traduzir(msg: string): string {
  if (msg.includes('uq_obra_trecho_obra_nome') || msg.includes('duplicate key'))
    return 'Já existe um local com esse nome nesta obra.'
  if (msg.includes('chk_obra_trecho_comprimento'))
    return 'O eixo precisa ter comprimento maior que zero: a estaca final deve ser diferente da inicial.'
  return `Não foi possível salvar o local. ${msg}`
}
