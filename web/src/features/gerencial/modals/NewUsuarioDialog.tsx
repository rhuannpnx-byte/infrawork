import { useState, useEffect, useMemo, type FormEvent, type ReactNode } from 'react'
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
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useCreateUsuario, useEmpresas, useEngenheiros } from '../hooks'
import { maskWhatsappBR } from '@/lib/format'
import { gerarSenha } from './RedefinirSenhaDialog'
import { falhaDoServidor } from '../lib/falha-servidor'
import { ROTULO_PAPEL, rotuloPapel } from '@/lib/rotulos'
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
 *   - Apontador  → app de campo; empresa fixa, sem engenheiro; recebe obras via permissões
 */
function rolesAllowedFor(caller: Role | undefined): Role[] {
  if (caller === 'god') return ['god', 'adm', 'engenheiro', 'apoio', 'cliente', 'apontador']
  if (caller === 'adm') return ['adm', 'engenheiro', 'apoio', 'cliente', 'apontador']
  if (caller === 'engenheiro') return ['apoio', 'apontador']
  return []
}

/** O formulário abre no papel mais comum de cadastrar; administrador geral só por escolha explícita. */
const papelInicial = (permitidos: Role[]): Role =>
  permitidos.find((r) => r !== 'god') ?? permitidos[0] ?? 'apoio'

const ROLE_LABEL: Record<Role, string> = {
  ...ROTULO_PAPEL,
  apontador: 'Apontador (app de campo)'
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type CampoComErro = 'email' | 'nome' | 'empresa' | 'engenheiro' | 'senha'

export function NewUsuarioDialog({ open, onOpenChange }: Props): ReactNode {
  const create = useCreateUsuario()
  const callerRole = useAuthStore((s) => s.profile?.role)
  const callerEmpresaId = useAuthStore((s) => s.profile?.empresa_id ?? null)
  const callerId = useAuthStore((s) => s.profile?.id ?? null)

  const allowedRoles = useMemo(() => rolesAllowedFor(callerRole), [callerRole])

  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')
  const [role, setRole] = useState<Role>(papelInicial(allowedRoles))
  const [empresaId, setEmpresaId] = useState<string>('')
  const [engenheiroId, setEngenheiroId] = useState<string>('')
  const [whatsapp, setWhatsapp] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

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
    setRole(papelInicial(allowedRoles))
    setPassword('')
    setEngenheiroId('')
    setWhatsapp('')
    setError(null)
    setTentou(false)
    if (callerRole !== 'god') setEmpresaId(callerEmpresaId ?? '')
    else setEmpresaId('')
  }

  const escolheEmpresa = callerRole === 'god' && role !== 'god'
  const escolheEngenheiro = role === 'apoio' && callerRole !== 'engenheiro'

  const erros: Partial<Record<CampoComErro, string>> = {}
  if (!email.trim()) erros.email = 'Informe o e-mail.'
  else if (!EMAIL_VALIDO.test(email.trim()))
    erros.email = 'Digite um e-mail válido, como nome@empresa.com.br.'
  if (nome.trim().length < 2) erros.nome = 'Informe o nome do usuário.'
  if (escolheEmpresa && !empresaId) erros.empresa = 'Selecione a empresa.'
  if (escolheEngenheiro && !engenheiroId)
    erros.engenheiro =
      engenheirosEmpresa.length === 0
        ? 'Não há engenheiro ativo nesta empresa. Cadastre o engenheiro antes do apoio.'
        : 'Selecione o engenheiro responsável pelo apoio.'
  if (password.trim().length < 10)
    erros.senha = 'Defina a senha inicial com pelo menos 10 caracteres.'
  const erro = (c: CampoComErro): string | undefined => (tentou ? erros[c] : undefined)

  const onSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (Object.keys(erros).length > 0) {
      setTentou(true)
      const form = e.currentTarget
      requestAnimationFrame(() =>
        form.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus()
      )
      return
    }
    try {
      const body: Parameters<typeof create.mutateAsync>[0] = {
        email: email.trim(),
        nome: nome.trim(),
        role
      }
      // Adm/Eng: a Edge Function sobrescreve com a empresa do caller (defesa em profundidade)
      if (escolheEmpresa) body.empresa_id = empresaId
      if (role === 'apoio')
        body.engenheiro_id = callerRole === 'engenheiro' ? callerId : engenheiroId
      if (whatsapp.trim()) body.whatsapp = whatsapp.trim()
      body.password = password.trim()

      const res = await create.mutateAsync(body)
      toast.success(`Usuário ${res.email} criado como ${rotuloPapel(res.role)}.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível criar o usuário. ${falhaDoServidor(err, 'Já existe um usuário com esse e-mail.')}`
      )
    }
  }

  const aoMudar = (o: boolean): void => {
    if (!o) reset()
    onOpenChange(o)
  }

  return (
    <Dialog open={open} onOpenChange={aoMudar} size="md" disableDismiss={create.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>
            O usuário entra com o e-mail e a senha inicial, no web ou no app de campo.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="E-mail" obrigatorio erro={erro('email')}>
              <Input
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@empresa.com.br"
                data-foco-inicial
              />
            </Campo>
            <Campo rotulo="Nome" obrigatorio erro={erro('nome')}>
              <Input autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} />
            </Campo>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Papel" obrigatorio>
              <Select
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
            </Campo>
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
          </div>

          {escolheEngenheiro ? (
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

          <Campo rotulo="WhatsApp" dica="Opcional. Número de contato, com DDI e DDD.">
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={whatsapp}
              onChange={(e) => setWhatsapp(maskWhatsappBR(e.target.value))}
              placeholder="+55 (64) 99999-9999"
            />
          </Campo>

          <div className="flex flex-col gap-1">
            <Label htmlFor="u-pwd">
              Senha inicial
              <span className="text-danger" aria-hidden>
                {' '}
                *
              </span>
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="u-pwd"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-required
                aria-invalid={erro('senha') ? true : undefined}
                aria-describedby="u-pwd-apoio"
              />
              <Button type="button" variant="secondary" onClick={() => setPassword(gerarSenha())}>
                Gerar senha
              </Button>
            </div>
            {erro('senha') ? (
              <p id="u-pwd-apoio" role="alert" className="text-xs font-medium text-danger">
                {erro('senha')}
              </p>
            ) : (
              <p id="u-pwd-apoio" className="text-xs text-text-muted">
                Mínimo de 10 caracteres. Passe a senha ao usuário.
              </p>
            )}
          </div>
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
            {create.isPending ? 'Criando…' : 'Criar usuário'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
