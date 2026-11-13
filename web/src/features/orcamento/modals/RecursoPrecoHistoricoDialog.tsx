import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EstadoConsulta } from '@/components/ui/estado'
import { useRecursoPrecos, useSetRecursoPrecoVigente } from '../hooks/recursos'
import { fmtBRL4 } from '@/lib/money'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { NewRecursoPrecoDialog } from './NewRecursoPrecoDialog'

/** Origem gravada pela importação da planilha; as demais são texto digitado pelo usuário. */
const rotuloOrigem = (origem: string | null): string =>
  origem === 'importacao_modelo' ? 'Importação da planilha' : (origem ?? '—')

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
  const consulta = useRecursoPrecos(open ? recursoId : null)
  const precos = consulta.data ?? []
  const setVigente = useSetRecursoPrecoVigente()
  const [openNew, setOpenNew] = useState(false)

  const marcarVigente = async (precoId: string): Promise<void> => {
    try {
      await setVigente.mutateAsync({ preco_id: precoId, recurso_id: recursoId })
      toast.success('Preço vigente atualizado.')
    } catch (err) {
      toast.error('Não foi possível trocar o preço vigente.', {
        description: err instanceof Error ? err.message : undefined
      })
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} size="lg">
        <DialogHeader>
          <DialogTitle>Histórico de preços</DialogTitle>
          <DialogDescription>{recursoNome}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <EstadoConsulta
            consulta={consulta}
            oQue="o histórico de preços"
            vazio={precos.length === 0}
            textoVazio="Este recurso ainda não tem preço. Use Novo preço para registrar o primeiro."
          >
            <p className="text-sm text-text-muted">
              Do mais recente ao mais antigo. Marque o preço que vale hoje para as composições.
              {setVigente.isPending ? (
                <span role="status" className="ml-2 text-text">
                  Salvando…
                </span>
              ) : null}
            </p>
            <div
              className="max-h-[55vh] overflow-auto rounded border border-border"
              role="region"
              aria-label="Preços registrados"
            >
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-elevated text-left text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                    <th className="w-28 px-2 py-1.5">Vigente</th>
                    <th className="px-2 py-1.5 text-right">Custo unitário</th>
                    <th className="px-2 py-1.5">Registrado em</th>
                    <th className="px-2 py-1.5">Vigência</th>
                    <th className="px-2 py-1.5">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {precos.map((p) => (
                    <tr
                      key={p.id}
                      className={cn(
                        'border-b border-border last:border-b-0',
                        p.is_vigente ? 'bg-accent-glow' : ''
                      )}
                    >
                      <td className="px-2 py-1.5">
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="radio"
                            name={`vigente-${recursoId}`}
                            checked={p.is_vigente}
                            onChange={() => void marcarVigente(p.id)}
                            disabled={setVigente.isPending}
                            aria-label={`Usar como vigente o preço de ${fmtBRL4(p.custo_unitario)}, de ${formatDate(p.vigencia_inicio)}`}
                            className="h-4 w-4 cursor-pointer accent-[color:var(--accent)]"
                          />
                          {p.is_vigente ? <Badge variant="success">Vigente</Badge> : null}
                        </label>
                      </td>
                      <td className="tabular px-2 py-1.5 text-right text-text">
                        {fmtBRL4(p.custo_unitario)}
                      </td>
                      <td className="tabular px-2 py-1.5 text-text-muted">
                        {formatDate(p.created_at)}
                      </td>
                      <td className="tabular px-2 py-1.5 text-text-muted">
                        {p.vigencia_fim
                          ? `${formatDate(p.vigencia_inicio)} a ${formatDate(p.vigencia_fim)}`
                          : `desde ${formatDate(p.vigencia_inicio)}`}
                      </td>
                      <td className="px-2 py-1.5 text-text-muted">{rotuloOrigem(p.origem)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </EstadoConsulta>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button type="button" onClick={() => setOpenNew(true)}>
            <Plus size={12} /> Novo preço
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
