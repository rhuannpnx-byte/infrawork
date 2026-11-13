/**
 * Página do tempo-caminho: a visão tempo-local do ApeX sobre o plano escolhido, com a barra de ferramentas (modo,
 * zoom do tempo e das estacas, hoje, trechos e opções de exibição).
 */
import { useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CalendarClock,
  Diamond,
  ListPlus,
  Maximize2,
  MousePointer2,
  Scissors,
  Settings2,
  SlidersHorizontal
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { useCronogramaUi } from '../../store'
import { Caixa } from '../campos'
import { PaginaPlano, type ContextoPlano } from '../PaginaPlano'
import { useDialogos } from '../useDialogos'
import { useFiltroVisao } from '../../hooks/filtro'
import { FiltroPopover } from '../FiltroPopover'
import { agoraLocal } from '../../visoes/formato'
import { LegendaControle } from '../LegendaControle'
import { Segmentado } from '@/components/ui/segmentado'
import {
  BarraFerramentas,
  GrupoBarra,
  MOTIVO_LINHA_BASE,
  MOTIVO_SEM_PERMISSAO,
  SeloSomenteLeitura,
  TituloOpcoes,
  ZoomPar
} from '../BarraPlano'
import { TempoCaminhoVista, type ModoTempoCaminho } from './TempoCaminhoVista'

export function TempoCaminhoPagina({ obraId }: { obraId: string }): ReactNode {
  return (
    <PaginaPlano
      obraId={obraId}
      titulo="Tempo-caminho"
      corpo={(c) => <CorpoTempoCaminho {...c} />}
    />
  )
}

function CorpoTempoCaminho({ obraId, calc, somenteLeitura, baseline }: ContextoPlano): ReactNode {
  const ui = useCronogramaUi()
  const o = ui.tc
  const dialogos = useDialogos(calc, obraId, somenteLeitura)
  const { filtro, setFiltro, calcFiltrado } = useFiltroVisao(calc)
  const [modo, setModo] = useState<ModoTempoCaminho>('selecionar')
  const [opcoes, setOpcoes] = useState(false)
  const [irPara, setIrPara] = useState<{ t: number; seq: number } | null>(null)
  const [escala, setEscala] = useState<{ pxPorHora: number; pxPorMetro: number } | null>(null)
  const e = calc.entrada!
  const acoes = dialogos.acoes
  const motivo = baseline ? MOTIVO_LINHA_BASE : MOTIVO_SEM_PERMISSAO

  const comTarefas = new Set<string>()
  for (const t of calc.resultado?.tarefas.values() ?? [])
    for (const w of t.wps) if (w.trecho_id) comTarefas.add(w.trecho_id)
  const locais = e.trechos.filter((t) => t.tipo === 'eixo' || o.areas)
  const trechosMostrados =
    o.trechos?.filter((id) => locais.some((t) => t.id === id)) ??
    locais.filter((t) => comTarefas.has(t.id)).map((t) => t.id)

  const zoomTempo = (f: number): void =>
    ui.setTcZoom({
      pxPorHora: Math.max(0.002, Math.min(200, (ui.tcZoom.pxPorHora ?? escala?.pxPorHora ?? 1) * f))
    })
  const zoomEstacas = (f: number): void =>
    ui.setTcZoom({
      pxPorMetro: Math.max(
        0.001,
        Math.min(50, (ui.tcZoom.pxPorMetro ?? escala?.pxPorMetro ?? 0.1) * f)
      )
    })
  const mudarTrecho = (id: string, on: boolean): void => {
    const atual = trechosMostrados
    ui.setTc({ trechos: on ? [...atual, id] : atual.filter((x) => x !== id) })
  }
  const moverTrecho = (id: string, d: -1 | 1): void => {
    const l = [...trechosMostrados]
    const i = l.indexOf(id),
      j = i + d
    if (i < 0 || j < 0 || j >= l.length) return
    ;[l[i], l[j]] = [l[j]!, l[i]!]
    ui.setTc({ trechos: l })
  }

  return (
    <>
      <BarraFerramentas rotulo="Ferramentas do tempo-caminho">
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
                titulo:
                  'Selecionar; arraste o começo da linha para mover o início ou o fim para mudar o término'
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
                  : 'Arraste do início, do meio ou do fim de uma linha até outra para criar a dependência'
              },
              {
                valor: 'dividir',
                rotulo: (
                  <>
                    <Scissors size={12} /> Dividir
                  </>
                ),
                desabilitado: somenteLeitura,
                titulo: somenteLeitura
                  ? motivo
                  : 'Clique numa estaca do eixo para dividir ali as tarefas que a cruzam'
              }
            ]}
          />
        </GrupoBarra>
        <GrupoBarra>
          <ZoomPar
            rotulo="Tempo"
            aoDiminuir={() => zoomTempo(1 / 1.5)}
            aoAumentar={() => zoomTempo(1.5)}
          />
          <ZoomPar
            rotulo="Estacas"
            aoDiminuir={() => zoomEstacas(1 / 1.5)}
            aoAumentar={() => zoomEstacas(1.5)}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => ui.setTcZoom({ pxPorHora: null, pxPorMetro: null })}
            title="Ajustar o gráfico à área da tela"
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
                onClick={() => setOpcoes((x) => !x)}
                title="Quais locais e o que desenhar"
              >
                <SlidersHorizontal size={12} /> Exibir
              </Button>
            }
          >
            <div className="w-80 space-y-3 p-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <TituloOpcoes>Locais (eixos na ordem, áreas à direita)</TituloOpcoes>
                  {o.trechos ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent hover:underline"
                      onClick={() => ui.setTc({ trechos: null })}
                    >
                      Só os com tarefas
                    </button>
                  ) : null}
                </div>
                {[
                  ...trechosMostrados
                    .map((id) => e.trechos.find((t) => t.id === id)!)
                    .filter(Boolean),
                  ...locais.filter((t) => !trechosMostrados.includes(t.id))
                ].map((t) => {
                  const on = trechosMostrados.includes(t.id)
                  return (
                    <div key={t.id} className="flex items-center gap-1">
                      <span
                        className={
                          t.tipo === 'area'
                            ? 'h-2.5 w-2.5 shrink-0 rounded-full'
                            : 'h-2.5 w-2.5 shrink-0 rounded-sm'
                        }
                        style={{ background: t.exib?.cor }}
                      />
                      <div className="min-w-0 flex-1">
                        <Caixa marcado={on} onMudar={(v) => mudarTrecho(t.id, v)}>
                          <span className="truncate">
                            {t.tipo === 'area' ? `Área ${t.nome}` : t.nome}
                          </span>
                          {!comTarefas.has(t.id) ? (
                            <span className="ml-1 text-xs text-text-muted">(sem tarefas)</span>
                          ) : null}
                        </Caixa>
                      </div>
                      {on ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => moverTrecho(t.id, -1)}
                            aria-label={`Mover ${t.nome} para a esquerda`}
                            title="Mover para a esquerda"
                          >
                            <ArrowUp size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => moverTrecho(t.id, 1)}
                            aria-label={`Mover ${t.nome} para a direita`}
                            title="Mover para a direita"
                          >
                            <ArrowDown size={12} />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <div className="space-y-1.5">
                <TituloOpcoes>Desenho</TituloOpcoes>
                <Caixa
                  marcado={o.areas}
                  onMudar={(v) => ui.setTc({ areas: v })}
                  dica="Locais sem estacas (OAE, jazida…) como colunas estreitas à direita dos eixos"
                >
                  Áreas
                </Caixa>
                <Caixa
                  marcado={o.areasResumo}
                  onMudar={(v) => ui.setTc({ areasResumo: v })}
                  dica="Contorno que envolve as tarefas de cada tarefa-resumo"
                >
                  Áreas das tarefas-resumo
                </Caixa>
                <Caixa marcado={o.rotulos} onMudar={(v) => ui.setTc({ rotulos: v })}>
                  Nome ao longo da linha
                </Caixa>
                <Caixa
                  marcado={o.caixas}
                  onMudar={(v) => ui.setTc({ caixas: v })}
                  dica="Retângulo envolvente de cada trecho contínuo da tarefa"
                >
                  Caixa das tarefas
                </Caixa>
                <Caixa
                  marcado={o.marcos}
                  onMudar={(v) => ui.setTc({ marcos: v })}
                  dica="Marcos com filtro de estacas: linhas no início e no fim da janela, nas faixas do marco"
                >
                  Marcos
                </Caixa>
                {e.plano.modo === 'controle' ? (
                  <Caixa
                    marcado={o.previsao}
                    onMudar={(v) => ui.setTc({ previsao: v })}
                    dica="Modo controle: o saldo de cada tarefa a partir da data de controle (tracejado)"
                  >
                    Previsão
                  </Caixa>
                ) : null}
                <Caixa marcado={o.dependencias} onMudar={(v) => ui.setTc({ dependencias: v })}>
                  Dependências
                </Caixa>
                <Caixa
                  marcado={o.automaticas}
                  onMudar={(v) => ui.setTc({ automaticas: v })}
                  desabilitado={!o.dependencias}
                >
                  Dependências derivadas dos serviços
                </Caixa>
              </div>
              <div className="space-y-1.5">
                <TituloOpcoes>Eixo do tempo</TituloOpcoes>
                <Caixa
                  marcado={o.fimDeSemana}
                  onMudar={(v) => ui.setTc({ fimDeSemana: v })}
                  dica="Com fins de semana, a linha fica vertical onde a tarefa para"
                >
                  Mostrar fins de semana
                </Caixa>
                <Caixa marcado={o.feriados} onMudar={(v) => ui.setTc({ feriados: v })}>
                  Mostrar feriados
                </Caixa>
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
        </GrupoBarra>
        <GrupoBarra fim>
          {calc.resultado?.controle ? (
            <LegendaControle
              visao="tempo-caminho"
              data={calc.resultado.controle.data}
              previsao={o.previsao}
            />
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
        <TempoCaminhoVista
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
