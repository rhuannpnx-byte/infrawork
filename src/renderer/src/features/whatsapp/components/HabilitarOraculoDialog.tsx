import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Search, Check, AlertTriangle } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useUsuarios } from '@/features/gerencial/hooks'
import { useHabilitarOraculo } from '@/features/whatsapp/hooks'
import type { UsuarioComEmpresa } from '@/types/gerencial'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** user_ids já habilitados (filtrados da lista). */
  jaHabilitados: Set<string>
}

/** Modal para habilitar o Oráculo a N usuários. Usuário sem WhatsApp cadastrado
 *  é sinalizado (não dá para casar o remetente da DM). */
export function HabilitarOraculoDialog({ open, onOpenChange, jaHabilitados }: Props): ReactNode {
  const { data: usuarios = [] } = useUsuarios()
  const habilitar = useHabilitarOraculo()

  const [filtro, setFiltro] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // Candidatos = usuários ativos ainda não habilitados.
  const candidatos = useMemo(
    () => usuarios.filter((u) => u.ativo && !jaHabilitados.has(u.id)),
    [usuarios, jaHabilitados]
  )
  const filtrados = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return candidatos
    return candidatos.filter(
      (u) => u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  }, [candidatos, filtro])

  function reset(): void {
    setFiltro('')
    setSel(new Set())
    setError(null)
  }

  function toggle(id: string): void {
    setSel((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function confirmar(): Promise<void> {
    if (sel.size === 0) {
      setError('Selecione ao menos um usuário.')
      return
    }
    setError(null)
    const escolhidos = usuarios.filter((u) => sel.has(u.id))
    try {
      await habilitar.mutateAsync(
        escolhidos.map((u) => ({ user_id: u.id, empresa_id: u.empresa_id }))
      )
      const semWpp = escolhidos.filter((u) => !u.whatsapp).length
      toast.success(
        `Oráculo habilitado para ${escolhidos.length} usuário(s).` +
          (semWpp > 0 ? ` ${semWpp} sem WhatsApp cadastrado.` : '')
      )
      reset()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao habilitar')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
      size="lg"
      disableDismiss={habilitar.isPending}
    >
      <DialogHeader>
        <DialogTitle>Habilitar Oráculo</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <DialogErrorBanner message={error} />
        <p className="text-2xs text-text-dim">
          Escolha quem poderá conversar com o Oráculo no WhatsApp. O acesso aos dados respeita
          exatamente as permissões de cada usuário no sistema.
        </p>

        <div className="relative">
          <Search
            size={11}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
          />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por nome ou email…"
            className="pl-7"
          />
        </div>

        <div className="max-h-72 overflow-auto rounded border border-border bg-bg-panel divide-y divide-border/40">
          {filtrados.map((u: UsuarioComEmpresa) => {
            const marcado = sel.has(u.id)
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id)}
                className={cn(
                  'w-full text-left px-3 py-2 flex items-center gap-2 transition-colors hover:bg-bg-hover',
                  marcado && 'bg-accent/10'
                )}
              >
                <span
                  className={cn(
                    'flex items-center justify-center w-4 h-4 rounded border shrink-0',
                    marcado ? 'bg-accent border-accent text-white' : 'border-border'
                  )}
                >
                  {marcado ? <Check size={11} /> : null}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-xs text-text">{u.nome}</span>
                  <span className="block truncate text-2xs font-mono text-text-dim">
                    {u.email}
                  </span>
                </span>
                <Badge variant="default">{u.role}</Badge>
                {!u.whatsapp ? (
                  <span
                    className="inline-flex items-center gap-1 text-2xs text-warn"
                    title="Usuário sem WhatsApp cadastrado — não será reconhecido na DM"
                  >
                    <AlertTriangle size={11} /> sem WhatsApp
                  </span>
                ) : null}
              </button>
            )
          })}
          {filtrados.length === 0 ? (
            <div className="px-3 py-6 text-center text-2xs text-text-dim italic">
              {candidatos.length === 0
                ? 'Todos os usuários já estão habilitados.'
                : 'Nenhum usuário encontrado.'}
            </div>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
          disabled={habilitar.isPending}
        >
          Cancelar
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={confirmar}
          disabled={sel.size === 0 || habilitar.isPending}
        >
          {habilitar.isPending ? 'Habilitando…' : `Habilitar (${sel.size})`}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
