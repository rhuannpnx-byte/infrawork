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
  DialogDescription,
  DialogBody,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MapaTrecho, type MapaTrechoMarcador } from '@/features/planejamento/components/MapaTrecho'
import {
  formatMarcadorCompacto,
  divisorMetrosPorUnidade,
  type TrechoCtx
} from '@/lib/format/posicao'
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
    const ctx: TrechoCtx = {
      unidade_espaco_padrao: trecho.unidade_espaco_padrao,
      unidade_custom_label: trecho.unidade_custom_label,
      unidade_custom_divisor_m: trecho.unidade_custom_divisor_m,
      marcador_valor_inicial: trecho.marcador_valor_inicial,
      geometry_sentido: trecho.geometry_sentido,
      geometry_comprimento_m: trecho.geometry_comprimento_m
    }
    const divisorM = divisorMetrosPorUnidade(ctx)
    const comprimentoM = Number(trecho.geometry_comprimento_m)
    const out: MapaTrechoMarcador[] = []
    for (let pos = 0; pos <= comprimentoM; pos += divisorM) {
      // Sentido-aware: trecho 'invertido' decresce a partir do valor inicial.
      out.push({ posicaoM: pos, label: formatMarcadorCompacto(pos, ctx) })
    }
    return out
  }, [trecho])

  if (!trecho || !trecho.geometry_geojson) return null

  const comprimentoKm = (Number(trecho.geometry_comprimento_m) / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

  async function remover(): Promise<void> {
    if (!trecho) return
    const ok = await confirm({
      title: 'Remover o mapa do eixo?',
      description:
        'A linha do mapa e a configuração dos marcadores são apagadas. As estacas e as tarefas do eixo continuam como estão.',
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
      toast.success('Mapa do eixo removido.')
      onOpenChange(false)
    } catch (e) {
      toast.error('Não foi possível remover o mapa.', { description: (e as Error).message })
    }
  }

  const unidadeLabel =
    trecho.unidade_espaco_padrao === 'custom'
      ? `1 ${trecho.unidade_custom_label} = ${trecho.unidade_custom_divisor_m} m`
      : trecho.unidade_espaco_padrao === 'estaca'
        ? 'a cada estaca de 20 m'
        : trecho.unidade_espaco_padrao === 'km'
          ? 'a cada km'
          : 'a cada metro'

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl" disableDismiss={salvar.isPending}>
      <DialogHeader>
        <DialogTitle>Mapa do eixo</DialogTitle>
        <DialogDescription>{trecho.nome}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Stat label="Comprimento" value={`${comprimentoKm} km`} />
          <Stat
            label="Marcadores"
            value={`${marcadores.length.toLocaleString('pt-BR')}, ${unidadeLabel}`}
          />
          <Stat
            label="Numeração"
            value={trecho.geometry_sentido === 'invertido' ? 'Decrescente' : 'Crescente'}
          />
          <Stat
            label="Cor"
            value={
              <span
                role="img"
                aria-label="Cor do eixo no mapa"
                className="inline-block h-3 w-8 rounded border border-border-strong align-middle"
                style={{ background: trecho.cor }}
              />
            }
          />
        </dl>
        <MapaTrecho
          geometry={trecho.geometry_geojson}
          cor={trecho.cor}
          marcadores={marcadores}
          animarSeta={false}
          interactive
          altura={420}
        />
        <p className="text-sm text-text-muted">
          {trecho.geometry_importado_em
            ? `Importado em ${new Date(trecho.geometry_importado_em).toLocaleString('pt-BR')}. `
            : ''}
          Use os botões abaixo para mudar a configuração, trocar o arquivo ou remover o mapa.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="danger" onClick={remover} disabled={salvar.isPending}>
          <Trash2 size={12} /> {salvar.isPending ? 'Removendo…' : 'Remover mapa'}
        </Button>
        <div className="flex-1" />
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Fechar
        </Button>
        <Button variant="secondary" onClick={onTrocar} disabled={salvar.isPending}>
          <FileUp size={12} /> Trocar arquivo
        </Button>
        <Button variant="default" onClick={onEditar} disabled={salvar.isPending}>
          <Edit3 size={12} /> Editar configuração
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">{label}</dt>
      <dd className="tabular text-text">{value}</dd>
    </div>
  )
}
