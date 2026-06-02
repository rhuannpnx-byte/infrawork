// Histórico de versões de um template: lista todas com ações por versão.

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Eye, Download, RotateCcw, Plus } from 'lucide-react'
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
import { useConfirm } from '@/components/modals/ConfirmDialog'
import {
  useVersoesTemplate,
  useBaixarExcelVersao,
  useNovaVersao
} from '@/features/planejamento/hooks/quantidades'
import { VisualizarQuantidadesDialog } from './VisualizarQuantidadesDialog'
import type { ObraTrecho } from '@/types/gerencial'
import type { TrechoQuantidadeTemplate } from '@/types/quantidades'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: TrechoQuantidadeTemplate
  trecho: ObraTrecho
  empresaNome: string
  obraCodigo: string
  obraNome: string
}

export function HistoricoVersoesDialog({
  open,
  onOpenChange,
  template,
  trecho,
  empresaNome,
  obraCodigo,
  obraNome
}: Props): ReactNode {
  const { data: versoes = [] } = useVersoesTemplate(template.id)
  const baixar = useBaixarExcelVersao()
  const novaVersao = useNovaVersao()
  const confirm = useConfirm()

  const [visualizarId, setVisualizarId] = useState<string | null>(null)
  const [novaVerOpen, setNovaVerOpen] = useState(false)
  const [comentario, setComentario] = useState('')
  const [origemId, setOrigemId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  async function commitNovaVersao(): Promise<void> {
    setError(null)
    try {
      await novaVersao.mutateAsync({
        template_id: template.id,
        origem_versao_id: origemId,
        comentario: comentario || undefined
      })
      toast.success('Nova versão criada e promovida a atual.')
      setNovaVerOpen(false)
      setComentario('')
      setOrigemId(undefined)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} size="lg">
        <DialogHeader>
          <DialogTitle>Histórico — {template.nome}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {versoes.length === 0 ? (
            <div className="text-text-dim text-xs italic">Sem versões.</div>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead className="text-text-dim uppercase text-2xs">
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-1.5 w-12">Nº</th>
                  <th className="text-left px-2 py-1.5 w-20">Atual</th>
                  <th className="text-left px-2 py-1.5 w-32">Data</th>
                  <th className="text-left px-2 py-1.5">Comentário</th>
                  <th className="text-right px-2 py-1.5 w-[180px]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {versoes.map((v) => (
                  <tr key={v.id} className="border-b border-border/40">
                    <td className="px-2 py-1.5 font-medium text-text">v{v.numero}</td>
                    <td className="px-2 py-1.5">
                      {v.is_atual ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-accent/20 text-accent text-2xs">
                          ★ atual
                        </span>
                      ) : (
                        <span className="text-text-dim text-2xs">histórica</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-text-muted">
                      {new Date(v.created_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="px-2 py-1.5 text-text-muted truncate" title={v.comentario ?? ''}>
                      {v.comentario || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setVisualizarId(v.id)}
                        >
                          <Eye size={11} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={baixar.isPending}
                          onClick={async () => {
                            try {
                              await baixar.mutateAsync({
                                versao_id: v.id,
                                trecho,
                                empresaNome,
                                obraCodigo,
                                obraNome
                              })
                            } catch (e) {
                              toast.error('Falha: ' + (e as Error).message)
                            }
                          }}
                        >
                          <Download size={11} />
                        </Button>
                        {!v.is_atual ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={novaVersao.isPending}
                            title="Restaurar como nova versão (clona + promove)"
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Restaurar v${v.numero}?`,
                                description: `Cria uma nova versão clonando v${v.numero} e promove a atual. A versão atual fica preservada no histórico.`,
                                confirmLabel: 'Restaurar',
                                variant: 'info'
                              })
                              if (!ok) return
                              try {
                                await novaVersao.mutateAsync({
                                  template_id: template.id,
                                  origem_versao_id: v.id,
                                  comentario: `Restaurada de v${v.numero}`
                                })
                                toast.success('Versão restaurada como nova.')
                              } catch (e) {
                                toast.error('Falha: ' + (e as Error).message)
                              }
                            }}
                          >
                            <RotateCcw size={11} />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="default"
            size="sm"
            disabled={versoes.length === 0}
            onClick={() => {
              setNovaVerOpen(true)
              setOrigemId(undefined)
              setComentario('')
            }}
          >
            <Plus size={11} /> Nova versão (clone da atual)
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </Dialog>

      {visualizarId ? (
        <VisualizarQuantidadesDialog
          open={!!visualizarId}
          onOpenChange={(o) => {
            if (!o) setVisualizarId(null)
          }}
          versaoId={visualizarId}
          trecho={trecho}
          empresaNome={empresaNome}
          obraCodigo={obraCodigo}
          obraNome={obraNome}
          templateNome={template.nome}
        />
      ) : null}

      {novaVerOpen ? (
        <Dialog
          open={novaVerOpen}
          onOpenChange={setNovaVerOpen}
          size="sm"
          disableDismiss={novaVersao.isPending}
        >
          <DialogHeader>
            <DialogTitle>Nova versão</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <DialogErrorBanner message={error} />
            <div className="text-2xs text-text-dim font-mono leading-relaxed">
              Cria uma cópia da versão atual e promove a nova a atual. A anterior
              fica intacta no histórico. Use depois &quot;Importar Excel&quot; pra
              substituir os dados se necessário.
            </div>
            <div>
              <Label htmlFor="coment-nv">Comentário (opcional)</Label>
              <Input
                id="coment-nv"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Ex: Revisão pós-vistoria DNIT · Set/26"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNovaVerOpen(false)}
              disabled={novaVersao.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={commitNovaVersao}
              disabled={novaVersao.isPending}
            >
              {novaVersao.isPending ? 'Criando…' : 'Criar versão'}
            </Button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </>
  )
}
