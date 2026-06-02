// Dialog read-only de visualizacao da geometria vinculada do trecho.
//
// Mostra: polilinha + marcadores no mapa, stats agregadas, e 3 acoes:
//   * Editar configuracao — abre wizard em modo 'editar' (step 3-5, preserva geometria)
//   * Trocar arquivo — abre wizard em modo 'trocar' (step 1-5)
//   * Remover mapa — confirma + zera os campos de geometria do trecho
//
// Click no badge da pagina Trechos: se trecho ja tem geometria, abre ESTE
// dialog (em vez do wizard). Sem geometria, abre direto o wizard 'novo'.

import { useMemo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Edit3, FileUp, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MapaTrecho, type MapaTrechoMarcador } from '@/features/planejamento/components/MapaTrecho'
import { useSalvarGeometriaTrecho } from '@/features/planejamento/hooks/trechos'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import type { ObraTrecho } from '@/types/gerencial'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  trecho: ObraTrecho | null
  /** Click em "Editar configuracao" — caller abre o wizard em modo 'editar'. */
  onEditar: () => void
  /** Click em "Trocar arquivo" — caller abre o wizard em modo 'trocar'. */
  onTrocar: () => void
}

export function VisualizarMapaTrechoDialog({
  open,
  onOpenChange,
  trecho,
  onEditar,
  onTrocar
}: Props): ReactNode {
  const salvar = useSalvarGeometriaTrecho()
  const confirm = useConfirm()

  const marcadores = useMemo<MapaTrechoMarcador[]>(() => {
    if (!trecho?.geometry_geojson || !trecho.geometry_comprimento_m) return []
    const divisorM =
      trecho.unidade_espaco_padrao === 'km'
        ? 1000
        : trecho.unidade_espaco_padrao === 'estaca'
          ? 20
          : trecho.unidade_espaco_padrao === 'custom'
            ? trecho.unidade_custom_divisor_m ?? 1
            : 1
    const label =
      trecho.unidade_espaco_padrao === 'km'
        ? 'km'
        : trecho.unidade_espaco_padrao === 'estaca'
          ? 'EST'
          : trecho.unidade_espaco_padrao === 'custom'
            ? trecho.unidade_custom_label || 'ref'
            : 'm'
    const valorInicial = Number(trecho.marcador_valor_inicial)
    const comprimentoM = Number(trecho.geometry_comprimento_m)
    const out: MapaTrechoMarcador[] = []
    for (let pos = 0; pos <= comprimentoM; pos += divisorM) {
      const valor = valorInicial + pos / divisorM
      const fmt = Number.isInteger(valor) ? String(valor) : valor.toFixed(2)
      out.push({ posicaoM: pos, label: `${label} ${fmt}` })
    }
    return out
  }, [trecho])

  if (!trecho || !trecho.geometry_geojson) return null

  const comprimentoKm = (Number(trecho.geometry_comprimento_m) / 1000).toFixed(2)

  async function remover(): Promise<void> {
    if (!trecho) return
    const ok = await confirm({
      title: 'Remover mapa do trecho?',
      description:
        'A polilinha e todas as configurações de marcadores serão apagadas. As tarefas vinculadas ao trecho continuam intactas.',
      confirmLabel: 'Remover mapa',
      variant: 'danger'
    })
    if (!ok) return
    try {
      await salvar.mutateAsync({
        id: trecho.id,
        obra_id: trecho.obra_id,
        geometry_geojson: null,
        geometry_bounds: null,
        geometry_comprimento_m: null,
        geometry_sentido: 'natural',
        geometry_importado_em: null
      })
      toast.success('Mapa do trecho removido.')
      onOpenChange(false)
    } catch (e) {
      toast.error('Falha ao remover: ' + (e as Error).message)
    }
  }

  const unidadeLabel =
    trecho.unidade_espaco_padrao === 'custom'
      ? `${trecho.unidade_custom_label} (${trecho.unidade_custom_divisor_m} m)`
      : trecho.unidade_espaco_padrao

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      disableDismiss={salvar.isPending}
    >
      <DialogHeader>
        <DialogTitle>Mapa do trecho — {trecho.nome}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <div className="grid grid-cols-4 gap-3 text-xs font-mono">
          <Stat label="Comprimento" value={`${comprimentoKm} km`} />
          <Stat label="Marcadores" value={`${marcadores.length} (${unidadeLabel})`} />
          <Stat
            label="Sentido"
            value={trecho.geometry_sentido === 'natural' ? 'natural' : 'invertido'}
          />
          <Stat
            label="Cor"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-3 rounded-full border border-border-strong"
                  style={{ background: trecho.cor }}
                />
                {trecho.cor}
              </span>
            }
          />
        </div>
        <MapaTrecho
          geometry={trecho.geometry_geojson}
          cor={trecho.cor}
          marcadores={marcadores}
          animarSeta={false}
          interactive
          altura={420}
        />
        <div className="text-2xs text-text-dim font-mono leading-relaxed">
          Importado em{' '}
          {trecho.geometry_importado_em
            ? new Date(trecho.geometry_importado_em).toLocaleString('pt-BR')
            : '—'}
          . Use as ações abaixo pra alterar a configuração, trocar o arquivo ou remover.
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          size="sm"
          onClick={remover}
          disabled={salvar.isPending}
          className="text-danger"
        >
          <Trash2 size={11} /> Remover mapa
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
        <Button variant="ghost" size="sm" onClick={onTrocar} disabled={salvar.isPending}>
          <FileUp size={11} /> Trocar arquivo
        </Button>
        <Button variant="default" size="sm" onClick={onEditar} disabled={salvar.isPending}>
          <Edit3 size={11} /> Editar configuração
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="rounded border border-border bg-bg-panel px-2 py-1.5">
      <div className="text-2xs uppercase text-text-dim font-mono">{label}</div>
      <div className="text-text">{value}</div>
    </div>
  )
}
