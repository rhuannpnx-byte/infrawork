import { useState, useEffect, useMemo, type FormEvent, type ReactNode } from 'react'
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
import { useCreateUsuario, useEmpresas, useEngenheiros } from '../hooks'
import { maskWhatsappBR } from '@/lib/format'
import type { Role } from '@/types/auth'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Aplica a matriz de papéis:
 *   - God        → escolhe role, empresa e (se apoio) engenheiro
 *   - Adm        → role ∈ {adm, engenheiro, apoio, cliente}; empresa = caller.empresa
 *   - Engenheiro → role obrigatório = apoio; engenheiro_id = caller.id
 *   - Cliente    → empresa fixa, sem engenheiro; recebe obras via permissões
 */
function rolesAllowedFor(caller: Role | undefined): Role[] {
  if (caller === 'god') return ['god', 'adm', 'engenheiro', 'apoio', 'cliente']
  if (caller === 'adm') return ['adm', 'engenheiro', 'apoio', 'cliente']
  if (caller === 'engenheiro') return ['apoio']
  return []
}

const ROLE_LABEL: Record<Role, string> = {
  god: 'God',
  adm: 'Administrador',
  engenheiro: 'Engenheiro',
  apoio: 'Apoio',
  cliente: 'Cliente'
}

export function NewUsuarioDialog({ open, onOpenChange }: Props): ReactNode {
  const create = useCreateUsuario()
  const callerRole = useAuthStore((s) => s.profile?.role)
  const callerEmpresaId = useAuthStore((s) => s.profile?.empresa_id ?? null)
  const callerId = useAuthStore((s) => s.profile?.id ?? null)

  const allowedRoles = useMemo(() => rolesAllowedFor(callerRole), [callerRole])

  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')
  const [role, setRole] = useState<Role>(allowedRoles[0] ?? 'apoio')
  const [empresaId, setEmpresaId] = useState<string>('')
  const [engenheiroId, setEngenheiroId] = useState<string>('')
  const [whatsapp, setWhatsapp] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: empresas = [] } = useEmpresas()
  // Para Adm: lista engenheiros da própria empresa pra atribuir apoio.
  // Para God: lista engenheiros da empresa selecionada no form.
  const empresaParaEngenheiros = callerRole === 'god' ? empresaId : callerEmpresaId
  const { data: engenheirosEmpresa = [] } = useEngenheiros(empresaParaEngenheiros)

  // Quando o role muda fora do escopo, reseta engenheiro_id
  useEffect(() => {
    if (role !== 'apoio') setEngenheiroId('')
    if (callerRole === 'engenheiro' && role === 'apoio' && callerId) {
      setEngenheiroId(callerId)
    }
  }, [role, callerRole, callerId])

  // Adm/Eng não escolhe empresa
  useEffect(() => {
    if (callerRole !== 'god') setEmpresaId(callerEmpresaId ?? '')
  }, [callerRole, callerEmpresaId])

  const reset = (): void => {
    setEmail('')
    setNome('')
    setRole(allowedRoles[0] ?? 'apoio')
    setPassword('')
    setEngenheiroId('')
    setWhatsapp('')
    setError(null)
    if (callerRole !== 'god') setEmpresaId(callerEmpresaId ?? '')
    else setEmpresaId('')
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      const body: Parameters<typeof create.mutateAsync>[0] = {
        email: email.trim(),
        nome: nome.trim(),
        role
      }
      if (role !== 'god') {
        if (callerRole === 'god') {
          if (!empresaId) {
            setError('Selecione a empresa.')
            return
          }
          body.empresa_id = empresaId
        }
        // Adm/Eng: a Edge Function sobrescreve com a empresa do caller (defesa em profundidade)
      }
      if (role === 'apoio') {
        if (callerRole === 'engenheiro') {
          body.engenheiro_id = callerId
        } else {
          if (!engenheiroId) {
            setError('Selecione o engenheiro responsável pelo Apoio.')
            return
          }
          body.engenheiro_id = engenheiroId
        }
      }
      if (whatsapp.trim()) body.whatsapp = whatsapp.trim()
      if (password.trim()) body.password = password.trim()

      const res = await create.mutateAsync(body)
      toast.success(`Usuário ${res.email} criado (${ROLE_LABEL[res.role as Role]}).`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar usuário')
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
          <DialogTitle>Novo usuário</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="u-email">Email</Label>
              <Input
                id="u-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="u-nome">Nome</Label>
              <Input id="u-nome" value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="u-role">Papel</Label>
              <Select
                id="u-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={allowedRoles.length <= 1}
              >
                {allowedRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </div>
            {callerRole === 'god' && role !== 'god' ? (
              <div>
                <Label htmlFor="u-emp">Empresa</Label>
                <Select
                  id="u-emp"
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
          </div>

          {role === 'apoio' && callerRole !== 'engenheiro' ? (
            <div>
              <Label htmlFor="u-eng">Engenheiro responsável</Label>
              <Select
                id="u-eng"
                value={engenheiroId}
                onChange={(e) => setEngenheiroId(e.target.value)}
                required
                disabled={engenheirosEmpresa.length === 0}
              >
                <option value="">
                  {engenheirosEmpresa.length === 0 ? 'Nenhum engenheiro ativo nesta empresa' : 'Selecione…'}
                </option>
                {engenheirosEmpresa.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome} · {e.email}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div>
            <Label htmlFor="u-wpp">WhatsApp (opcional)</Label>
            <Input
              id="u-wpp"
              type="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(maskWhatsappBR(e.target.value))}
              placeholder="+55 (64) 99999-9999"
              inputMode="tel"
            />
            <div className="text-2xs text-text-dim font-mono mt-1">
              Com DDI e DDD. Usado para casar mensagens do WhatsApp ao usuário.
            </div>
          </div>

          <div>
            <Label htmlFor="u-pwd">Senha inicial (opcional)</Label>
            <Input
              id="u-pwd"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Em branco envia convite por email"
              minLength={10}
            />
            <div className="text-2xs text-text-dim font-mono mt-1">
              Se preenchida, a senha precisa ter ≥ 10 caracteres.
            </div>
          </div>

        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="default" disabled={create.isPending}>
            {create.isPending ? 'Criando…' : 'Criar usuário'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
