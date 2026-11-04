/**
 * Novo/editar local: eixo (nome + unidade + estaca inicial + estaca final → comprimento e numeração; o mapa é
 * opcional) ou área (só o nome). Como no DynaRoad, a "road line" é só nome e estacas de início/fim.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Campo } from '@/features/cronograma/components/campos'
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
  const comMapa = !!trecho && temGeometria(trecho)

  useEffect(() => {
    if (!open) return
    setErro(null)
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

  const salvar = async (): Promise<void> => {
    setErro(null)
    const n = nome.trim()
    if (!n) return setErro('Dê um nome ao local.')
    if (tipo === 'eixo') {
      if (unidade === 'custom' && !(divisorCustom && divisorCustom > 0))
        return setErro('Informe quantos metros vale uma unidade personalizada.')
      if (vIni === null) return setErro(`Estaca inicial inválida (valor em ${rot}).`)
      if (!comMapa) {
        if (vFim === null) return setErro(`Estaca final inválida (valor em ${rot}).`)
        if (!derivado || derivado.comprimento_m <= 0)
          return setErro('A estaca final precisa ser diferente da inicial.')
      }
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={pendente}>
      <DialogHeader>
        <DialogTitle>
          {trecho
            ? `Editar ${trecho.tipo === 'eixo' ? 'eixo' : 'área'} — ${trecho.nome}`
            : 'Novo local'}
        </DialogTitle>
        <DialogDescription>
          {tipo === 'eixo'
            ? 'Um eixo é um estaqueamento: nome, unidade e as estacas inicial e final. O mapa (KML) é opcional.'
            : 'Uma área é um local sem estacas (OAE, jazida, canteiro…): as tarefas ficam nela inteira.'}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erro} />
        {!trecho ? (
          <div className="flex gap-1 rounded border border-border p-0.5 w-fit">
            {(['eixo', 'area'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`px-3 h-6 rounded text-xs ${tipo === t ? 'bg-accent text-[color:var(--primary-foreground)]' : 'text-text-muted hover:text-text'}`}
              >
                {t === 'eixo' ? 'Eixo (com estacas)' : 'Área (sem estacas)'}
              </button>
            ))}
          </div>
        ) : null}
        <Campo rotulo="Nome">
          <Input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={tipo === 'eixo' ? 'Ex.: BR-060 pista norte' : 'Ex.: OAE Córrego Fundo'}
          />
        </Campo>
        {tipo === 'eixo' ? (
          <>
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
              <Campo rotulo="Unidade">
                <Select
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value as UnidadeEspacoPadrao)}
                >
                  <option value="km">km</option>
                  <option value="estaca">estaca (20 m)</option>
                  <option value="m">metro</option>
                  <option value="custom">personalizada</option>
                </Select>
              </Campo>
              {unidade === 'custom' ? (
                <>
                  <Campo rotulo="Rótulo">
                    <Input
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      placeholder="ref"
                    />
                  </Campo>
                  <Campo rotulo="Metros por unidade">
                    <Input value={customDiv} onChange={(e) => setCustomDiv(e.target.value)} />
                  </Campo>
                </>
              ) : null}
            </div>
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
              <Campo rotulo={`Estaca inicial (${rot})`} dica="Valor do marcador no início do eixo">
                <Input value={estIni} onChange={(e) => setEstIni(e.target.value)} />
              </Campo>
              <Campo
                rotulo={`Estaca final (${rot})`}
                dica={
                  comMapa
                    ? 'Com mapa vinculado, a estaca final vem do comprimento da polilinha'
                    : 'Menor que a inicial = numeração decrescente'
                }
              >
                <Input
                  value={estFim}
                  disabled={comMapa}
                  onChange={(e) => setEstFim(e.target.value)}
                  placeholder={comMapa ? 'do mapa' : 'ex.: 12,5'}
                />
              </Campo>
              <Campo rotulo="Comprimento">
                <div className="h-7 flex items-center text-xs font-mono text-text-muted">
                  {comMapa
                    ? `${formatNumber(compMapa, 0)} m (mapa)`
                    : derivado
                      ? `${formatNumber(derivado.comprimento_m, 0)} m · ${derivado.geometry_sentido === 'invertido' ? 'decrescente' : 'crescente'}`
                      : '—'}
                </div>
              </Campo>
            </div>
          </>
        ) : null}
        <Campo rotulo="Cor">
          <div className="flex gap-1.5">
            {TRECHO_CORES_PADRAO.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${c === cor ? 'border-text' : 'border-border'}`}
                style={{ background: c }}
                aria-label={`Cor ${c}`}
              />
            ))}
          </div>
        </Campo>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pendente}>
          Cancelar
        </Button>
        <Button onClick={() => void salvar()} disabled={pendente}>
          {trecho ? 'Salvar' : 'Criar'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function traduzir(msg: string): string {
  if (msg.includes('uq_obra_trecho_obra_nome') || msg.includes('duplicate key'))
    return 'Já existe um local com esse nome nesta obra.'
  if (msg.includes('chk_obra_trecho_comprimento'))
    return 'Eixo precisa de comprimento maior que zero (estaca final diferente da inicial).'
  return msg
}
