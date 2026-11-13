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
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { supabase } from '@/lib/supabase/client'
import type { ObraComEmpresa } from '@/types/gerencial'
import { VinculoFleetHub } from '../components/VinculoFleetHub'
import { STATUS_OBRA } from '../lib/status-obra'

const STATUS = STATUS_OBRA

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
  type Chave = keyof typeof f
  const [erroServidor, setErroServidor] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)
  const set =
    (k: Chave) =>
    (v: string): void =>
      setF((x) => ({ ...x, [k]: v }))

  const ext = f.extensao_km.trim()
    ? Number(f.extensao_km.replace(/\./g, '').replace(',', '.'))
    : null

  const erros: Partial<Record<Chave, string>> = {}
  if (!f.codigo.trim()) erros.codigo = 'Informe o código da obra.'
  if (f.nome.trim().length < 3) erros.nome = 'Informe o nome da obra, com pelo menos 3 letras.'
  if (ext !== null && !(ext >= 0)) erros.extensao_km = 'Digite a extensão em km, como 12,5.'
  if (
    f.data_inicio_planejada &&
    f.data_fim_planejada &&
    f.data_fim_planejada < f.data_inicio_planejada
  )
    erros.data_fim_planejada = 'O término não pode ser antes do início.'
  const erro = (k: Chave): string | undefined => (tentou ? erros[k] : undefined)

  const salvar = useMutation({
    mutationFn: async () => {
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
          /duplicate|unique/.test(error.message)
            ? 'Já existe uma obra com esse código. Use outro código.'
            : `Não foi possível salvar os dados da obra. ${error.message}`
        )
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gerencial'] })
      void qc.invalidateQueries({ queryKey: ['scope'] })
      toast.success('Dados da obra salvos.')
      onOpenChange(false)
    },
    onError: (e) => setErroServidor(e.message)
  })

  const enviar = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    setErroServidor(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    salvar.mutate()
  }

  const campo = (
    k: Chave,
    rotulo: string,
    extra: Partial<Parameters<typeof Input>[0]> = {},
    opcoes: { obrigatorio?: boolean; dica?: string; className?: string } = {}
  ): ReactNode => (
    <Campo
      rotulo={rotulo}
      obrigatorio={opcoes.obrigatorio}
      dica={opcoes.dica}
      erro={erro(k)}
      className={opcoes.className}
    >
      <Input value={f[k]} onChange={(e) => set(k)(e.target.value)} autoComplete="off" {...extra} />
    </Campo>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" disableDismiss={salvar.isPending}>
      <form onSubmit={enviar} noValidate>
        <DialogHeader>
          <DialogTitle>Editar obra</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={erroServidor} />
          <div className="grid grid-cols-3 gap-3">
            {campo('codigo', 'Código', { autoFocus: true }, { obrigatorio: true })}
            {campo('nome', 'Nome', {}, { obrigatorio: true, className: 'col-span-2' })}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {campo('rodovia', 'Rodovia', { placeholder: 'Ex.: GO-010' })}
            {campo('trecho', 'Trecho', { placeholder: 'Ex.: Entr. GO-437 / Entr. GO-010' })}
            {campo('extensao_km', 'Extensão (km)', {
              inputMode: 'decimal',
              placeholder: 'Ex.: 12,5',
              className: 'text-right tabular'
            })}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Campo rotulo="Status">
              <Select value={f.status} onChange={(e) => set('status')(e.target.value)}>
                {STATUS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Campo>
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
            variant="secondary"
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
