import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, XCircle } from 'lucide-react'
import type ExcelJS from 'exceljs'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { downloadBlob, loadWorkbookFromFile } from '@/lib/xlsx/download'
import type { ImportAcao, ImportResultado, ParseResult, ParsedRow } from '@/lib/xlsx/types'

export interface PreviewColumn<T> {
  key: string
  header: string
  render: (row: ParsedRow<T>) => ReactNode
  align?: 'left' | 'right'
  width?: number
}

export interface ImportTemplateDialogProps<T, O> {
  open: boolean
  onOpenChange: (open: boolean) => void
  titulo: string
  /** "recursos", "composições", "itens" — usado nos textos. */
  entidadeLabel: string
  gerarModelo: () => Promise<Blob>
  nomeArquivoModelo: string
  /** Download adicional no passo 1 (ex.: dados atuais no formato do modelo). */
  extraDownload?: { label: string; descricao: string; baixar: () => Promise<void> }
  parse: (wb: ExcelJS.Workbook) => Promise<ParseResult<T>> | ParseResult<T>
  previewColumns: PreviewColumn<T>[]
  opcoes?: {
    inicial: O
    render: (value: O, set: (v: O) => void, rows: ParsedRow<T>[]) => ReactNode
  }
  aplicar: (rows: ParsedRow<T>[], opcoes: O) => Promise<ImportResultado>
  resultadoMetrics: (r: ImportResultado) => Array<{ label: string; value: number }>
  onAplicado?: (r: ImportResultado) => void
}

type Step = 'modelo' | 'preview' | 'aplicando' | 'resultado'

const ACAO_LABEL: Record<ImportAcao, string> = {
  criar: 'criar',
  atualizar: 'atualizar',
  pular: 'pular',
  erro: 'erro'
}
const ACAO_VARIANT: Record<ImportAcao, 'success' | 'accent' | 'default' | 'danger'> = {
  criar: 'success',
  atualizar: 'accent',
  pular: 'default',
  erro: 'danger'
}

const MAX_PREVIEW = 300

