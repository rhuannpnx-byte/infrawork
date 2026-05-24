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

  const reset = (): void => {
    setNome('')
    setCnpj('')
    setError(null)
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      const res = await create.mutateAsync({
        nome: nome.trim(),
        cnpj: cnpj.trim() || undefined
      })
      toast.success(`Empresa "${res.nome}" criada.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar empresa')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="sm"
      disableDismiss={create.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Nova empresa</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div>
            <Label htmlFor="emp-nome">Razão social</Label>
            <Input
              id="emp-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="emp-cnpj">CNPJ (opcional)</Label>
            <Input
              id="emp-cnpj"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="00.000.000/0000-00"
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar empresa'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
