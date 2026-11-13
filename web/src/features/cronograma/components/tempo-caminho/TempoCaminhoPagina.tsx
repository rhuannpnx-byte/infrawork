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
  SlidersHorizontal,
  ZoomIn,
  ZoomOut
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
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-bg-panel px-3 py-1.5">
        <div className="flex rounded border border-border-strong p-0.5">
          <Button
            variant={modo === 'selecionar' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setModo('selecionar')}
            title="Selecionar; arraste o começo da linha para mover o início ou o fim para mudar o término"
          >
            <MousePointer2 size={12} /> Selecionar
          </Button>
          <Button
            variant={modo === 'dependencias' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setModo('dependencias')}
            disabled={somenteLeitura}
            title="Arraste do início, meio ou fim de uma linha até outra para criar a dependência"
          >
            <ArrowRightLeft size={12} /> Dependências
          </Button>
          <Button
            variant={modo === 'dividir' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setModo('dividir')}
            disabled={somenteLeitura}
            title="Clique numa estaca do eixo para dividir ali as tarefas que a cruzam"
          >
            <Scissors size={12} /> Dividir
          </Button>
        </div>
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-2xs text-text-dim">Tempo</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => zoomTempo(1 / 1.5)}
          title="Comprimir o tempo"
        >
          <ZoomOut size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => zoomTempo(1.5)} title="Esticar o tempo">
          <ZoomIn size={14} />
        </Button>
        <span className="ml-1 text-2xs text-text-dim">Estacas</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => zoomEstacas(1 / 1.5)}
          title="Comprimir as estacas"
        >
          <ZoomOut size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => zoomEstacas(1.5)}
          title="Esticar as estacas"
        >
          <ZoomIn size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => ui.setTcZoom({ pxPorHora: null, pxPorMetro: null })}
          title="Ajustar o gráfico à área"
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
            <Button variant="ghost" size="sm" onClick={() => setOpcoes((x) => !x)}>
              <SlidersHorizontal size={12} /> Exibir
            </Button>
          }
        >
          <div className="w-80 space-y-3 rounded-md border border-border-strong bg-bg-elevated p-3 shadow-xl">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                  Locais (eixos na ordem; áreas à direita)
                </span>
                {o.trechos ? (
                  <button
                    type="button"
                    className="text-2xs text-accent hover:underline"
                    onClick={() => ui.setTc({ trechos: null })}
                  >
                    os com tarefas
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
                          <span className="ml-1 text-2xs text-text-dim">(sem tarefas)</span>
                        ) : null}
                      </Caixa>
                    </div>
                    {on ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => moverTrecho(t.id, -1)}
                          aria-label="Para a esquerda"
                        >
                          <ArrowUp size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => moverTrecho(t.id, 1)}
                          aria-label="Para a direita"
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
              <div className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                Desenho
              </div>
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
                dica="Fecho das tarefas de cada tarefa-resumo (as áreas das sum tasks do DynaRoad)"
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
              <div className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                Eixo do tempo
              </div>
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
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => acoes.criarTarefas(null)}
          disabled={somenteLeitura}
        >
          <ListPlus size={12} /> Criar tarefas
        </Button>
        <Button variant="ghost" size="sm" onClick={dialogos.abrirMarcos}>
          <Diamond size={12} /> Marcos
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {calc.resultado?.controle ? (
            <LegendaControle
              visao="tempo-caminho"
              data={calc.resultado.controle.data}
              previsao={o.previsao}
            />
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
