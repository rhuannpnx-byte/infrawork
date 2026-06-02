// Dialog principal de gerenciamento de templates de quantidades por trecho.
//
// Mostra: cards de templates do trecho com ações por template:
//   - Ver dados (abre VisualizarQuantidadesDialog na versão atual)
//   - Baixar Excel atual
//   - Importar Excel (abre ImportarExcelQuantidadesDialog)
//   - Histórico (abre HistoricoVersoesDialog)
//   - Editar colunas (abre ConfigTemplateQuantidadeDialog em modo edit-colunas)
//   - Remover
//
// Botão "+ Novo template" abre ConfigTemplateQuantidadeDialog em modo create.

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  Eye,
  Download,
  Upload,
  History,
  Settings
} from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import {
  useTemplatesQuantidade,
  useDeletarTemplateQuantidade,
  useBaixarExcelVersao,
  useVersaoTemplate
} from '@/features/planejamento/hooks/quantidades'
import { ConfigTemplateQuantidadeDialog } from './ConfigTemplateQuantidadeDialog'
import { VisualizarQuantidadesDialog } from './VisualizarQuantidadesDialog'
import { ImportarExcelQuantidadesDialog } from './ImportarExcelQuantidadesDialog'
import { HistoricoVersoesDialog } from './HistoricoVersoesDialog'
import type { ObraTrecho } from '@/types/gerencial'
import type { TrechoQuantidadeTemplateResumo } from '@/types/quantidades'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  trecho: ObraTrecho
  empresaNome: string
  obraCodigo: string
  obraNome: string
}

