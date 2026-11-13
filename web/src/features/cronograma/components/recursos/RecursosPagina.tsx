/**
 * Página de recursos do plano escolhido:
 *  - **Histograma** (padrão): a apresentação do InfraWork desktop — grupos (mão de obra, equipamentos, combustível,
 *    material), visão semanal (um recurso por barra) ou geral (uma barra por semana), métrica Recursos/Dias/Horas,
 *    tabela recurso × semana e exportação Excel; sobre o uso calculado pelo motor e as composições.
 *  - **Uso contínuo e limites**: a `ResourceView` do ApeX (uso no tempo, picos e o limite de unidades simultâneas que o
 *    motor respeita no nivelamento).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Calendar } from '@apex/calendar'
import { FileSpreadsheet, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Segmentado } from '@/components/ui/segmentado'
import { TabPill } from '@/components/ui/TabPill'
import { downloadBlob } from '@/lib/files/download'
import { HORA } from '../../visoes/eixo'
import { montarHistograma, type UnidadeTempo } from '../../visoes/histograma'
import { gerarHistogramaRecursosXlsx } from '../../visoes/histograma-xlsx'
import { jornadaReferencia } from '../../motor/calendario'
import { useComposicoesServicos } from '../../hooks/composicoes'
import { ZoomPar } from '../BarraPlano'
import { PaginaPlano, type ContextoPlano } from '../PaginaPlano'
import { useDialogos } from '../useDialogos'
import { RecursosVista } from './RecursosVista'
import { HistogramaRecursosChart } from './HistogramaRecursosChart'

export function RecursosPagina({
  obraId,
  obraNome
}: {
  obraId: string
  obraNome: string
}): ReactNode {
  return (
    <PaginaPlano
      obraId={obraId}
      titulo="Histograma de recursos"
      corpo={(c) => <CorpoRecursos {...c} obraNome={obraNome} />}
    />
  )
}

function CorpoRecursos({
  obraId,
  calc,
  somenteLeitura,
  obraNome
}: ContextoPlano & { obraNome: string }): ReactNode {
  const [aba, setAba] = useState<'histograma' | 'uso'>('histograma')
  return (
    <>
      <div
        role="tablist"
        aria-label="Visões de recursos"
        className="flex shrink-0 items-center gap-4 border-b border-border bg-bg-panel px-3"
      >
        <TabPill active={aba === 'histograma'} onClick={() => setAba('histograma')}>
          Histograma
        </TabPill>
        <TabPill active={aba === 'uso'} onClick={() => setAba('uso')}>
          Uso contínuo e limites
        </TabPill>
      </div>
      {aba === 'histograma' ? (
        <Histograma calc={calc} obraId={obraId} obraNome={obraNome} />
      ) : (
        <UsoContinuo calc={calc} obraId={obraId} somenteLeitura={somenteLeitura} />
      )}
    </>
  )
}

function Histograma({
  calc,
  obraId,
  obraNome
}: Pick<ContextoPlano, 'calc' | 'obraId'> & { obraNome: string }): ReactNode {
  const e = calc.entrada!
  const r = calc.resultado
  const [unidadeTempo, setUnidadeTempo] = useState<UnidadeTempo>('recursos')
  const [exportando, setExportando] = useState(false)
  const servicos = useMemo(
    () =>
      e.tarefas
        .filter((t) => t.tipo_no === 'tarefa' && !t.is_indireto && t.servico_id)
        .map((t) => t.servico_id!),
    [e.tarefas]
  )
  const { data: composicoes } = useComposicoesServicos(obraId, servicos)
  const resultado = useMemo(() => {
    if (!r) return { semanas: [], recursos: [] }
    const spec = r.calendarios[r.calendarioPadraoId]
    if (!spec) return { semanas: [], recursos: [] }
    const calPadrao =
      e.calendarios.find((c) => c.id === e.plano.calendario_id) ??
      e.calendarios.find((c) => c.padrao) ??
      e.calendarios[0]
    return montarHistograma(e, r, composicoes ?? new Map(), {
      unidadeTempo,
      calendario: new Calendar(spec),
      jornada: calPadrao ? jornadaReferencia(calPadrao) : 8
    })
  }, [e, r, composicoes, unidadeTempo])

  const exportar = async (): Promise<void> => {
    if (!resultado.recursos.length) return
    setExportando(true)
    try {
      const blob = await gerarHistogramaRecursosXlsx({
        obraNome,
        planoNome: e.plano.nome,
        unidadeTempo,
        semanas: resultado.semanas,
        recursos: resultado.recursos
      })
      downloadBlob(blob, `Histograma planejado - ${obraNome || 'obra'}.xlsx`)
      toast.success('Histograma exportado.')
    } catch (x) {
      toast.error(
        `Não foi possível exportar o histograma.${x instanceof Error ? ` ${x.message}` : ''}`
      )
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Demanda de recursos por semana, conforme o cronograma calculado (composição × equipes).
        </p>
        <div className="flex items-center gap-2">
          <Segmentado
            rotulo="Medida de mão de obra e equipamentos"
            tamanho="sm"
            valor={unidadeTempo}
            aoMudar={setUnidadeTempo}
            opcoes={[
              { valor: 'recursos', rotulo: 'Recursos', titulo: 'Quantos recursos trabalham na semana' },
              { valor: 'dias', rotulo: 'Dias', titulo: 'Dias de trabalho na semana' },
              { valor: 'horas', rotulo: 'Horas', titulo: 'Horas de trabalho na semana' }
            ]}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void exportar()}
            disabled={exportando || !resultado.recursos.length}
            title={
              resultado.recursos.length
                ? 'Baixar a planilha recurso × semana'
                : 'Não há recursos planejados para exportar'
            }
          >
            <FileSpreadsheet size={12} /> {exportando ? 'Exportando…' : 'Exportar Excel'}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <HistogramaRecursosChart result={resultado} unidadeTempo={unidadeTempo} height={340} />
      </div>
    </div>
  )
}

function UsoContinuo({
  calc,
  obraId,
  somenteLeitura
}: Pick<ContextoPlano, 'calc' | 'obraId' | 'somenteLeitura'>): ReactNode {
  const dialogos = useDialogos(calc, obraId, somenteLeitura)
  const [px, setPx] = useState<number | null>(null)
  const [escolhidos, setEscolhidos] = useState<string[] | null>(null)
  const r = calc.resultado
  const e = calc.entrada!
  // sem escolha: os equipamentos (o que mais limita o cronograma)
  const padrao = useMemo(() => {
    const grupo = new Map<string, string>()
    for (const q of e.equipes) for (const x of q.recursos) grupo.set(x.recurso_id, x.grupo ?? '')
    return (r?.recursos ?? [])
      .map((x) => x.recurso_id)
      .filter((id) => ['MVE', 'EQUIPAMENTO'].includes(grupo.get(id) ?? ''))
  }, [e, r])
  const mostrar = useMemo(() => new Set(escolhidos ?? padrao), [escolhidos, padrao])
  const escalaAtual = (): number => {
    if (px) return px
    if (!r || r.fimProjeto === null) return 1
    return Math.max(0.01, 900 / Math.max(1, ((r.fimProjeto - r.inicioProjeto) / HORA) * 0.35))
  }
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-bg-panel px-3 py-1.5">
        <ZoomPar
          rotulo="Tempo"
          aoDiminuir={() => setPx(escalaAtual() / 1.5)}
          aoAumentar={() => setPx(escalaAtual() * 1.5)}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPx(null)}
          title="Ajustar o período do plano à largura da tela"
        >
          <Maximize2 size={12} /> Ajustar
        </Button>
        <span className="ml-3 min-w-0 text-xs text-text-muted">
          Uso dos recursos das composições pelas tarefas, com o nivelamento do motor. Limite: no
          máximo tantas unidades ao mesmo tempo: o cálculo atrasa tarefas para respeitá-lo.
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <RecursosVista
          calc={calc}
          somenteLeitura={somenteLeitura}
          mostrar={mostrar}
          onMostrar={setEscolhidos}
          onAbrirTarefa={dialogos.acoes.abrirTarefa}
          pxPorHora={px}
        />
      </div>
      {dialogos.elemento}
    </>
  )
}