export function ImportTemplateDialog<T, O>(props: ImportTemplateDialogProps<T, O>): ReactNode {
  const {
    open,
    onOpenChange,
    titulo,
    entidadeLabel,
    gerarModelo,
    nomeArquivoModelo,
    extraDownload,
    parse,
    previewColumns,
    opcoes,
    aplicar,
    resultadoMetrics,
    onAplicado
  } = props
  const [step, setStep] = useState<Step>('modelo')
  const [arquivoNome, setArquivoNome] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParseResult<T> | null>(null)
  const [soErros, setSoErros] = useState(false)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [opt, setOpt] = useState<O>(opcoes?.inicial as O)
  const [resultado, setResultado] = useState<ImportResultado | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setStep('modelo')
      setArquivoNome(null)
      setParsed(null)
      setSoErros(false)
      setErroGeral(null)
      setResultado(null)
      setOpt(opcoes?.inicial as O)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const [baixandoExtra, setBaixandoExtra] = useState(false)
  const baixarModelo = async (): Promise<void> => {
    try {
      const blob = await gerarModelo()
      downloadBlob(blob, nomeArquivoModelo)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar o modelo.')
    }
  }

  const escolherArquivo = async (file: File): Promise<void> => {
    setErroGeral(null)
    setParsing(true)
    setArquivoNome(file.name)
    try {
      const wb = await loadWorkbookFromFile(file)
      const res = await parse(wb)
      setParsed(res)
      if (res.errosGerais.some((e) => e.nivel === 'erro')) {
        setErroGeral(
          res.errosGerais
            .filter((e) => e.nivel === 'erro')
            .map((e) => e.msg)
            .join(' ')
        )
        if (res.rows.length === 0) return
      }
      setStep('preview')
    } catch (e) {
      setErroGeral(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.')
    } finally {
      setParsing(false)
    }
  }

  const validas = useMemo(() => (parsed?.rows ?? []).filter((r) => r.acao !== 'erro'), [parsed])
  const visiveis = useMemo(() => {
    const base = parsed?.rows ?? []
    return soErros ? base.filter((r) => r.acao === 'erro' || r.avisos.length > 0) : base
  }, [parsed, soErros])

  const importar = async (): Promise<void> => {
    if (!parsed) return
    setStep('aplicando')
    setErroGeral(null)
    try {
      const r = await aplicar(validas, opt)
      setResultado(r)
      setStep('resultado')
      onAplicado?.(r)
      if (r.ok) toast.success(`Importação de ${entidadeLabel} concluída.`)
      else toast.warning(`Importação concluída com ${r.erros.length} erro(s).`)
    } catch (e) {
      setErroGeral(e instanceof Error ? e.message : 'Falha ao importar.')
      setStep('preview')
    }
  }

  const resumo = parsed?.resumo

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size={step === 'modelo' ? 'md' : 'xl'}
      disableDismiss={step === 'aplicando'}
    >
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erroGeral} />

        {step === 'modelo' ? (
          <div className="space-y-4">
            <div className="rounded border border-border bg-bg-panel p-3 space-y-2">
              <div className="text-xs font-medium text-text">1. Baixe o modelo padrão</div>
              <p className="text-2xs text-text-muted">
                O arquivo traz a aba &quot;Instruções&quot;, as colunas esperadas (com listas de
                valores) e uma aba de exemplo.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => void baixarModelo()}>
                  <Download size={11} /> Baixar modelo (.xlsx)
                </Button>
                {extraDownload ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={baixandoExtra}
                    title={extraDownload.descricao}
                    onClick={() => {
                      setBaixandoExtra(true)
                      extraDownload
                        .baixar()
                        .catch((e) =>
                          toast.error(e instanceof Error ? e.message : 'Falha ao exportar.')
                        )
                        .finally(() => setBaixandoExtra(false))
                    }}
                  >
                    <Download size={11} /> {baixandoExtra ? 'Exportando…' : extraDownload.label}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="rounded border border-border bg-bg-panel p-3 space-y-2">
              <div className="text-xs font-medium text-text">2. Preencha e envie o arquivo</div>
              <p className="text-2xs text-text-muted">
                Você verá uma prévia com o que será criado, atualizado ou ignorado antes de
                confirmar.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => inputRef.current?.click()}
                  disabled={parsing}
                >
                  {parsing ? <Loader2 size={11} className="animate-spin" /> : <FileUp size={11} />}{' '}
                  {parsing ? 'Lendo…' : 'Escolher arquivo'}
                </Button>
                {arquivoNome ? (
                  <span className="text-2xs font-mono text-text-dim truncate">{arquivoNome}</span>
                ) : null}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void escolherArquivo(f)
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        ) : null}

        {step === 'preview' && parsed && resumo ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-2xs font-mono text-text-dim truncate max-w-[260px]"
                title={arquivoNome ?? ''}
              >
                {arquivoNome}
              </span>
              <span className="h-4 w-px bg-border" />
              {(['criar', 'atualizar', 'pular', 'erro'] as ImportAcao[]).map((a) => (
                <Badge key={a} variant={ACAO_VARIANT[a]}>
                  {resumo[a]} {ACAO_LABEL[a]}
                </Badge>
              ))}
              {parsed.rows.some((r) => r.avisos.length > 0) ? (
                <Badge variant="warn">
                  {parsed.rows.reduce((n, r) => n + r.avisos.length, 0)} aviso(s)
                </Badge>
              ) : null}
              <label className="ml-auto flex items-center gap-1.5 text-2xs text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={soErros}
                  onChange={(e) => setSoErros(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                só erros e avisos
              </label>
            </div>

            {parsed.errosGerais
              .filter((e) => e.nivel === 'aviso')
              .map((e, i) => (
                <div key={i} className="text-2xs text-warn flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-px shrink-0" /> {e.msg}
                </div>
              ))}

            <div className="rounded border border-border overflow-auto max-h-[46vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-elevated text-2xs font-mono uppercase text-text-dim">
                  <tr>
                    <th className="px-2 py-1.5 text-left w-12">Linha</th>
                    <th className="px-2 py-1.5 text-left w-24">Ação</th>
                    {previewColumns.map((c) => (
                      <th
                        key={c.key}
                        className={cn(
                          'px-2 py-1.5 font-normal',
                          c.align === 'right' ? 'text-right' : 'text-left'
                        )}
                        style={{ width: c.width }}
                      >
                        {c.header}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-left">Mensagens</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.slice(0, MAX_PREVIEW).map((r) => (
                    <tr
                      key={`${r.sheet}-${r.row}`}
                      className={cn(
                        'border-t border-border',
                        r.acao === 'erro' && 'bg-danger/5'
                      )}
                    >
                      <td className="px-2 py-1 font-mono text-2xs text-text-dim">{r.row}</td>
                      <td className="px-2 py-1">
                        <Badge variant={ACAO_VARIANT[r.acao]}>{ACAO_LABEL[r.acao]}</Badge>
                      </td>
                      {previewColumns.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            'px-2 py-1 text-text',
                            c.align === 'right' && 'text-right font-mono tabular-nums'
                          )}
                        >
                          {c.render(r)}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-2xs">
                        {r.motivo ? <div className="text-text-dim">{r.motivo}</div> : null}
                        {r.erros.map((e, i) => (
                          <div key={`e${i}`} className="text-danger flex items-start gap-1">
                            <XCircle size={10} className="mt-0.5 shrink-0" /> {e.msg}
                          </div>
                        ))}
                        {r.avisos.map((a, i) => (
                          <div key={`a${i}`} className="text-warn flex items-start gap-1">
                            <AlertTriangle size={10} className="mt-0.5 shrink-0" /> {a.msg}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visiveis.length > MAX_PREVIEW ? (
                <div className="px-2 py-1.5 text-2xs font-mono text-text-dim border-t border-border">
                  mostrando {MAX_PREVIEW} de {visiveis.length} linhas
                </div>
              ) : null}
            </div>

            {opcoes ? (
              <div className="rounded border border-border bg-bg-panel p-3">
                {opcoes.render(opt, setOpt, parsed.rows)}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 'aplicando' ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-muted font-mono">
            <Loader2 size={14} className="animate-spin" /> Importando {entidadeLabel}…
          </div>
        ) : null}

        {step === 'resultado' && resultado ? (
          <div className="space-y-3">
            <div
              className={cn(
                'flex items-center gap-2 text-sm',
                resultado.ok ? 'text-success' : 'text-warn'
              )}
            >
              {resultado.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {resultado.ok ? 'Importação concluída' : 'Importação concluída com erros'}
              <span className="text-2xs font-mono text-text-dim ml-auto">
                {resultado.duracao_ms} ms
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {resultadoMetrics(resultado).map((m) => (
                <div key={m.label} className="rounded border border-border bg-bg-panel p-2">
                  <div className="text-2xs font-mono uppercase text-text-dim">{m.label}</div>
                  <div className="text-lg font-mono text-text tabular-nums">{m.value}</div>
                </div>
              ))}
            </div>
            {resultado.avisos.length > 0 ? (
              <details className="rounded border border-warn/30 bg-warn/5 p-2 text-2xs" open>
                <summary className="cursor-pointer text-warn">
                  {resultado.avisos.length} aviso(s)
                </summary>
                <ul className="mt-1 space-y-0.5 text-text-muted list-disc pl-4">
                  {resultado.avisos.slice(0, 100).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {resultado.erros.length > 0 ? (
              <details className="rounded border border-danger/30 bg-danger/5 p-2 text-2xs" open>
                <summary className="cursor-pointer text-danger">
                  {resultado.erros.length} erro(s)
                </summary>
                <ul className="mt-1 space-y-0.5 text-text-muted list-disc pl-4">
                  {resultado.erros.slice(0, 100).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {step === 'preview' ? (
          <>
            <Button variant="ghost" onClick={() => setStep('modelo')}>
              Voltar
            </Button>
            <Button
              variant="default"
              onClick={() => void importar()}
              disabled={validas.length === 0}
            >
              Importar {validas.length} linha(s) válida(s)
            </Button>
          </>
        ) : step === 'resultado' ? (
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={step === 'aplicando'}
          >
            Cancelar
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
