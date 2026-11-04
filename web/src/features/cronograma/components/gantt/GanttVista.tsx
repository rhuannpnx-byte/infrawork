/**
 * Visão Gantt do cronograma (a `GanttView` do ApeX sobre o plano do InfraWork): grade + linha do tempo, seleção
 * sincronizada, menus de contexto (`ContextMenuHelper`), dica das barras e os comandos que vão ao motor.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Calendar, getWorkDaysBetween } from '@apex/calendar'
import { toast } from 'sonner'
import { FolderPlus, ListPlus, Pencil, Wand2, Zap } from 'lucide-react'
import type { CalculoCronograma } from '../../hooks/calculo'
import { useAtualizarTarefa, useMudarTrecho } from '../../hooks/edicao'
import { useCronogramaUi, type ColunaGantt } from '../../store'
import { calendarioInterface, EixoTempo, HORA } from '../../visoes/eixo'
import {
  comFilhas,
  linhasVisiveis,
  montarGantt,
  numerarHierarquia,
  SEM_LOCAL,
  type DependenciaGantt,
  type LinhaGantt
} from '../../visoes/gantt-dados'
import {
  coresServicos,
  fmtData,
  fmtDataHora,
  fmtDias,
  fmtEstaca,
  fmtNum
} from '../../visoes/formato'
import { jornadaReferencia } from '../../motor/calendario'
import type { TarefaEntrada } from '../../motor/tipos'
import type { TarefaResultado } from '../../motor/calculo'
import { useMenusCronograma, type AcoesCronograma } from '../menus'
import { DicaFlutuante } from '../DicaFlutuante'
import { GanttGrade, type DefColuna } from './GanttGrade'
import {
  ALTURA_CABECALHO,
  GanttLinhaTempo,
  type InfoBarra,
  type ModoGantt
} from './GanttLinhaTempo'

export type AcoesGantt = AcoesCronograma

interface Props {
  calc: CalculoCronograma
  modo: ModoGantt
  somenteLeitura: boolean
  acoes: AcoesGantt
  /** pedido para rolar até uma data (botão "Hoje") */
  irPara: { t: number; seq: number } | null
  /** tarefas selecionadas (o pai mostra no painel e usa nos botões) */
  onSelecao?: (ids: string[]) => void
  /** escala efetiva (px por hora de trabalho): base do zoom do pai quando o eixo está ajustado */
  onEscala?: (pxPorHora: number) => void
}

const COLS_GANTT_BASE: Record<
  ColunaGantt,
  { titulo: string; largura: number; direita?: boolean; dica?: string }
> = {
  numero: { titulo: 'Nº', largura: 72 },
  nome: { titulo: 'Nome', largura: 230 },
  servico: { titulo: 'Serviço', largura: 72 },
  trecho: { titulo: 'Trecho', largura: 130, dica: 'Local da tarefa (clique para mudar de trecho)' },
  quantidade: { titulo: 'Quantidade', largura: 100, direita: true },
  inicio: { titulo: 'Início', largura: 68, direita: true },
  fim: { titulo: 'Término', largura: 68, direita: true },
  duracao: {
    titulo: 'Duração',
    largura: 66,
    direita: true,
    dica: 'Dias úteis no calendário da tarefa'
  },
  producao: {
    titulo: 'Produção/dia',
    largura: 104,
    direita: true,
    dica: 'Produção da composição × equipes'
  },
  equipes: { titulo: 'Equipes', largura: 120 },
  folga: { titulo: 'Folga', largura: 60, direita: true, dica: 'Folga total em dias de trabalho' },
  estacas: { titulo: 'Estacas', largura: 150 },
  prioridade: {
    titulo: 'Prior.',
    largura: 56,
    direita: true,
    dica: 'Prioridade de cálculo (maior primeiro)'
  },
  executado: {
    titulo: '% exec.',
    largura: 64,
    direita: true,
    dica: 'Modo controle: grau de execução pela produção lançada'
  },
  previsto: {
    titulo: 'Prev. término',
    largura: 86,
    direita: true,
    dica: 'Modo controle: término previsto pela taxa realizada e a planejada'
  }
}

