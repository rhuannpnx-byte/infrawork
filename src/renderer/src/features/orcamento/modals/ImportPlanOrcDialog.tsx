import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
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
import { adminApi } from '@/lib/supabase/functions'
import { fmtBRL } from '@/lib/money'

interface OrcamentoImportItem {
  idx: number
  codigo: string
  descricao: string
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  is_folha: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

type Step = 'upload' | 'preview' | 'aplicando' | 'resultado'

// Mapping default — usado quando o parser auto-detect falha. Inclui o layout
// padrão TecPav (Plan_Orc, header em linha 1, cols A-E).
const DEFAULT_MAPPING = {
  formato: 'xlsx' as const,
  aba_plan_orc: {
    nome: 'Plan_Orc',
    linhas_cabecalho: 1,
    colunas: {
      codigo: 'A',
      descricao: 'B',
      unidade: 'C',
      quantidade: 'D',
      venda_unitaria: 'E'
    }
  }
}

export function ImportPlanOrcDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('upload')
  const [arquivoNome, setArquivoNome] = useState<string>('')
  const [itens, setItens] = useState<OrcamentoImportItem[]>([])
  const [abaUsada, setAbaUsada] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{
    criados: number
    pulados: number
    erros: string[]
  } | null>(null)

  const reset = (): void => {
    setStep('upload')
    setArquivoNome('')
    setItens([])
    setAbaUsada(null)
    setError(null)
    setResultado(null)
  }

  const escolherArquivo = async (): Promise<void> => {
    setError(null)
    try {
      const r = await window.infrawork.orcamento.escolherArquivo()
      if (r.canceled || !r.path) return
      setArquivoNome(r.name ?? r.path)
      const parsed = await window.infrawork.orcamento.parseExcel({
        path: r.path,
        mapping: DEFAULT_MAPPING
      })
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      if (parsed.result.itens.length === 0) {
        setError(
          `Nenhum item encontrado na planilha. Abas detectadas: ${
            parsed.result.abas_encontradas.join(', ') || '(nenhuma)'
          }`
        )
        return
      }
      setItens(parsed.result.itens)
      setAbaUsada(parsed.result.aba_usada)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao ler arquivo')
    }
  }

