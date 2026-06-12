import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { FileText, FileSpreadsheet, FileJson } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import type { TableExportConfig } from '@/components/data-table/export-types'
import { buildRelatorioHtml, computarServico } from '@/features/acompanhamento/lib/relatorio-servico'

type Format = 'pdf' | 'excel' | 'csv'

function csvCell(v: string | number | null, sep: string): string {
  if (v == null) return ''
  const s = typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v)
  return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s
}

function baixarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ExportDialog(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('export'))
  const config = useUIStore((s) => s.modalPayload.export) as TableExportConfig | undefined
  const close = (): void => useUIStore.getState().closeModal('export')

  const temRelatorio = !!config?.relatorio?.servicos?.length
  const formatosDisp = useMemo<Format[]>(
    () => (temRelatorio ? ['pdf', 'excel', 'csv'] : ['excel', 'csv']),
    [temRelatorio]
  )
  const [format, setFormat] = useState<Format>('pdf')
  const [sep, setSep] = useState(';')
  const [incluirCabecalho, setIncluirCabecalho] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Sem config → mantém o stub legado (não quebra outras telas).
  if (open && !config) return <StubDialog close={close} />

  const fmt: Format = formatosDisp.includes(format) ? format : formatosDisp[0]

  const handleExport = async (): Promise<void> => {
    if (!config) return
    setExporting(true)
    try {
      if (fmt === 'csv') {
        const linhas: string[] = []
        if (incluirCabecalho) linhas.push(config.colunas.map((c) => csvCell(c.header, sep)).join(sep))
        for (const row of config.linhas) linhas.push(row.map((v) => csvCell(v, sep)).join(sep))
        const csv = '﻿' + linhas.join('\r\n')
        baixarBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${config.filenameBase}.csv`)
        toast.success('CSV exportado.')
        close()
      } else if (fmt === 'excel') {
        const servicos = (config.relatorio?.servicos ?? []).map(({ pr, cs }) => {
          const d = computarServico(pr, cs)
          const mediaByRange = new Map(d.weeklyMedia.map((w) => [w.range, w.media]))
          const semanas = d.weeklyPrevReal.map((w) => ({
            prev: w.prev,
            real: w.real,
            media: mediaByRange.get(w.range) ?? null,
            range: w.range
          }))
          return {
            codigo: pr.codigo,
            descricao: pr.descricao,
            unidade: pr.unidade ?? '',
            mediaNec: d.proj.mediaNec,
            semanas
          }
        })
        const res = await window.infrawork.tabela.exportXlsx({
          obraNome: config.obraNome,
          titulo: config.titulo,
          filenameBase: config.filenameBase,
          colunas: config.colunas,
          linhas: config.linhas,
          servicos
        })
        if (res.ok) { toast.success('Excel exportado.'); close() }
        else if (!res.canceled) toast.error(res.error ?? 'Falha ao exportar Excel.')
      } else {
        // PDF — relatório por serviço
        const rel = config.relatorio!
        const html = buildRelatorioHtml(rel.servicos, {
          obraNome: config.obraNome,
          logoDataUrl: rel.logoDataUrl
        })
        const res = await window.infrawork.relatorio.exportPdf({ html, filenameBase: config.filenameBase })
        if (res.ok) { toast.success('PDF exportado.'); close() }
        else if (!res.canceled) toast.error(res.error ?? 'Falha ao exportar PDF.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha na exportação.')
    } finally {
      setExporting(false)
    }
  }

  const allTabs: Array<{ key: Format; label: string; icon: typeof FileText }> = [
    { key: 'pdf', label: 'PDF', icon: FileText },
    { key: 'excel', label: 'Excel', icon: FileSpreadsheet },
    { key: 'csv', label: 'CSV', icon: FileJson }
  ]
  const tabs = allTabs.filter((t) => formatosDisp.includes(t.key))

  const nServ = config?.relatorio?.servicos.length ?? 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} size="md">
      <DialogHeader>
        <DialogTitle>Exportar — {config?.titulo}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="flex gap-1 border border-border rounded p-0.5 bg-bg-elevated">
          {tabs.map((t) => {
            const isActive = t.key === fmt
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setFormat(t.key)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 h-7 rounded text-xs font-medium transition-colors',
                  isActive ? 'bg-bg-panel text-text shadow-[0_0_0_1px_var(--border-accent)]' : 'text-text-muted hover:text-text'
                )}
              >
                <Icon size={12} /> {t.label}
              </button>
            )
          })}
        </div>

        {fmt === 'pdf' ? (
          <p className="text-xs text-text-muted leading-relaxed">
            Relatório completo <strong className="text-text">por serviço</strong> ({nServ} {nServ === 1 ? 'página' : 'páginas'}, A4 paisagem):
            curva-S com projeções, calor de produção (30 dias), produção dia-a-dia, previsto × realizado semanal e média semanal × necessária.
          </p>
        ) : fmt === 'excel' ? (
          <p className="text-xs text-text-muted leading-relaxed">
            Planilha <strong className="text-text">.xlsx</strong>: aba <strong className="text-text">Comparativo</strong> ({config?.linhas.length} {config?.linhas.length === 1 ? 'linha' : 'linhas'})
            {nServ > 0 ? <> + {nServ} {nServ === 1 ? 'aba' : 'abas'} de dados por serviço (semanas previsto × realizado).</> : '.'}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-text-muted">
              CSV da tabela comparativa ({config?.linhas.length} {config?.linhas.length === 1 ? 'linha' : 'linhas'}).
            </p>
            <div>
              <Label>Separador</Label>
              <Select value={sep} onChange={(e) => setSep(e.target.value)}>
                <option value=";">; (ponto e vírgula)</option>
                <option value=",">, (vírgula)</option>
                <option value={'\t'}>Tabulação</option>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
              <input
                type="checkbox"
                checked={incluirCabecalho}
                onChange={(e) => setIncluirCabecalho(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Incluir cabeçalho
            </label>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close} disabled={exporting}>
          Cancelar
        </Button>
        <Button variant="default" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exportando…' : 'Exportar'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Diálogo placeholder antigo — usado quando a tabela não fornece config de export. */
function StubDialog({ close }: { close: () => void }): ReactNode {
  return (
    <Dialog open onOpenChange={(o) => !o && close()} size="md">
      <DialogHeader>
        <DialogTitle>Exportar</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p className="text-xs text-text-muted">Exportação não disponível para esta tabela.</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="default" onClick={close}>Fechar</Button>
      </DialogFooter>
    </Dialog>
  )
}
