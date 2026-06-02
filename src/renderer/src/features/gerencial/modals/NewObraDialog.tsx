import { useState, useEffect, type FormEvent, type ReactNode } from 'react'
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
import { useCreateObra, useEmpresas } from '../hooks'
import { useAuthStore } from '@/stores/auth-store'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STATUS_OPTS: Array<{ value: string; label: string }> = [
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'planejamento', label: 'Planejamento' },
  { value: 'paralisado', label: 'Paralisada' },
  { value: 'concluido', label: 'Concluída' }
]

const UNIDADE_OPTS: Array<{ value: 'km' | 'm' | 'estaca'; label: string }> = [
  { value: 'km', label: 'km (2+508,50)' },
  { value: 'm', label: 'm (2508,50)' },
  { value: 'estaca', label: 'estaca (EST 125+8,50)' }
]

export function NewObraDialog({ open, onOpenChange }: Props): ReactNode {
  const create = useCreateObra()
  const role = useAuthStore((s) => s.profile?.role)
  const callerEmpresaId = useAuthStore((s) => s.profile?.empresa_id ?? null)
  const { data: empresas = [] } = useEmpresas()

  const [nome, setNome] = useState('')
  const [codigo, setCodigo] = useState('')
  const [empresaId, setEmpresaId] = useState<string>('')
  const [status, setStatus] = useState('em_andamento')
  const [unidade, setUnidade] = useState<'km' | 'm' | 'estaca'>('km')
  const [error, setError] = useState<string | null>(null)

  // Adm/Eng não escolhem empresa — usa a do caller
  useEffect(() => {
    if (role !== 'god') setEmpresaId(callerEmpresaId ?? '')
  }, [role, callerEmpresaId])

  const reset = (): void => {
    setNome('')
    setCodigo('')
    setStatus('em_andamento')
    setUnidade('km')
    setError(null)
    if (role !== 'god') setEmpresaId(callerEmpresaId ?? '')
    else setEmpresaId('')
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      const body: Parameters<typeof create.mutateAsync>[0] = {
        nome: nome.trim(),
        codigo: codigo.trim(),
        status,
        unidade_espaco_padrao: unidade
      }
      if (role === 'god') {
        if (!empresaId) {
          setError('Selecione a empresa.')
          return
        }
        body.empresa_id = empresaId
      }
      const res = await create.mutateAsync(body)
      toast.success(`Obra ${res.codigo} criada.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar obra')
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
          <DialogTitle>Nova obra</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          {role === 'god' ? (
            <div>
              <Label htmlFor="obra-empresa">Empresa</Label>
              <Select
                id="obra-empresa"
                value={empresaId}
                onChange={(e) => setEmpresaId(e.target.value)}
                required
              >
                <option value="">Selecione…</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="obra-codigo">Código</Label>
              <Input
                id="obra-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                required
                placeholder="Ex.: OB-2026-001"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="obra-status">Status</Label>
              <Select id="obra-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="obra-nome">Nome da obra</Label>
            <Input
              id="obra-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              minLength={3}
              placeholder="Ex.: Duplicação BR-153, Lote 2"
            />
          </div>
          <div>
            <Label htmlFor="obra-unidade">Unidade do 1º trecho</Label>
            <Select
              id="obra-unidade"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value as 'km' | 'm' | 'estaca')}
            >
              {UNIDADE_OPTS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
            <div className="text-2xs text-text-dim mt-1 font-mono">
              Obra inicia com 1 trecho &ldquo;Principal&rdquo;. Adicione outros depois em Planejamento → Trechos.
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar obra'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
