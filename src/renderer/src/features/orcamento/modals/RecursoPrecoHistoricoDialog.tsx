import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useRecursoPrecos, useSetRecursoPrecoVigente } from '../hooks/recursos'
import { fmtBRL4 } from '@/lib/money'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { NewRecursoPrecoDialog } from './NewRecursoPrecoDialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  recursoId: string
  recursoNome: string
}

export function RecursoPrecoHistoricoDialog({
  open,
  onOpenChange,
  recursoId,
  recursoNome
}: Props): ReactNode {
  const { data: precos = [], isLoading } = useRecursoPrecos(open ? recursoId : null)
  const setVigente = useSetRecursoPrecoVigente()
  const [openNew, setOpenNew] = useState(false)

  const marcarVigente = async (precoId: string): Promise<void> => {
    try {
      await setVigente.mutateAsync({ preco_id: precoId, recurso_id: recursoId })
      toast.success('Preço vigente atualizado.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao marcar vigente')
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} size="lg">
        <DialogHeader>
          <DialogTitle>Histórico de preços — {recursoNome}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {isLoading ? (
            <div className="text-xs text-text-muted font-mono p-3">Carregando…</div>
          ) : precos.length === 0 ? (
            <div className="text-xs text-text-muted font-mono p-3">Nenhum preço registrado.</div>
          ) : (
            <>
              <div className="text-2xs text-text-dim font-mono">
                Histórico em ordem de inserção. Marque qual preço está vigente.
              </div>
              <table className="w-full text-xs font-mono">
                <thead className="text-2xs text-text-dim uppercase">
                  <tr className="border-b border-border">
                    <th className="text-left px-2 py-1.5 w-20">Vigente</th>
                    <th className="text-left px-2 py-1.5">Custo unitário</th>
                    <th className="text-left px-2 py-1.5">Inserido em</th>
                    <th className="text-left px-2 py-1.5">Vigência</th>
                    <th className="text-left px-2 py-1.5">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {precos.map((p) => (
                    <tr
                      key={p.id}
                      className={cn(
                        'border-b border-border/60',
                        p.is_vigente ? 'bg-accent-glow' : ''
                      )}
                    >
                      <td className="px-2 py-1.5">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`vigente-${recursoId}`}
                            checked={p.is_vigente}
                            onChange={() => void marcarVigente(p.id)}
                            disabled={setVigente.isPending}
                            className="accent-[color:var(--accent)] cursor-pointer"
                          />
                          {p.is_vigente ? <Badge variant="success">vigente</Badge> : null}
                        </label>
                      </td>
                      <td className="px-2 py-1.5 text-text">{fmtBRL4(p.custo_unitario)}</td>
                      <td className="px-2 py-1.5 text-text-muted">{formatDate(p.created_at)}</td>
                      <td className="px-2 py-1.5 text-text-muted">
                        {formatDate(p.vigencia_inicio)}
                        {p.vigencia_fim ? ` – ${formatDate(p.vigencia_fim)}` : ''}
                      </td>
                      <td className="px-2 py-1.5 text-text-dim">{p.origem ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpenNew(true)}>
            <Plus size={11} /> Novo preço
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </Dialog>
      <NewRecursoPrecoDialog
        open={openNew}
        onOpenChange={setOpenNew}
        recursoId={recursoId}
        recursoNome={recursoNome}
      />
    </>
  )
}
