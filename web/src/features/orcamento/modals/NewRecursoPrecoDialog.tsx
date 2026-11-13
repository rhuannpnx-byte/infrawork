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
import { parseBR } from '@/lib/money'
import { hojeLocalISO } from '@/lib/format/local-date'
import { useAddRecursoPreco } from '../hooks/recursos'
import { detalheDoErro } from '@/features/orcamento/lib/erro'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  recursoId: string
  recursoNome: string
}

/** Só algarismos, ponto e vírgula: o que o `parseBR` entende como número. */
const NUMERO = /^\d[\d.,]*$/

type CampoComErro = 'custo' | 'vigencia'

export function NewRecursoPrecoDialog({
  open,
  onOpenChange,
  recursoId,
  recursoNome
}: Props): ReactNode {
  const add = useAddRecursoPreco()
  const today = hojeLocalISO()
  const [custo, setCusto] = useState('')
  const [vigenciaInicio, setVigenciaInicio] = useState(today)
  const [origem, setOrigem] = useState('')
  const [observacao, setObservacao] = useState('')
  const [marcarVigente, setMarcarVigente] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  const reset = (): void => {
    setCusto('')
    setVigenciaInicio(today)
    setOrigem('')
    setObservacao('')
    setMarcarVigente(true)
    setError(null)
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  // parseBR: remove separador de milhar (.) ANTES de trocar a vírgula.
  const valor = parseBR(custo).toNumber()

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (!custo.trim()) erros.custo = 'Informe o custo unitário.'
  else if (!NUMERO.test(custo.trim()) || isNaN(valor) || valor < 0)
    erros.custo = 'Digite o custo como um número, por exemplo 1.250,50.'
  if (!vigenciaInicio) erros.vigencia = 'Informe a data em que o preço começa a valer.'
  const erro = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    try {
      await add.mutateAsync({
        recurso_id: recursoId,
        custo_unitario: valor,
        vigencia_inicio: vigenciaInicio,
        origem: origem.trim() || undefined,
        observacao: observacao.trim() || undefined,
        marcar_vigente: marcarVigente
      })
      toast.success('Preço registrado.')
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(`Não foi possível registrar o preço. ${detalheDoErro(err) ?? 'Tente de novo.'}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="md" disableDismiss={add.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Novo preço</DialogTitle>
          <DialogDescription>{recursoNome}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Custo unitário (R$ por unidade)" obrigatorio erro={erro('custo')}>
              <Input
                value={custo}
                onChange={(e) => setCusto(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                data-foco-inicial=""
                placeholder="Ex.: 6,40"
                className="tabular text-right"
              />
            </Campo>
            <Campo rotulo="Vale a partir de" obrigatorio erro={erro('vigencia')}>
              <Input
                type="date"
                value={vigenciaInicio}
                onChange={(e) => setVigenciaInicio(e.target.value)}
              />
            </Campo>
          </div>
          <Campo rotulo="Origem" dica="Opcional. De onde veio o preço.">
            <Input
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
              autoComplete="off"
              placeholder="Ex.: cotação do fornecedor, contrato, SINAPI 04/2026"
            />
          </Campo>
          <Campo rotulo="Observação" dica="Opcional.">
            <Input
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              autoComplete="off"
            />
          </Campo>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={marcarVigente}
              onChange={(e) => setMarcarVigente(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-[color:var(--accent)]"
            />
            Usar este preço como o vigente
          </label>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => aoMudar(false)}
            disabled={add.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={add.isPending}>
            {add.isPending ? 'Registrando…' : 'Registrar preço'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
