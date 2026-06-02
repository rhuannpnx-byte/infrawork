// Wizard 3-step pra importar Excel de quantidades preenchido.
//   1) Upload (drag-drop + buscar arquivo)
//   2) Modo de importação (substituir vs nova_versao) + comentário opcional
//   3) Confirmação + commit

import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Upload, FileSpreadsheet } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useImportarExcelQuantidades } from '@/features/planejamento/hooks/quantidades'
import type { ObraTrecho } from '@/types/gerencial'
import type { TrechoQuantidadeTemplate } from '@/types/quantidades'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: TrechoQuantidadeTemplate
  trecho: ObraTrecho
}

type Step = 1 | 2 | 3
type ModoImport = 'substituir' | 'nova_versao'

export function ImportarExcelQuantidadesDialog({
  open,
  onOpenChange,
  template,
  trecho
}: Props): ReactNode {
  const importar = useImportarExcelQuantidades()
  const [step, setStep] = useState<Step>(1)
  const [file, setFile] = useState<File | null>(null)
  const [modo, setModo] = useState<ModoImport>('substituir')
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function reset(): void {
    setStep(1)
    setFile(null)
    setModo('substituir')
    setComentario('')
    setError(null)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) {
      setFile(f)
      setError(null)
      setStep(2)
    }
  }

  async function commit(): Promise<void> {
    if (!file) return
    setError(null)
    try {
      const r = await importar.mutateAsync({
        template_id: template.id,
        trecho,
        file,
        modo_importacao: modo,
        comentario: comentario || undefined
      })
      const wMsg = r.warnings.length > 0 ? ` (${r.warnings.length} avisos)` : ''
      toast.success(
        `Importado: ${r.segmentos_inseridos} segmentos, ${r.celulas_inseridas} valores${wMsg}.`
      )
      if (r.warnings.length > 0) {
        // Loga TODOS no console — útil pra diagnosticar perdas de valor
        // (cada warning corresponde a um valor que não entrou no banco).
        console.warn('[ImportarExcel] avisos completos:', r.warnings)
        // E mostra até 10 toasts (antes era 5 — encobria perdas em planilhas
        // grandes com várias células ininterpretáveis).
        for (const w of r.warnings.slice(0, 10)) {
          toast.warning(`Linha ${w.row ?? '-'}: ${w.msg}`)
        }
        if (r.warnings.length > 10) {
          toast.warning(
            `+${r.warnings.length - 10} avisos. Veja o console (F12) pra lista completa.`
          )
        }
      }
      reset()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="lg"
      disableDismiss={importar.isPending}
    >
      <DialogHeader>
        <DialogTitle>
          Importar Excel — {template.nome}
          <span className="ml-2 text-2xs font-mono text-text-dim">Passo {step}/3</span>
        </DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        {step === 1 ? (
          <div className="space-y-3">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              className={`border-2 border-dashed rounded p-8 text-center transition-colors ${
                dragOver ? 'border-accent bg-accent/5' : 'border-border bg-bg/40'
              }`}
            >
              <Upload size={32} className="mx-auto mb-2 text-text-dim" />
              <div className="text-sm text-text mb-1">Arraste o Excel preenchido aqui</div>
              <div className="text-2xs text-text-dim mb-3 font-mono">
                ou clique abaixo pra buscar
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) {
                    setFile(f)
                    setError(null)
                    setStep(2)
                  }
                  e.target.value = ''
                }}
                className="hidden"
              />
              <Button variant="default" size="sm" onClick={() => inputRef.current?.click()}>
                Buscar arquivo
              </Button>
            </div>
            <div className="text-2xs text-text-dim font-mono leading-relaxed">
              Aceita apenas .xlsx. O arquivo deve ter as colunas &quot;Início (m)&quot;, &quot;Fim
              (m)&quot;, &quot;Unid Inicial&quot;, &quot;Unid Final&quot; + as colunas do template.
              Linhas em branco são ignoradas.
            </div>
          </div>
        ) : null}

        {step === 2 && file ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded border border-border bg-bg-panel px-3 py-2 text-xs font-mono">
              <FileSpreadsheet size={14} className="text-accent" />
              <span className="text-text">{file.name}</span>
              <span className="text-text-dim">({(file.size / 1024).toFixed(1)} KB)</span>
            </div>

            <div>
              <Label>Modo de importação</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setModo('substituir')}
                  className={`text-left rounded border p-3 transition-colors ${
                    modo === 'substituir'
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-bg-panel hover:border-border-strong'
                  }`}
                >
                  <div className="text-xs font-medium text-text">Substituir versão atual</div>
                  <div className="text-2xs font-mono text-text-dim mt-1">
                    Sobrescreve dados da versão atual. Sem nova entrada no histórico.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setModo('nova_versao')}
                  className={`text-left rounded border p-3 transition-colors ${
                    modo === 'nova_versao'
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-bg-panel hover:border-border-strong'
                  }`}
                >
                  <div className="text-xs font-medium text-text">Importar como nova versão</div>
                  <div className="text-2xs font-mono text-text-dim mt-1">
                    Cria uma versão nova preservando a anterior no histórico.
                  </div>
                </button>
              </div>
            </div>

            {modo === 'nova_versao' ? (
              <div>
                <Label htmlFor="coment">Comentário (opcional)</Label>
                <Input
                  id="coment"
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  placeholder="Ex: Revisão pós-projeto executivo · Agosto/26"
                />
                <div className="text-2xs text-text-dim mt-1 font-mono">
                  Aparece no histórico. Útil pra lembrar depois.
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 && file ? (
          <div className="space-y-3 text-xs">
            <div className="rounded border border-border bg-bg-panel p-3 space-y-1.5">
              <div>
                <span className="text-text-dim">Arquivo:</span>{' '}
                <span className="text-text font-mono">{file.name}</span>
              </div>
              <div>
                <span className="text-text-dim">Modo:</span>{' '}
                <span className="text-text">
                  {modo === 'substituir' ? 'Substituir versão atual' : 'Nova versão'}
                </span>
              </div>
              {modo === 'nova_versao' && comentario ? (
                <div>
                  <span className="text-text-dim">Comentário:</span>{' '}
                  <span className="text-text">&quot;{comentario}&quot;</span>
                </div>
              ) : null}
            </div>
            <div className="text-2xs text-text-dim font-mono leading-relaxed">
              {modo === 'substituir'
                ? 'Os dados existentes da versão atual serão deletados e substituídos. Esta ação é irreversível.'
                : 'Uma nova versão será criada com os dados deste Excel. A versão anterior fica preservada no histórico.'}
            </div>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {step > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={importar.isPending}
            onClick={() => setStep((s) => (s - 1) as Step)}
          >
            Voltar
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={importar.isPending}
          >
            Cancelar
          </Button>
        )}
        {step < 3 ? (
          <Button
            variant="default"
            size="sm"
            disabled={!file || importar.isPending}
            onClick={() => setStep((s) => (s + 1) as Step)}
          >
            Continuar
          </Button>
        ) : (
          <Button variant="default" size="sm" disabled={importar.isPending} onClick={commit}>
            {importar.isPending ? 'Importando…' : 'Confirmar importação'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
