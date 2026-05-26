import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, CheckCircle2, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { adminApi } from '@/lib/supabase/functions'
import { fmtBRL } from '@/lib/money'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

type Step = 'upload' | 'preview' | 'aplicando' | 'resultado'

export function ImportIndiretoDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('upload')
  const [arquivoNome, setArquivoNome] = useState<string>('')
  const [valorMensal, setValorMensal] = useState(0)
  const [descricaoOrigem, setDescricaoOrigem] = useState<string | null>(null)
  const [descricao, setDescricao] = useState('Custos Indiretos')
  const [meses, setMeses] = useState('12')
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{
    codigo: string
    descricao: string
    valor_total: number
    meses: number
  } | null>(null)

  const reset = (): void => {
    setStep('upload')
    setArquivoNome('')
    setValorMensal(0)
    setDescricaoOrigem(null)
    setDescricao('Custos Indiretos')
    setMeses('12')
    setError(null)
    setResultado(null)
  }

  const escolherArquivo = async (): Promise<void> => {
    setError(null)
    try {
      const r = await window.infrawork.orcamento.escolherArquivo()
      if (r.canceled || !r.path) return
      setArquivoNome(r.name ?? r.path)
      const parsed = await window.infrawork.orcamento.parseCpuExcel({ path: r.path })
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      const total = parsed.result.indireto_total
      if (!total) {
        setError('A aba INDIRETO não foi encontrada ou o total mensal está vazio.')
        return
      }
      setValorMensal(total.valor_mensal)
      setDescricaoOrigem(total.descricao_root)
      if (total.descricao_root) setDescricao(total.descricao_root)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao ler arquivo')
    }
  }

  const mesesNum = Math.max(1, Math.floor(Number(meses) || 0))
  const valorTotal = valorMensal * mesesNum

  const aplicar = async (): Promise<void> => {
    setError(null)
    if (!descricao.trim()) {
      setError('Informe uma descrição.')
      return
    }
    if (mesesNum <= 0) {
      setError('Informe um número de meses ≥ 1.')
      return
    }
    setStep('aplicando')
    try {
      const r = await adminApi.importIndiretoAplicar({
        obra_id: obraId,
        descricao: descricao.trim(),
        valor_mensal: valorMensal,
        meses: mesesNum
      })
      setResultado({
        codigo: r.item.codigo,
        descricao: r.item.descricao,
        valor_total: r.valor_total,
        meses: r.meses
      })
      setStep('resultado')
      qc.invalidateQueries({ queryKey: ['orcamento', 'indireto'] })
      qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade'] })
      toast.success(`"${r.item.descricao}" criado com ${fmtBRL(r.valor_total)}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar')
      setStep('preview')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="md"
      disableDismiss={step === 'aplicando'}
    >
      <DialogHeader>
        <DialogTitle>Importar custos indiretos</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />

        {step === 'upload' ? (
          <div className="space-y-3 py-4">
            <div className="text-2xs font-mono text-text-dim">
              Selecione o arquivo <span className="text-text">.xlsm</span> da planilha de
              planejamento TecPav. O sistema lê o <strong>total mensal</strong> da aba{' '}
              <code>INDIRETO</code> e cria <strong>um único item</strong> de custo indireto na
              obra. Você define no próximo passo a quantos meses esse valor equivale.
            </div>
            <Button variant="default" onClick={escolherArquivo}>
              <FileUp size={11} /> Selecionar arquivo
            </Button>
          </div>
        ) : null}

        {step === 'preview' ? (
          <div className="space-y-3">
            <div className="text-2xs font-mono text-text-dim">
              Arquivo: <span className="text-text">{arquivoNome}</span>
              {descricaoOrigem ? (
                <>
                  {' · raiz: '}
                  <span className="text-text">{descricaoOrigem}</span>
                </>
              ) : null}
            </div>

            <div className="rounded border border-border bg-bg-elevated p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                  Valor mensal (planilha)
                </span>
                <span className="text-text font-mono text-sm tabular-nums">
                  {fmtBRL(valorMensal)}
                </span>
              </div>
            </div>

            <div>
              <Label htmlFor="ind-desc" className="block">
                Descrição
              </Label>
              <Input
                id="ind-desc"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Custos Indiretos"
              />
            </div>

            <div>
              <Label htmlFor="ind-meses" className="block">
                Duração (meses)
              </Label>
              <Input
                id="ind-meses"
                type="text"
                inputMode="numeric"
                value={meses}
                onChange={(e) => setMeses(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Ex.: 12"
              />
              <p className="text-2xs text-text-dim font-mono mt-1">
                Quantos meses esse custo mensal vai durar na obra.
              </p>
            </div>

            <div className="rounded border border-accent-line bg-accent-glow/40 p-3 text-xs font-mono">
              <div className="flex items-baseline justify-between">
                <span className="text-text-muted">
                  {fmtBRL(valorMensal)} × {mesesNum} {mesesNum === 1 ? 'mês' : 'meses'}
                </span>
                <span className="text-accent text-lg tabular-nums">{fmtBRL(valorTotal)}</span>
              </div>
            </div>
          </div>
        ) : null}

        {step === 'aplicando' ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="animate-spin text-accent" size={32} />
            <div className="text-xs font-mono text-text-muted">Criando item de indireto…</div>
          </div>
        ) : null}

        {step === 'resultado' && resultado ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-accent">
              <CheckCircle2 size={16} />
              <span className="text-sm font-mono">Item criado</span>
            </div>
            <div className="rounded border border-border bg-bg-elevated p-3 text-xs font-mono space-y-1">
              <div>
                <span className="text-text-dim">Código: </span>
                <span className="text-text">{resultado.codigo}</span>
              </div>
              <div>
                <span className="text-text-dim">Descrição: </span>
                <span className="text-text">{resultado.descricao}</span>
              </div>
              <div>
                <span className="text-text-dim">Valor total ({resultado.meses}{' '}
                {resultado.meses === 1 ? 'mês' : 'meses'}): </span>
                <span className="text-accent tabular-nums">{fmtBRL(resultado.valor_total)}</span>
              </div>
            </div>
            <div className="text-2xs font-mono text-text-muted border-t border-border pt-2">
              Você pode vincular esse item a um agrupador da Planilha Orçamentária via &ldquo;Agrupar
              como serviço&rdquo; → modo &ldquo;Indireto&rdquo;.
            </div>
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
            <Button
              type="button"
              variant="default"
              onClick={aplicar}
              disabled={mesesNum <= 0 || valorMensal <= 0}
            >
              Criar {fmtBRL(valorTotal)}
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
