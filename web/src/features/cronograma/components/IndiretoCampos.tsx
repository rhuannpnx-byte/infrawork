/**
 * Parâmetros da tarefa de indireto: a distribuição (contínuo, como a aba Indireto do desktop; pontual; parcelado),
 * e, no contínuo, periodicidade do custo, receita e folgas; taxas em todos.
 */
import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { Segmentado } from '@/components/ui/segmentado'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useTaxas } from '@/features/orcamento/hooks/taxas'
import { cn } from '@/lib/utils'
import { Caixa, Campo, Secao } from './campos'
import { PARCELAS_PADRAO, type FormIndireto, type ParcelaForm } from './indireto-form'

const ROTULO_PERIODO = { dia: 'dia útil', mes: 'mês', ano: 'ano' } as const

/** "12,5" → 12.5 (o campo já vem sem ponto de milhar). */
const lerPct = (s: string): number | null => {
  const n = Number(s.replace(',', '.'))
  return s.trim() && Number.isFinite(n) ? n : null
}

export function IndiretoCampos({
  valor,
  onMudar,
  obraId,
  ro = false,
  custoPeriodo,
  multiplas = false
}: {
  valor: FormIndireto
  onMudar: (f: FormIndireto) => void
  obraId: string | null
  ro?: boolean
  /** custo orçado por período, para a dica (tarefa já criada) */
  custoPeriodo?: string
  /** criação: o parcelado edita todas as parcelas (vira uma tarefa por parcela); edição: só a desta tarefa */
  multiplas?: boolean
}): ReactNode {
  const { data: regimes = [] } = useTaxas(obraId)
  const set = (p: Partial<FormIndireto>): void => onMudar({ ...valor, ...p })
  const per = ROTULO_PERIODO[valor.periodicidade]
  const setParcela = (k: number, p: Partial<ParcelaForm>): void =>
    set({ parcelas: valor.parcelas.map((x, j) => (j === k ? { ...x, ...p } : x)) })
  const mudarDistribuicao = (d: FormIndireto['distribuicao']): void => {
    if (d === valor.distribuicao) return
    const parcelas =
      d === 'continuo'
        ? valor.parcelas
        : d === 'pontual'
          ? [{ ...(valor.parcelas[0] ?? PARCELAS_PADRAO.pontual[0]), pct: '100' }]
          : multiplas
            ? PARCELAS_PADRAO.parcelado
            : [{ ...(valor.parcelas[0] ?? PARCELAS_PADRAO.parcelado[0]), pct: '50' }]
    set({ distribuicao: d, parcelas })
  }
  const somaPct = valor.parcelas.reduce((a, p) => a + (lerPct(p.pct) ?? 0), 0)
  return (
    <div className="space-y-4">
      <Secao titulo="Distribuição do custo">
        <Segmentado
          rotulo="Distribuição do custo do indireto"
          tamanho="sm"
          valor={valor.distribuicao}
          aoMudar={(d) => {
            if (!ro) mudarDistribuicao(d)
          }}
          opcoes={[
            {
              valor: 'continuo',
              rotulo: 'Contínuo',
              titulo: 'Enquanto durar a obra (administração): custo por período',
              desabilitado: ro
            },
            {
              valor: 'pontual',
              rotulo: 'Pontual',
              titulo: 'O valor total do item num período só (canteiro)',
              desabilitado: ro
            },
            {
              valor: 'parcelado',
              rotulo: 'Parcelado',
              titulo:
                'O valor total em parcelas, cada uma no seu período (mobilização/desmobilização)',
              desabilitado: ro
            }
          ]}
        />
        <p className="text-xs text-text-muted">
          {valor.distribuicao === 'continuo'
            ? 'O custo dura enquanto durarem os serviços diretos, por período (administração local).'
            : valor.distribuicao === 'pontual'
              ? 'O valor total orçado do item entra num período só, repartido por igual nos dias úteis (canteiro).'
              : multiplas
                ? 'O valor total orçado do item é dividido em parcelas; cada parcela vira uma tarefa com o seu período (mobilização no início, desmobilização no fim).'
                : 'Esta tarefa é uma parcela do item; as outras parcelas são outras tarefas do mesmo item. As parcelas somam no máximo 100%.'}
        </p>
      </Secao>

      {valor.distribuicao !== 'continuo' ? (
        <Secao titulo={valor.distribuicao === 'pontual' ? 'Período' : 'Parcelas'}>
          <div className="space-y-2">
            {valor.parcelas.map((p, k) => (
              <div key={k} className="flex flex-wrap items-end gap-2">
                {valor.distribuicao === 'parcelado' ? (
                  <Campo
                    rotulo={multiplas ? `Parcela ${k + 1} (%)` : 'Parcela (%)'}
                    className="w-28"
                  >
                    <Input
                      mascara="decimal"
                      casas={2}
                      value={p.pct}
                      disabled={ro}
                      onChange={(e) => setParcela(k, { pct: e.target.value })}
                      className="tabular text-right"
                    />
                  </Campo>
                ) : null}
                <Campo rotulo="Quando" className="w-36">
                  <Select
                    value={p.ancora}
                    disabled={ro}
                    onChange={(e) =>
                      setParcela(k, { ancora: e.target.value as ParcelaForm['ancora'] })
                    }
                  >
                    <option value="inicio">Primeiros</option>
                    <option value="fim">Últimos</option>
                  </Select>
                </Campo>
                <Campo rotulo="Dias úteis" className="w-28">
                  <Input
                    mascara="inteiro"
                    value={p.dias}
                    disabled={ro}
                    onChange={(e) => setParcela(k, { dias: e.target.value })}
                    className="tabular text-right"
                  />
                </Campo>
                <span className="pb-2 text-xs text-text-muted">da obra</span>
                {multiplas && valor.distribuicao === 'parcelado' && valor.parcelas.length > 1 ? (
                  <IconButton
                    size="sm"
                    variant="danger"
                    className="mb-1"
                    aria-label={`Remover a parcela ${k + 1}`}
                    title="Remover a parcela"
                    disabled={ro}
                    onClick={() => set({ parcelas: valor.parcelas.filter((_, j) => j !== k) })}
                  >
                    <Trash2 size={12} aria-hidden />
                  </IconButton>
                ) : null}
              </div>
            ))}
            {multiplas && valor.distribuicao === 'parcelado' ? (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ro}
                  onClick={() =>
                    set({ parcelas: [...valor.parcelas, { pct: '', ancora: 'fim', dias: '30' }] })
                  }
                >
                  <Plus size={12} /> Parcela
                </Button>
                <span
                  className={cn(
                    'tabular text-xs',
                    Math.abs(somaPct - 100) < 0.005 ? 'text-success' : 'text-warn'
                  )}
                >
                  Total {somaPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%
                  {Math.abs(somaPct - 100) < 0.005
                    ? ''
                    : somaPct < 100
                      ? ` · faltam ${(100 - somaPct).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (podem ficar para outra tarefa do item)`
                      : ' · passa de 100%'}
                </span>
              </div>
            ) : null}
            <p className="text-xs text-text-muted">
              Contados na janela dos serviços diretos: “primeiros 30” começa no início da primeira
              tarefa direta; “últimos 30” termina no fim da última. Custo e receita são a parcela do
              valor orçado do item, repartida por igual nos dias úteis.
            </p>
          </div>
        </Secao>
      ) : null}

      {valor.distribuicao === 'continuo' ? (
        <>
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
              <p className="pb-2 text-xs text-text-muted">
                Custo total ={' '}
                {custoPeriodo ? `${custoPeriodo} por ${per}` : `valor orçado por ${per}`} × nº de{' '}
                {per === 'mês' ? 'meses' : per === 'ano' ? 'anos' : 'dias úteis'} cobertos pelo
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
                No ritmo dos serviços diretos
              </Opcao>
              {valor.receitaModo === 'percentual_dos_servicos' ? (
                <p className="pl-6 text-xs text-text-muted">
                  Em cada período, a receita orçada do indireto × (faturamento dos serviços diretos
                  no período ÷ faturamento total dos serviços diretos).
                </p>
              ) : (
                <Caixa
                  marcado={valor.extrapola}
                  desabilitado={ro}
                  onMudar={(v) => set({ extrapola: v })}
                >
                  Receita acompanha o período integral (desmarcado: limitada ao valor orçado do
                  item)
                </Caixa>
              )}
            </div>
          </Secao>

          <Secao titulo="Janela">
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Começa antes das diretas (dias úteis)">
                <Input
                  mascara="inteiro"
                  value={valor.antes}
                  disabled={ro}
                  onChange={(e) => set({ antes: e.target.value })}
                  className="font-mono"
                />
              </Campo>
              <Campo rotulo="Termina depois das diretas (dias úteis)">
                <Input
                  mascara="inteiro"
                  value={valor.depois}
                  disabled={ro}
                  onChange={(e) => set({ depois: e.target.value })}
                  className="font-mono"
                />
              </Campo>
            </div>
            <p className="text-xs text-text-muted">
              A tarefa cobre do início da primeira tarefa direta ao fim da última, mais estas
              folgas.
            </p>
          </Secao>
        </>
      ) : null}

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