export function QuantidadesTrechoDialog({
  open,
  onOpenChange,
  trecho,
  empresaNome,
  obraCodigo,
  obraNome
}: Props): ReactNode {
  const { data: templates = [] } = useTemplatesQuantidade(trecho.id)
  const deletar = useDeletarTemplateQuantidade()
  const confirm = useConfirm()

  const [novoOpen, setNovoOpen] = useState(false)
  const [editOpen, setEditOpen] = useState<TrechoQuantidadeTemplateResumo | null>(null)
  const [visualOpen, setVisualOpen] = useState<TrechoQuantidadeTemplateResumo | null>(null)
  const [importOpen, setImportOpen] = useState<TrechoQuantidadeTemplateResumo | null>(null)
  const [historicoOpen, setHistoricoOpen] = useState<TrechoQuantidadeTemplateResumo | null>(null)

  const temGeometria =
    !!trecho.geometry_geojson && trecho.geometry_geojson.coordinates.length >= 2

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} size="lg">
        <DialogHeader>
          <DialogTitle>
            Quantidades — {trecho.nome}
            <span className="ml-2 text-2xs font-mono text-text-dim">
              {trecho.geometry_comprimento_m != null
                ? `${(Number(trecho.geometry_comprimento_m) / 1000).toFixed(2)} km · ${
                    trecho.unidade_espaco_padrao === 'custom'
                      ? trecho.unidade_custom_label
                      : trecho.unidade_espaco_padrao
                  }`
                : 'sem geometria'}
            </span>
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {!temGeometria ? (
            <div className="rounded border border-warning/40 bg-warning/10 p-4 text-2xs font-mono text-warning leading-relaxed">
              Este trecho não tem geometria vinculada. Vincule uma polilinha KMZ/KML no botão
              &quot;Mapa&quot; do trecho antes de criar templates de quantidades — a grade
              analítica depende do comprimento.
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded border border-dashed border-border p-6 text-center">
              <div className="text-sm text-text mb-1">Sem templates de quantidade ainda</div>
              <div className="text-2xs text-text-dim font-mono mb-3">
                Crie um pra começar a registrar volumes, áreas, pesos ou qualquer outra
                quantidade ao longo do trecho.
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={() => setNovoOpen(true)}
              >
                <Plus size={11} /> Criar primeiro template
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  trecho={trecho}
                  empresaNome={empresaNome}
                  obraCodigo={obraCodigo}
                  obraNome={obraNome}
                  onVer={() => setVisualOpen(t)}
                  onImportar={() => setImportOpen(t)}
                  onHistorico={() => setHistoricoOpen(t)}
                  onEditar={() => setEditOpen(t)}
                  onRemover={async () => {
                    const ok = await confirm({
                      title: `Remover template "${t.nome}"?`,
                      description:
                        'Todas as versões, colunas e dados serão apagados. Esta ação é irreversível.',
                      confirmLabel: 'Remover',
                      variant: 'danger'
                    })
                    if (!ok) return
                    try {
                      await deletar.mutateAsync({
                        template_id: t.id,
                        trecho_id: trecho.id
                      })
                      toast.success('Template removido.')
                    } catch (e) {
                      toast.error('Falha ao remover: ' + (e as Error).message)
                    }
                  }}
                />
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {temGeometria && templates.length > 0 ? (
            <Button variant="default" size="sm" onClick={() => setNovoOpen(true)}>
              <Plus size={11} /> Novo template
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Sub-dialogs */}
      {novoOpen ? (
        <ConfigTemplateQuantidadeDialog
          open={novoOpen}
          onOpenChange={setNovoOpen}
          trechoId={trecho.id}
          obraId={trecho.obra_id}
          modo="create"
        />
      ) : null}
      {editOpen ? (
        <EditarColunasWrapper
          template={editOpen}
          trechoId={trecho.id}
          obraId={trecho.obra_id}
          onClose={() => setEditOpen(null)}
        />
      ) : null}
      {visualOpen?.versao_atual ? (
        <VisualizarQuantidadesDialog
          open={!!visualOpen}
          onOpenChange={(o) => {
            if (!o) setVisualOpen(null)
          }}
          versaoId={visualOpen.versao_atual.id}
          trecho={trecho}
          empresaNome={empresaNome}
          obraCodigo={obraCodigo}
          obraNome={obraNome}
          templateNome={visualOpen.nome}
        />
      ) : null}
      {importOpen ? (
        <ImportarExcelQuantidadesDialog
          open={!!importOpen}
          onOpenChange={(o) => {
            if (!o) setImportOpen(null)
          }}
          template={importOpen}
          trecho={trecho}
        />
      ) : null}
      {historicoOpen ? (
        <HistoricoVersoesDialog
          open={!!historicoOpen}
          onOpenChange={(o) => {
            if (!o) setHistoricoOpen(null)
          }}
          template={historicoOpen}
          trecho={trecho}
          empresaNome={empresaNome}
          obraCodigo={obraCodigo}
          obraNome={obraNome}
        />
      ) : null}
    </>
  )
}

// ─── Sub-componente: card de um template ────────────────────────────────
function TemplateCard({
  template,
  trecho,
  empresaNome,
  obraCodigo,
  obraNome,
  onVer,
  onImportar,
  onHistorico,
  onEditar,
  onRemover
}: {
  template: TrechoQuantidadeTemplateResumo
  trecho: ObraTrecho
  empresaNome: string
  obraCodigo: string
  obraNome: string
  onVer: () => void
  onImportar: () => void
  onHistorico: () => void
  onEditar: () => void
  onRemover: () => void
}): ReactNode {
  const baixar = useBaixarExcelVersao()
  const va = template.versao_atual

  return (
    <div className="rounded border border-border bg-bg-panel p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-text truncate">{template.nome}</div>
          <div className="text-2xs font-mono text-text-dim mt-0.5">
            {template.modo === 'analitico' ? 'Analítico' : 'Simplificado'} ·{' '}
            {va ? `v${va.numero} ★ de ${template.total_versoes}` : 'sem versão'} ·{' '}
            {va?.total_colunas ?? 0} cols · {va?.total_segmentos ?? 0} segmentos
          </div>
          {va?.comentario ? (
            <div className="text-2xs font-mono text-text-muted mt-1 italic truncate">
              &quot;{va.comentario}&quot;
            </div>
          ) : null}
        </div>
        <IconButton
          size="sm"
          variant="danger"
          aria-label={`Remover template ${template.nome}`}
          onClick={onRemover}
        >
          <Trash2 size={11} />
        </IconButton>
      </div>
      <div className="flex gap-1 mt-2 flex-wrap">
        <Button
          size="sm"
          variant="ghost"
          onClick={onVer}
          disabled={!va || va.total_segmentos === 0}
        >
          <Eye size={11} /> Ver dados
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!va || baixar.isPending}
          onClick={async () => {
            if (!va) return
            try {
              await baixar.mutateAsync({
                versao_id: va.id,
                trecho,
                empresaNome,
                obraCodigo,
                obraNome
              })
            } catch (e) {
              toast.error('Falha ao baixar: ' + (e as Error).message)
            }
          }}
        >
          <Download size={11} /> {baixar.isPending ? 'Gerando…' : 'Baixar Excel'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onImportar} disabled={!va}>
          <Upload size={11} /> Importar Excel
        </Button>
        <Button size="sm" variant="ghost" onClick={onHistorico}>
          <History size={11} /> Histórico
        </Button>
        <Button size="sm" variant="ghost" onClick={onEditar} disabled={!va}>
          <Settings size={11} /> Editar colunas
        </Button>
      </div>
    </div>
  )
}

// Wrapper que carrega colunas da versão atual antes de abrir o ConfigDialog em edit-colunas
function EditarColunasWrapper({
  template,
  trechoId,
  obraId,
  onClose
}: {
  template: TrechoQuantidadeTemplateResumo
  trechoId: string
  obraId: string
  onClose: () => void
}): ReactNode {
  const va = template.versao_atual
  const { data: versao } = useVersaoTemplate(va?.id ?? null)

  if (!va || !versao) {
    return null
  }

  return (
    <ConfigTemplateQuantidadeDialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      trechoId={trechoId}
      obraId={obraId}
      modo="edit-colunas"
      template={template}
      versaoId={va.id}
      colunasIniciais={versao.colunas}
    />
  )
}
