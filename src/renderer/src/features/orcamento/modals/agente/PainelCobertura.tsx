// Painel esquerdo do workbench — mapa de cobertura. No topo, o quanto do VALOR
// do orçamento já está agrupado (R$ e %). Cada serviço-folha vira uma barra que
// enche de azul em função do VALOR de venda que ele agrupa ÷ valor total da obra
// (ignorando índices/etapas). Clicar num serviço destaca, no painel central, as
// receitas que ele agrupa.

import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/money'
import type { Servico } from '@/types/orcamento'
import type { GrupoVM } from './agente-shared'

interface Props {
  servicosFolha: Servico[]
  grupos: GrupoVM[]
  totalReceitas: number
  vendaPorReceita: Map<string, number>
  totalVenda: number
  servicoSelecionadoId: string | null
  onSelecionar: (servicoId: string | null) => void
}

interface LinhaServico {
  servico: Servico
  qtdReceitas: number
  venda: number
  pct: number
}

export function PainelCobertura({
  servicosFolha,
  grupos,
  totalReceitas,
  vendaPorReceita,
  totalVenda,
  servicoSelecionadoId,
  onSelecionar
}: Props): ReactNode {
  const [busca, setBusca] = useState('')

  // Receitas (qtd + valor) agrupadas por serviço no rascunho vivo (inclui aplicados).
  const porServico = useMemo(() => {
    const m = new Map<string, { qtd: number; venda: number }>()
    for (const g of grupos) {
      const acc = m.get(g.servico_id) ?? { qtd: 0, venda: 0 }
      acc.qtd += g.receitas.length
      for (const r of g.receitas) acc.venda += vendaPorReceita.get(r.id) ?? 0
      m.set(g.servico_id, acc)
    }
    return m
  }, [grupos, vendaPorReceita])

  const linhas = useMemo<LinhaServico[]>(() => {
    const q = busca.trim().toLowerCase()
    const base = servicosFolha
      .filter((s) => !q || s.nome.toLowerCase().includes(q) || s.codigo.toLowerCase().includes(q))
      .map((s) => {
        const ag = porServico.get(s.id) ?? { qtd: 0, venda: 0 }
        // Barra em função do VALOR do orçamento que o serviço cobre.
        const pct = totalVenda > 0 ? (ag.venda / totalVenda) * 100 : 0
        return { servico: s, qtdReceitas: ag.qtd, venda: ag.venda, pct }
      })
    // Serviços com mais valor agrupado primeiro, depois por código.
    base.sort((a, b) => {
      if (b.venda !== a.venda) return b.venda - a.venda
      return a.servico.codigo.localeCompare(b.servico.codigo)
    })
    return base
  }, [servicosFolha, porServico, totalVenda, busca])

  const totalAgrupadas = useMemo(
    () => grupos.reduce((acc, g) => acc + g.receitas.length, 0),
    [grupos]
  )
  const vendaAgrupada = useMemo(() => {
    let t = 0
    for (const g of grupos) for (const r of g.receitas) t += vendaPorReceita.get(r.id) ?? 0
    return t
  }, [grupos, vendaPorReceita])
  const pctValor = totalVenda > 0 ? Math.round((vendaAgrupada / totalVenda) * 100) : 0
  const vendaOmissa = Math.max(0, totalVenda - vendaAgrupada)
  const itensOmissos = Math.max(0, totalReceitas - totalAgrupadas)

  return (
    <div className="h-full flex flex-col bg-bg-rail">
      <div className="px-3 py-2 border-b border-border shrink-0 space-y-2">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xs font-mono text-text-dim uppercase tracking-wide">
              Cobertura do orçamento
            </span>
            <span className="text-sm font-semibold text-accent">{pctValor}%</span>
          </div>
          {/* Barra global de valor agrupado */}
          <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min(100, pctValor)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-2xs font-mono">
            <span className="text-text-muted">{fmtBRL(vendaAgrupada)} agrupado</span>
            <span className="text-warn">{fmtBRL(vendaOmissa)} omisso</span>
          </div>
          <div className="flex items-center justify-between text-2xs font-mono text-text-dim">
            <span>{totalAgrupadas} itens agrupados</span>
            <span>{itensOmissos} omissos</span>
          </div>
        </div>
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar serviço…"
            className="pl-7"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-1.5 space-y-0.5">
        {linhas.map(({ servico, qtdReceitas, venda, pct }) => {
          const selecionado = servico.id === servicoSelecionadoId
          const vazio = qtdReceitas === 0
          return (
            <button
              key={servico.id}
              type="button"
              onClick={() => onSelecionar(selecionado ? null : servico.id)}
              title={`${servico.codigo} · ${servico.nome} — ${qtdReceitas} receita(s) · ${fmtBRL(venda)}`}
              className={cn(
                'w-full text-left rounded px-2 py-1.5 transition-colors group',
                selecionado ? 'bg-accent-glow ring-1 ring-accent-line' : 'hover:bg-bg-hover'
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-2xs font-mono text-text-dim shrink-0">{servico.codigo}</span>
                <span
                  className={cn('text-xs truncate flex-1', vazio ? 'text-text-dim' : 'text-text')}
                >
                  {servico.nome}
                </span>
                <span
                  className={cn(
                    'text-2xs font-mono shrink-0',
                    vazio ? 'text-text-faint' : 'text-text-muted'
                  )}
                >
                  {qtdReceitas}
                </span>
              </div>
              {/* Barra de cobertura (valor) + valor agrupado */}
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(pct > 0 ? 2 : 0, pct))}%`,
                      backgroundColor: selecionado ? 'var(--accent-hover)' : 'var(--accent)'
                    }}
                  />
                </div>
                <span
                  className={cn(
                    'text-2xs font-mono shrink-0 tabular-nums',
                    vazio ? 'text-text-faint' : 'text-text-dim'
                  )}
                >
                  {vazio ? '—' : fmtBRL(venda)}
                </span>
              </div>
            </button>
          )
        })}
        {linhas.length === 0 ? (
          <div className="text-2xs text-text-dim italic px-2 py-3 text-center">
            Nenhum serviço encontrado.
          </div>
        ) : null}
      </div>
    </div>
  )
}
