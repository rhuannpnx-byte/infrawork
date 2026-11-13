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
import { useCreateEmpresa } from '../hooks'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewEmpresaDialog({ open, onOpenChange }: Props): ReactNode {
  const create = useCreateEmpresa()
  const [nome, setNome] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  const reset = (): void => {
    setNome('')
    setCnpj('')
    setError(null)
    setTentou(false)
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  const erroNome = nome.trim().length < 2 ? 'Informe a razão social da empresa.' : undefined

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
      const res = await create.mutateAsync({
        nome: nome.trim(),
        cnpj: cnpj.trim() || undefined
      })
      toast.success(`Empresa "${res.nome}" criada.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível criar a empresa. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="sm" disableDismiss={create.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Nova empresa</DialogTitle>
          <DialogDescription>
            Depois de criar, cadastre o administrador da empresa em Usuários.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <Campo rotulo="Razão social" obrigatorio erro={tentou ? erroNome : undefined}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </Campo>
          <Campo rotulo="CNPJ" dica="Opcional.">
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              autoComplete="off"
            />
          </Campo>
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
            {create.isPending ? 'Criando…' : 'Criar empresa'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
