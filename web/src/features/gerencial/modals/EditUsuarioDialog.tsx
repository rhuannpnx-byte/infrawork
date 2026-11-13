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
import { Campo } from '@/components/ui/campo'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useUpdateUsuario, useEmpresas, useEngenheiros } from '../hooks'
import { maskWhatsappBR } from '@/lib/format'
import { ROTULO_PAPEL } from '@/lib/rotulos'
import type { Role } from '@/types/auth'
import type { UsuarioComEmpresa } from '@/types/gerencial'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario: UsuarioComEmpresa | null
}

/** Papéis que o caller pode atribuir ao editar (God não é atribuível por Adm). */
function rolesEditableFor(caller: Role | undefined): Role[] {
  if (caller === 'god') return ['god', 'adm', 'engenheiro', 'apoio', 'cliente', 'apontador']
  if (caller === 'adm') return ['adm', 'engenheiro', 'apoio', 'cliente', 'apontador']
  return []
}

const ROLE_LABEL: Record<Role, string> = {
  ...ROTULO_PAPEL,
  apontador: 'Apontador (app de campo)'
}

type CampoComErro = 'nome' | 'empresa' | 'engenheiro'

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
  const [tentou, setTentou] = useState(false)

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
    setTentou(false)
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

  const escolheEmpresa = callerRole === 'god' && role !== 'god'

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (nome.trim().length < 2) erros.nome = 'Informe o nome do usuário.'
  if (escolheEmpresa && !empresaId) erros.empresa = 'Selecione a empresa.'
  if (role === 'apoio' && !engenheiroId)
    erros.engenheiro =
      engenheirosEmpresa.length === 0
        ? 'Não há engenheiro ativo nesta empresa. Cadastre o engenheiro antes do apoio.'
        : 'Selecione o engenheiro responsável pelo apoio.'
  const erro = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (!usuario) return
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() =>
        form.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus()
      )
      return
    }
    try {
      const body: Parameters<typeof update.mutateAsync>[0] = {
        id: usuario.id,
        nome: nome.trim(),
        whatsapp: whatsapp.trim() ? whatsapp.trim() : null,
        role,
        ativo
      }
      // Adm: a Edge Function trava na empresa do caller.
      if (escolheEmpresa) body.empresa_id = empresaId
      if (role === 'apoio') body.engenheiro_id = engenheiroId

      const res = await update.mutateAsync(body)
      toast.success(`Usuário ${res.email} atualizado.`)
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível salvar o usuário. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" disableDismiss={update.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />

          <Campo rotulo="E-mail" dica="O e-mail não pode ser alterado.">
            <Input type="email" value={usuario?.email ?? ''} disabled readOnly />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Nome" obrigatorio erro={erro('nome')}>
              <Input
                autoComplete="off"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                autoFocus
              />
            </Campo>
            <Campo rotulo="WhatsApp" dica="Opcional. Com DDI e DDD.">
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={whatsapp}
                onChange={(e) => setWhatsapp(maskWhatsappBR(e.target.value))}
                placeholder="+55 (64) 99999-9999"
              />
            </Campo>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Papel" obrigatorio>
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={allowedRoles.length <= 1}
              >
                {/* mantém o papel atual visível mesmo se fora da lista atribuível */}
                {(allowedRoles.includes(role) ? allowedRoles : [role, ...allowedRoles]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Situação" dica="Usuário inativo não consegue entrar.">
              <Select
                value={ativo ? 'ativo' : 'inativo'}
                onChange={(e) => setAtivo(e.target.value === 'ativo')}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </Select>
            </Campo>
          </div>

          {escolheEmpresa ? (
            <Campo rotulo="Empresa" obrigatorio erro={erro('empresa')}>
              <Select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                <option value="">Selecione…</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : null}

          {role === 'apoio' ? (
            <Campo
              rotulo="Engenheiro responsável"
              obrigatorio
              dica="O apoio herda o acesso às obras deste engenheiro."
              erro={erro('engenheiro')}
            >
              <Select
                value={engenheiroId}
                onChange={(e) => setEngenheiroId(e.target.value)}
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
            </Campo>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
