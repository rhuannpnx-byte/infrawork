import { useEffect, useState, type ReactNode } from 'react'
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

  useEffect(() => {
    if (open) {
      setSenha(gerarSenha())
      setError(null)
    }
  }, [open])

  const salvar = async (): Promise<void> => {
    if (!usuario) return
    setError(null)
    if (senha.trim().length < 10) return setError('A senha precisa ter ao menos 10 caracteres.')
    try {
      await update.mutateAsync({ id: usuario.id, senha: senha.trim() })
      await navigator.clipboard?.writeText(senha.trim()).catch(() => undefined)
      toast.success(`Senha de ${usuario.nome} redefinida (copiada para a área de transferência).`)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao redefinir a senha')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <DialogHeader>
        <DialogTitle>Redefinir senha</DialogTitle>
        <DialogDescription>{usuario ? `${usuario.nome} · ${usuario.email}` : ''}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />
        <div>
          <Label htmlFor="nova-senha">Nova senha</Label>
          <div className="flex gap-1.5">
            <Input
              id="nova-senha"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setSenha(gerarSenha())}
              aria-label="Gerar outra senha"
              title="Gerar outra"
            >
              <RefreshCw size={13} />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => void navigator.clipboard?.writeText(senha)}
              aria-label="Copiar senha"
              title="Copiar"
            >
              <Copy size={13} />
            </Button>
          </div>
          <p className="mt-1 text-2xs text-text-muted">
            Mínimo de 10 caracteres. Passe a senha ao usuário; a sessão atual dele continua até
            expirar.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={update.isPending}>
          Cancelar
        </Button>
        <Button onClick={() => void salvar()} disabled={update.isPending}>
          {update.isPending ? 'Salvando…' : 'Redefinir'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
