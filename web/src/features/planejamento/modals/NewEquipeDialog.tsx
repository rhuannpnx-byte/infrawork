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
import { EQUIPE_TIPOS, EQUIPE_CORES_PADRAO } from '@/types/planejamento'
import { useCreateEquipe } from '../hooks/equipes'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
}

export function NewEquipeDialog({ open, onOpenChange, obraId }: Props): ReactNode {
  const create = useCreateEquipe()
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<string>(EQUIPE_TIPOS[0])
  const [tipoCustom, setTipoCustom] = useState('')
  const [cor, setCor] = useState<string>(EQUIPE_CORES_PADRAO[0])
  const [error, setError] = useState<string | null>(null)

  const reset = (): void => {
    setNome('')
    setTipo(EQUIPE_TIPOS[0])
    setTipoCustom('')
    setCor(EQUIPE_CORES_PADRAO[0])
    setError(null)
  }

  const tipoFinal = tipo === '__custom' ? tipoCustom : tipo

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!tipoFinal.trim()) {
      setError('Tipo é obrigatório.')
      return
    }
    try {
      await create.mutateAsync({ obra_id: obraId, nome: nome.trim(), tipo: tipoFinal.trim(), cor })
      toast.success(`Equipe "${nome}" criada.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar equipe')
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
      disableDismiss={create.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Nova equipe</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div>
            <Label htmlFor="eq-nome">Nome</Label>
            <Input
              id="eq-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              autoFocus
              placeholder="Ex.: Pavimentação 01"
            />
          </div>

          <div>
            <Label htmlFor="eq-tipo">Tipo</Label>
            <select
              id="eq-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-mono"
            >
              {EQUIPE_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="__custom">Outro…</option>
            </select>
            {tipo === '__custom' ? (
              <Input
                value={tipoCustom}
                onChange={(e) => setTipoCustom(e.target.value)}
                placeholder="Digite o tipo"
                className="mt-2"
                required
              />
            ) : null}
          </div>

          <div>
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {EQUIPE_CORES_PADRAO.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  className={`w-6 h-6 rounded border-2 ${cor === c ? 'border-text' : 'border-border'}`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
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
            {create.isPending ? 'Criando…' : 'Criar equipe'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
