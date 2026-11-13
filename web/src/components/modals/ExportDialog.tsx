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
import {
  buildRelatorioHtml,
  computarServico
} from '@/features/acompanhamento/lib/relatorio-servico'
import { downloadBlob, nomeComStamp } from '@/lib/files/download'
import { printHtmlToPdf } from '@/lib/print/print-html'

type Format = 'pdf' | 'excel' | 'csv'

function csvCell(v: string | number | null, sep: string): string {
  if (v == null) return ''
  const s = typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v)
  return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s
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

  if (!config) return null

  const fmt: Format = formatosDisp.includes(format) ? format : formatosDisp[0]

  const handleExport = async (): Promise<void> => {
    if (!config) return
    setExporting(true)
    try {
      if (fmt === 'csv') {
        const linhas: string[] = []
        if (incluirCabecalho)
          linhas.push(config.colunas.map((c) => csvCell(c.header, sep)).join(sep))
        for (const row of config.linhas) linhas.push(row.map((v) => csvCell(v, sep)).join(sep))
        const csv = '﻿' + linhas.join('\r\n')
        downloadBlob(
          new Blob([csv], { type: 'text/csv;charset=utf-8' }),
          `${config.filenameBase}.csv`
        )
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
        // o exceljs (~1 MB) só baixa quando alguém exporta
        const { gerarTabelaXlsx } = await import('@/lib/excel/tabela-xlsx')
        const blob = await gerarTabelaXlsx({
          obraNome: config.obraNome,
          titulo: config.titulo,
          filenameBase: config.filenameBase,
          colunas: config.colunas,
          linhas: config.linhas,
          servicos
        })
        downloadBlob(blob, nomeComStamp(config.filenameBase, 'xlsx'))
        toast.success('Excel exportado.')
        close()
      } else {
        // PDF — relatório por serviço via diálogo de impressão do browser
        const rel = config.relatorio!
        const html = buildRelatorioHtml(rel.servicos, {
          obraNome: config.obraNome,
          logoDataUrl: rel.logoDataUrl
        })
        await printHtmlToPdf(html, config.filenameBase)
        toast.success('Relatório aberto para impressão (Salvar como PDF).')
        close()
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
        <DialogTitle>Exportar: {config?.titulo}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div
          role="radiogroup"
          aria-label="Formato do arquivo"
          className="flex gap-1 border border-border-strong rounded p-0.5"
        >
          {tabs.map((t) => {
            const isActive = t.key === fmt
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setFormat(t.key)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 h-8 rounded text-sm transition-colors',
                  isActive
                    ? 'bg-accent-glow-strong text-accent font-semibold'
                    : 'text-text-muted hover:text-text hover:bg-bg-hover'
                )}
              >
                <Icon size={12} /> {t.label}
              </button>
            )
          })}
        </div>

        {fmt === 'pdf' ? (
          <p className="text-sm text-text-muted">
            Relatório por serviço ({nServ} {nServ === 1 ? 'página' : 'páginas'}, A4 paisagem): curva
            S com projeções, mapa de calor da produção (30 dias), produção dia a dia, previsto e
            realizado por semana e média semanal necessária. Abre a impressão do navegador; escolha
            &quot;Salvar como PDF&quot;.
          </p>
        ) : fmt === 'excel' ? (
          <p className="text-sm text-text-muted">
            Planilha <strong className="text-text">.xlsx</strong>: aba{' '}
            <strong className="text-text">{temRelatorio ? 'Comparativo' : config?.titulo}</strong> (
            {config?.linhas.length} {config?.linhas.length === 1 ? 'linha' : 'linhas'})
            {nServ > 0 ? (
              <>
                {' '}
                e {nServ} {nServ === 1 ? 'aba' : 'abas'} de dados por serviço (previsto e realizado
                por semana).
              </>
            ) : (
              '.'
            )}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              CSV da tabela ({config?.linhas.length}{' '}
              {config?.linhas.length === 1 ? 'linha' : 'linhas'}).
            </p>
            <div>
              <Label htmlFor="exp-sep">Separador</Label>
              <Select id="exp-sep" value={sep} onChange={(e) => setSep(e.target.value)}>
                <option value=";">; (ponto e vírgula)</option>
                <option value=",">, (vírgula)</option>
                <option value={'\t'}>Tabulação</option>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
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
        <Button variant="secondary" onClick={close} disabled={exporting}>
          Cancelar
        </Button>
        <Button variant="default" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exportando…' : 'Exportar'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
