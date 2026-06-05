import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Search, Check, X, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { EmptyState } from '@/components/layout/EmptyState'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { KPICard } from '@/components/charts/KPICard'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { cn } from '@/lib/utils'
import { fmtBRL } from '@/lib/money'
import { useValorAgregado } from '@/features/acompanhamento/hooks/valor-agregado'
import { useProducao } from '@/features/acompanhamento/hooks/producao'
import {
  useValorAgregadoFiltrosStore,
  janelaEfetiva
} from '@/features/acompanhamento/stores/valor-agregado-filtros'
import {
  montarMemoriasFilhos,
  carregarFotosExport
} from '@/features/acompanhamento/lib/valor-agregado-export'
import { CurvaSValorAgregado } from '@/features/acompanhamento/components/valor-agregado/CurvaSValorAgregado'
import { PlanejadoProjetadoPorServico } from '@/features/acompanhamento/components/valor-agregado/PlanejadoProjetadoPorServico'
import { MedicaoTable } from '@/features/acompanhamento/components/valor-agregado/MedicaoTable'
import { fmtDataBR } from '@/features/planejamento/lib/dates'

export function AcompanhamentoValorAgregadoPage(): ReactNode {
  return (
    <RequireObra pageTitle="Valor Agregado">
      <ValorAgregadoInner />
    </RequireObra>
  )
}

function ValorAgregadoInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!

  const rawDe = useValorAgregadoFiltrosStore((s) => s.data_de)
  const rawAte = useValorAgregadoFiltrosStore((s) => s.data_ate)
  const setRange = useValorAgregadoFiltrosStore((s) => s.setRange)
  const servicoItemId = useValorAgregadoFiltrosStore((s) => s.servico_item_id)
  const setServicoItem = useValorAgregadoFiltrosStore((s) => s.setServicoItem)

  // Janela efetiva (range completo OU mês atual). O picker mantém o range cru.
  const { de, ate } = janelaEfetiva(rawDe, rawAte)

  const { curva, comparativo, medicao, listaServicos, grupos, curvaSRows, isLoading, semBaseline } =
    useValorAgregado(obraId, { de, ate, servicoItemId })

  // Produção dia-a-dia do período — base das memórias de cálculo no export.
  const { data: producao = [] } = useProducao(obraId, { data_de: de, data_ate: ate })

  const [exportando, setExportando] = useState(false)

  // KPIs: últimos valores projetados acumulados + total medição do período.
  const kpis = useMemo(() => {
    let recProj = 0
    let custProj = 0
    for (const b of curva) {
      if (b.receita_projetada_acum != null) recProj = b.receita_projetada_acum
      if (b.custo_projetado_acum != null) custProj = b.custo_projetado_acum
    }
    const totalMedicao = medicao.reduce((a, r) => a + r.medicao_valor, 0)
    return { recProj, custProj, margem: recProj - custProj, totalMedicao }
  }, [curva, medicao])

  async function exportar(): Promise<void> {
    if (medicao.length === 0) return
    setExportando(true)
    try {
      const memorias = montarMemoriasFilhos(grupos, curvaSRows, producao, servicoItemId, de, ate)
      const fotos = await carregarFotosExport(obraId, de, ate)
      const dmy = (s: string): string => {
        const [y, m, d] = s.split('-')
        return `${d}.${m}.${y}`
      }
      const res = await window.infrawork.medicao.exportXlsx({
        obraNome: scope.obra?.nome ?? 'Obra',
        periodoLabel: `${fmtDataBR(de)} a ${fmtDataBR(ate)}`,
        periodoArquivo: `${dmy(de)} - ${dmy(ate)}`,
        medicao,
        memorias,
        fotos
      })
      if (res.canceled) return
      if (!res.ok) {
        toast.error(`Falha ao exportar: ${res.error}`)
        return
      }
      toast.success('Planilha exportada.')
    } catch (err) {
      toast.error(`Falha ao exportar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Valor Agregado" subtitle={scope.obra?.nome ?? ''} />

      <div className="flex-1 overflow-auto">
        {/* Filtros sticky */}
        <div className="sticky top-0 z-20 bg-bg border-b border-border px-5 py-2 flex flex-wrap items-center gap-3">
          <span className="text-2xs font-mono uppercase text-text-dim">Período</span>
          <DateRangePopover
            from={rawDe}
            to={rawAte}
            onChange={(d, a) => setRange(d, a)}
            placeholder="Mês atual"
          />
          <span className="ml-2 h-4 w-px bg-border" />
          <span className="text-2xs font-mono uppercase text-text-dim">Serviço</span>
          <ServicoSelect value={servicoItemId} onChange={setServicoItem} opcoes={listaServicos} />
          {servicoItemId && (
            <button
              onClick={() => setServicoItem(null)}
              className="text-2xs text-text-dim hover:text-danger inline-flex items-center gap-0.5"
              title="Limpar filtro de serviço"
            >
              <X size={9} /> limpar
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {semBaseline ? (
            <EmptyState
              icon="trending-up"
              title="Sem baseline ativo"
              description="Promova um baseline no planejamento para comparar o valor agregado da produção."
            />
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <PulseBlock key={i} h={92} />)
                ) : (
                  <>
                    <KPICard
                      icon={<TrendingUp size={11} />}
                      label="Receita projetada"
                      value={fmtBRL(kpis.recProj)}
                      hint="valor agregado acumulado"
                    />
                    <KPICard
                      icon={<TrendingUp size={11} />}
                      label="Custo projetado"
                      value={fmtBRL(kpis.custProj)}
                      hint="produzido + indireto + impostos"
                    />
                    <KPICard
                      icon={<TrendingUp size={11} />}
                      label="Margem projetada"
                      value={fmtBRL(kpis.margem)}
                    />
                    <KPICard
                      icon={<TrendingUp size={11} />}
                      label="Medição do período"
                      value={fmtBRL(kpis.totalMedicao)}
                    />
                  </>
                )}
              </div>

              {/* Curva-S de valor agregado */}
              <div>
                <div className="text-2xs font-mono uppercase text-text-dim mb-1.5">
                  Curva-S — planejado × projetado (acumulado)
                </div>
                {isLoading ? <PulseBlock h={380} /> : <CurvaSValorAgregado dados={curva} />}
              </div>

              {/* Planejado × Projetado por serviço */}
              <div>
                <div className="text-2xs font-mono uppercase text-text-dim mb-1.5">
                  Planejado × Projetado por serviço (período)
                </div>
                {isLoading ? (
                  <PulseBlock h={260} />
                ) : (
                  <PlanejadoProjetadoPorServico dados={comparativo} />
                )}
              </div>

              {/* Medição unitária */}
              {isLoading ? (
                <PulseBlock h={240} />
              ) : (
                <MedicaoTable rows={medicao} onExportar={exportar} exportando={exportando} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** Combobox custom para serviços — espelha o do dashboard (select nativo renderiza branco no Electron). */
function ServicoSelect({
  value,
  onChange,
  opcoes
}: {
  value: string | null
  onChange: (id: string | null) => void
  opcoes: Array<{ id: string; label: string }>
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState('')
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return opcoes
    return opcoes.filter((o) => o.label.toLowerCase().includes(q))
  }, [opcoes, busca])
  const selecionado = value ? opcoes.find((o) => o.id === value) : null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded border text-2xs font-mono min-w-[240px] max-w-[300px]',
          value
            ? 'border-accent/50 text-text bg-accent/5 hover:border-accent'
            : 'border-border text-text-dim hover:text-text hover:border-border-strong'
        )}
      >
        <span className="flex-1 text-left truncate">
          {selecionado ? selecionado.label : 'Todos os serviços'}
        </span>
        <ChevronDown size={11} className="shrink-0 text-text-dim" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => {
              setOpen(false)
              setBusca('')
            }}
          />
          <div className="absolute top-full mt-1 left-0 z-40 bg-bg-elevated border border-border-strong rounded shadow-xl w-[340px] max-h-[320px] overflow-hidden flex flex-col">
            <div className="px-2 py-1.5 border-b border-border flex items-center gap-1.5">
              <Search size={11} className="text-text-dim" />
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar serviço…"
                className="bg-transparent flex-1 text-2xs font-mono text-text outline-none placeholder:text-text-dim"
              />
            </div>
            <div className="overflow-auto flex-1 p-1">
              <button
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                  setBusca('')
                }}
                className={cn(
                  'w-full text-left px-2 py-1 rounded text-2xs font-mono flex items-center gap-1.5',
                  value == null
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-dim hover:bg-bg-hover hover:text-text'
                )}
              >
                {value == null && <Check size={10} />}
                {value != null && <span className="size-2.5 shrink-0" />}— Todos os serviços —
              </button>
              {filtradas.length === 0 && (
                <div className="text-2xs font-mono text-text-dim p-2 text-center">
                  sem resultados
                </div>
              )}
              {filtradas.map((o) => {
                const sel = value === o.id
                return (
                  <button
                    key={o.id}
                    onClick={() => {
                      onChange(o.id)
                      setOpen(false)
                      setBusca('')
                    }}
                    className={cn(
                      'w-full text-left px-2 py-1 rounded text-2xs font-mono flex items-center gap-1.5',
                      sel ? 'bg-accent/15 text-accent' : 'text-text hover:bg-bg-hover'
                    )}
                  >
                    {sel ? <Check size={10} /> : <span className="size-2.5 shrink-0" />}
                    <span className="truncate">{o.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
