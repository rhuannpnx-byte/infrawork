import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Copy, RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogErrorBanner
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateUsuario } from '../hooks'
import type { UsuarioComEmpresa } from '@/types/gerencial'

/** Senha legível para ditar no canteiro: sem 0/O, 1/l/I. */
export function gerarSenha(n = 12): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const v = new Uint32Array(n)
  crypto.getRandomValues(v)
  return Array.from(v, (x) => abc[x % abc.length]).join('')
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario: UsuarioComEmpresa | null
}

/** Redefinição de senha pelo administrador (sem e-mail: quem redefine repassa a senha ao usuário). */
export function RedefinirSenhaDialog({ open, onOpenChange, usuario }: Props): ReactNode {
  const update = useUpdateUsuario()
  const [senha, setSenha] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tentou, setTentou] = useState(false)

  useEffect(() => {
    if (open) {
      setSenha(gerarSenha())
      setError(null)
      setTentou(false)
    }
  }, [open])

  const erroSenha =
    senha.trim().length < 10 ? 'A senha precisa ter pelo menos 10 caracteres.' : undefined
  const erroVisivel = tentou ? erroSenha : undefined

  const salvar = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!usuario) return
    setError(null)
    if (erroSenha) {
      setTentou(true)
      e.currentTarget.querySelector<HTMLElement>('#nova-senha')?.focus()
      return
    }
    try {
      await update.mutateAsync({ id: usuario.id, senha: senha.trim() })
      await navigator.clipboard?.writeText(senha.trim()).catch(() => undefined)
      toast.success(`Senha de ${usuario.nome} redefinida e copiada para a área de transferência.`)
      onOpenChange(false)
    } catch (err) {
      setError(
        `Não foi possível redefinir a senha. ${err instanceof Error ? err.message : 'Tente de novo.'}`
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" disableDismiss={update.isPending}>
      <form onSubmit={salvar} noValidate>
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>
            {usuario ? `${usuario.nome} · ${usuario.email}` : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <DialogErrorBanner message={error} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="nova-senha">
              Nova senha
              <span className="text-danger" aria-hidden>
                {' '}
                *
              </span>
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="nova-senha"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                aria-required
                aria-invalid={erroVisivel ? true : undefined}
                aria-describedby="nova-senha-apoio"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="shrink-0"
                onClick={() => setSenha(gerarSenha())}
                aria-label="Gerar outra senha"
                title="Gerar outra senha"
              >
                <RefreshCw size={13} />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="shrink-0"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(senha)
                    .then(() => toast.success('Senha copiada.'))
                    .catch(() => toast.error('Não foi possível copiar. Selecione a senha e copie.'))
                }
                aria-label="Copiar senha"
                title="Copiar senha"
              >
                <Copy size={13} />
              </Button>
            </div>
            {erroVisivel ? (
              <p id="nova-senha-apoio" role="alert" className="text-xs font-medium text-danger">
                {erroVisivel}
              </p>
            ) : (
              <p id="nova-senha-apoio" className="text-xs text-text-muted">
                Mínimo de 10 caracteres. Passe a senha ao usuário; a sessão atual dele continua até
                expirar.
              </p>
            )}
          </div>
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
            {update.isPending ? 'Salvando…' : 'Redefinir senha'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
