import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Link2, Copy } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/ui-store'

// Lista de usuários virá do backend quando o módulo de compartilhamento for ligado.
const usuarios: Array<{
  id: string
  nome: string
  email: string
  iniciais: string
  avatarColor: string
}> = []

type Permissao = 'visualizar' | 'comentar' | 'editar' | 'admin'
const LABELS: Record<Permissao, string> = {
  visualizar: 'Visualizar',
  comentar: 'Comentar',
  editar: 'Editar',
  admin: 'Administrar'
}

export function ShareDialog(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('share'))
  const close = (): void => useUIStore.getState().closeModal('share')
  const [linkAtivo, setLinkAtivo] = useState(false)
  const [email, setEmail] = useState('')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()} size="md">
      <DialogHeader>
        <DialogTitle>Compartilhar projeto</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Convidar por email…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1"
          />
          <Select defaultValue="editar" className="!w-[140px]">
            {(Object.keys(LABELS) as Permissao[]).map((p) => (
              <option key={p} value={p}>
                {LABELS[p]}
              </option>
            ))}
          </Select>
          <Button variant="default" size="default" disabled={!email}>
            Convidar
          </Button>
        </div>

        <div>
          <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-2">Pessoas com acesso</div>
          <div className="space-y-1">
            {usuarios.map((u) => (
              <div key={u.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-hover">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-bg uppercase shrink-0"
                  style={{ background: u.avatarColor }}
                >
                  {u.iniciais}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text truncate">{u.nome}</div>
                  <div className="text-2xs text-text-dim font-mono truncate">{u.email}</div>
                </div>
                <Select defaultValue={u.id === 'u-001' ? 'admin' : 'editar'} className="!w-[120px]">
                  {(Object.keys(LABELS) as Permissao[]).map((p) => (
                    <option key={p} value={p}>
                      {LABELS[p]}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-border bg-bg-elevated p-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              <Link2 size={12} className="text-text-muted" />
              <span className="text-xs text-text">Link com permissão de visualização</span>
            </div>
            <input
              type="checkbox"
              checked={linkAtivo}
              onChange={(e) => setLinkAtivo(e.target.checked)}
              className="accent-[var(--accent)]"
            />
          </label>
          {linkAtivo ? (
            <div className="mt-2 flex gap-1.5">
              <Input
                readOnly
                value="https://infrawork.tecpav.com.br/p/<obra>?token=…"
                className="font-mono text-2xs"
              />
              <Button
                variant="secondary"
                size="default"
                onClick={() => {
                  navigator.clipboard?.writeText('https://infrawork.tecpav.com.br/p/GO-060-L3?token=4f7e9c…')
                  toast.success('Link copiado!')
                }}
              >
                <Copy size={11} /> Copiar
              </Button>
            </div>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          Fechar
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
