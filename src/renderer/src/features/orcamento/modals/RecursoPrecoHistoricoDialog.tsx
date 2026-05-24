import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Dialog, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useRecursoPrecos } from '../hooks/recursos'
import { fmtBRL4 } from '@/lib/money'
import { formatDate } from '@/lib/format'
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
  const [openNew, setOpenNew] = useState(false)

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
            <table className="w-full text-xs font-mono">
              <thead className="text-2xs text-text-dim uppercase">
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-1.5">Custo unitário</th>
                  <th className="text-left px-2 py-1.5">Vigência início</th>
                  <th className="text-left px-2 py-1.5">Vigência fim</th>
                  <th className="text-left px-2 py-1.5">Origem</th>
                </tr>
              </thead>
              <tbody>
                {precos.map((p) => (
                  <tr key={p.id} className="border-b border-border/60">
                    <td className="px-2 py-1.5 text-text">{fmtBRL4(p.custo_unitario)}</td>
                    <td className="px-2 py-1.5 text-text-muted">{formatDate(p.vigencia_inicio)}</td>
                    <td className="px-2 py-1.5 text-text-muted">
                      {p.vigencia_fim ? formatDate(p.vigencia_fim) : 'vigente'}
                    </td>
                    <td className="px-2 py-1.5 text-text-dim">{p.origem ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
