import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { BarraFiltros, Filtro, FiltroUnico } from '@/components/ui/filtros'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { AvisoSemLinhaDeBase } from '@/features/acompanhamento/components/AvisoSemLinhaDeBase'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { EmptyState } from '@/components/layout/EmptyState'
import { DateRangePopover } from '@/components/ui/DateRangePopover'
import { PulseBlock } from '@/components/ui/PulseBlock'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { fmtBRL, fmtQtd } from '@/lib/money'
import { useValorAgregado } from '@/features/acompanhamento/hooks/valor-agregado'
import { useProducao } from '@/features/acompanhamento/hooks/producao'
import {
  useValorAgregadoFiltrosStore,
  janelaEfetiva
} from '@/features/acompanhamento/stores/valor-agregado-filtros'
import {
  montarMemoriasFilhos,
  carregarFotosExport,
  carregarMateriaisProducao,
  carregarViagensExport
} from '@/features/acompanhamento/lib/valor-agregado-export'
import { CurvaSValorAgregado } from '@/features/acompanhamento/components/valor-agregado/CurvaSValorAgregado'
import { PlanejadoProjetadoPorServico } from '@/features/acompanhamento/components/valor-agregado/PlanejadoProjetadoPorServico'
import { MedicaoTable } from '@/features/acompanhamento/components/valor-agregado/MedicaoTable'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { gerarMedicaoXlsx } from '@/lib/excel/medicao-xlsx'
import { downloadBlob } from '@/lib/files/download'

export function AcompanhamentoValorAgregadoPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Valor Agregado">
      <RequireObra pageTitle="Valor Agregado">
        <ValorAgregadoInner />
      </RequireObra>
    </RequireRole>
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

  const {
    curva,
    comparativo,
    medicao,
    listaServicos,
    grupos,
    curvaSRows,
    prateleira,
    referenciaProvisoria,
    isLoading,
    semBaseline
  } = useValorAgregado(obraId, { de, ate, servicoItemId })

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
      const [materialPorId, viagens] = await Promise.all([
        carregarMateriaisProducao(obraId, de, ate),
        carregarViagensExport(obraId, de, ate)
      ])
      const memorias = montarMemoriasFilhos(
        grupos,
        curvaSRows,
        producao,
        materialPorId,
        servicoItemId,
        de,
        ate,
        viagens
      )
      const fotos = await carregarFotosExport(obraId, de, ate)
      const dmy = (s: string): string => {
        const [y, m, d] = s.split('-')
        return `${d}.${m}.${y}`
      }
      const blob = await gerarMedicaoXlsx({
        obraNome: scope.obra?.nome ?? 'Obra',
        periodoLabel: `${fmtDataBR(de)} a ${fmtDataBR(ate)}`,
        periodoArquivo: `${dmy(de)} - ${dmy(ate)}`,
        medicao,
        memorias,
        fotos
      })
      downloadBlob(blob, `Medição ${scope.obra?.nome ?? 'Obra'} ${dmy(de)} - ${dmy(ate)}.xlsx`)
      toast.success('Planilha exportada.')
    } catch (err) {
      toast.error(`Não foi possível exportar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Valor Agregado" />
      <AvisoSemLinhaDeBase obraId={obraId} />

      <div className="flex-1 overflow-auto">
        <BarraFiltros
          className="sticky top-0 z-20"
          aoLimpar={servicoItemId ? () => setServicoItem(null) : null}
        >
          <Filtro rotulo="Período">
            <DateRangePopover
              from={rawDe}
              to={rawAte}
              onChange={(d, a) => setRange(d, a)}
              placeholder="Mês atual"
            />
          </Filtro>
          <FiltroUnico
            rotulo="Serviço"
            todos="Todos os serviços"
            opcoes={listaServicos.map((o) => ({ valor: o.id, rotulo: o.label }))}
            valor={servicoItemId}
            aoMudar={setServicoItem}
          />
        </BarraFiltros>

        <div className="p-5 space-y-4">
          {semBaseline ? (
            <EmptyState
              icon="trending-up"
              title="Sem linha de base vigente"
              description="Trave um plano como linha de base e torne-o vigente para comparar o valor agregado da produção."
            />
          ) : (
            <>
              {referenciaProvisoria ? (
                <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text">
                  Sem linha de base vigente (replanejamento em andamento): o previsto usa a última
                  vigente como referência provisória.
                </div>
              ) : null}
              {prateleira.length > 0 ? (
                <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text space-y-0.5">
                  <div className="font-semibold">
                    Executado além do contrato (não agrega valor até um aditivo):
                  </div>
                  {prateleira.map((p) => (
                    <div key={p.id} className="tabular text-text-muted">
                      {p.codigo} · {p.descricao}: {fmtQtd(p.excedente)} {p.unidade}
                    </div>
                  ))}
                </div>
              ) : null}
              <FaixaIndicadores rotulo="Valor agregado">
                <Indicador
                  rotulo="Receita executada"
                  tamanho="sm"
                  carregando={isLoading}
                  valor={fmtBRL(kpis.recProj)}
                >
                  <span>valor agregado acumulado</span>
                </Indicador>
                <Indicador
                  rotulo="Custo executado"
                  tamanho="sm"
                  carregando={isLoading}
                  valor={fmtBRL(kpis.custProj)}
                >
                  <span>produzido, indireto e impostos</span>
                </Indicador>
                <Indicador
                  rotulo="Margem"
                  tamanho="sm"
                  carregando={isLoading}
                  tom={kpis.margem < 0 ? 'danger' : 'neutro'}
                  valor={fmtBRL(kpis.margem)}
                >
                  <span>receita menos custo, até hoje</span>
                </Indicador>
                <Indicador
                  rotulo="Medição do período"
                  tamanho="sm"
                  carregando={isLoading}
                  valor={fmtBRL(kpis.totalMedicao)}
                >
                  <span>pelas quantidades do período</span>
                </Indicador>
              </FaixaIndicadores>

              <div>
                <h2 className="text-lg font-semibold text-text mb-2">
                  Curva S{' '}
                  <span className="text-sm font-normal text-text-muted">
                    receita e custo, previstos e executados, acumulados
                  </span>
                </h2>
                {isLoading ? <PulseBlock h={380} /> : <CurvaSValorAgregado dados={curva} />}
              </div>

              <div>
                <h2 className="text-lg font-semibold text-text mb-2">
                  Previsto e executado por serviço{' '}
                  <span className="text-sm font-normal text-text-muted">no período</span>
                </h2>
                {isLoading ? (
                  <PulseBlock h={260} />
                ) : (
                  <PlanejadoProjetadoPorServico dados={comparativo} />
                )}
              </div>

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
