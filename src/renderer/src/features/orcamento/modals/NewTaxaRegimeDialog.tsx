import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
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
import { useCreateTaxa } from '../hooks/taxas'
import { fmtPct2, parseBR } from '@/lib/money'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

type CampoKey =
  | 'iss_perc'
  | 'pis_perc'
  | 'cofins_perc'
  | 'csll_perc'
  | 'irpj_perc'
  | 'cprb_perc'
  | 'outros_perc'

interface CampoPerc {
  key: CampoKey
  label: string
  hint?: string
}

/**
 * Defaults baseados em regime padrão de construção civil em obra de
 * governo (Lucro Real com desoneração). Strings já em BR (vírgula decimal).
 */
const DEFAULTS: Record<CampoKey, string> = {
  iss_perc: '5',
  pis_perc: '0,65',
  cofins_perc: '3',
  csll_perc: '1,08',
  irpj_perc: '1,2',
  cprb_perc: '4,5',
  outros_perc: '0'
}

const CAMPOS: CampoPerc[] = [
  { key: 'iss_perc', label: 'ISS', hint: 'varia 2-5% por município' },
  { key: 'pis_perc', label: 'PIS' },
  { key: 'cofins_perc', label: 'COFINS' },
  { key: 'csll_perc', label: 'CSLL', hint: 'presumido construção' },
  { key: 'irpj_perc', label: 'IRPJ', hint: 'presumido construção' },
  { key: 'cprb_perc', label: 'CPRB', hint: 'desoneração folha' },
  { key: 'outros_perc', label: 'Outros', hint: 'catch-all (BDI, taxas extras)' }
]

/**
 * Lê uma string em formato BR ("5,08" ou "5.08" ou "5") e devolve o número
 * como percentual (5,08 = 5.08, NÃO 0.0508). Aceita até 2 casas decimais —
 * casas extras são truncadas via Math.round(× 100) / 100.
 */
function parsePerc(s: string): number {
  if (!s || s.trim() === '') return 0
  const n = parseBR(s).toNumber()
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

export function NewTaxaRegimeDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const create = useCreateTaxa()
  const [nome, setNome] = useState('Padrão')
  const [percs, setPercs] = useState<Record<CampoKey, string>>({ ...DEFAULTS })
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setNome('Padrão')
    setPercs({ ...DEFAULTS })
    setError(null)
  }

  // Total como fração (0..1) — soma dos campos / 100
  const total = CAMPOS.reduce((acc, c) => acc + parsePerc(percs[c.key]) / 100, 0)

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      await create.mutateAsync({
        obra_id: obraId,
        nome: nome.trim(),
        iss_perc: parsePerc(percs.iss_perc) / 100,
        pis_perc: parsePerc(percs.pis_perc) / 100,
        cofins_perc: parsePerc(percs.cofins_perc) / 100,
        csll_perc: parsePerc(percs.csll_perc) / 100,
        irpj_perc: parsePerc(percs.irpj_perc) / 100,
        cprb_perc: parsePerc(percs.cprb_perc) / 100,
        outros_perc: parsePerc(percs.outros_perc) / 100
      })
      toast.success(`Taxa "${nome}" criada (${fmtPct2(total)}).`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar taxa')
    }
  }

  /**
   * Sanitiza o input mantendo só dígitos + um único separador (vírgula ou
   * ponto, normalizado pra vírgula) e até 2 casas decimais. Permite
   * estados intermediários como "5," ou "5,0".
   */
  const setPerc = (key: CampoKey, raw: string): void => {
    let s = raw.replace(/[^\d.,]/g, '').replace(/\./g, ',')
    // Mantém só a primeira vírgula
    const i = s.indexOf(',')
    if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, '')
    // Limita a 2 casas decimais
    if (i >= 0 && s.length - i - 1 > 2) s = s.slice(0, i + 3)
    setPercs((p) => ({ ...p, [key]: s }))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="lg"
      disableDismiss={create.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Nova taxa</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div className="text-2xs font-mono text-text-dim">
            Conjunto de impostos sobre a receita. O <strong>total</strong> abaixo é aplicado como
            deflator no cálculo de lucro: <code>Lucro = Venda − Custo − Venda × total</code>.
          </div>

          <div>
            <Label htmlFor="t-nome">Nome</Label>
            <Input
              id="t-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              autoFocus
              placeholder="Ex.: Padrão, Lucro Real 2026, etc."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {CAMPOS.map((c) => (
              <div key={c.key}>
                <Label htmlFor={`t-${c.key}`}>
                  {c.label} (%)
                  {c.hint ? (
                    <span className="text-text-dim font-normal"> · {c.hint}</span>
                  ) : null}
                </Label>
                <Input
                  id={`t-${c.key}`}
                  value={percs[c.key]}
                  onChange={(e) => setPerc(c.key, e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </div>
            ))}
          </div>

          <div className="border-t border-border pt-2 flex justify-between items-baseline">
            <span className="text-2xs text-text-dim font-mono uppercase">
              Total (deflator de receita)
            </span>
            <span className="text-md font-mono text-accent tabular-nums">{fmtPct2(total)}</span>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar taxa'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
