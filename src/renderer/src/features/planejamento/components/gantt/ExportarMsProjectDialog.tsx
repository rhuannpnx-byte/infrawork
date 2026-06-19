// Modal de exportação para MS Project (XML PDI). Permite incluir recursos
// (mão de obra, equipamentos, material e combustível) como Recursos/Atribuições,
// de modo que o gráfico de recursos do Project reproduza o Histograma planejado.

import { useState, type ReactNode } from 'react'
import { FileDown } from 'lucide-react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ExportarMsProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (incluirRecursos: boolean) => void
  exportando: boolean
  /** Quantidade de recursos que seriam incluídos (composições expandidas). */
  recursosCount: number
  /** Tarefas diretas sem composição utilizável (ficam sem recursos no XML). */
  tarefasSemComposicao: number
}

export function ExportarMsProjectDialog({
  open,
  onOpenChange,
  onConfirm,
  exportando,
  recursosCount,
  tarefasSemComposicao
}: ExportarMsProjectDialogProps): ReactNode {
  const [incluirRecursos, setIncluirRecursos] = useState(true)
  const semRecursos = recursosCount === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" disableDismiss={exportando}>
      <DialogHeader>
        <DialogTitle>Exportar para MS Project</DialogTitle>
        <DialogDescription>Cronograma no formato .xml do MS Project.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <label
          className={
            'flex items-start gap-2.5 rounded border border-border bg-bg-panel px-3 py-2.5 ' +
            (semRecursos ? 'opacity-50' : 'cursor-pointer hover:bg-bg-hover')
          }
        >
          <input
            type="checkbox"
            checked={incluirRecursos && !semRecursos}
            disabled={semRecursos || exportando}
            onChange={(e) => setIncluirRecursos(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span className="space-y-0.5">
            <span className="block text-xs font-medium text-text">
              Incluir recursos (histograma)
            </span>
            <span className="block text-2xs text-text-dim leading-relaxed">
              Embute equipes/insumos e consumo de material das composições, para o gráfico de
              recursos do Project reproduzir o Histograma planejado.
            </span>
          </span>
        </label>

        {semRecursos ? (
          <p className="text-2xs font-mono text-text-dim">
            Nenhuma composição disponível neste plano — será exportado apenas o cronograma.
          </p>
        ) : (
          <p className="text-2xs font-mono text-text-dim">
            {recursosCount} recurso{recursosCount === 1 ? '' : 's'} ser
            {recursosCount === 1 ? 'á' : 'ão'} incluído{recursosCount === 1 ? '' : 's'}.
          </p>
        )}

        {incluirRecursos && !semRecursos && tarefasSemComposicao > 0 ? (
          <p className="text-2xs font-mono text-amber-400">
            ⚠ {tarefasSemComposicao} tarefa{tarefasSemComposicao === 1 ? '' : 's'} sem composição
            ficar{tarefasSemComposicao === 1 ? 'á' : 'ão'} sem recursos.
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} disabled={exportando}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={() => onConfirm(incluirRecursos && !semRecursos)}
          disabled={exportando}
        >
          <FileDown size={12} className={exportando ? 'animate-pulse' : ''} />{' '}
          {exportando ? 'Exportando…' : 'Exportar'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
