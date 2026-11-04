/**
 * Conferência numérica do tempo-caminho contra o cálculo do motor (usada pelos testes e por
 * `scripts/verificar-tempo-caminho.mjs`). Monta os eixos como a visão (trechos lado a lado; tempo comprimido pelo
 * calendário de interface), gera as linhas com as mesmas funções e confere, por tarefa:
 *   1. pontas de cada pedaço = (estaca, data) do trecho de trabalho (wp) calculado;
 *   2. avanço monotônico no tempo e nas estacas, no sentido de execução;
 *   3. estaca ao longo da linha = fração das horas de trabalho da tarefa (RN-042; vertical onde a tarefa para);
 *   4. duração de cada wp ∝ quantidade do wp / produção da equipe (a inclinação vem das quantidades);
 *   5. faixa coberta pelos wps = locais da tarefa; barra do Gantt = envelope dos wps;
 *   6. sentido: crescente começa pela estaca menor, decrescente pela maior.
 */
import { Calendar } from '@apex/calendar'
import type { ResultadoCalculo } from '../motor/calculo'
import { jornadaReferencia } from '../motor/calendario'
import type { PlanoEntrada } from '../motor/tipos'
import { calendarioInterface, EixoTempo, HORA } from './eixo'
import { EixoEstacas, linhaDoPedaco, pedacosPlanejados } from './tempo-caminho'

export interface ConferenciaTempoCaminho {
  tarefas: number
  pedacos: number
  pontos: number
  falhas: string[]
}

const dt = (s: number): string => new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ')

