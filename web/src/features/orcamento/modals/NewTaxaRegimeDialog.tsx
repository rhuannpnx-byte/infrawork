import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useCreateTaxa } from '../hooks/taxas'
import { fmtPct2, parseBR } from '@/lib/money'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

type CampoKey =
  'iss_perc' | 'pis_perc' | 'cofins_perc' | 'csll_perc' | 'irpj_perc' | 'cprb_perc' | 'outros_perc'

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
  { key: 'iss_perc', label: 'ISS', hint: 'Varia de 2% a 5% conforme o município.' },
  { key: 'pis_perc', label: 'PIS' },
  { key: 'cofins_perc', label: 'COFINS' },
  { key: 'csll_perc', label: 'CSLL', hint: 'Lucro presumido da construção.' },
  { key: 'irpj_perc', label: 'IRPJ', hint: 'Lucro presumido da construção.' },
  { key: 'cprb_perc', label: 'CPRB', hint: 'Desoneração da folha.' },
  { key: 'outros_perc', label: 'Outros', hint: 'Demais taxas sobre a receita.' }
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
  const [tentou, setTentou] = useState(false)

  const reset = (): void => {
    setNome('Padrão')
    setPercs({ ...DEFAULTS })
    setError(null)
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  const erroNome = nome.trim().length < 2 ? 'Informe o nome do conjunto de taxas.' : undefined

  // Total como fração (0..1) — soma dos campos / 100
  const total = CAMPOS.reduce((acc, c) => acc + parsePerc(percs[c.key]) / 100, 0)

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (erroNome) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
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
      setError(`Não foi possível criar a taxa. ${detalheDoErro(err) ?? 'Tente de novo.'}`)
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
    <Dialog open={open} onOpenChange={aoMudar} size="lg" disableDismiss={create.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Nova taxa</DialogTitle>
          <DialogDescription>
            Conjunto de impostos sobre a receita. O total é descontado da venda no cálculo do lucro:
            lucro = venda − custo − venda × total.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <Campo rotulo="Nome" obrigatorio erro={tentou ? erroNome : undefined}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
              data-foco-inicial=""
              placeholder="Ex.: Padrão, Lucro real 2026"
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            {CAMPOS.map((c) => (
              <Campo key={c.key} rotulo={`${c.label} (%)`} dica={c.hint}>
                <Input
                  value={percs[c.key]}
                  onChange={(e) => setPerc(c.key, e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  className="tabular text-right"
                />
              </Campo>
            ))}
          </div>

          <div className="flex items-baseline justify-between border-t border-border pt-2">
            <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
              Total descontado da receita
            </span>
            <span className="tabular text-md font-semibold text-text">{fmtPct2(total)}</span>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => aoMudar(false)}
            disabled={create.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar taxa'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
