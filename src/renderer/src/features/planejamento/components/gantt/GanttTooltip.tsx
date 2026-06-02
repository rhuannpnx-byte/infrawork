// GanttTooltip — tooltip flutuante ao passar mouse sobre uma barra/marco.
// position: fixed seguindo o cursor + offset. Mostra metadata essencial.

import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/money'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'
import { fmtDataBR } from '../../lib/dates'

interface GanttTooltipProps {
  node: PlanejamentoTarefaCompleta
  x: number
  y: number
}

export function GanttTooltip({ node, x, y }: GanttTooltipProps): ReactNode {
  const nome = node.nome_custom ?? node.servico_grupo_descricao ?? '(sem nome)'
  const codigo = node.codigo_eap ?? node.servico_grupo_codigo
  const equipes = node.equipes ?? []
  const tf = node.total_float
  const isCritico = node.is_critico

  // Clamp pra não sair do viewport
  const W = 260
  const left = Math.min(x + 14, window.innerWidth - W - 8)
  const top = Math.min(y + 14, window.innerHeight - 200)

  return createPortal(
    <div
      className={cn(
        'fixed z-50 pointer-events-none',
        'rounded-md bg-bg-elevated border border-border-strong shadow-lg',
        'px-3 py-2 text-2xs font-mono space-y-1'
      )}
      style={{ left, top, width: W }}
    >
      <div className="flex items-baseline gap-2 mb-1">
        {codigo && <span className="text-text-dim">{codigo}</span>}
        <span className="text-text font-semibold truncate flex-1">{nome}</span>
      </div>
      <Row label="Início" value={fmtDataBR(node.data_inicio)} />
      <Row label="Fim" value={fmtDataBR(node.data_fim)} />
      <Row
        label="Duração"
        value={node.duracao_dias_uteis_calc != null ? `${node.duracao_dias_uteis_calc}d` : '—'}
      />
      {node.tipo_no === 'tarefa' && node.quantidade_alocada != null && (
        <Row
          label="Qtd"
          value={`${node.quantidade_alocada} ${node.unidade_servico ?? ''}`}
        />
      )}
      {equipes.length > 0 && (
        <Row
          label={equipes.length === 1 ? 'Equipe' : `Equipes (${equipes.length})`}
          value={equipes.map((e) => e.nome).join(', ')}
        />
      )}
      {node.cpu_snapshot_id && (
        <Row label="CPU" value={node.servico_codigo ?? '—'} />
      )}
      {node.custo_total_tarefa > 0 && (
        <Row label="Custo" value={fmtBRL(node.custo_total_tarefa)} />
      )}
      {tf != null && (
        <Row
          label="Folga"
          value={
            isCritico ? (
              <span className="text-danger font-semibold">CRÍTICA</span>
            ) : (
              <span className="text-text-muted">{tf}d</span>
            )
          }
        />
      )}
    </div>,
    document.body
  )
}

function Row({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-text-dim text-2xs min-w-[52px]">{label}:</span>
      <span className="text-text-muted text-2xs flex-1 truncate">{value}</span>
    </div>
  )
}
