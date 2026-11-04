/**
 * Linhas e barras do Gantt a partir do plano e do resultado do motor — o `buildGanttData` do ApeX
 * (`views/gantt/data.ts`) sobre os dados do InfraWork.
 *
 * Hierarquia como no ApeX: o plano (tarefa-resumo raiz) → tarefas-resumo (EAP) → local (trecho, ou "Sem local") →
 * tipo (serviço) → tarefa. As barras dos grupos são a união das barras das tarefas de baixo; a dos resumos sobe da
 * mais funda para a raiz (`OnLeave`). Sem o agrupamento por local e serviço (opção do InfraWork), as tarefas ficam
 * direto sob a tarefa-resumo, na ordem da EAP.
 *
 * Também as dependências visíveis (do usuário e as derivadas dos tipos), os marcos com as tarefas incluídas, as
 * violações (bandeiras) e o período do eixo (`GetDateSpan`: folga de 10 % dos dias, entre 1 e 100 dias).
 */
import { beginOfCalendarDay, endOfCalendarDay } from '@apex/calendar'
import type { ResultadoCalculo, TarefaResultado, ViolacaoTarefa } from '../motor/calculo'
import { isoParaSeg } from '../motor/tempo'
import type { PlanoEntrada, TarefaEntrada, TipoDependencia } from '../motor/tipos'
import { pontoViolacaoDependencia } from './dependencias'
import { DIA } from './eixo'

export type TipoLinha = 'plano' | 'grupo' | 'local' | 'servico' | 'tarefa'

export interface BarraGantt {
  inicio: number
  fim: number
  /** barra de tarefa (arrastável) */
  tarefa: boolean
}

export interface LinhaGantt {
  chave: string
  tipo: TipoLinha
  nivel: number
  texto: string
  /** tarefa ou tarefa-resumo do InfraWork */
  id: string | null
  pai: string | null
  barra: BarraGantt | null
  /** número da hierarquia ("1", "1.2"), só nas linhas visíveis */
  numero?: string
  /** serviço da linha (tipo) ou da tarefa */
  servicoId: string | null
  trechoId: string | null
}

export interface DependenciaGantt {
  /** id em planejamento_dependencia (só as do usuário) */
  id: string | null
  pred: string
  succ: string
  tipo: TipoDependencia
  usuario: boolean
}

export interface MarcoGantt {
  id: string
  nome: string
  inicio: number | null
  fim: number | null
  tarefas: string[]
}

export type PontoViolacao = 'inicio' | 'meio' | 'fim'

export interface ViolacaoGantt {
  tarefaId: string
  ponto: PontoViolacao
  texto: string
}

export interface OpcoesGantt {
  /** linhas de local (trecho) e tipo (serviço), como no ApeX */
  agrupar: boolean
  /** linhas das tarefas-resumo (`SHOW_SUM_TASKS`) */
  resumos: boolean
  /** marcos (`SHOW_MILESTONES`) */
  marcos: boolean
}

export const OPCOES_GANTT_PADRAO: OpcoesGantt = { agrupar: true, resumos: true, marcos: true }

export interface DadosGantt {
  linhas: LinhaGantt[]
  dependencias: DependenciaGantt[]
  marcos: MarcoGantt[]
  violacoes: ViolacaoGantt[]
  inicio: number
  fim: number
}

const TIPO_AUTO: Record<number, TipoDependencia> = { 0: 'FF', 1: 'SF', 2: 'FS', 3: 'SS', 4: 'EST' }
export const SEM_LOCAL = 'Sem local'

const textoViolacao = (
  v: ViolacaoTarefa,
  nomeTarefa: (id: string) => string,
  nomeMarco: (id: string) => string
): string => {
  switch (v.tipo) {
    case 'dependencia':
      return `Atraso máximo da dependência violado (de ${nomeTarefa(v.dependencia_predecessora)})`
    case 'restricao':
      return v.ponto === 'inicio' ? 'Restrição de início violada' : 'Restrição de término violada'
    case 'marco':
      return `Marco violado: ${nomeMarco(v.marco_id)}`
    case 'projeto':
      return v.ponto === 'inicio' ? 'Início do projeto violado' : 'Prazo do projeto violado'
  }
}

