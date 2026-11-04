/**
 * Página do cronograma (Gantt): barra de ferramentas das visões do ApeX (modo seleção/dependências, zoom, opções de
 * exibição, inserir tarefas, tarefa-resumo, marcos, compactar e propriedades do plano) sobre o casco do plano.
 */
import { useCallback, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ArrowRightLeft,
  CalendarClock,
  Diamond,
  FolderPlus,
  ListPlus,
  Maximize2,
  MousePointer2,
  Settings2,
  SlidersHorizontal,
  Zap,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { useConfirm } from '@/components/modals/ConfirmDialog'
import { useComandoVisao } from '../hooks/edicao'
import { COLUNAS_GANTT, useCronogramaUi, type ColunaGantt } from '../store'
import { GanttVista } from './gantt/GanttVista'
import type { ModoGantt } from './gantt/GanttLinhaTempo'
import { Caixa } from './campos'
import { PaginaPlano, type ContextoPlano } from './PaginaPlano'
import { useDialogos } from './useDialogos'
import { useFiltroVisao } from '../hooks/filtro'
import { FiltroPopover } from './FiltroPopover'
import { agoraLocal } from '../visoes/formato'
import { LegendaControle } from './LegendaControle'

const ROTULO_COLUNA: Record<ColunaGantt, string> = {
  numero: 'Nº da hierarquia',
  nome: 'Nome',
  servico: 'Serviço',
  trecho: 'Trecho (local)',
  quantidade: 'Quantidade',
  inicio: 'Início',
  fim: 'Término',
  duracao: 'Duração',
  producao: 'Produção/dia',
  equipes: 'Equipes',
  folga: 'Folga',
  estacas: 'Estacas',
  prioridade: 'Prioridade',
  executado: '% executado (controle)',
  previsto: 'Término previsto (controle)'
}

export function CronogramaPagina({
  obraId,
  obraNome
}: {
  obraId: string
  obraNome: string
}): ReactNode {
  return (
    <PaginaPlano
      obraId={obraId}
      obraNome={obraNome}
      titulo="Cronograma"
      corpo={(c) => <CorpoGantt {...c} />}
    />
  )
}

function CorpoGantt({ obraId, calc, somenteLeitura, baseline }: ContextoPlano): ReactNode {
  const ui = useCronogramaUi()
  const confirmar = useConfirm()
  const comando = useComandoVisao()
  const dialogos = useDialogos(calc, obraId, somenteLeitura)
  const { filtro, setFiltro, calcFiltrado } = useFiltroVisao(calc)
  const [modo, setModo] = useState<ModoGantt>('selecionar')
  const [opcoes, setOpcoes] = useState(false)
  const [irPara, setIrPara] = useState<{ t: number; seq: number } | null>(null)
  const [escala, setEscala] = useState<number | null>(null)
  const e = calc.entrada!
  const acoes = dialogos.acoes

  const zoom = (fator: number): void => {
    const atual = ui.pxPorHora ?? escala ?? 2
    ui.setZoom(Math.max(0.005, Math.min(400, atual * fator)))
  }

  const compactar = useCallback(async () => {
    const ok = await confirmar({
      title: 'Compactar o cronograma?',
      description:
        'Recalcula as prioridades de todas as tarefas pela folga (as que terminam mais tarde ganham prioridade) e traz cada uma para o início mais cedo possível, respeitando dependências, equipes e recursos. As prioridades e os inícios atuais serão substituídos.',
      confirmLabel: 'Compactar',
      variant: 'warn'
    })
    if (!ok) return
    comando.mutate(
      { planejamentoId: e.plano.id, sig: calc.sig, comando: { tipo: 'compactar' } },
      {
        onSuccess: () => toast.success('Cronograma compactado.'),
        onError: (x) => toast.error(x.message)
      }
    )
  }, [e.plano.id, calc.sig, comando, confirmar])

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-bg-panel px-3 py-1.5">
        <div className="flex rounded border border-border-strong p-0.5">
          <Button
            variant={modo === 'selecionar' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setModo('selecionar')}
            title="Selecionar e arrastar barras"
          >
            <MousePointer2 size={12} /> Selecionar
          </Button>
          <Button
            variant={modo === 'dependencias' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setModo('dependencias')}
            disabled={somenteLeitura}
            title="Arraste de um ponto de uma barra até outro para criar a dependência"
          >
            <ArrowRightLeft size={12} /> Dependências
          </Button>
        </div>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button variant="ghost" size="icon" onClick={() => zoom(1 / 1.5)} title="Diminuir zoom">
          <ZoomOut size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => zoom(1.5)} title="Aumentar zoom">
          <ZoomIn size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => ui.setZoom(null)}
          title="Ajustar o período do plano à largura"
        >
          <Maximize2 size={12} /> Ajustar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIrPara({ t: agoraLocal(), seq: Date.now() })}
          title="Rolar até hoje"
        >
          <CalendarClock size={12} /> Hoje
        </Button>
        <FiltroPopover entrada={e} filtro={filtro} onChange={setFiltro} />
        <Popover
          open={opcoes}
          onOpenChange={setOpcoes}
          trigger={
            <Button variant="ghost" size="sm" onClick={() => setOpcoes((o) => !o)}>
              <SlidersHorizontal size={12} /> Exibir
            </Button>
          }
        >
          <div className="w-72 space-y-3 rounded-md border border-border-strong bg-bg-elevated p-3 shadow-xl">
            <div className="space-y-1.5">
              <div className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                Linhas e barras
              </div>
              <Caixa marcado={ui.gantt.resumos} onMudar={(v) => ui.setGantt({ resumos: v })}>
                Tarefas-resumo
              </Caixa>
              <Caixa
                marcado={ui.gantt.agrupar}
                onMudar={(v) => ui.setGantt({ agrupar: v })}
                dica="Como no DynaRoad: dentro de cada tarefa-resumo, as tarefas por trecho e por serviço"
              >
                Agrupar por local e serviço
              </Caixa>
              <Caixa marcado={ui.gantt.rotulos} onMudar={(v) => ui.setGantt({ rotulos: v })}>
                Nome ao lado da barra
              </Caixa>
              <Caixa marcado={ui.gantt.numeros} onMudar={(v) => ui.setGantt({ numeros: v })}>
                Número da hierarquia antes da barra
              </Caixa>
              <Caixa
                marcado={ui.gantt.critico}
                onMudar={(v) => ui.setGantt({ critico: v })}
                dica="Contorna as tarefas sem folga total"
              >
                Destacar tarefas sem folga
              </Caixa>
              <Caixa marcado={ui.gantt.marcos} onMudar={(v) => ui.setGantt({ marcos: v })}>
                Marcos
              </Caixa>
              <Caixa
                marcado={ui.gantt.automaticas}
                onMudar={(v) => ui.setGantt({ automaticas: v })}
                dica="Dependências por estacas criadas pelas dependências entre serviços (tracejadas)"
              >
                Dependências derivadas dos serviços
              </Caixa>
            </div>
            <div className="space-y-1.5">
              <div className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                Eixo do tempo
              </div>
              <Caixa
                marcado={ui.gantt.fimDeSemana}
                onMudar={(v) => ui.setGantt({ fimDeSemana: v })}
                dica="Sem esta opção os dias sem expediente somem do eixo"
              >
                Mostrar fins de semana
              </Caixa>
              <Caixa
                marcado={ui.gantt.feriados}
                onMudar={(v) => ui.setGantt({ feriados: v })}
                dica="Feriados sombreados no eixo; desligado, somem"
              >
                Mostrar feriados
              </Caixa>
            </div>
            <div className="space-y-1.5">
              <div className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                Colunas da grade
              </div>
              <div className="grid grid-cols-2 gap-1">
                {COLUNAS_GANTT.filter((c) => c !== 'nome').map((c) => (
                  <Caixa
                    key={c}
                    marcado={ui.colunas.includes(c)}
                    onMudar={(v) =>
                      ui.setColunas(
                        v
                          ? COLUNAS_GANTT.filter((x) => x === c || ui.colunas.includes(x))
                          : ui.colunas.filter((x) => x !== c)
                      )
                    }
                  >
                    {ROTULO_COLUNA[c]}
                  </Caixa>
                ))}
              </div>
            </div>
          </div>
        </Popover>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => acoes.criarTarefas(null)}
          disabled={somenteLeitura}
        >
          <ListPlus size={12} /> Criar tarefas
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => acoes.novoGrupo(null)}
          disabled={somenteLeitura}
        >
          <FolderPlus size={12} /> Tarefa-resumo
        </Button>
        <Button variant="ghost" size="sm" onClick={dialogos.abrirMarcos}>
          <Diamond size={12} /> Marcos
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void compactar()}
          disabled={somenteLeitura || !calc.resultado}
          title="Pack schedule: prioridades pela folga e tudo o mais cedo possível"
        >
          <Zap size={12} /> Compactar
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {calc.resultado?.controle ? (
            <LegendaControle visao="gantt" data={calc.resultado.controle.data} />
          ) : null}
          {baseline ? (
            <span className="rounded border border-border px-2 py-0.5 text-2xs text-text-dim">
              Linha de base travada — somente leitura
            </span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={acoes.abrirPlano}>
            <Settings2 size={12} /> Plano
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <GanttVista
          calc={calcFiltrado}
          modo={modo}
          somenteLeitura={somenteLeitura}
          acoes={acoes}
          irPara={irPara}
          onEscala={setEscala}
        />
      </div>
      {dialogos.elemento}
    </>
  )
}
