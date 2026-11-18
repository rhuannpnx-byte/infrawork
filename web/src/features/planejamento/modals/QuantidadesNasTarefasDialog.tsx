import { type ReactNode } from 'react'
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'
import { formatMarcadorCompacto } from '@/lib/format/posicao'
import { contar } from '@/lib/rotulos'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import type { ObraTrecho } from '@/types/gerencial'
import type { QuantidadeNaTarefa } from '../hooks/quantidades'
import { ctxObraTrecho } from '../lib/trecho'

const casas = (v: number): number => (Number.isInteger(v) ? 0 : 2)
const MAX_FAIXAS = 4

/**
 * Quantidades de um local sem grade, somadas das tarefas do plano. Só leitura: elas são editadas nas tarefas do
 * cronograma, onde foram informadas.
 */
export function QuantidadesNasTarefasDialog({
  open,
  onOpenChange,
  trecho,
  servicos,
  planoNome
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trecho: ObraTrecho
  servicos: QuantidadeNaTarefa[]
  planoNome: string
}): ReactNode {
  const ehEixo = trecho.tipo === 'eixo'
  const ctx = ctxObraTrecho(trecho)
  const pos = (m: number | null): string =>
    m == null ? '—' : formatMarcadorCompacto(m, ctx) || '—'

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl">
      <DialogHeader>
        <DialogTitle>Quantidades de {trecho.nome}</DialogTitle>
        <DialogDescription>
          {`Somadas das tarefas do plano "${planoNome}". Este local não tem grade de quantidades: elas foram informadas direto nas tarefas do cronograma.`}
        </DialogDescription>
      </DialogHeader>
      {/* com rolagem: precisa receber foco para rolar pelo teclado */}
      <DialogBody
        className="max-h-[60vh] overflow-auto p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        tabIndex={0}
        role="region"
        aria-label="Quantidades por serviço"
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-panel">
            <tr className="border-b border-border text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
              <th className="w-full px-4 py-2 text-left font-semibold">Serviço</th>
              {ehEixo ? <th className="px-2 py-2 text-left font-semibold">Faixas</th> : null}
              <th className="px-4 py-2 text-right font-semibold">Quantidade</th>
            </tr>
          </thead>
          <tbody>
            {servicos.map((s) => (
              <tr key={s.item_orcamentario_id} className="border-b border-border last:border-b-0">
                <td className="max-w-0 px-4 py-2 align-top">
                  <span className="flex min-w-0 gap-2">
                    <span className="shrink-0 tabular text-text-dim">{s.codigo}</span>
                    <span className="truncate text-text" title={s.descricao}>
                      {s.descricao}
                    </span>
                  </span>
                </td>
                {ehEixo ? (
                  <td className="whitespace-nowrap px-2 py-2 align-top text-xs text-text-muted tabular">
                    {s.faixas.slice(0, MAX_FAIXAS).map((f, i) => (
                      <span key={i} className="block">
                        {pos(f.inicio_m)} → {pos(f.fim_m)}
                        {f.tarefas > 1 ? ` (${f.tarefas} tarefas)` : ''}
                      </span>
                    ))}
                    {s.faixas.length > MAX_FAIXAS ? (
                      <span className="block">
                        e mais {contar(s.faixas.length - MAX_FAIXAS, 'faixa', 'faixas')}
                      </span>
                    ) : null}
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-4 py-2 text-right align-top tabular font-semibold text-text">
                  {formatNumber(s.total, casas(s.total))}{' '}
                  <span className="font-normal text-text-muted">{s.unidade ?? ''}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogBody>
      <DialogFooter className="justify-between">
        <span className="text-xs text-text-muted">
          {contar(servicos.length, 'serviço', 'serviços')}. Para mudar, edite as tarefas num plano
          em edição.
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false)
              navigateActiveTab('/planejamento/cronograma')
            }}
          >
            Abrir o cronograma
          </Button>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