/** Barra de uma tarefa fora do motor (indireto): a janela calculada. */
function barraIndireto(r: ResultadoCalculo, id: string): BarraGantt | null {
  const i = r.indiretos.find((x) => x.tarefa_id === id)
  return i && i.fim > i.inicio ? { inicio: i.inicio, fim: i.fim, tarefa: false } : null
}

export function montarGantt(
  e: PlanoEntrada,
  r: ResultadoCalculo | undefined,
  o: OpcoesGantt = OPCOES_GANTT_PADRAO
): DadosGantt {
  const servicos = new Map(e.servicos.map((s) => [s.id, s]))
  const trechos = new Map(e.trechos.map((t) => [t.id, t]))
  const porId = new Map(e.tarefas.map((t) => [t.id, t]))
  const filhos = new Map<string | null, TarefaEntrada[]>()
  for (const t of e.tarefas) {
    const pai = t.parent_id && porId.get(t.parent_id)?.tipo_no === 'grupo' ? t.parent_id : null
    const l = filhos.get(pai) ?? []
    l.push(t)
    filhos.set(pai, l)
  }
  for (const l of filhos.values()) l.sort((a, b) => a.ordem - b.ordem)

  const res = (id: string): TarefaResultado | undefined => r?.tarefas.get(id)
  const barraTarefa = (t: TarefaEntrada): BarraGantt | null => {
    const x = res(t.id)
    if (x) return { inicio: x.inicio, fim: x.fim, tarefa: true }
    return r ? barraIndireto(r, t.id) : null
  }
  const trechoDe = (t: TarefaEntrada): string | null => {
    const w = res(t.id)?.wps[0]
    if (w) return w.trecho_id
    const l = [...t.locais].sort((a, b) => a.ordem - b.ordem)[0]
    return l?.trecho_id ?? null
  }

  const linhas: LinhaGantt[] = []
  /** spans de cada linha de grupo, acumulados de baixo para cima */
  const spans = new Map<string, [number, number][]>()
  const juntar = (chave: string, b: BarraGantt | null): void => {
    if (!b) return
    const l = spans.get(chave) ?? []
    l.push([b.inicio, b.fim])
    spans.set(chave, l)
  }

  const raiz: LinhaGantt = {
    chave: 'p',
    tipo: 'plano',
    nivel: 0,
    texto: e.plano.nome,
    id: null,
    pai: null,
    barra: null,
    servicoId: null,
    trechoId: null
  }
  if (o.resumos) linhas.push(raiz)

  const visitar = (
    grupoId: string | null,
    chaveGrupo: string,
    nivel: number,
    ancestrais: string[]
  ): void => {
    const lista = filhos.get(grupoId) ?? []
    const tarefas = lista.filter((t) => t.tipo_no === 'tarefa')
    const grupos = lista.filter((t) => t.tipo_no === 'grupo')
    const sobe = (b: BarraGantt | null, chaves: string[]): void => {
      for (const k of [...ancestrais, ...chaves]) juntar(k, b)
    }
    const linhaTarefa = (t: TarefaEntrada, nv: number, pai: string, chaves: string[]): void => {
      const b = barraTarefa(t)
      linhas.push({
        chave: `t:${t.id}`,
        tipo: 'tarefa',
        nivel: nv,
        texto: t.nome,
        id: t.id,
        pai,
        barra: b,
        servicoId: t.servico_id,
        trechoId: trechoDe(t)
      })
      sobe(b, chaves)
    }
    const emGrupoDeTarefas = (nv: number): void => {
      if (!o.agrupar) return
      // local (eixo do 1º trecho da tarefa) → tipo (serviço) → tarefa, na ordem da primeira aparição
      const locais = new Map<string, Map<string, TarefaEntrada[]>>()
      for (const t of tarefas) {
        const lk = trechoDe(t) ?? '-'
        const sk = t.servico_id ?? '-'
        if (!locais.has(lk)) locais.set(lk, new Map())
        const m = locais.get(lk)!
        if (!m.has(sk)) m.set(sk, [])
        m.get(sk)!.push(t)
      }
      for (const [lk, tipos] of locais) {
        const chaveL = `${chaveGrupo}/l:${lk}`
        linhas.push({
          chave: chaveL,
          tipo: 'local',
          nivel: nv,
          texto: lk === '-' ? SEM_LOCAL : (trechos.get(lk)?.nome ?? 'Trecho'),
          id: null,
          pai: chaveGrupo,
          barra: null,
          servicoId: null,
          trechoId: lk === '-' ? null : lk
        })
        for (const [sk, ts] of tipos) {
          const chaveS = `${chaveL}/s:${sk}`
          const s = servicos.get(sk)
          linhas.push({
            chave: chaveS,
            tipo: 'servico',
            nivel: nv + 1,
            texto: s ? `${s.codigo} ${s.nome}`.trim() : 'Sem serviço',
            id: null,
            pai: chaveL,
            barra: null,
            servicoId: sk === '-' ? null : sk,
            trechoId: lk === '-' ? null : lk
          })
          for (const t of ts) linhaTarefa(t, nv + 2, chaveS, [chaveL, chaveS])
        }
      }
    }
    if (o.agrupar) {
      emGrupoDeTarefas(nivel)
      for (const g of grupos) linhaGrupo(g, nivel, chaveGrupo, ancestrais)
    } else {
      for (const t of lista) {
        if (t.tipo_no === 'grupo') linhaGrupo(t, nivel, chaveGrupo, ancestrais)
        else linhaTarefa(t, nivel, chaveGrupo, [])
      }
    }
  }
  const linhaGrupo = (g: TarefaEntrada, nivel: number, pai: string, ancestrais: string[]): void => {
    const chave = `g:${g.id}`
    if (o.resumos)
      linhas.push({
        chave,
        tipo: 'grupo',
        nivel,
        texto: g.nome,
        id: g.id,
        pai,
        barra: null,
        servicoId: null,
        trechoId: null
      })
    visitar(g.id, chave, o.resumos ? nivel + 1 : nivel, [...ancestrais, chave])
  }
  visitar(null, 'p', o.resumos ? 1 : 0, ['p'])

  // barras dos grupos: a união dos filhos (um retângulo do menor início ao maior fim)
  for (const l of linhas) {
    if (l.tipo === 'tarefa') continue
    const s = spans.get(l.chave)
    if (s?.length)
      l.barra = {
        inicio: Math.min(...s.map((x) => x[0])),
        fim: Math.max(...s.map((x) => x[1])),
        tarefa: false
      }
  }

  // dependências (só entre tarefas que aparecem)
  const visiveis = new Set(
    linhas.filter((l) => l.tipo === 'tarefa' && l.barra?.tarefa).map((l) => l.id!)
  )
  const dependencias: DependenciaGantt[] = []
  for (const d of e.dependencias) {
    if (visiveis.has(d.predecessora_id) && visiveis.has(d.sucessora_id))
      dependencias.push({
        id: d.id,
        pred: d.predecessora_id,
        succ: d.sucessora_id,
        tipo: d.tipo,
        usuario: true
      })
  }
  for (const d of r?.automaticas ?? []) {
    if (visiveis.has(d.predecessora_id) && visiveis.has(d.sucessora_id))
      dependencias.push({
        id: null,
        pred: d.predecessora_id,
        succ: d.sucessora_id,
        tipo: TIPO_AUTO[d.tipo] ?? 'EST',
        usuario: false
      })
  }

  // marcos com tarefas incluídas
  const marcos: MarcoGantt[] = []
  if (o.marcos) {
    const incl = new Map(
      (r?.marcos ?? []).map((m) => [m.id, m.tarefas.filter((t) => visiveis.has(t))])
    )
    for (const m of e.marcos) {
      const tarefas = incl.get(m.id) ?? []
      if (tarefas.length === 0) continue
      marcos.push({
        id: m.id,
        nome: m.nome,
        inicio: m.inicio ? isoParaSeg(m.inicio) : null,
        fim: m.fim ? isoParaSeg(m.fim) : null,
        tarefas
      })
    }
  }

  // violações: dependência → término nas FF/SF, início nas demais
  const nomeTarefa = (id: string): string => porId.get(id)?.nome ?? 'tarefa'
  const nomeMarco = (id: string): string => e.marcos.find((m) => m.id === id)?.nome ?? 'marco'
  const violacoes: ViolacaoGantt[] = []
  for (const id of visiveis) {
    for (const v of res(id)?.violacoes ?? []) {
      let ponto: PontoViolacao
      if (v.tipo === 'dependencia')
        ponto = pontoViolacaoDependencia(
          v.dependencia_predecessora,
          id,
          e.dependencias,
          r?.automaticas ?? []
        )
      else ponto = v.ponto
      violacoes.push({ tarefaId: id, ponto, texto: textoViolacao(v, nomeTarefa, nomeMarco) })
    }
  }

  // período do eixo (`GetDateSpan`)
  let b = Infinity,
    f = -Infinity
  for (const l of linhas) {
    if (l.tipo !== 'tarefa' || !l.barra) continue
    b = Math.min(b, l.barra.inicio)
    f = Math.max(f, l.barra.fim)
  }
  for (const m of marcos) {
    for (const x of [m.inicio, m.fim]) {
      if (x === null) continue
      b = Math.min(b, x)
      f = Math.max(f, x)
    }
  }
  if (!(b <= f)) {
    b = isoParaSeg(e.plano.inicio)
    f = e.plano.prazo ? isoParaSeg(e.plano.prazo) : b + 365 * DIA
    if (f < b) f = b + DIA
  }
  const dias = (f - b) / DIA
  const folga = Math.min(100, Math.max(1, Math.round(dias * 0.1)))
  return {
    linhas,
    dependencias,
    marcos,
    violacoes,
    inicio: beginOfCalendarDay(b - folga * DIA),
    fim: endOfCalendarDay(f + folga * DIA)
  }
}