  const aplicar = async (): Promise<void> => {
    setError(null)
    setStep('aplicando')
    try {
      const r = await adminApi.importPlanOrcAplicar({
        obra_id: obraId,
        itens
      })
      setResultado({
        criados: r.stats.criados,
        pulados: r.stats.pulados,
        erros: r.erros
      })
      setStep('resultado')
      qc.invalidateQueries({ queryKey: ['orcamento', 'plan-orc'] })
      qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade'] })
      if (r.stats.criados > 0) {
        toast.success(
          `${r.stats.criados} item(ns) importados em ${Math.round(r.duracao_ms / 100) / 10}s.`
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar')
      setStep('preview')
    }
  }

  const folhas = itens.filter((i) => i.is_folha).length
  const etapas = itens.filter((i) => !i.is_folha).length
  const totalVenda = itens
    .filter((i) => i.is_folha)
    .reduce((acc, i) => acc + (i.quantidade ?? 0) * (i.venda_unitaria ?? 0), 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="lg"
      disableDismiss={step === 'aplicando'}
    >
      <DialogHeader>
        <DialogTitle>Importar planilha orçamentária</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        {step === 'upload' ? (
          <div className="space-y-3 py-4">
            <div className="text-2xs font-mono text-text-dim">
              Selecione o arquivo <span className="text-text">.xlsx / .xlsm</span> com a planilha
              orçamentária. O sistema detecta automaticamente colunas
              <code> código, descrição, unidade, quantidade, venda unit.</code> Itens sem unidade
              viram <strong>índices</strong> (estruturais); itens com unidade viram{' '}
              <strong>receitas</strong>.
            </div>
            <Button variant="default" onClick={escolherArquivo}>
              <FileUp size={11} /> Selecionar arquivo
            </Button>
          </div>
        ) : null}

        {step === 'preview' ? (
          <div className="space-y-2">
            <div className="text-2xs font-mono text-text-dim">
              Arquivo: <span className="text-text">{arquivoNome}</span>
              {abaUsada ? (
                <span>
                  {' '}
                  · aba: <span className="text-success">{abaUsada}</span>
                </span>
              ) : null}{' '}
              · {itens.length} itens ({etapas} índices + {folhas} receitas) · Venda total:{' '}
              <span className="text-text">{fmtBRL(totalVenda)}</span>
            </div>
            <div className="max-h-[420px] overflow-auto rounded border border-border">
              <table className="w-full text-xs font-mono">
                <thead className="text-2xs text-text-dim bg-bg-elevated sticky top-0">
                  <tr className="border-b border-border">
                    <th className="px-2 py-1 text-left">Código</th>
                    <th className="px-2 py-1 text-left">Descrição</th>
                    <th className="px-2 py-1 text-center">Un.</th>
                    <th className="px-2 py-1 text-right">Qtd</th>
                    <th className="px-2 py-1 text-right">Venda unit.</th>
                    <th className="px-2 py-1 text-right">Venda total</th>
                    <th className="px-2 py-1 text-left">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it) => {
                    const depth = it.codigo.split('.').length - 1
                    const venda = (it.quantidade ?? 0) * (it.venda_unitaria ?? 0)
                    return (
                      <tr key={it.codigo} className="border-b border-border/40">
                        <td className="px-2 py-1 text-text-dim text-2xs">
                          <span style={{ paddingLeft: `${depth * 8}px` }}>{it.codigo}</span>
                        </td>
                        <td
                          className="px-2 py-1 text-text truncate max-w-[260px]"
                          title={it.descricao}
                        >
                          {it.descricao}
                        </td>
                        <td className="px-2 py-1 text-center text-text-muted text-2xs">
                          {it.unidade ?? '—'}
                        </td>
                        <td className="px-2 py-1 text-right text-text-muted tabular-nums">
                          {it.quantidade !== null
                            ? it.quantidade.toLocaleString('pt-BR')
                            : '—'}
                        </td>
                        <td className="px-2 py-1 text-right text-text-muted tabular-nums">
                          {it.venda_unitaria !== null ? fmtBRL(it.venda_unitaria) : '—'}
                        </td>
                        <td className="px-2 py-1 text-right text-text tabular-nums">
                          {it.is_folha ? fmtBRL(venda) : '—'}
                        </td>
                        <td className="px-2 py-1">
                          {it.is_folha ? (
                            <Badge variant="success">receita</Badge>
                          ) : (
                            <Badge>índice</Badge>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-2xs font-mono text-text-muted border-t border-border pt-2">
              <AlertTriangle size={11} className="inline mr-1 text-warn" />
              Itens com código já existente na obra serão pulados. Para vincular receitas a CPUs,
              use &ldquo;Agrupar como serviço&rdquo; depois.
            </div>
          </div>
        ) : null}

        {step === 'aplicando' ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="animate-spin text-accent" size={32} />
            <div className="text-xs font-mono text-text-muted">
              Importando {itens.length} item(ns)…
            </div>
          </div>
        ) : null}

        {step === 'resultado' && resultado ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-accent">
              <CheckCircle2 size={16} />
              <span className="text-sm font-mono">Importação concluída</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <Metric label="Itens criados" value={resultado.criados} />
              <Metric label="Já existiam (pulados)" value={resultado.pulados} />
            </div>
            {resultado.erros.length > 0 ? (
              <details className="text-2xs font-mono text-danger">
                <summary className="cursor-pointer">Erros ({resultado.erros.length})</summary>
                <ul className="pl-3 mt-1 space-y-0.5 max-h-32 overflow-auto">
                  {resultado.erros.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {step === 'upload' ? (
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        ) : null}
        {step === 'preview' ? (
          <>
            <Button type="button" variant="ghost" onClick={() => setStep('upload')}>
              Voltar
            </Button>
            <Button type="button" variant="default" onClick={aplicar}>
              Importar {itens.length} item(ns)
            </Button>
          </>
        ) : null}
        {step === 'resultado' ? (
          <Button type="button" variant="default" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  )
}

function Metric({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="rounded border border-border bg-bg-elevated px-3 py-2">
      <div className="text-2xs uppercase tracking-wider text-text-dim">{label}</div>
      <div className="text-text tabular-nums text-base">{value}</div>
    </div>
  )
}
