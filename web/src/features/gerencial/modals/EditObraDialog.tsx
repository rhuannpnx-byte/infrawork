import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { supabase } from '@/lib/supabase/client'
import type { ObraComEmpresa } from '@/types/gerencial'
import { VinculoFleetHub } from '../components/VinculoFleetHub'

const STATUS = [
  { value: 'planejamento', label: 'Planejamento' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'paralisado', label: 'Paralisada' },
  { value: 'concluido', label: 'Concluída' }
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  obra: ObraComEmpresa
}

/** Dados cadastrais da obra (adm/god; o RLS de `obras` já restringe à empresa do adm). */
export function EditObraDialog({ open, onOpenChange, obra }: Props): ReactNode {
  const qc = useQueryClient()
  const [f, setF] = useState({
    nome: obra.nome,
    codigo: obra.codigo,
    status: obra.status,
    rodovia: obra.rodovia ?? '',
    trecho: obra.trecho ?? '',
    extensao_km: obra.extensao_km != null ? String(obra.extensao_km).replace('.', ',') : '',
    data_base_orcamento: obra.data_base_orcamento ?? '',
    data_inicio_planejada: obra.data_inicio_planejada ?? '',
    data_fim_planejada: obra.data_fim_planejada ?? ''
  })
  const [erro, setErro] = useState<string | null>(null)
  const set =
    (k: keyof typeof f) =>
    (v: string): void =>
      setF((x) => ({ ...x, [k]: v }))

  const salvar = useMutation({
    mutationFn: async () => {
      const ext = f.extensao_km.trim()
        ? Number(f.extensao_km.replace(/\./g, '').replace(',', '.'))
        : null
      if (ext !== null && !(ext >= 0)) throw new Error('Extensão inválida.')
      if (f.nome.trim().length < 3) throw new Error('Nome muito curto.')
      if (!f.codigo.trim()) throw new Error('Informe o código.')
      if (
        f.data_inicio_planejada &&
        f.data_fim_planejada &&
        f.data_fim_planejada < f.data_inicio_planejada
      )
        throw new Error('O término não pode ser antes do início.')
      const { error } = await supabase
        .from('obras')
        .update({
          nome: f.nome.trim(),
          codigo: f.codigo.trim(),
          status: f.status,
          rodovia: f.rodovia.trim() || null,
          trecho: f.trecho.trim() || null,
          extensao_km: ext,
          data_base_orcamento: f.data_base_orcamento || null,
          data_inicio_planejada: f.data_inicio_planejada || null,
          data_fim_planejada: f.data_fim_planejada || null
        })
        .eq('id', obra.id)
      if (error)
        throw new Error(
          /duplicate|unique/.test(error.message) ? 'Já existe obra com esse código.' : error.message
        )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gerencial'] })
      void qc.invalidateQueries({ queryKey: ['scope'] })
      toast.success('Dados da obra salvos.')
      onOpenChange(false)
    },
    onError: (e) => setErro(e.message)
  })

  const enviar = (e: FormEvent): void => {
    e.preventDefault()
    setErro(null)
    salvar.mutate()
  }

  const campo = (
    k: keyof typeof f,
    rotulo: string,
    extra: Partial<Parameters<typeof Input>[0]> = {}
  ): ReactNode => (
    <div>
      <Label htmlFor={`obra-${k}`}>{rotulo}</Label>
      <Input id={`obra-${k}`} value={f[k]} onChange={(e) => set(k)(e.target.value)} {...extra} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      <form onSubmit={enviar}>
        <DialogHeader>
          <DialogTitle>Dados da obra</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={erro} />
          <div className="grid grid-cols-3 gap-3">
            {campo('codigo', 'Código')}
            <div className="col-span-2">{campo('nome', 'Nome')}</div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {campo('rodovia', 'Rodovia', { placeholder: 'GO-010' })}
            {campo('trecho', 'Trecho', { placeholder: 'Entr. GO-437 / Entr. GO-010' })}
            {campo('extensao_km', 'Extensão (km)', {
              inputMode: 'decimal',
              className: 'text-right'
            })}
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label htmlFor="obra-status">Status</Label>
              <Select
                id="obra-status"
                value={f.status}
                onChange={(e) => set('status')(e.target.value)}
              >
                {STATUS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            {campo('data_base_orcamento', 'Data-base', { type: 'date' })}
            {campo('data_inicio_planejada', 'Início', { type: 'date' })}
            {campo('data_fim_planejada', 'Término', { type: 'date' })}
          </div>
          {obra.empresa_id ? (
            <VinculoFleetHub obraId={obra.id} empresaId={obra.empresa_id} />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={salvar.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
