import { useMemo, useState, type ReactNode } from 'react'
import type {
  MarchaTempoOpcoes,
  PlanejamentoDependencia,
  PlanejamentoTarefaCompleta,
  TracoTarefa
} from '@/types/planejamento'
import type { ObraTrecho } from '@/types/gerencial'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'
import { MarchaTempoPainel } from './MarchaTempoPainel'
import { MarchaTempoSeriesPanel } from './MarchaTempoSeriesPanel'
import { MarchaTempoExport } from './MarchaTempoExport'

interface MarchaTempoMultiTrechoProps {
  tarefas: PlanejamentoTarefaCompleta[]
  tracos: TracoTarefa[]
  trechos: ObraTrecho[]
  trechosSelecionados: string[]
  templatesPorTrecho: Map<string, TrechoQuantidadeVersaoCompleta | null>
  dependencias: PlanejamentoDependencia[]
  dataDate: string | null
  opcoes: MarchaTempoOpcoes
  onChangeOpcoes: (op: MarchaTempoOpcoes) => void
  exportRequest: number
  onExportConsumed: () => void
}

export function MarchaTempoMultiTrecho({
  tarefas,
  tracos,
  trechos,
  trechosSelecionados,
  templatesPorTrecho,
  dependencias,
  dataDate,
  opcoes,
  onChangeOpcoes,
  exportRequest,
  onExportConsumed
}: MarchaTempoMultiTrechoProps): ReactNode {
  const dominioTempo = useMemo<[number, number]>(() => {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const t of tarefas) {
      if (!t.data_inicio || !t.data_fim) continue
      const ini = new Date(`${t.data_inicio}T00:00:00Z`).getTime()
      const fim = new Date(`${t.data_fim}T00:00:00Z`).getTime()
      if (ini < lo) lo = ini
      if (fim > hi) hi = fim
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      return [0, 30 * 86400000]
    }
    const pad = (hi - lo) * 0.03
    return [lo - pad, hi + pad]
  }, [tarefas])

  const trechosParaRender = useMemo(
    () =>
      trechosSelecionados
        .map((id) => trechos.find((t) => t.id === id))
        .filter((t): t is ObraTrecho => !!t)
        .sort((a, b) => a.ordem - b.ordem),
    [trechosSelecionados, trechos]
  )

  // Estado do export: trecho-alvo é o 1º selecionado, modal abre quando
  // exportRequest muda
  const [exportOpen, setExportOpen] = useState(false)
  const [lastReq, setLastReq] = useState(exportRequest)
  if (exportRequest !== lastReq) {
    setLastReq(exportRequest)
    setExportOpen(true)
  }

  if (trechosParaRender.length === 0) return null

  const trechoExport = trechosParaRender[0]
  const templateExport = templatesPorTrecho.get(trechoExport.id) ?? null

  return (
    <div className="flex flex-col gap-3">
      {trechosParaRender.map((trecho) => (
        <div key={trecho.id} className="flex flex-col">
          <MarchaTempoPainel
            trecho={trecho}
            template={templatesPorTrecho.get(trecho.id) ?? null}
            tarefas={tarefas}
            tracos={tracos}
            dependencias={dependencias}
            dominioTempo={dominioTempo}
            dataDate={dataDate}
            opcoes={opcoes}
          />
          <MarchaTempoSeriesPanel
            tracos={tracos.filter((t) => t.trechoId === trecho.id)}
            estilos={opcoes.estilosSerie}
            onChange={(estilos) => onChangeOpcoes({ ...opcoes, estilosSerie: estilos })}
          />
        </div>
      ))}

      <MarchaTempoExport
        open={exportOpen}
        onClose={() => {
          setExportOpen(false)
          onExportConsumed()
        }}
        trecho={trechoExport}
        template={templateExport}
        tracos={tracos.filter((t) => t.trechoId === trechoExport.id)}
        tarefas={tarefas}
        dataDate={dataDate}
        dominioTempo={dominioTempo}
        opcoes={opcoes}
      />
    </div>
  )
}
