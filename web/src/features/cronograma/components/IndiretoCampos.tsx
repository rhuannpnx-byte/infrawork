/** Parâmetros da tarefa de indireto (como a aba Indireto do desktop): periodicidade do custo, receita, folgas e taxas. */
import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useTaxas } from '@/features/orcamento/hooks/taxas'
import { cn } from '@/lib/utils'
import { Caixa, Campo, Secao } from './campos'
import type { FormIndireto } from './indireto-form'

const ROTULO_PERIODO = { dia: 'dia útil', mes: 'mês', ano: 'ano' } as const

export function IndiretoCampos({
  valor,
  onMudar,
  obraId,
  ro = false,
  custoPeriodo
}: {
  valor: FormIndireto
  onMudar: (f: FormIndireto) => void
  obraId: string | null
  ro?: boolean
  /** custo orçado por período, para a dica (tarefa já criada) */
  custoPeriodo?: string
}): ReactNode {
  const { data: regimes = [] } = useTaxas(obraId)
  const set = (p: Partial<FormIndireto>): void => onMudar({ ...valor, ...p })
  const per = ROTULO_PERIODO[valor.periodicidade]
  return (
    <div className="space-y-4">
      <Secao titulo="Custo">
        <div className="grid grid-cols-[220px_1fr] items-end gap-3">
          <Campo rotulo="Periodicidade do custo orçado">
            <Select
              value={valor.periodicidade}
              disabled={ro}
              onChange={(e) =>
                set({ periodicidade: e.target.value as FormIndireto['periodicidade'] })
              }
            >
              <option value="dia">Dia útil</option>
              <option value="mes">Mês</option>
              <option value="ano">Ano</option>
            </Select>
          </Campo>
          <p className="pb-2 text-2xs text-text-dim">
            Custo total = {custoPeriodo ? `${custoPeriodo} por ${per}` : `valor orçado por ${per}`}{' '}
            × nº de {per === 'mês' ? 'meses' : per === 'ano' ? 'anos' : 'dias úteis'} cobertos pelo
            cronograma.
          </p>
        </div>
      </Secao>

      <Secao titulo="Receita">
        <div className="space-y-2">
          <Opcao
            marcado={valor.receitaModo === 'mesma_logica_custo'}
            ro={ro}
            onClick={() => set({ receitaModo: 'mesma_logica_custo' })}
          >
            Mesma lógica do custo (R$ por {per})
          </Opcao>
          <Opcao
            marcado={valor.receitaModo === 'percentual_dos_servicos'}
            ro={ro}
            onClick={() => set({ receitaModo: 'percentual_dos_servicos' })}
          >
            Percentual do faturamento dos serviços diretos no período
          </Opcao>
          {valor.receitaModo === 'percentual_dos_servicos' ? (
            <div className="flex items-center gap-2 pl-6">
              <Input
                value={valor.receitaPct}
                disabled={ro}
                inputMode="decimal"
                aria-label="Percentual sobre o faturamento dos diretos"
                onChange={(e) => set({ receitaPct: e.target.value })}
                className="h-7 w-24 text-right font-mono text-xs"
              />
              <span className="text-xs text-text-muted">% sobre o faturamento dos diretos</span>
            </div>
          ) : null}
          <Caixa marcado={valor.extrapola} desabilitado={ro} onMudar={(v) => set({ extrapola: v })}>
            Receita acompanha o período integral (desmarcado: limitada ao valor orçado do item)
          </Caixa>
        </div>
      </Secao>

      <Secao titulo="Janela">
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Começa antes das diretas (dias úteis)">
            <Input
              value={valor.antes}
              disabled={ro}
              inputMode="numeric"
              onChange={(e) => set({ antes: e.target.value })}
              className="font-mono"
            />
          </Campo>
          <Campo rotulo="Termina depois das diretas (dias úteis)">
            <Input
              value={valor.depois}
              disabled={ro}
              inputMode="numeric"
              onChange={(e) => set({ depois: e.target.value })}
              className="font-mono"
            />
          </Campo>
        </div>
        <p className="text-2xs text-text-dim">
          A tarefa cobre do início da primeira tarefa direta ao fim da última, mais estas folgas.
        </p>
      </Secao>

      <Secao titulo="Taxas">
        <Caixa
          marcado={valor.aplicaTaxas}
          desabilitado={ro}
          onMudar={(v) => set({ aplicaTaxas: v, regimeId: v ? valor.regimeId : '' })}
        >
          Aplicar taxas (regime) sobre o faturamento como custo
        </Caixa>
        {valor.aplicaTaxas ? (
          <Campo rotulo="Regime de taxas" className="max-w-sm">
            <Select
              value={valor.regimeId}
              disabled={ro}
              onChange={(e) => set({ regimeId: e.target.value })}
            >
              <option value="">— escolher —</option>
              {regimes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nome} ({(Number(r.total_perc_calc) * 100).toFixed(2).replace('.', ',')} %)
                </option>
              ))}
            </Select>
          </Campo>
        ) : null}
      </Secao>
    </div>
  )
}

function Opcao({
  marcado,
  ro,
  onClick,
  children
}: {
  marcado: boolean
  ro: boolean
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <label className={cn('flex items-center gap-2 text-xs text-text', ro && 'opacity-60')}>
      <input
        type="radio"
        checked={marcado}
        disabled={ro}
        onChange={onClick}
        className="accent-[var(--accent)]"
      />
      {children}
    </label>
  )
}