export function GanttVista({
  calc,
  modo,
  somenteLeitura,
  acoes,
  irPara,
  onSelecao,
  onEscala
}: Props): ReactNode {
  const { entrada, resultado } = calc
  const ui = useCronogramaUi()
  const planoId = entrada?.plano.id ?? ''
  const atualizarTarefa = useAtualizarTarefa()
  const mudarTrecho = useMudarTrecho()

  const [selecao, setSelecao] = useState<Set<string>>(new Set())
  const [ancora, setAncora] = useState<string | null>(null)
  const [depSel, setDepSel] = useState<DependenciaGantt | null>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  /** posição vertical pedida pela grade (aplicada pela linha do tempo, que é a dona da rolagem) */
  const [pedidoTop, setPedidoTop] = useState<{ top: number; seq: number } | null>(null)
  const topRef = useRef(0)
  const [dica, setDica] = useState<{ x: number; y: number; linha: LinhaGantt } | null>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const [areaW, setAreaW] = useState(1200)
  const [areaH, setAreaH] = useState(600)
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setAreaW(el.clientWidth)
      setAreaH(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── modelo ──
  const dados = useMemo(
    () => (entrada ? montarGantt(entrada, resultado, ui.gantt) : null),
    [entrada, resultado, ui.gantt]
  )
  const recolhidas = useMemo(() => new Set(ui.recolhidas[planoId] ?? []), [ui.recolhidas, planoId])
  const linhas = useMemo(() => {
    if (!dados) return []
    const v = linhasVisiveis(dados.linhas, recolhidas)
    numerarHierarquia(v)
    return v
  }, [dados, recolhidas])
  const filhas = useMemo(() => (dados ? comFilhas(dados.linhas) : new Set<string>()), [dados])

  const porId = useMemo(() => new Map((entrada?.tarefas ?? []).map((t) => [t.id, t])), [entrada])
  const servicos = useMemo(
    () => new Map((entrada?.servicos ?? []).map((s) => [s.id, s])),
    [entrada]
  )
  const trechos = useMemo(() => new Map((entrada?.trechos ?? []).map((t) => [t.id, t])), [entrada])
  const equipesServico = useMemo(
    () => new Map((entrada?.equipes ?? []).map((q) => [q.servico_id, q])),
    [entrada]
  )
  const nomeadas = useMemo(
    () => new Map((entrada?.equipesNomeadas ?? []).map((q) => [q.id, q.nome])),
    [entrada]
  )
  const cores = useMemo(() => coresServicos(entrada?.servicos ?? []), [entrada])
  const jornada = useMemo(() => {
    const c =
      entrada?.calendarios.find((x) => x.id === resultado?.calendarioPadraoId) ??
      entrada?.calendarios[0]
    return c ? jornadaReferencia(c) || 8 : 8
  }, [entrada, resultado])

  // ── calendários e eixo ──
  const specPadrao = resultado ? resultado.calendarios[resultado.calendarioPadraoId] : undefined
  const global = useMemo(() => {
    try {
      return specPadrao ? new Calendar(specPadrao) : null
    } catch {
      return null
    }
  }, [specPadrao])
  const calInterface = useMemo(() => {
    try {
      return specPadrao
        ? calendarioInterface(specPadrao, ui.gantt.fimDeSemana, ui.gantt.feriados)
        : null
    } catch {
      return null
    }
  }, [specPadrao, ui.gantt.fimDeSemana, ui.gantt.feriados])
  const larguraGrade =
    ui.larguraGrade ??
    Math.min(
      Math.round(areaW * 0.6),
      ui.colunas.reduce((x, c) => x + COLS_GANTT_BASE[c].largura, 0) + 2
    )
  const larguraTempo = Math.max(300, areaW - larguraGrade - 5)
  const eixo = useMemo(() => {
    if (!calInterface || !dados) return null
    const horasTotais = (calInterface.AS2WS(dados.fim) - calInterface.AS2WS(dados.inicio)) / HORA
    const ajuste = horasTotais > 0 ? larguraTempo / horasTotais : 1
    const px = ui.pxPorHora ?? ajuste
    return new EixoTempo(calInterface, dados.inicio, dados.fim, Math.max(0.005, Math.min(400, px)))
  }, [calInterface, dados, ui.pxPorHora, larguraTempo])

  useEffect(() => {
    if (eixo) onEscala?.(eixo.pxPorHora)
  }, [eixo, onEscala])

  // ── seleção ──
  const chaveSel = (l: LinhaGantt): string => (l.tipo === 'tarefa' && l.id ? l.id : l.chave)
  const selecionar = useCallback(
    (l: LinhaGantt, e: { ctrl: boolean; shift: boolean }) => {
      const k = chaveSel(l)
      setDepSel(null)
      setSelecao((atual) => {
        if (e.shift && ancora) {
          const a = linhas.findIndex((x) => chaveSel(x) === ancora)
          const b = linhas.findIndex((x) => x.chave === l.chave)
          if (a >= 0 && b >= 0) {
            const novo = new Set(e.ctrl ? atual : [])
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) novo.add(chaveSel(linhas[i]!))
            return novo
          }
        }
        if (e.ctrl) {
          const novo = new Set(atual)
          if (novo.has(k)) novo.delete(k)
          else novo.add(k)
          return novo
        }
        return atual.size === 1 && atual.has(k) ? atual : new Set([k])
      })
      if (!e.shift) setAncora(k)
    },
    [ancora, linhas]
  )
  const tarefasSel = useMemo(
    () => [...selecao].filter((k) => porId.get(k)?.tipo_no === 'tarefa'),
    [selecao, porId]
  )
  useEffect(() => {
    onSelecao?.(tarefasSel)
  }, [tarefasSel, onSelecao])

  // ── textos da grade ──
  const resTarefa = (id: string | null): TarefaResultado | undefined =>
    id ? resultado?.tarefas.get(id) : undefined
  const unidade = (t: TarefaEntrada | undefined): string =>
    t?.servico_id ? (servicos.get(t.servico_id)?.unidade ?? '') : ''
  const producaoDia = (t: TarefaEntrada): number | null => {
    const q = t.servico_id ? equipesServico.get(t.servico_id) : undefined
    const p = Number(q?.producao_diaria) || 0
    return p > 0 ? p * Math.max(1, t.qtd_equipes) * t.coef_producao : null
  }
  const periodoLinha = (l: LinhaGantt): { b: number; e: number } | null =>
    l.barra ? { b: l.barra.inicio, e: l.barra.fim } : null
  /** tarefas abaixo de cada linha de grupo (soma de quantidades; grau no modo controle) */
  const tarefasDe = useMemo(() => {
    const out = new Map<string, string[]>()
    if (!dados) return out
    const pilha: { chave: string; nivel: number }[] = []
    for (const l of dados.linhas) {
      while (pilha.length && pilha[pilha.length - 1]!.nivel >= l.nivel) pilha.pop()
      if (l.tipo === 'tarefa' && l.id)
        for (const a of pilha) out.set(a.chave, [...(out.get(a.chave) ?? []), l.id])
      pilha.push({ chave: l.chave, nivel: l.nivel })
    }
    return out
  }, [dados])
  /** locais da tarefa com trecho, na ordem */
  const locaisDe = (t: TarefaEntrada): TarefaEntrada['locais'] =>
    [...t.locais].filter((l) => l.trecho_id).sort((a, b) => a.ordem - b.ordem)
  const nomeTrecho = (id: string): string => {
    const tr = trechos.get(id)
    return tr ? (tr.tipo === 'area' ? `Área ${tr.nome}` : tr.nome) : ''
  }
  /** "Estacas" da tarefa pelos seus locais (não pelo cálculo): a tarefa é os seus locais */
  const estacasDe = (t: TarefaEntrada): string => {
    const ls = locaisDe(t)
    if (!ls.length) return ''
    const ids = new Set(ls.map((l) => l.trecho_id))
    if (ids.size > 1) return `${ids.size} trechos`
    const tr = trechos.get(ls[0]!.trecho_id!)
    if (tr?.tipo === 'area') return 'área inteira'
    const com = ls.filter((l) => l.inicio_m !== null && l.fim_m !== null)
    if (!com.length) return ''
    return `${fmtEstaca(Math.min(...com.map((l) => l.inicio_m!)), tr)} – ${fmtEstaca(Math.max(...com.map((l) => l.fim_m!)), tr)}`
  }
  const colunas: DefColuna[] = useMemo(
    () =>
      ui.colunas.map((id) => {
        const base = COLS_GANTT_BASE[id]
        const c: DefColuna = { id, ...base, texto: () => '' }
        switch (id) {
          case 'numero':
            c.texto = (l) => l.numero ?? ''
            break
          case 'nome':
            c.texto = (l) => l.texto
            c.editar = {
              tipo: 'texto',
              valor: (l) => l.texto,
              gravar: (l, v) =>
                l.id &&
                v.trim() &&
                atualizarTarefa.mutate(
                  { planejamentoId: planoId, id: l.id, campos: { nome_custom: v.trim() } },
                  { onError: (e) => toast.error(e.message) }
                )
            }
            break
          case 'servico':
            c.texto = (l) => {
              const t = l.id ? porId.get(l.id) : undefined
              return t?.servico_id ? (servicos.get(t.servico_id)?.codigo ?? '') : ''
            }
            break
          case 'quantidade':
            c.texto = (l) => {
              const t = l.id ? porId.get(l.id) : undefined
              if (l.tipo === 'tarefa')
                return t && t.quantidade
                  ? `${fmtNum(t.quantidade, 'auto')} ${unidade(t)}`.trim()
                  : ''
              // linhas de local e serviço somam as tarefas de baixo quando a unidade é uma só
              if (l.tipo !== 'local' && l.tipo !== 'servico') return ''
              const ts = (tarefasDe.get(l.chave) ?? [])
                .map((id) => porId.get(id))
                .filter((x): x is TarefaEntrada => !!x && !x.is_indireto)
              const uns = new Set(ts.map(unidade))
              if (!ts.length || uns.size !== 1) return ''
              const s = ts.reduce((a, x) => a + x.quantidade, 0)
              return s ? `${fmtNum(s, 'auto')} ${[...uns][0]}`.trim() : ''
            }
            break
          case 'trecho':
            c.texto = (l) => {
              const t = l.id ? porId.get(l.id) : undefined
              if (l.tipo !== 'tarefa' || !t || t.is_indireto) return ''
              const ids = [...new Set(locaisDe(t).map((x) => x.trecho_id!))]
              if (!ids.length) return SEM_LOCAL
              return ids.length > 1 ? `${ids.length} trechos` : nomeTrecho(ids[0]!)
            }
            c.editar = {
              tipo: 'opcoes',
              valor: (l) => {
                const t = l.id ? porId.get(l.id) : undefined
                const ids = t ? [...new Set(locaisDe(t).map((x) => x.trecho_id!))] : []
                return ids.length === 1 ? ids[0]! : ''
              },
              opcoes: () => [
                { valor: '', rotulo: SEM_LOCAL },
                ...[...trechos.values()].map((tr) => ({ valor: tr.id, rotulo: nomeTrecho(tr.id) }))
              ],
              gravar: (l, v) =>
                l.id &&
                mudarTrecho.mutate(
                  { planejamentoId: planoId, tarefaId: l.id, trechoId: v || null },
                  {
                    onSuccess: (r) => r.avisos.length && toast.warning(r.avisos.join(' · ')),
                    onError: (e) => toast.error(e.message)
                  }
                )
            }
            break
          case 'inicio':
            c.texto = (l) => fmtData(periodoLinha(l)?.b)
            break
          case 'fim':
            c.texto = (l) => fmtData(periodoLinha(l) ? periodoLinha(l)!.e - 1 : null)
            break
          case 'duracao':
            c.texto = (l) => {
              const r = resTarefa(l.id)
              if (l.tipo === 'tarefa' && r) return fmtDias(r.duracao_dias_uteis)
              const pr = periodoLinha(l)
              return pr && global
                ? fmtDias(Math.max(0, getWorkDaysBetween(global, pr.b, pr.e)))
                : ''
            }
            break
          case 'producao':
            c.texto = (l) => {
              const t = l.id ? porId.get(l.id) : undefined
              const v = t && l.tipo === 'tarefa' ? producaoDia(t) : null
              return v ? `${fmtNum(v, 'auto')} ${unidade(t)}` : ''
            }
            break
          case 'equipes':
            c.texto = (l) => {
              const t = l.id ? porId.get(l.id) : undefined
              if (!t || l.tipo !== 'tarefa' || t.is_indireto) return ''
              const nomes = t.equipes_ids.map((x) => nomeadas.get(x)).filter(Boolean)
              return [`${t.qtd_equipes}×`, ...nomes].join(' ')
            }
            c.editar = {
              tipo: 'inteiro',
              valor: (l) => String(porId.get(l.id ?? '')?.qtd_equipes ?? 1),
              gravar: (l, v) => {
                const n = Math.round(Number(v.replace(',', '.')))
                if (!(n >= 1 && n <= 50))
                  return void toast.error('O número de equipes vai de 1 a 50.')
                if (l.id)
                  atualizarTarefa.mutate(
                    { planejamentoId: planoId, id: l.id, campos: { qtd_equipes: n } },
                    { onError: (e) => toast.error(e.message) }
                  )
              }
            }
            break
          case 'folga':
            c.texto = (l) => {
              const r = resTarefa(l.id)
              return l.tipo === 'tarefa' && r ? fmtDias(r.folga_total_h / jornada) : ''
            }
            break
          case 'estacas':
            c.texto = (l) => {
              // linha do local: a faixa do eixo ("Location's station span")
              if (l.tipo === 'local' && l.trechoId) {
                const tr = trechos.get(l.trechoId)
                return tr?.tipo === 'eixo' && tr.comprimento_m
                  ? `${fmtEstaca(0, tr)} – ${fmtEstaca(tr.comprimento_m, tr)}`
                  : ''
              }
              const t = l.id ? porId.get(l.id) : undefined
              return l.tipo === 'tarefa' && t ? estacasDe(t) : ''
            }
            break
          case 'executado':
            c.texto = (l) => {
              const g = grauLinha(l)
              return g === null ? '' : `${fmtNum(g * 100, 0)} %`
            }
            break
          case 'previsto':
            c.texto = (l) => {
              const f = l.id ? resultado?.controle?.tarefas[l.id]?.fim_previsto : undefined
              return f ? fmtData(f - 1) : ''
            }
            break
          case 'prioridade':
            c.texto = (l) =>
              l.tipo === 'tarefa' && l.id && resTarefa(l.id)
                ? String(porId.get(l.id)?.prioridade ?? '')
                : ''
            c.editar = {
              tipo: 'inteiro',
              valor: (l) => String(porId.get(l.id ?? '')?.prioridade ?? 500),
              gravar: (l, v) => {
                const n = Math.round(Number(v.replace(',', '.')))
                if (!(n >= 0))
                  return void toast.error('A prioridade é um número inteiro a partir de zero.')
                if (l.id)
                  atualizarTarefa.mutate(
                    { planejamentoId: planoId, id: l.id, campos: { prioridade: n } },
                    { onError: (e) => toast.error(e.message) }
                  )
              }
            }
            break
        }
        return c
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ui.colunas, porId, servicos, resultado, global, jornada, nomeadas, trechos, planoId, tarefasDe]
  )

  const corLinha = useCallback(
    (l: LinhaGantt): string => {
      if (l.tipo === 'tarefa') {
        const t = l.id ? porId.get(l.id) : undefined
        return (
          t?.exib?.aparencia?.cor ||
          (t?.servico_id ? cores.get(t.servico_id) : undefined) ||
          'var(--text-dim)'
        )
      }
      if (l.tipo === 'servico') return (l.servicoId && cores.get(l.servicoId)) || 'var(--text-dim)'
      if (l.tipo === 'local')
        return (l.trechoId && trechos.get(l.trechoId)?.exib?.cor) || 'var(--text-dim)'
      return 'var(--text-muted)'
    },
    [porId, cores, trechos]
  )

  const cruzam = useCallback(
    (a: string, b: string): boolean => {
      const wa = resTarefa(a)?.wps ?? [],
        wb = resTarefa(b)?.wps ?? []
      return wa.some((x) =>
        wb.some(
          (y) =>
            x.trecho_id &&
            x.trecho_id === y.trecho_id &&
            x.inicio_m < y.fim_m &&
            y.inicio_m < x.fim_m
        )
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resultado]
  )

  // ── modo controle: grau de cada linha (tarefas pelo motor; grupos pela regra `OnLeave`/`SetCompletedXCoord` do ApeX) ──
  const grauLinha = useCallback(
    (l: LinhaGantt): number | null => {
      const ctl = resultado?.controle
      if (!ctl) return null
      if (l.tipo === 'tarefa') return l.id && ctl.tarefas[l.id] ? ctl.tarefas[l.id]!.grau : null
      if (!l.barra || !eixo) return null
      // completedX = menor x executado dos filhos não concluídos (no eixo); depois a fração da barra do grupo
      let cx = Infinity
      for (const id of tarefasDe.get(l.chave) ?? []) {
        const c = ctl.tarefas[id]
        const r = resultado.tarefas.get(id)
        if (!c || !r || c.grau >= 1) continue
        const a = eixo.x(r.inicio)
        cx = Math.min(cx, a + (eixo.x(r.fim) - a) * c.grau)
      }
      if (cx === Infinity)
        return (tarefasDe.get(l.chave) ?? []).some((id) => ctl.tarefas[id]) ? 1 : null
      const esq = eixo.x(l.barra.inicio)
      const dir = eixo.x(l.barra.fim)
      return cx > dir ? 1 : cx > esq && dir > esq ? (cx - esq) / (dir - esq) : 0
    },
    [resultado, tarefasDe, eixo]
  )
  const infoBarra = useCallback(
    (l: LinhaGantt): InfoBarra => {
      const t = l.id ? porId.get(l.id) : undefined
      const r = l.id ? resultado?.tarefas.get(l.id) : undefined
      return {
        cor: corLinha(l),
        moverInicio: !!t && !t.asap && !somenteLeitura,
        critica: ui.gantt.critico && !!r && r.folga_total_h <= 1e-6,
        rotulo: t?.exib?.aparencia?.rotulo === false ? '' : l.texto,
        grau: grauLinha(l),
        fimPrevisto:
          l.tipo === 'tarefa' && l.id
            ? (resultado?.controle?.tarefas[l.id]?.fim_previsto ?? null)
            : null,
        equipes: t && r && !t.is_indireto ? Math.max(1, Math.round(t.qtd_equipes || 1)) : null
      }
    },
    [porId, resultado, corLinha, somenteLeitura, ui.gantt.critico, grauLinha]
  )

  // ── menus e comandos (comuns às visões) ──
  const menus = useMenusCronograma(calc, somenteLeitura, acoes, () => setSelecao(new Set()))
  const executar = menus.executar

  const menuLinha = (l: LinhaGantt, x: number, y: number): void => {
    const k = chaveSel(l)
    if (!selecao.has(k)) setSelecao(new Set([k]))
    if (l.tipo === 'tarefa' && l.id)
      return menus.menuTarefas(selecao.has(k) ? [...selecao] : [k], x, y)
    if (l.tipo === 'grupo' && l.id) return menus.menuGrupo(l.id, x, y)
    const ro = somenteLeitura
    if (l.tipo === 'plano') {
      return menus.abrir(
        [
          {
            rotulo: 'Propriedades do plano…',
            padrao: true,
            icone: <Pencil size={12} />,
            acao: () => acoes.abrirPlano()
          },
          'sep',
          {
            rotulo: 'Criar tarefas…',
            icone: <ListPlus size={12} />,
            desabilitado: ro,
            acao: () => acoes.criarTarefas(null)
          },
          {
            rotulo: 'Nova tarefa-resumo…',
            icone: <FolderPlus size={12} />,
            desabilitado: ro,
            acao: () => acoes.novoGrupo(null)
          },
          {
            rotulo: 'Renomear tarefas automaticamente',
            icone: <Wand2 size={12} />,
            desabilitado: ro,
            acao: menus.renomearTudo
          },
          'sep',
          { rotulo: 'Expandir tudo', acao: () => ui.setRecolhidas(planoId, []) },
          {
            rotulo: 'Recolher tudo',
            acao: () =>
              ui.setRecolhidas(
                planoId,
                [...filhas].filter((c) => c !== 'p')
              )
          }
        ],
        x,
        y
      )
    }
    menuFundo(x, y)
  }

  const menuFundo = (x: number, y: number): void => {
    const ro = somenteLeitura
    menus.abrir(
      [
        {
          rotulo: 'Criar tarefas…',
          icone: <ListPlus size={12} />,
          desabilitado: ro,
          acao: () => acoes.criarTarefas(null)
        },
        {
          rotulo: 'Nova tarefa-resumo…',
          icone: <FolderPlus size={12} />,
          desabilitado: ro,
          acao: () => acoes.novoGrupo(null)
        },
        'sep',
        { rotulo: 'Expandir tudo', acao: () => ui.setRecolhidas(planoId, []) },
        {
          rotulo: 'Recolher tudo',
          acao: () =>
            ui.setRecolhidas(
              planoId,
              [...filhas].filter((c) => c !== 'p')
            )
        },
        'sep',
        {
          rotulo: 'Renomear tarefas automaticamente',
          icone: <Wand2 size={12} />,
          desabilitado: ro,
          acao: menus.renomearTudo
        },
        {
          rotulo: 'Compactar o cronograma',
          icone: <Zap size={12} />,
          desabilitado: ro,
          acao: () => executar({ tipo: 'compactar' })
        }
      ],
      x,
      y
    )
  }

  // Delete remove a seleção (tarefas ou a dependência selecionada)
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (somenteLeitura || e.key !== 'Delete') return
      const alvo = e.target as HTMLElement
      if (alvo.closest('input, textarea, select, [contenteditable]')) return
      if (depSel?.id) {
        menus.removerDependencia(depSel.id)
        setDepSel(null)
        return
      }
      const ids = [...selecao].filter((k) => porId.has(k))
      if (ids.length) void menus.remover(ids)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecao, depSel, somenteLeitura, planoId, porId])

  // Rolagem vertical: a linha do tempo é a dona da posição (a grade só a acompanha). Ações na grade (roda do mouse,
  // foco numa célula) viram um *pedido* explícito; o eco da própria rolagem da linha do tempo nunca volta para ela —
  // com a rolagem suave do navegador, o valor ecoado chega um quadro atrasado e puxava a tela para trás (tremia).
  const rolarPara = (top: number): void => {
    const novo = Math.max(0, top)
    topRef.current = novo
    setScroll((s) => ({ ...s, top: novo }))
    setPedidoTop((p) => ({ top: novo, seq: (p?.seq ?? 0) + 1 }))
  }
  const rolar = (dy: number): void => rolarPara(topRef.current + dy)

  if (!entrada || !dados) return null

  return (
    <div ref={areaRef} className="flex h-full min-h-0 w-full">
      <GanttGrade
        linhas={linhas}
        colunas={colunas}
        largura={larguraGrade}
        scrollTop={scroll.top}
        alturaVista={areaH - ALTURA_CABECALHO}
        comFilhas={filhas}
        recolhidas={recolhidas}
        selecionadas={selecao}
        cores={corLinha}
        somenteLeitura={somenteLeitura}
        onRolar={rolar}
        onRolarPara={rolarPara}
        onAlternar={(l) => ui.alternarRecolhida(planoId, l.chave)}
        onSelecionar={selecionar}
        onAbrir={(l) => abrirLinha(l)}
        onMenu={(l, x, y) => (l ? menuLinha(l, x, y) : menuFundo(x, y))}
      />
      <Divisoria largura={larguraGrade} onMudar={ui.setLarguraGrade} />
      <div className="min-w-0 flex-1">
        {eixo ? (
          <GanttLinhaTempo
            linhas={linhas}
            dados={dados}
            eixo={eixo}
            global={global}
            infoBarra={infoBarra}
            cruzam={cruzam}
            modo={modo}
            somenteLeitura={somenteLeitura}
            mostrarAutomaticas={ui.gantt.automaticas}
            mostrarRotulos={ui.gantt.rotulos}
            mostrarNumeros={ui.gantt.numeros}
            selecionadas={selecao}
            depSelecionada={depSel?.id ?? null}
            pedidoTop={pedidoTop}
            onScroll={(top, left) => {
              topRef.current = top
              setScroll({ top, left })
            }}
            onSelecionarLinha={selecionar}
            onAbrirLinha={abrirLinha}
            onMenuLinha={menuLinha}
            onMenuFundo={menuFundo}
            onSelecionarDependencia={(d) => {
              setDepSel(d)
              if (d) setSelecao(new Set())
            }}
            onAbrirDependencia={(d) => {
              acoes.abrirDependencia({
                id: d.usuario ? d.id : null,
                pred: d.pred,
                succ: d.succ,
                tipo: d.usuario ? d.tipo : 'EST',
                derivada: !d.usuario
              })
            }}
            onMenuDependencia={menus.menuDependencia}
            onArrastar={(a) =>
              executar(
                a.tipo === 'inicio'
                  ? { tipo: 'inicio', tarefaId: a.tarefaId, em: a.data }
                  : { tipo: 'fim', tarefaId: a.tarefaId, em: a.data }
              )
            }
            onNovaDependencia={(pred, succ, tipo) =>
              acoes.abrirDependencia({ id: null, pred, succ, tipo })
            }
            faixas={(id) => calc.faixas(id)}
            onDica={setDica}
            irPara={irPara}
            dataControle={resultado?.controle?.data ?? null}
          />
        ) : null}
      </div>
      {menus.elemento}
      {dica ? <DicaFlutuante x={dica.x} y={dica.y} conteudo={conteudoDica(dica.linha)} /> : null}
    </div>
  )

  function abrirLinha(l: LinhaGantt): void {
    if (l.tipo === 'tarefa' && l.id) acoes.abrirTarefa(l.id)
    else if (l.tipo === 'grupo' && l.id) acoes.abrirGrupo(l.id)
    else if (l.tipo === 'plano') acoes.abrirPlano()
    else if (l.tipo === 'local' && l.trechoId) acoes.abrirLocal(l.trechoId)
    else ui.alternarRecolhida(planoId, l.chave)
  }

  function conteudoDica(l: LinhaGantt): {
    titulo: string
    linhas: [string, string][]
    avisos: string[]
  } {
    const t = l.id ? porId.get(l.id) : undefined
    const r = resTarefa(l.id)
    const out: [string, string][] = []
    const avisos: string[] = []
    if (l.tipo === 'tarefa' && t) {
      const s = t.servico_id ? servicos.get(t.servico_id) : undefined
      if (s) out.push(['Serviço', `${s.codigo} ${s.nome}`])
      if (t.quantidade) out.push(['Quantidade', `${fmtNum(t.quantidade, 'auto')} ${unidade(t)}`])
      // locais (work places): trecho, faixa, quantidade e o período calculado de cada um
      const ls = locaisDe(t)
      ls.forEach((l, k) => {
        const tr = trechos.get(l.trecho_id!)
        const faixa =
          tr?.tipo === 'area' || l.inicio_m === null || l.fim_m === null
            ? 'área inteira'
            : `${fmtEstaca(l.inicio_m, tr)} – ${fmtEstaca(l.fim_m, tr)}`
        const ws = (r?.wps ?? []).filter((w) => w.local_id === l.id)
        const quando = ws.length
          ? ` · ${fmtData(Math.min(...ws.map((w) => w.inicio)))} → ${fmtData(Math.max(...ws.map((w) => w.fim)) - 1)}`
          : ''
        out.push([
          ls.length > 1 ? `Local ${k + 1}` : 'Local',
          `${nomeTrecho(l.trecho_id!)} · ${faixa} · ${fmtNum(l.quantidade, 'auto')} ${unidade(t)}${l.qtd_origem === 'trecho' ? ' (do template)' : ''}${quando}`
        ])
      })
      if (!ls.length && !t.is_indireto) out.push(['Local', SEM_LOCAL])
      if (r) {
        out.push(['Período', `${fmtDataHora(r.inicio)} → ${fmtDataHora(r.fim)}`])
        out.push(['Duração', `${fmtDias(r.duracao_dias_uteis)} (${fmtNum(r.duracao_h, 1)} h)`])
        out.push(['Folga total', fmtDias(r.folga_total_h / jornada)])
        out.push(['Folga livre', fmtDias(r.folga_livre_h / jornada)])
      }
      const pd = producaoDia(t)
      if (pd)
        out.push([
          'Produção',
          `${fmtNum(pd, 'auto')} ${unidade(t)}/dia (${t.qtd_equipes}× equipe${t.qtd_equipes === 1 ? '' : 's'})`
        ])
      if (Math.abs(t.coef_producao - 1) > 1e-9)
        avisos.push(
          `Produtividade alterada (× ${fmtNum(t.coef_producao, 'auto')}) por um arraste antigo — em Propriedades › Equipes, volte à da composição.`
        )
      out.push(['Esticar o término', 'muda o número de equipes (a produção é a da composição)'])
      const nomes = t.equipes_ids.map((x) => nomeadas.get(x)).filter(Boolean)
      if (nomes.length) out.push(['Equipes', nomes.join(', ')])
      out.push(['Início', t.asap ? 'o mais cedo possível' : 'desejado (arraste para mover)'])
      const ctl = resultado?.controle?.tarefas[t.id]
      if (ctl) {
        out.push([
          'Executado',
          `${fmtNum(ctl.realizado, 'auto')} ${unidade(t)} (${fmtNum(ctl.grau * 100, 0)} %)`
        ])
        if (ctl.taxa_real)
          out.push(['Taxa real', `${fmtNum(ctl.taxa_real, 'auto')} ${unidade(t)}/dia`])
        if (ctl.fim_previsto && r) {
          const atraso = (ctl.fim_previsto - r.fim) / 86400
          out.push([
            'Previsão',
            `${fmtDataHora(ctl.fim_previsto)}${Math.abs(atraso) >= 0.5 ? ` (${atraso > 0 ? '+' : ''}${fmtNum(atraso, 0)} d)` : ''}`
          ])
        }
      }
      if (r?.sem_producao)
        avisos.push('Sem produção: a composição do serviço não tem produção/dia.')
      for (const v of dados?.violacoes ?? []) if (v.tarefaId === t.id) avisos.push(v.texto)
    } else if (l.barra) {
      out.push(['Período', `${fmtData(l.barra.inicio)} → ${fmtData(l.barra.fim - 1)}`])
      if (global)
        out.push(['Duração', fmtDias(getWorkDaysBetween(global, l.barra.inicio, l.barra.fim))])
    }
    return { titulo: l.texto, linhas: out, avisos }
  }
}

function Divisoria({
  largura,
  onMudar
}: {
  largura: number
  onMudar: (w: number | null) => void
}): ReactNode {
  const ini = useRef<{ x: number; w: number } | null>(null)
  return (
    <div
      className="w-[5px] shrink-0 cursor-col-resize border-x border-border bg-bg-panel hover:bg-accent/30"
      onPointerDown={(e) => {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        ini.current = { x: e.clientX, w: largura }
      }}
      onPointerMove={(e) => ini.current && onMudar(ini.current.w + e.clientX - ini.current.x)}
      onPointerUp={() => (ini.current = null)}
      onDoubleClick={() => onMudar(null)}
      title="Arraste para mudar a largura da grade; duplo clique ajusta às colunas"
    />
  )
}
