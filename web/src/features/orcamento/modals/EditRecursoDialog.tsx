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
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useUpdateRecurso } from '../hooks/recursos'
import { RECURSO_GRUPO_LABEL, type Recurso, type RecursoGrupo } from '@/types/orcamento'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  recurso: Recurso | null
}

const GRUPOS: RecursoGrupo[] = ['MO', 'MVE', 'COMBUSTIVEL', 'MATERIAL', 'ADM']

export function EditRecursoDialog({ open, onOpenChange, recurso }: Props): ReactNode {
  const update = useUpdateRecurso()
  const [grupo, setGrupo] = useState<RecursoGrupo>('MATERIAL')
  const [nome, setNome] = useState('')
  const [codigo, setCodigo] = useState('')
  const [unidade, setUnidade] = useState('')
  const [observacao, setObservacao] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!recurso) return
    setGrupo(recurso.grupo)
    setNome(recurso.nome)
    setCodigo(recurso.codigo ?? '')
    setUnidade(recurso.unidade)
    setObservacao(recurso.observacao ?? '')
    setError(null)
  }, [recurso, open])

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!recurso) return
    setError(null)
    try {
      if (grupo !== recurso.grupo && SUPABASE_ENABLED && supabase) {
        // O grupo define em que bloco da composição o recurso entra; trocar
        // com uso em composições deixaria o cálculo incoerente.
        const { count } = await supabase
          .from('cpu_item')
          .select('id', { count: 'exact', head: true })
          .eq('recurso_id', recurso.id)
        if ((count ?? 0) > 0) {
          setError(
            `Este recurso é usado em ${count} insumo(s) de composição — não é possível trocar o grupo.`
          )
          return
        }
      }
      await update.mutateAsync({
        id: recurso.id,
        grupo,
        nome: nome.trim(),
        codigo: codigo.trim() || null,
        unidade: unidade.trim(),
        observacao: observacao.trim() || null
      })
      toast.success('Recurso atualizado.')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={update.isPending}>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Editar recurso</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="er-grupo">Grupo</Label>
              <Select
                id="er-grupo"
                value={grupo}
                onChange={(e) => setGrupo(e.target.value as RecursoGrupo)}
              >
                {GRUPOS.map((g) => (
                  <option key={g} value={g}>
                    {RECURSO_GRUPO_LABEL[g]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="er-unidade">Unidade</Label>
              <Input
                id="er-unidade"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <Label htmlFor="er-nome">Nome</Label>
            <Input
              id="er-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={2}
            />
          </div>
          <div>
            <Label htmlFor="er-codigo">Código (opcional)</Label>
            <Input
              id="er-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <Label htmlFor="er-obs">Observação (opcional)</Label>
            <Input id="er-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
          <p className="text-2xs text-text-dim">
            O preço é editado pelo histórico de preços (ícone de relógio na lista).
          </p>
        </DialogBody>
        <DialogFooter>
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