export function conferirTempoCaminho(
  e: PlanoEntrada,
  r: ResultadoCalculo,
  o: { fimDeSemana?: boolean; feriados?: boolean } = {}
): ConferenciaTempoCaminho {
  const eixos = e.trechos.filter((t) => t.tipo === 'eixo')
  const lista: { id: string; ini: number; fim: number; x0: number; x1: number }[] = []
  let x0 = 0
  for (const t of eixos) {
    let fim = Number(t.comprimento_m) || 0
    for (const res of r.tarefas.values())
      for (const w of res.wps) if (w.trecho_id === t.id) fim = Math.max(fim, w.fim_m)
    const larg = Math.max(1, fim) * 0.1
    lista.push({ id: t.id, ini: 0, fim: Math.max(1, fim), x0, x1: x0 + larg })
    x0 += larg + 14
  }
  const eixoE = new EixoEstacas(lista)
  const spec = r.calendarios[r.calendarioPadraoId]!
  const calUi = calendarioInterface(spec, o.fimDeSemana ?? false, o.feriados ?? true, true)
  let b = Infinity,
    f = -Infinity
  for (const res of r.tarefas.values())
    for (const w of res.wps) {
      b = Math.min(b, w.inicio)
      f = Math.max(f, w.fim)
    }
  const eixoT = new EixoTempo(calUi, b - 86400 * 10, f + 86400 * 10, 2)

  const porId = new Map(e.tarefas.map((t) => [t.id, t]))
  const equipe = new Map(e.equipes.map((q) => [q.servico_id, q]))
  const calPadrao =
    e.calendarios.find((c) => c.id === e.plano.calendario_id) ??
    e.calendarios.find((c) => c.padrao) ??
    e.calendarios[0]
  const jornada = calPadrao ? jornadaReferencia(calPadrao) : 8
  const falhas = new Set<string>()
  let nTarefas = 0,
    nPedacos = 0,
    nPontos = 0

  for (const res of r.tarefas.values()) {
    const t = porId.get(res.id)
    if (!t) continue
    const falhar = (msg: string): void => void falhas.add(`${t.nome}: ${msg}`)
    const cal = new Calendar(r.calendarios[res.calendario_id] ?? spec)
    const crescente = t.sentido !== 'decrescente'
    const wpsEixo = res.wps.filter((w) => w.trecho_id && eixoE.porId.has(w.trecho_id))
    if (!res.wps.length) continue
    nTarefas++

    // 5. barra do Gantt = envelope dos wps
    const minW = Math.min(...res.wps.map((w) => w.inicio)),
      maxW = Math.max(...res.wps.map((w) => w.fim))
    if (Math.abs(minW - res.inicio) > 60 || Math.abs(maxW - res.fim) > 60)
      falhar(`barra ${dt(res.inicio)}→${dt(res.fim)} ≠ envelope dos wps ${dt(minW)}→${dt(maxW)}`)

    // 5. faixa dos wps = locais da tarefa
    for (const l of t.locais) {
      if (!l.trecho_id || l.inicio_m === null || l.fim_m === null || !eixoE.porId.has(l.trecho_id))
        continue
      const ws = res.wps.filter((w) => w.local_id === l.id)
      if (!ws.length) {
        falhar(`local ${l.inicio_m}–${l.fim_m} sem wp`)
        continue
      }
      const a = Math.min(...ws.map((w) => w.inicio_m)),
        z = Math.max(...ws.map((w) => w.fim_m))
      if (Math.abs(a - l.inicio_m) > 0.01 || Math.abs(z - l.fim_m) > 0.01)
        falhar(`wps cobrem ${a}–${z} m, local é ${l.inicio_m}–${l.fim_m} m`)
    }

    // 4. duração ∝ quantidade / produção (mesma taxa em todos os wps da tarefa)
    const q = t.servico_id ? equipe.get(t.servico_id) : undefined
    const taxaH =
      ((Number(q?.producao_diaria) || 0) / jornada) * Math.max(1, t.qtd_equipes) * t.coef_producao
    if (taxaH > 0)
      for (const w of res.wps) {
        if (!(w.quantidade > 0)) continue
        const horas = (cal.AS2WS(w.fim) - cal.AS2WS(w.inicio)) / HORA
        const esperado = w.quantidade / taxaH
        if (Math.abs(horas - esperado) > Math.max(0.05, esperado * 0.01))
          falhar(
            `wp ${w.inicio_m}–${w.fim_m} m: ${horas.toFixed(2)} h ≠ ${esperado.toFixed(2)} h (qtd ${w.quantidade})`
          )
      }

    // 6. sentido: o primeiro wp no tempo, no mesmo trecho, é o da ponta certa
    for (const tr of new Set(wpsEixo.map((w) => w.trecho_id))) {
      const ws = wpsEixo.filter((w) => w.trecho_id === tr).sort((x, y) => x.inicio - y.inicio)
      for (let i = 1; i < ws.length; i++) {
        if (crescente && ws[i]!.inicio_m < ws[i - 1]!.inicio_m)
          falhar(`crescente, mas o wp ${ws[i]!.inicio_m} m vem depois do ${ws[i - 1]!.inicio_m} m`)
        if (!crescente && ws[i]!.inicio_m > ws[i - 1]!.inicio_m)
          falhar(
            `decrescente, mas o wp ${ws[i]!.inicio_m} m vem depois do ${ws[i - 1]!.inicio_m} m`
          )
      }
    }

    // 1–3. as linhas desenhadas
    for (const pc of pedacosPlanejados(res, crescente).filter((p) => eixoE.porId.has(p.trecho))) {
      nPedacos++
      const pts = linhaDoPedaco(cal, eixoT, eixoE, pc).flat()
      if (!pts.length) {
        falhar(`pedaço ${pc.stA}→${pc.stB} sem linha`)
        continue
      }
      nPontos += pts.length
      const xa = eixoE.x(pc.trecho, pc.stA)!,
        xb = eixoE.x(pc.trecho, pc.stB)!
      const p0 = pts[0]!,
        p1 = pts[pts.length - 1]!
      if (Math.abs(p0.x - xa) > 0.01 || Math.abs(p0.y - eixoT.x(pc.tA)) > 0.5)
        falhar(`início do pedaço ${pc.stA} m/${dt(pc.tA)} desenhado fora do lugar`)
      if (Math.abs(p1.x - xb) > 0.01 || Math.abs(p1.y - eixoT.x(pc.tB)) > 0.5)
        falhar(`fim do pedaço ${pc.stB} m/${dt(pc.tB)} desenhado fora do lugar`)
      const W = cal.AS2WS(pc.tB) - cal.AS2WS(pc.tA)
      for (let i = 1; i < pts.length; i++) {
        if (pts[i]!.y < pts[i - 1]!.y - 1e-6) falhar(`tempo volta no pedaço ${pc.stA}→${pc.stB}`)
        if ((xb - xa) * (pts[i]!.x - pts[i - 1]!.x) < -1e-6)
          falhar(`estaca volta no pedaço ${pc.stA}→${pc.stB}`)
      }
      // 3. x = xa + (xb−xa)·(horas da tarefa até t)/W; num y comprimido (dois instantes) vale a faixa entre os x
      if (W > 0)
        for (const p of pts) {
          const t1 = eixoT.data(p.y)
          const fr = Math.min(1, Math.max(0, (cal.AS2WS(t1) - cal.AS2WS(pc.tA)) / W))
          const esperado = xa + (xb - xa) * fr
          const mesmos = pts.filter((q2) => Math.abs(q2.y - p.y) < 1e-6).map((q2) => q2.x)
          const lo = Math.min(...mesmos, esperado),
            hi = Math.max(...mesmos, esperado)
          if (
            Math.abs(p.x - esperado) > 0.6 &&
            !(mesmos.length > 1 && p.x >= lo - 0.6 && p.x <= hi + 0.6)
          )
            falhar(`ponto fora da proporção das horas de trabalho em ${dt(t1)}`)
        }
    }
  }
  return { tarefas: nTarefas, pedacos: nPedacos, pontos: nPontos, falhas: [...falhas] }
}
