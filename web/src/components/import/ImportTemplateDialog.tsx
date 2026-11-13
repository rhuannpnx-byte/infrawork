import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, XCircle } from 'lucide-react'
import type ExcelJS from 'exceljs'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { cn } from '@/lib/utils'
import { contar } from '@/lib/rotulos'
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
  /** O que a linha vira com as opções escolhidas (ex.: "atualizar" passa a "ignorar"). Só muda a prévia. */
  acaoEfetiva?: (acao: ImportAcao, opcoes: O) => ImportAcao
  aplicar: (rows: ParsedRow<T>[], opcoes: O) => Promise<ImportResultado>
  resultadoMetrics: (r: ImportResultado) => Array<{ label: string; value: number }>
  onAplicado?: (r: ImportResultado) => void
}

type Step = 'modelo' | 'preview' | 'aplicando' | 'resultado'

const ACAO_LABEL: Record<ImportAcao, string> = {
  criar: 'Criar',
  atualizar: 'Atualizar',
  pular: 'Ignorar',
  erro: 'Erro'
}
/** Contagem de cada ação no resumo da prévia: "8 para criar", "1 com erro". */
const ACAO_RESUMO: Record<ImportAcao, string> = {
  criar: 'para criar',
  atualizar: 'para atualizar',
  pular: 'para ignorar',
  erro: 'com erro'
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
    acaoEfetiva,
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
      toast.error('Não foi possível gerar o modelo.', {
        description: e instanceof Error ? e.message : undefined
      })
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
      // erro da biblioteca de leitura (arquivo que não é .xlsx) não diz nada a quem usa a tela
      const detalhe = e instanceof Error ? e.message : ''
      setErroGeral(
        `Não foi possível ler o arquivo. ${
          detalhe && !/zip|central directory|corrupt|signature|unexpected/i.test(detalhe)
            ? detalhe
            : 'Confira se é o modelo em .xlsx e envie de novo.'
        }`
      )
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
      else toast.warning(`Importação concluída com ${contar(r.erros.length, 'erro', 'erros')}.`)
    } catch (e) {
      setErroGeral(
        `Não foi possível importar. ${(e as { message?: string } | null)?.message ?? 'Tente de novo.'}`
      )
      setStep('preview')
    }
  }

  const acaoDe = (acao: ImportAcao): ImportAcao => (acaoEfetiva ? acaoEfetiva(acao, opt) : acao)
  const resumo = useMemo(() => {
    if (!parsed || !acaoEfetiva) return parsed?.resumo
    const conta: Record<ImportAcao, number> = { criar: 0, atualizar: 0, pular: 0, erro: 0 }
    for (const r of parsed.rows) conta[acaoEfetiva(r.acao, opt)]++
    return conta
  }, [parsed, acaoEfetiva, opt])
  const totalAvisos = (parsed?.rows ?? []).reduce((n, r) => n + r.avisos.length, 0)
  const semValidas = validas.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size={step === 'modelo' ? 'md' : 'xl'}
      disableDismiss={step === 'aplicando'}
    >
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription>
          {step === 'modelo'
            ? 'Passo 1 de 2: baixe o modelo, preencha e envie o arquivo.'
            : step === 'preview'
              ? 'Passo 2 de 2: confira a prévia. Nada é gravado antes de você importar.'
              : step === 'aplicando'
                ? 'Aguarde, sem fechar a janela.'
                : 'Resultado da importação.'}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={erroGeral} />

        {step === 'modelo' ? (
          <ol className="space-y-3">
            <li className="space-y-2 rounded border border-border bg-bg-panel p-3">
              <h3 className="text-md font-semibold text-text">1. Baixe o modelo</h3>
              <p className="text-sm text-text-muted">
                O arquivo traz a aba &quot;Instruções&quot;, as colunas esperadas (com listas de
                valores) e uma aba de exemplo.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => void baixarModelo()}>
                  <Download size={12} /> Baixar modelo (.xlsx)
                </Button>
                {extraDownload ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={baixandoExtra}
                    title={extraDownload.descricao}
                    onClick={() => {
                      setBaixandoExtra(true)
                      extraDownload
                        .baixar()
                        .catch((e) =>
                          toast.error('Não foi possível exportar.', {
                            description: e instanceof Error ? e.message : undefined
                          })
                        )
                        .finally(() => setBaixandoExtra(false))
                    }}
                  >
                    <Download size={12} /> {baixandoExtra ? 'Exportando…' : extraDownload.label}
                  </Button>
                ) : null}
              </div>
            </li>
            <li className="space-y-2 rounded border border-border bg-bg-panel p-3">
              <h3 className="text-md font-semibold text-text">2. Preencha e envie o arquivo</h3>
              <p className="text-sm text-text-muted">
                Antes de confirmar, você vê uma prévia com o que será criado, atualizado ou
                ignorado.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => inputRef.current?.click()}
                  disabled={parsing}
                >
                  {parsing ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}{' '}
                  {parsing ? 'Lendo o arquivo…' : 'Escolher arquivo'}
                </Button>
                {arquivoNome ? (
                  <span className="truncate text-sm text-text-muted" title={arquivoNome}>
                    {arquivoNome}
                  </span>
                ) : null}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                aria-label="Arquivo preenchido (.xlsx)"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void escolherArquivo(f)
                  e.target.value = ''
                }}
              />
            </li>
          </ol>
        ) : null}

        {step === 'preview' && parsed && resumo ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-text" role="status">
                <span className="font-semibold">
                  {contar(validas.length, 'linha válida', 'linhas válidas')}
                </span>
                {resumo.erro > 0 ? `, ${resumo.erro.toLocaleString('pt-BR')} com erro` : ''}
                {arquivoNome ? (
                  <span className="text-text-muted" title={arquivoNome}>
                    {' '}
                    em{' '}
                    <span className="inline-block max-w-[220px] truncate align-bottom">
                      {arquivoNome}
                    </span>
                  </span>
                ) : null}
              </p>
              <span className="h-4 w-px bg-border" aria-hidden />
              {(['criar', 'atualizar', 'pular', 'erro'] as ImportAcao[])
                .filter((a) => resumo[a] > 0)
                .map((a) => (
                  <Badge key={a} variant={ACAO_VARIANT[a]}>
                    {resumo[a].toLocaleString('pt-BR')} {ACAO_RESUMO[a]}
                  </Badge>
                ))}
              {totalAvisos > 0 ? (
                <Badge variant="warn">{contar(totalAvisos, 'aviso', 'avisos')}</Badge>
              ) : null}
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-text-muted">
                <input
                  type="checkbox"
                  checked={soErros}
                  onChange={(e) => setSoErros(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Só linhas com erro ou aviso
              </label>
            </div>

            {semValidas ? (
              <p role="alert" className="text-sm font-medium text-danger">
                Nenhuma linha válida para importar. Corrija os erros no arquivo e envie de novo.
              </p>
            ) : null}

            {parsed.errosGerais
              .filter((e) => e.nivel === 'aviso')
              .map((e, i) => (
                <div key={i} className="flex items-start gap-1.5 text-sm text-text">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />{' '}
                  {e.msg}
                </div>
              ))}

            <div
              className="max-h-[46vh] overflow-auto rounded border border-border"
              tabIndex={0}
              role="region"
              aria-label="Prévia das linhas do arquivo"
            >
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg-elevated text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                  <tr>
                    <th className="w-14 px-2 py-1.5 text-left">Linha</th>
                    <th className="w-24 px-2 py-1.5 text-left">Ação</th>
                    {previewColumns.map((c) => (
                      <th
                        key={c.key}
                        className={cn(
                          'px-2 py-1.5',
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
                  {visiveis.length === 0 ? (
                    <tr>
                      <td
                        colSpan={previewColumns.length + 3}
                        className="px-2 py-4 text-sm text-text-muted"
                      >
                        {soErros
                          ? 'Nenhuma linha com erro ou aviso.'
                          : 'O arquivo não tem linhas preenchidas.'}
                      </td>
                    </tr>
                  ) : null}
                  {visiveis.slice(0, MAX_PREVIEW).map((r) => (
                    <tr
                      key={`${r.sheet}-${r.row}`}
                      className={cn(
                        'border-t border-border align-top',
                        r.acao === 'erro' && 'bg-danger/5'
                      )}
                    >
                      <td className="tabular px-2 py-1 text-text-muted">{r.row}</td>
                      <td className="px-2 py-1">
                        <Badge variant={ACAO_VARIANT[acaoDe(r.acao)]}>
                          {ACAO_LABEL[acaoDe(r.acao)]}
                        </Badge>
                      </td>
                      {previewColumns.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            'px-2 py-1 text-text',
                            c.align === 'right' && 'tabular text-right'
                          )}
                        >
                          {c.render(r)}
                        </td>
                      ))}
                      <td className="px-2 py-1 text-sm">
                        {r.motivo ? <div className="text-text-muted">{r.motivo}</div> : null}
                        {r.erros.map((e, i) => (
                          <div key={`e${i}`} className="flex items-start gap-1 text-danger">
                            <XCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
                            <span>
                              <span className="sr-only">Erro: </span>
                              {e.msg}
                            </span>
                          </div>
                        ))}
                        {r.avisos.map((a, i) => (
                          <div key={`a${i}`} className="flex items-start gap-1 text-text">
                            <AlertTriangle
                              size={14}
                              className="mt-0.5 shrink-0 text-warn"
                              aria-hidden
                            />
                            <span>
                              <span className="sr-only">Aviso: </span>
                              {a.msg}
                            </span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visiveis.length > MAX_PREVIEW ? (
                <div className="border-t border-border px-2 py-1.5 text-sm text-text-muted">
                  Mostrando as primeiras {MAX_PREVIEW} de {visiveis.length.toLocaleString('pt-BR')}{' '}
                  linhas. Todas as linhas válidas serão importadas.
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
          <div
            role="status"
            className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted"
          >
            <Loader2 size={14} className="animate-spin" aria-hidden /> Importando {entidadeLabel}…
          </div>
        ) : null}

        {step === 'resultado' && resultado ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-md font-semibold text-text" role="status">
              {resultado.ok ? (
                <CheckCircle2 size={16} className="text-success" aria-hidden />
              ) : (
                <AlertTriangle size={16} className="text-warn" aria-hidden />
              )}
              {resultado.ok
                ? 'Importação concluída.'
                : `Importação concluída com ${contar(resultado.erros.length, 'erro', 'erros')}.`}
              <span className="tabular ml-auto text-sm font-normal text-text-muted">
                {(resultado.duracao_ms / 1000).toLocaleString('pt-BR', {
                  maximumFractionDigits: 1
                })}{' '}
                s
              </span>
            </div>
            <FaixaIndicadores rotulo="Resultado da importação">
              {resultadoMetrics(resultado).map((m) => (
                <Indicador
                  key={m.label}
                  rotulo={m.label}
                  valor={m.value.toLocaleString('pt-BR')}
                  tamanho="sm"
                />
              ))}
            </FaixaIndicadores>
            {resultado.avisos.length > 0 ? (
              <details className="rounded border border-warn/40 bg-warn/5 p-2 text-sm" open>
                <summary className="cursor-pointer font-medium text-text">
                  {contar(resultado.avisos.length, 'aviso', 'avisos')}
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text-muted">
                  {resultado.avisos.slice(0, 100).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                {resultado.avisos.length > 100 ? (
                  <p className="mt-1 text-text-muted">
                    Mostrando os primeiros 100 de {resultado.avisos.length.toLocaleString('pt-BR')}.
                  </p>
                ) : null}
              </details>
            ) : null}
            {resultado.erros.length > 0 ? (
              <details className="rounded border border-danger/40 bg-danger/5 p-2 text-sm" open>
                <summary className="cursor-pointer font-medium text-danger">
                  {contar(resultado.erros.length, 'erro', 'erros')}
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text">
                  {resultado.erros.slice(0, 100).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                {resultado.erros.length > 100 ? (
                  <p className="mt-1 text-text-muted">
                    Mostrando os primeiros 100 de {resultado.erros.length.toLocaleString('pt-BR')}.
                  </p>
                ) : null}
              </details>
            ) : null}
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {step === 'preview' ? (
          <>
            <Button variant="secondary" onClick={() => setStep('modelo')}>
              Voltar
            </Button>
            <Button
              variant="default"
              onClick={() => void importar()}
              disabled={semValidas}
              title={semValidas ? 'Nenhuma linha válida para importar' : undefined}
            >
              Importar {contar(validas.length, 'linha válida', 'linhas válidas')}
            </Button>
          </>
        ) : step === 'resultado' ? (
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={step === 'aplicando'}
          >
            {step === 'aplicando' ? 'Importando…' : 'Cancelar'}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
