import { useState, useEffect, type FormEvent, type ReactNode } from 'react'
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
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useCreateObra, useEmpresas } from '../hooks'
import { useAuthStore } from '@/stores/auth-store'
import { STATUS_OBRA } from '../lib/status-obra'
import { falhaDoServidor } from '../lib/falha-servidor'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STATUS_OPTS = STATUS_OBRA

type CampoComErro = 'empresa' | 'codigo' | 'nome'

export function NewObraDialog({ open, onOpenChange }: Props): ReactNode {
  const create = useCreateObra()
  const role = useAuthStore((s) => s.profile?.role)
  const callerEmpresaId = useAuthStore((s) => s.profile?.empresa_id ?? null)
  const { data: empresas = [] } = useEmpresas()

  const [nome, setNome] = useState('')
  const [codigo, setCodigo] = useState('')
  const [empresaId, setEmpresaId] = useState<string>('')
  const [status, setStatus] = useState('em_andamento')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  // Adm/Eng não escolhem empresa — usa a do caller
  useEffect(() => {
    if (role !== 'god') setEmpresaId(callerEmpresaId ?? '')
  }, [role, callerEmpresaId])

  const reset = (): void => {
    setNome('')
    setCodigo('')
    setStatus('em_andamento')
    setError(null)
    setTentou(false)
    if (role !== 'god') setEmpresaId(callerEmpresaId ?? '')
    else setEmpresaId('')
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (role === 'god' && !empresaId) erros.empresa = 'Selecione a empresa.'
  if (!codigo.trim()) erros.codigo = 'Informe o código da obra.'
  if (nome.trim().length < 3) erros.nome = 'Informe o nome da obra, com pelo menos 3 letras.'
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
      const body: Parameters<typeof create.mutateAsync>[0] = {
        nome: nome.trim(),
        codigo: codigo.trim(),
        status
      }
      if (role === 'god') body.empresa_id = empresaId
      const res = await create.mutateAsync(body)
      toast.success(`Obra ${res.codigo} criada.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível criar a obra. ${falhaDoServidor(err, 'Já existe uma obra com esse código nesta empresa. Use outro código.')}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="sm" disableDismiss={create.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Nova obra</DialogTitle>
          <DialogDescription>
            Rodovia, trecho e datas ficam em Editar dados, na página da obra.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          {role === 'god' ? (
            <Campo rotulo="Empresa" obrigatorio erro={erro('empresa')}>
              <Select
                value={empresaId}
                onChange={(e) => setEmpresaId(e.target.value)}
                data-foco-inicial
              >
                <option value="">Selecione…</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Código" obrigatorio erro={erro('codigo')}>
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ex.: OB-2026-001"
                autoComplete="off"
                data-foco-inicial={role !== 'god' ? '' : undefined}
              />
            </Campo>
            <Campo rotulo="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Campo>
          </div>
          <Campo rotulo="Nome da obra" obrigatorio erro={erro('nome')}>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Duplicação BR-153, Lote 2"
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
            {create.isPending ? 'Criando…' : 'Criar obra'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
