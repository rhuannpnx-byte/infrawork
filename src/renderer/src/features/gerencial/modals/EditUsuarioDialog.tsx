import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
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
import { useAuthStore } from '@/stores/auth-store'
import { useUpdateUsuario, useEmpresas, useEngenheiros } from '../hooks'
import { maskWhatsappBR } from '@/lib/format'
import type { Role } from '@/types/auth'
import type { UsuarioComEmpresa } from '@/types/gerencial'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario: UsuarioComEmpresa | null
}

/** Papéis que o caller pode atribuir ao editar (God não é atribuível por Adm). */
function rolesEditableFor(caller: Role | undefined): Role[] {
  if (caller === 'god') return ['god', 'adm', 'engenheiro', 'apoio', 'cliente']
  if (caller === 'adm') return ['adm', 'engenheiro', 'apoio', 'cliente']
  return []
}

const ROLE_LABEL: Record<Role, string> = {
  god: 'God',
  adm: 'Administrador',
  engenheiro: 'Engenheiro',
  apoio: 'Apoio',
  cliente: 'Cliente'
}

export function EditUsuarioDialog({ open, onOpenChange, usuario }: Props): ReactNode {
  const update = useUpdateUsuario()
  const callerRole = useAuthStore((s) => s.profile?.role)
  const callerEmpresaId = useAuthStore((s) => s.profile?.empresa_id ?? null)

  const allowedRoles = useMemo(() => rolesEditableFor(callerRole), [callerRole])

  const [nome, setNome] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [role, setRole] = useState<Role>('apoio')
  const [empresaId, setEmpresaId] = useState<string>('')
  const [engenheiroId, setEngenheiroId] = useState<string>('')
  const [ativo, setAtivo] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: empresas = [] } = useEmpresas()
  const empresaParaEngenheiros = callerRole === 'god' ? empresaId : callerEmpresaId
  const { data: engenheirosEmpresa = [] } = useEngenheiros(empresaParaEngenheiros)

  // Pré-preenche quando abre / muda o alvo.
  useEffect(() => {
    if (!usuario) return
    setNome(usuario.nome)
    setWhatsapp(maskWhatsappBR(usuario.whatsapp ?? ''))
    setRole(usuario.role)
    setEmpresaId(usuario.empresa_id ?? '')
    setEngenheiroId(usuario.engenheiro_id ?? '')
    setAtivo(usuario.ativo)
    setError(null)
  }, [usuario])

  // Coerência papel → vínculos.
  useEffect(() => {
    if (role !== 'apoio') setEngenheiroId('')
    if (role === 'god') setEmpresaId('')
  }, [role])

  // Adm não escolhe empresa (fica na própria).
  useEffect(() => {
    if (callerRole !== 'god' && role !== 'god') setEmpresaId(callerEmpresaId ?? '')
  }, [callerRole, callerEmpresaId, role])

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!usuario) return
    try {
      const body: Parameters<typeof update.mutateAsync>[0] = {
        id: usuario.id,
        nome: nome.trim(),
        whatsapp: whatsapp.trim() ? whatsapp.trim() : null,
        role,
        ativo
      }
      if (role !== 'god') {
        if (callerRole === 'god') {
          if (!empresaId) {
            setError('Selecione a empresa.')
            return
          }
          body.empresa_id = empresaId
        }
        // Adm: a Edge Function trava na empresa do caller.
      }
      if (role === 'apoio') {
        if (!engenheiroId) {
          setError('Selecione o engenheiro responsável pelo Apoio.')
          return
        }
        body.engenheiro_id = engenheiroId
      }

      const res = await update.mutateAsync(body)
      toast.success(`Usuário ${res.email} atualizado.`)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar usuário')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={update.isPending}>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <div>
            <Label>Email</Label>
            <Input value={usuario?.email ?? ''} disabled readOnly />
            <div className="text-2xs text-text-dim font-mono mt-1">
              O email não pode ser alterado.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="e-nome">Nome</Label>
              <Input
                id="e-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                required
                minLength={2}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="e-wpp">WhatsApp</Label>
              <Input
                id="e-wpp"
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(maskWhatsappBR(e.target.value))}
                placeholder="+55 (64) 99999-9999"
                inputMode="tel"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="e-role">Papel</Label>
              <Select
                id="e-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={allowedRoles.length <= 1}
              >
                {/* mantém o papel atual visível mesmo se fora da lista atribuível */}
                {(allowedRoles.includes(role) ? allowedRoles : [role, ...allowedRoles]).map(
                  (r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  )
                )}
              </Select>
            </div>
            <div>
              <Label htmlFor="e-status">Status</Label>
              <Select
                id="e-status"
                value={ativo ? 'ativo' : 'inativo'}
                onChange={(e) => setAtivo(e.target.value === 'ativo')}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </Select>
            </div>
          </div>

          {callerRole === 'god' && role !== 'god' ? (
            <div>
              <Label htmlFor="e-emp">Empresa</Label>
              <Select
                id="e-emp"
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

          {role === 'apoio' ? (
            <div>
              <Label htmlFor="e-eng">Engenheiro responsável</Label>
              <Select
                id="e-eng"
                value={engenheiroId}
                onChange={(e) => setEngenheiroId(e.target.value)}
                required
                disabled={engenheirosEmpresa.length === 0}
              >
                <option value="">
                  {engenheirosEmpresa.length === 0
                    ? 'Nenhum engenheiro ativo nesta empresa'
                    : 'Selecione…'}
                </option>
                {engenheirosEmpresa.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome} · {e.email}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
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
