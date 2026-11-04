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
import type { Encarregado } from '@/types/acompanhamento'
import { useCreateEncarregado, useUpdateEncarregado } from '../../hooks/lancamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obraId: string
  /** Quando informado, edita; senão cria. */
  encarregado?: Encarregado | null
  onCreated?: (e: Encarregado) => void
}

export function EncarregadoDialog({
  open,
  onOpenChange,
  obraId,
  encarregado = null,
  onCreated
}: Props): ReactNode {
  // O formulário só monta com o diálogo aberto: o estado inicial vem das props
  // a cada abertura, sem efeito de sincronização.
  if (!open) return null
  return (
    <FormDialog
      onOpenChange={onOpenChange}
      obraId={obraId}
      encarregado={encarregado}
      onCreated={onCreated}
    />
  )
}

function FormDialog({
  onOpenChange,
  obraId,
  encarregado,
  onCreated
}: Omit<Props, 'open'>): ReactNode {
  const create = useCreateEncarregado()
  const update = useUpdateEncarregado()
  const [nome, setNome] = useState(encarregado?.nome ?? '')
  const [apelido, setApelido] = useState(encarregado?.apelido ?? '')
  const [telefone, setTelefone] = useState(encarregado?.telefone ?? '')
  const [ativo, setAtivo] = useState(encarregado?.ativo ?? true)
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || update.isPending

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (nome.trim().length < 2) {
      setError('Informe o nome.')
      return
    }
    try {
      if (encarregado) {
        await update.mutateAsync({ id: encarregado.id, nome, apelido, telefone, ativo })
        toast.success('Encarregado atualizado.')
      } else {
        const novo = await create.mutateAsync({ obra_id: obraId, nome, apelido, telefone })
        toast.success(`Encarregado "${novo.nome}" criado.`)
        onCreated?.(novo)
      }
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar'
      setError(
        /duplicate|unique/i.test(msg) ? 'Já existe um encarregado com esse nome nesta obra.' : msg
      )
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange} size="sm" disableDismiss={pending} topmost>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>{encarregado ? 'Editar encarregado' : 'Novo encarregado'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div>
            <Label htmlFor="enc-nome">Nome</Label>
            <Input
              id="enc-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
              autoFocus
              placeholder="Ex.: João da Silva"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="enc-apelido">Apelido</Label>
              <Input
                id="enc-apelido"
                value={apelido}
                onChange={(e) => setApelido(e.target.value)}
                placeholder="opcional"
              />
            </div>
            <div>
              <Label htmlFor="enc-tel">Telefone</Label>
              <Input
                id="enc-tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                inputMode="tel"
                placeholder="(xx) xxxxx-xxxx"
              />
            </div>
          </div>
          {encarregado ? (
            <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
              <input
                type="checkbox"
                checked={ativo}
                onChange={(e) => setAtivo(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Ativo (aparece nas listas de lançamento)
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando…' : encarregado ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
