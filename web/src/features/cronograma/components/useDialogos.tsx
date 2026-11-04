/**
 * Diálogos do cronograma compartilhados pelas visões (Gantt, tempo-caminho): propriedades da tarefa, dependência,
 * criar tarefas, dividir por estaca/quantidade, tarefa-resumo, plano, marcos e o eixo/área (duplo clique no local).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useObraTrechos } from '@/features/planejamento/hooks/trechos'
import { EixoDialog } from '@/features/planejamento/modals/EixoDialog'
import type { CalculoCronograma } from '../hooks/calculo'
import type { AcoesCronograma } from './menus'
import { TarefaDialog } from './TarefaDialog'
import { DependenciaDialog, type DependenciaAlvo } from './DependenciaDialog'
import { CriarTarefasDialog } from './CriarTarefasDialog'
import { DividirEstacaDialog, type AlvoDividirEstaca } from './DividirEstacaDialog'
import { DividirQuantidadeDialog } from './DividirQuantidadeDialog'
import { GrupoDialog, PlanoDialog, type AlvoGrupo } from './GrupoPlanoDialogs'
import { MarcosDialog } from './MarcosDialog'

export interface DialogosCronograma {
  acoes: AcoesCronograma
  abrirMarcos: () => void
  elemento: ReactNode
}

export function useDialogos(
  calc: CalculoCronograma,
  obraId: string,
  somenteLeitura: boolean
): DialogosCronograma {
  const [tarefa, setTarefa] = useState<string | null>(null)
  const [dep, setDep] = useState<DependenciaAlvo | null>(null)
  const [criar, setCriar] = useState<string | null | undefined>(undefined)
  const [grupo, setGrupo] = useState<AlvoGrupo | null>(null)
  const [plano, setPlano] = useState(false)
  const [marcos, setMarcos] = useState(false)
  const [divEstaca, setDivEstaca] = useState<AlvoDividirEstaca | null>(null)
  const [divQtd, setDivQtd] = useState<string | null>(null)
  const [localId, setLocalId] = useState<string | null>(null)
  const { data: trechosObra = [] } = useObraTrechos(obraId)
  const trechoAberto = trechosObra.find((t) => t.id === localId) ?? null

  const acoes: AcoesCronograma = useMemo(
    () => ({
      abrirTarefa: setTarefa,
      abrirGrupo: (id) => setGrupo({ id }),
      abrirPlano: () => setPlano(true),
      abrirDependencia: setDep,
      criarTarefas: (pai) => setCriar(pai),
      novoGrupo: (pai) => setGrupo({ novo: true, pai }),
      dividirEstaca: setDivEstaca,
      dividirQuantidade: setDivQtd,
      abrirLocal: setLocalId
    }),
    []
  )

  const elemento = (
    <>
      <TarefaDialog
        calc={calc}
        tarefaId={tarefa}
        somenteLeitura={somenteLeitura}
        onFechar={() => setTarefa(null)}
        onAbrirDependencia={setDep}
      />
      <DependenciaDialog
        calc={calc}
        alvo={dep}
        somenteLeitura={somenteLeitura}
        onFechar={() => setDep(null)}
      />
      <CriarTarefasDialog
        calc={calc}
        obraId={obraId}
        destino={criar}
        onFechar={() => setCriar(undefined)}
      />
      <DividirEstacaDialog calc={calc} alvo={divEstaca} onFechar={() => setDivEstaca(null)} />
      <DividirQuantidadeDialog calc={calc} tarefaId={divQtd} onFechar={() => setDivQtd(null)} />
      <GrupoDialog
        calc={calc}
        alvo={grupo}
        somenteLeitura={somenteLeitura}
        onFechar={() => setGrupo(null)}
      />
      <PlanoDialog
        calc={calc}
        aberto={plano}
        somenteLeitura={somenteLeitura}
        onFechar={() => setPlano(false)}
      />
      <MarcosDialog
        calc={calc}
        aberto={marcos}
        somenteLeitura={somenteLeitura}
        onFechar={() => setMarcos(false)}
      />
      <EixoDialog
        open={!!trechoAberto}
        onOpenChange={(o) => !o && setLocalId(null)}
        obraId={obraId}
        trecho={trechoAberto}
      />
    </>
  )
  return { acoes, abrirMarcos: () => setMarcos(true), elemento }
}
