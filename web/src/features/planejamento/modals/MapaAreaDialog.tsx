/**
 * Contorno de uma área (OAE, jazida, canteiro) a partir de um KMZ/KML: escolher o arquivo, conferir no mapa e
 * salvar; depois, trocar ou remover. O contorno aparece no mapa das fotos, ajudando a situar o que foi fotografado.
 */
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { MapPinned, Trash2, Upload } from 'lucide-react'
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
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { pickFile } from '@/lib/files/pick-file'
import { parseAreaKmzOrKml, type ParsedKmlArea } from '@/lib/kml/parse'
import type { ObraTrecho } from '@/types/gerencial'
import { MapaTrecho } from '../components/MapaTrecho'
import { useSalvarGeometriaTrecho } from '../hooks/trechos'
import { poligonoDoTrecho } from '../lib/trecho'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  trecho: ObraTrecho
  readOnly: boolean
}

export function MapaAreaDialog({ open, onOpenChange, trecho, readOnly }: Props): ReactNode {
  const salvar = useSalvarGeometriaTrecho()
  const confirm = useConfirm()
  const atual = poligonoDoTrecho(trecho)
  const [novo, setNovo] = useState<(ParsedKmlArea & { arquivo: string }) | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [lendo, setLendo] = useState(false)

  const fechar = (o: boolean): void => {
    if (!o) {
      setNovo(null)
      setErro(null)
    }
    onOpenChange(o)
  }

  const escolher = async (): Promise<void> => {
    const f = await pickFile({
      accept: '.kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml'
    })
    if (!f) return
    setErro(null)
    setLendo(true)
    try {
      setNovo({ ...(await parseAreaKmzOrKml(f)), arquivo: f.name })
    } catch (e) {
      setNovo(null)
      setErro((e as Error).message)
    } finally {
      setLendo(false)
    }
  }

  const gravar = async (): Promise<void> => {
    if (!novo) return
    try {
      await salvar.mutateAsync({
        id: trecho.id,
        obra_id: trecho.obra_id,
        geometry_geojson: novo.geometry,
        geometry_bounds: novo.bounds,
        geometry_comprimento_m: null,
        geometry_importado_em: new Date().toISOString()
      })
      toast.success(`Contorno de ${trecho.nome} salvo.`)
      fechar(false)
    } catch (e) {
      setErro(`Não foi possível salvar o contorno. ${(e as Error).message}`)
    }
  }

  const remover = async (): Promise<void> => {
    const ok = await confirm({
      title: `Remover o contorno de ${trecho.nome}?`,
      description: 'A área continua com as quantidades e as tarefas; só sai o desenho do mapa.',
      confirmLabel: 'Remover contorno',
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
        geometry_importado_em: null
      })
      toast.success('Contorno removido.')
      fechar(false)
    } catch (e) {
      setErro(`Não foi possível remover o contorno. ${(e as Error).message}`)
    }
  }

  const mostrar = novo?.geometry ?? atual
  return (
    <Dialog open={open} onOpenChange={fechar} size="xl" disableDismiss={salvar.isPending}>
      <DialogHeader>
        <DialogTitle>Mapa da área</DialogTitle>
        <DialogDescription>
          {trecho.nome}. O contorno vem de um arquivo KMZ ou KML (um polígono desenhado no Google
          Earth) e aparece no mapa das fotos.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erro} />
        {novo ? (
          <p className="text-sm text-text">
            <strong>{novo.arquivo}</strong>
            {novo.totalPoligonos > 1
              ? ` · o arquivo tem ${novo.totalPoligonos} polígonos; vale o primeiro.`
              : ''}{' '}
            Confira o contorno e salve.
          </p>
        ) : null}
        {mostrar ? (
          <MapaTrecho geometry={mostrar} cor={trecho.cor} interactive altura={420} />
        ) : (
          <div className="flex h-[240px] flex-col items-center justify-center gap-3 rounded border border-dashed border-border-strong text-center">
            <MapPinned size={20} className="text-text-dim" aria-hidden />
            <p className="max-w-[48ch] text-sm text-text-muted">
              Esta área ainda não tem contorno. Escolha um arquivo KMZ ou KML com o polígono da
              área.
            </p>
            {!readOnly ? (
              <Button size="sm" disabled={lendo} onClick={() => void escolher()}>
                <Upload size={12} /> {lendo ? 'Lendo…' : 'Escolher arquivo…'}
              </Button>
            ) : null}
          </div>
        )}
        {!novo && atual && trecho.geometry_importado_em ? (
          <p className="text-sm text-text-muted">
            Importado em {new Date(trecho.geometry_importado_em).toLocaleString('pt-BR')}.
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {!readOnly && atual && !novo ? (
          <Button
            variant="ghost"
            className="mr-auto hover:text-danger"
            disabled={salvar.isPending}
            onClick={() => void remover()}
          >
            <Trash2 size={12} /> Remover contorno
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => fechar(false)} disabled={salvar.isPending}>
          {novo ? 'Cancelar' : 'Fechar'}
        </Button>
        {!readOnly && mostrar ? (
          novo ? (
            <Button disabled={salvar.isPending} onClick={() => void gravar()}>
              {salvar.isPending ? 'Salvando…' : 'Salvar contorno'}
            </Button>
          ) : (
            <Button variant="secondary" disabled={lendo} onClick={() => void escolher()}>
              <Upload size={12} /> {lendo ? 'Lendo…' : 'Trocar arquivo…'}
            </Button>
          )
        ) : null}
      </DialogFooter>
    </Dialog>
  )
}
