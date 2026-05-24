import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
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
import { EQUIPE_TIPOS, EQUIPE_CORES_PADRAO, type Equipe } from '@/types/planejamento'
import { useUpdateEquipe, useDeleteEquipe } from '../hooks/equipes'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  equipe: Equipe | null
}

export function EditEquipeDialog({ open, onOpenChange, equipe }: Props): ReactNode {
  const update = useUpdateEquipe()
  const del = useDeleteEquipe()
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('')
  const [tipoCustom, setTipoCustom] = useState('')
  const [cor, setCor] = useState(EQUIPE_CORES_PADRAO[0])
  const [ativo, setAtivo] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (equipe && open) {
      setNome(equipe.nome)
      const isPadrao = (EQUIPE_TIPOS as readonly string[]).includes(equipe.tipo)
      setTipo(isPadrao ? equipe.tipo : '__custom')
      setTipoCustom(isPadrao ? '' : equipe.tipo)
      setCor(equipe.cor)
      setAtivo(equipe.ativo)
      setError(null)
    }
  }, [equipe, open])

  if (!equipe) return null

  const tipoFinal = tipo === '__custom' ? tipoCustom : tipo

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      await update.mutateAsync({
        id: equipe.id,
        obra_id: equipe.obra_id,
        nome: nome.trim(),
        tipo: tipoFinal.trim(),
        cor,
        ativo
      })
      toast.success('Equipe atualizada.')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar')
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!confirm('Excluir esta equipe? Não há volta. Alocações ficam órfãs.')) return
    try {
      await del.mutateAsync({ id: equipe.id, obra_id: equipe.obra_id })
      toast.success('Equipe excluída.')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      disableDismiss={update.isPending || del.isPending}
    >
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Editar equipe</DialogTitle>
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
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-mono">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
            />
            Ativa
          </label>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDelete} disabled={del.isPending}>
            Excluir
          </Button>
          <div className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
