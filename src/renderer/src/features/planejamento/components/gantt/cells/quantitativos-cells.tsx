// Cells do grupo "Quantitativos": QtdAlocadaCell, UnidadeCell, ProdDiaCell.
//
// QtdAlocadaCell tem 2 modos:
//   * Manual: InlineCell número formato pt-BR.
//   * Vinculado (qtd_link setado): read-only com badge 🔗 + valor calculado
//     via computeLinkedQtd no template do trecho. Botão pequeno abre popover
//     QtdLinkPopover pra trocar/desvincular.

import { useRef, type ReactNode } from 'react'
import { Link as LinkIcon, Unlink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InlineCell } from '@/components/InlineCell'
import { fmtQtd } from '@/lib/money'
import type { CellProps } from './types'

// ─── QtdAlocadaCell ────────────────────────────────────────────────────────
interface QtdAlocadaCellProps extends CellProps {
  /** Valor calculado via computeLinkedQtd quando qtd_link está setado. NULL
   *  se tarefa não tem qtd_link OU template/posição faltando. Quando NULL e
   *  qtd_link setado, mostra "—" + badge alerta. */
  qtdLinkValue: number | null
}
export function QtdAlocadaCell({ node, ctx, qtdLinkValue }: QtdAlocadaCellProps): ReactNode {
  const btnRef = useRef<HTMLButtonElement>(null)
  if (node.tipo_no !== 'tarefa') {
    return <Dash />
  }

  const isLinked = !!node.qtd_link
  const valor = isLinked ? qtdLinkValue : node.quantidade_alocada

  const onAbrir = (): void => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) ctx.abrirQtdLink(node.id, rect)
  }

  // Modo vinculado: read-only + chip
  if (isLinked) {
    return (
      <div className="flex items-center justify-end gap-1 h-full px-1">
        <span className="text-2xs font-mono tabular-nums text-text-muted">
          {valor != null ? fmtQtd(valor) : '—'}
        </span>
        {ctx.readOnly ? (
          <LinkIcon size={9} className="text-accent shrink-0" />
        ) : (
          <button
            ref={btnRef}
            type="button"
            onClick={onAbrir}
            className="inline-flex items-center justify-center h-4 w-4 rounded text-accent hover:bg-accent/10"
            title={`Vinculado a "${node.qtd_link}". Clique para mudar/desvincular.`}
          >
            <LinkIcon size={9} />
          </button>
        )}
      </div>
    )
  }

  // Modo manual: InlineCell + botão 🔗 ao lado pra vincular
  return (
    <div className="flex items-center gap-0.5 h-full w-full">
      <div className="flex-1 min-w-0">
        <InlineCell
          value={node.quantidade_alocada != null ? String(node.quantidade_alocada) : ''}
          placeholder="—"
          qtd
          align="right"
          disabled={ctx.readOnly}
          onCommit={async (v) => {
            const n = v.trim() === '' ? null : Number(v)
            await ctx.commitQuantidade(node.id, Number.isFinite(n as number) ? (n as number) : null)
          }}
        />
      </div>
      {!ctx.readOnly && (
        <button
          ref={btnRef}
          type="button"
          onClick={onAbrir}
          className={cn(
            'inline-flex items-center justify-center h-4 w-4 rounded shrink-0',
            'text-text-faint hover:text-accent hover:bg-accent/10'
          )}
          title="Vincular a métrica do trecho"
        >
          <LinkIcon size={9} />
        </button>
      )}
    </div>
  )
}

// ─── UnidadeCell ───────────────────────────────────────────────────────────
// Read-only — vem do servico (unidade_servico) ou da producao_diaria_unidade.
export function UnidadeCell({ node }: CellProps): ReactNode {
  if (node.tipo_no !== 'tarefa') {
    return <Dash />
  }
  const un = node.unidade_servico ?? node.producao_diaria_unidade ?? '—'
  return (
    <div className="flex items-center justify-center h-full text-2xs font-mono text-text-muted">
      {un}
    </div>
  )
}

// ─── ProdDiaCell ───────────────────────────────────────────────────────────
export function ProdDiaCell({ node, ctx }: CellProps): ReactNode {
  if (node.tipo_no !== 'tarefa') {
    return <Dash />
  }
  // Indiretas: produção/dia derivada = quantidade_alocada / duração. Não é
  // editável (não tem CPU). Apresentada como read-only italic pra distinguir.
  if (node.is_indireto) {
    const qtd = Number(node.quantidade_alocada ?? 0)
    const dur = Number(node.duracao_dias_uteis_calc ?? 0)
    const prod = dur > 0 ? qtd / dur : 0
    return (
      <div className="flex items-center justify-end h-full px-1 text-2xs font-mono tabular-nums text-text-dim italic">
        {prod > 0 ? `${fmtQtd(prod)}/dia` : '—'}
      </div>
    )
  }
  if (ctx.readOnly) {
    return (
      <div className="flex items-center justify-end h-full px-1 text-2xs font-mono tabular-nums text-text-muted">
        {node.producao_diaria_qtde != null ? `${fmtQtd(node.producao_diaria_qtde)}/dia` : '—'}
      </div>
    )
  }
  return (
    <InlineCell
      value={node.producao_diaria_qtde != null ? String(node.producao_diaria_qtde) : ''}
      placeholder="—"
      qtd
      align="right"
      onCommit={async (v) => {
        const n = v.trim() === '' ? null : Number(v)
        await ctx.commitProducao(node.id, Number.isFinite(n as number) ? (n as number) : null)
      }}
    />
  )
}

function Dash(): ReactNode {
  return (
    <div className="flex items-center justify-center h-full text-text-faint text-xs">—</div>
  )
}

// Pra LinkIcon não fica unused se não importado em outro lugar
void Unlink
