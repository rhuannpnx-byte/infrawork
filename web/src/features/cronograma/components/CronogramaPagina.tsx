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
  MoreHorizontal,
  MousePointer2,
  Settings2,
  SlidersHorizontal,
  Zap
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'
import { Segmentado } from '@/components/ui/segmentado'
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
import {
  BarraFerramentas,
  GrupoBarra,
  MOTIVO_LINHA_BASE,
  MOTIVO_SEM_PERMISSAO,
  SeloSomenteLeitura,
  TituloOpcoes,
  ZoomPar
} from './BarraPlano'

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

export function CronogramaPagina({ obraId }: { obraId: string }): ReactNode {
  return <PaginaPlano obraId={obraId} titulo="Cronograma" corpo={(c) => <CorpoGantt {...c} />} />
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
  const motivo = baseline ? MOTIVO_LINHA_BASE : MOTIVO_SEM_PERMISSAO

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
        onError: (x) => toast.error(`Não foi possível compactar o cronograma. ${x.message}`)
      }
    )
  }, [e.plano.id, calc.sig, comando, confirmar])

  return (
    <>
      <BarraFerramentas rotulo="Ferramentas do cronograma">
        <GrupoBarra>
          <Segmentado
            rotulo="Modo do ponteiro"
            tamanho="sm"
            valor={modo}
            aoMudar={setModo}
            opcoes={[
              {
                valor: 'selecionar',
                rotulo: (
                  <>
                    <MousePointer2 size={12} /> Selecionar
                  </>
                ),
                titulo: 'Selecionar e arrastar as barras'
              },
              {
                valor: 'dependencias',
                rotulo: (
                  <>
                    <ArrowRightLeft size={12} /> Dependências
                  </>
                ),
                desabilitado: somenteLeitura,
                titulo: somenteLeitura
                  ? motivo
                  : 'Arraste de um ponto de uma barra até outra para criar a dependência'
              }
            ]}
          />
        </GrupoBarra>
        <GrupoBarra>
          <ZoomPar rotulo="Zoom" aoDiminuir={() => zoom(1 / 1.5)} aoAumentar={() => zoom(1.5)} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => ui.setZoom(null)}
            title="Ajustar o período do plano à largura da tela"
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
        </GrupoBarra>
        <GrupoBarra>
          <FiltroPopover entrada={e} filtro={filtro} onChange={setFiltro} />
          <Popover
            open={opcoes}
            onOpenChange={setOpcoes}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={opcoes}
                onClick={() => setOpcoes((o) => !o)}
                title="O que mostrar nas linhas, nas barras e na grade"
              >
                <SlidersHorizontal size={12} /> Exibir
              </Button>
            }
          >
            <div className="w-72 space-y-3 p-2">
              <div className="space-y-1.5">
                <TituloOpcoes>Linhas e barras</TituloOpcoes>
                <Caixa marcado={ui.gantt.resumos} onMudar={(v) => ui.setGantt({ resumos: v })}>
                  Tarefas-resumo
                </Caixa>
                <Caixa
                  marcado={ui.gantt.agrupar}
                  onMudar={(v) => ui.setGantt({ agrupar: v })}
                  dica="Dentro de cada tarefa-resumo, as tarefas ficam agrupadas por local e por serviço"
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
                <TituloOpcoes>Eixo do tempo</TituloOpcoes>
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
                <TituloOpcoes>Colunas da grade</TituloOpcoes>
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
        </GrupoBarra>
        <GrupoBarra>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => acoes.criarTarefas(null)}
            disabled={somenteLeitura}
            title={somenteLeitura ? motivo : 'Criar tarefas a partir dos serviços e dos locais'}
          >
            <ListPlus size={12} /> Criar tarefas
          </Button>
          <Button variant="ghost" size="sm" onClick={dialogos.abrirMarcos}>
            <Diamond size={12} /> Marcos
          </Button>
          <Dropdown
            trigger={
              <Button variant="ghost" size="sm" aria-haspopup="menu">
                <MoreHorizontal size={14} /> Mais
              </Button>
            }
          >
            <DropdownItem
              onClick={() => acoes.novoGrupo(null)}
              disabled={somenteLeitura}
              title={somenteLeitura ? motivo : 'Agrupa tarefas sob um título, com barra de resumo'}
            >
              <FolderPlus size={12} /> Nova tarefa-resumo
            </DropdownItem>
            <DropdownItem
              onClick={() => void compactar()}
              disabled={somenteLeitura || !calc.resultado}
              title={
                somenteLeitura
                  ? motivo
                  : 'Recalcula as prioridades pela folga e traz cada tarefa para o início mais cedo possível'
              }
            >
              <Zap size={12} /> Compactar o cronograma
            </DropdownItem>
          </Dropdown>
        </GrupoBarra>
        <GrupoBarra fim>
          {calc.resultado?.controle ? (
            <LegendaControle visao="gantt" data={calc.resultado.controle.data} />
          ) : null}
          {somenteLeitura ? <SeloSomenteLeitura motivo={motivo} /> : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={acoes.abrirPlano}
            title="Datas, prazo, calendário e modo do plano"
          >
            <Settings2 size={12} /> Plano
          </Button>
        </GrupoBarra>
      </BarraFerramentas>
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