/** Linhas visíveis: some a descendência (nível maior, em pré-ordem) das recolhidas. */
export function linhasVisiveis(
  linhas: readonly LinhaGantt[],
  recolhidas: ReadonlySet<string>
): LinhaGantt[] {
  const out: LinhaGantt[] = []
  let esconde = Infinity
  linhas.forEach((l, i) => {
    if (l.nivel > esconde) return
    esconde = Infinity
    out.push(l)
    if (recolhidas.has(l.chave) && (linhas[i + 1]?.nivel ?? -1) > l.nivel) esconde = l.nivel
  })
  return out
}

/** `CGrid::MakeHierarchyNumbers` [O]: um contador por nível, separados por ponto. */
export function numerarHierarquia(linhas: LinhaGantt[]): void {
  const cont: number[] = []
  for (const l of linhas) {
    cont.length = l.nivel + 1
    for (let i = 0; i < l.nivel; i++) cont[i] ??= 0
    cont[l.nivel] = (cont[l.nivel] ?? 0) + 1
    l.numero = cont
      .slice(0, l.nivel + 1)
      .map((n) => String(n ?? 0))
      .join('.')
  }
}

/** Linhas que têm filhas (botão de recolher). */
export function comFilhas(linhas: readonly LinhaGantt[]): Set<string> {
  const out = new Set<string>()
  linhas.forEach((l, i) => {
    if ((linhas[i + 1]?.nivel ?? -1) > l.nivel) out.add(l.chave)
  })
  return out
}
