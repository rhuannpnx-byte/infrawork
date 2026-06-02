// supabase/tests/cronograma-pure.test.ts
//
// Testes unitários de cronograma-pure.ts. Não tocam o banco — lógica é pura.
//
// Cenários cobertos (do plano):
//   1. Tarefa 100% dentro de um mês com fator cadastrado.
//   2. Tarefa 100% dentro de um mês sem registro (default 1.0).
//   3. Tarefa atravessa 2 meses com fatores diferentes.
//   4. Tarefa atravessa 4+ meses com fatores variados.
//   + Edge cases: quantidade pequena, inválidos, equipes, fim de semana, safety.
//
// Execução: cd supabase/functions && deno task test

import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1'
import {
  addWorkDays,
  agruparPorSemana,
  calcularDuracaoDiaria,
  type CalendarioCtx,
  diffMonths,
  diffWorkDays,
  diffYears,
  fracaoSobreposta,
  isoDate,
  nextWorkDay,
  parseISO,
  shiftWorkDays,
  sobreposicao,
  startOfWeekMondayUTC,
  ultimoDiaUtilDaSemana
} from '../functions/_shared/cronograma-pure.ts'

function ctx(opts: Partial<CalendarioCtx> = {}): CalendarioCtx {
  return {
    bitmask: 31, // seg-sex
    excecoes: new Map(),
    fatorMes: new Map(),
    ...opts
  }
}

// ─── Cenário 1: tarefa dentro de um mês com fator cadastrado ────────────────
//
// 100 unidades, prod 10/dia, 1 equipe, fator 0.8 → efetivo 8/dia.
// Início 2026-02-02 (segunda). Dias úteis necessários: 100/8 = 12.5 → 13 dias.
// Iteração: 8×12 = 96, último dia capeado em 4 (= 100 - 96).
// Dias úteis seg-sex Feb: 02 03 04 05 06 (sem) 09 10 11 12 13 (sem) 16 17 18.
// 13º dia útil = 2026-02-18 (quarta).
Deno.test('Cenário 1: dentro de um mês com fator 0.8', () => {
  const c = ctx({ fatorMes: new Map([['2026-02', 0.8]]) })
  const r = calcularDuracaoDiaria(100, 10, 1, parseISO('2026-02-02'), c)
  assertEquals(r.dataInicio, '2026-02-02')
  assertEquals(r.duracaoDiasUteis, 13)
  assertEquals(r.dataFim, '2026-02-18')
  assertEquals(r.quantidadePorDia.length, 13)
  const soma = r.quantidadePorDia.reduce((acc, q) => acc + q.quantidade, 0)
  assertAlmostEquals(soma, 100, 0.001)
  // Último dia capeado em 4
  assertAlmostEquals(r.quantidadePorDia[12].quantidade, 4, 0.001)
  // Penúltimo dia = 8 (cheio)
  assertAlmostEquals(r.quantidadePorDia[11].quantidade, 8, 0.001)
})

// ─── Cenário 2: tarefa dentro de um mês SEM fator (default 1.0) ─────────────
//
// 100 unidades, prod 10/dia, 1 equipe → 10/dia. 10 dias úteis exatos.
// Início 2026-02-02 (seg). Dia 10 = 2026-02-13 (sex).
Deno.test('Cenário 2: dentro de um mês sem fator (default 1.0)', () => {
  const c = ctx() // fatorMes vazio
  const r = calcularDuracaoDiaria(100, 10, 1, parseISO('2026-02-02'), c)
  assertEquals(r.duracaoDiasUteis, 10)
  assertEquals(r.dataFim, '2026-02-13')
  const soma = r.quantidadePorDia.reduce((acc, q) => acc + q.quantidade, 0)
  assertAlmostEquals(soma, 100, 0.001)
  // Todos os dias com 10 (nenhum cap)
  for (const q of r.quantidadePorDia) {
    assertAlmostEquals(q.quantidade, 10, 0.001)
  }
})

// ─── Cenário 3: tarefa atravessa 2 meses com fatores diferentes ─────────────
//
// 1000 unidades, prod 50/dia, 1 equipe.
// jan-2026: fator 1.0 → 50/dia. fev-2026: fator 0.8 → 40/dia.
// Início 2026-01-26 (seg).
// Jan dias úteis (26-30): 26 27 28 29 30 = 5 dias × 50 = 250. Acumulado 250.
// Fev: 1000 - 250 = 750 restante / 40 = 18.75 → 19 dias.
//   Fev dias úteis: 02 03 04 05 06 09 10 11 12 13 16 17 18 19 20 23 24 25 26 = 19 dias.
//   Último (Feb 26 Thu) capeado em 30 (= 1000 - 970).
// Total: 5 + 19 = 24 dias úteis. dataFim = 2026-02-26.
Deno.test('Cenário 3: atravessa 2 meses (jan 1.0, fev 0.8)', () => {
  const c = ctx({
    fatorMes: new Map([
      ['2026-01', 1.0],
      ['2026-02', 0.8]
    ])
  })
  const r = calcularDuracaoDiaria(1000, 50, 1, parseISO('2026-01-26'), c)
  assertEquals(r.dataInicio, '2026-01-26')
  assertEquals(r.duracaoDiasUteis, 24)
  assertEquals(r.dataFim, '2026-02-26')
  const soma = r.quantidadePorDia.reduce((acc, q) => acc + q.quantidade, 0)
  assertAlmostEquals(soma, 1000, 0.001)
  // Sanity: pelo menos um dia de jan e um de fev têm quantidades diferentes (50 vs 40)
  const dia0 = r.quantidadePorDia[0] // 2026-01-26
  const diaFev = r.quantidadePorDia.find((q) => q.data.startsWith('2026-02-')) ?? r.quantidadePorDia[0]
  assertAlmostEquals(dia0.quantidade, 50, 0.001)
  // O primeiro dia de fev (Feb 2) deve ter qty = 40
  const primeiroFev = r.quantidadePorDia.find((q) => q.data === '2026-02-02')
  assert(primeiroFev !== undefined, 'esperava primeiro dia útil de fev')
  assertAlmostEquals(primeiroFev!.quantidade, 40, 0.001)
})

// ─── Cenário 4: tarefa atravessa 4 meses com fatores variados ───────────────
//
// 5000 unidades, prod 100/dia, 1 equipe.
// nov-2025: 0.7 → 70/dia. dez-2025: 0.6 → 60/dia. jan-2026: 0.8 → 80/dia.
// fev-2026: 1.0 → 100/dia.
// Início 2025-11-03 (seg).
// Soma final tem que dar 5000 exato; e quantidades por dia variam por mês.
Deno.test('Cenário 4: atravessa 4 meses (nov 0.7 / dez 0.6 / jan 0.8 / fev 1.0)', () => {
  const c = ctx({
    fatorMes: new Map([
      ['2025-11', 0.7],
      ['2025-12', 0.6],
      ['2026-01', 0.8],
      ['2026-02', 1.0]
    ])
  })
  const r = calcularDuracaoDiaria(5000, 100, 1, parseISO('2025-11-03'), c)
  assertEquals(r.dataInicio, '2025-11-03')
  const soma = r.quantidadePorDia.reduce((acc, q) => acc + q.quantidade, 0)
  assertAlmostEquals(soma, 5000, 0.001)
  // Atravessa pelo menos 3 meses (4 ideal)
  const meses = new Set(r.quantidadePorDia.map((q) => q.data.slice(0, 7)))
  assert(meses.size >= 3, `esperava ≥3 meses, foram ${meses.size}: ${[...meses].sort().join(',')}`)
  // Verifica que dias de meses diferentes têm quantidades diferentes
  const novDay = r.quantidadePorDia.find((q) => q.data.startsWith('2025-11-') && q.quantidade > 50)
  const decDay = r.quantidadePorDia.find((q) => q.data.startsWith('2025-12-') && q.quantidade > 50)
  if (novDay && decDay) {
    assertAlmostEquals(novDay.quantidade, 70, 0.001)
    assertAlmostEquals(decDay.quantidade, 60, 0.001)
  }
})

// ─── Edge case: quantidade pequena (1 dia basta) ────────────────────────────
Deno.test('Edge: quantidade pequena, 1 dia útil cap inicial', () => {
  const c = ctx()
  // prod 100/dia, quantidade 50 → 1 dia, capeado em 50.
  const r = calcularDuracaoDiaria(50, 100, 1, parseISO('2026-02-02'), c)
  assertEquals(r.duracaoDiasUteis, 1)
  assertEquals(r.dataInicio, '2026-02-02')
  assertEquals(r.dataFim, '2026-02-02')
  assertEquals(r.quantidadePorDia.length, 1)
  assertAlmostEquals(r.quantidadePorDia[0].quantidade, 50, 0.001)
  assertEquals(r.atingiuLimite, false)
})

// ─── Edge cases: inválidos ──────────────────────────────────────────────────
Deno.test('Edge: quantidade <= 0 → duração 0', () => {
  const r = calcularDuracaoDiaria(0, 10, 1, parseISO('2026-02-02'), ctx())
  assertEquals(r.duracaoDiasUteis, 0)
  assertEquals(r.quantidadePorDia.length, 0)
})

Deno.test('Edge: prodDiaria <= 0 → duração 0', () => {
  const r = calcularDuracaoDiaria(100, 0, 1, parseISO('2026-02-02'), ctx())
  assertEquals(r.duracaoDiasUteis, 0)
})

// ─── Edge: equipes múltiplas paralelas ──────────────────────────────────────
Deno.test('Edge: 3 equipes triplicam a velocidade efetiva', () => {
  const c = ctx()
  // prod 10/dia × 3 equipes = 30/dia. quantidade 90 → 3 dias úteis exatos.
  const r = calcularDuracaoDiaria(90, 10, 3, parseISO('2026-02-02'), c)
  assertEquals(r.duracaoDiasUteis, 3)
})

// ─── Edge: pula fim de semana ───────────────────────────────────────────────
Deno.test('Edge: pula sábado/domingo (bitmask 31)', () => {
  const c = ctx()
  // Início 2026-02-06 (sex), prod 100/dia, quantidade 200 → 2 dias úteis.
  // sex(06) e seg(09).
  const r = calcularDuracaoDiaria(200, 100, 1, parseISO('2026-02-06'), c)
  assertEquals(r.duracaoDiasUteis, 2)
  assertEquals(r.dataInicio, '2026-02-06')
  assertEquals(r.dataFim, '2026-02-09')
})

// ─── Edge: dataInicio cai num sábado → avança pra próxima segunda ───────────
Deno.test('Edge: dataInicio em sábado → avança para próxima segunda', () => {
  const c = ctx()
  // 2026-02-07 é sábado. Próxima segunda é 2026-02-09.
  const r = calcularDuracaoDiaria(100, 10, 1, parseISO('2026-02-07'), c)
  assertEquals(r.dataInicio, '2026-02-09')
})

// ─── Edge: respeita exceção de calendário (feriado) ─────────────────────────
Deno.test('Edge: exceção bloqueante (feriado) é pulada', () => {
  const c = ctx({
    excecoes: new Map([['2026-02-04', false]]) // quarta vira "não útil"
  })
  // quantidade 30, prod 10/dia. Início 2026-02-02 (seg).
  // Dias: seg(02)=10, ter(03)=10, qua(04 FERIADO skip), qui(05)=10. Total = 30 em 3 dias.
  const r = calcularDuracaoDiaria(30, 10, 1, parseISO('2026-02-02'), c)
  assertEquals(r.duracaoDiasUteis, 3)
  assertEquals(r.dataFim, '2026-02-05') // pulou 04
  const datas = r.quantidadePorDia.map((q) => q.data)
  assertEquals(datas, ['2026-02-02', '2026-02-03', '2026-02-05'])
})

// ─── Edge: exceção liberadora (sábado vira útil) ────────────────────────────
Deno.test('Edge: exceção liberadora (sábado vira útil)', () => {
  const c = ctx({
    excecoes: new Map([['2026-02-07', true]]) // sábado vira útil
  })
  // quantidade 60, prod 10/dia. Início 2026-02-02 (seg).
  // Dias: 02 03 04 05 06 SAB(07) → 6 dias × 10 = 60. dataFim = 07.
  const r = calcularDuracaoDiaria(60, 10, 1, parseISO('2026-02-02'), c)
  assertEquals(r.duracaoDiasUteis, 6)
  assertEquals(r.dataFim, '2026-02-07')
})

// ─── Edge: safety cap em quantidade inviável ────────────────────────────────
Deno.test('Edge: safety cap retorna atingiuLimite=true sem loop infinito', () => {
  const c = ctx()
  // 1e9 unidades, prod 0.01/dia, 1 equipe → 1e11 dias. Bate safety (1830).
  const r = calcularDuracaoDiaria(1e9, 0.01, 1, parseISO('2026-01-05'), c)
  assertEquals(r.atingiuLimite, true)
})

// ═══════════════════════════════════════════════════════════════════════════
// agruparPorSemana (2026-06: deriva perfil semanal de calcularDuracaoDiaria)
// ═══════════════════════════════════════════════════════════════════════════

// ─── startOfWeekMondayUTC ───────────────────────────────────────────────────
Deno.test('startOfWeekMondayUTC: quinta → segunda', () => {
  const seg = startOfWeekMondayUTC(parseISO('2026-02-05'))
  assertEquals(seg.toISOString().slice(0, 10), '2026-02-02')
})

Deno.test('startOfWeekMondayUTC: domingo → segunda anterior', () => {
  const seg = startOfWeekMondayUTC(parseISO('2026-02-08'))
  assertEquals(seg.toISOString().slice(0, 10), '2026-02-02')
})

Deno.test('startOfWeekMondayUTC: segunda mesmo dia', () => {
  const seg = startOfWeekMondayUTC(parseISO('2026-02-02'))
  assertEquals(seg.toISOString().slice(0, 10), '2026-02-02')
})

// ─── ultimoDiaUtilDaSemana ──────────────────────────────────────────────────
Deno.test('ultimoDiaUtilDaSemana: bitmask seg-sex → sexta', () => {
  const c = ctx()
  const d = ultimoDiaUtilDaSemana(parseISO('2026-02-02'), c)
  assertEquals(d.toISOString().slice(0, 10), '2026-02-06')
})

Deno.test('ultimoDiaUtilDaSemana: semana toda paralisada → retorna segunda', () => {
  const excecoes = new Map<string, boolean>()
  for (const d of ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06']) {
    excecoes.set(d, false)
  }
  const c = ctx({ excecoes })
  const d = ultimoDiaUtilDaSemana(parseISO('2026-02-02'), c)
  assertEquals(d.toISOString().slice(0, 10), '2026-02-02')
})

// ─── agruparPorSemana ───────────────────────────────────────────────────────
Deno.test('agruparPorSemana: vazio retorna vazio', () => {
  assertEquals(agruparPorSemana([]), [])
})

Deno.test('agruparPorSemana: 5 dias da mesma semana → 1 bucket', () => {
  const r = agruparPorSemana([
    { data: '2026-02-02', quantidade: 10 }, // seg
    { data: '2026-02-03', quantidade: 10 },
    { data: '2026-02-04', quantidade: 10 },
    { data: '2026-02-05', quantidade: 10 },
    { data: '2026-02-06', quantidade: 10 } // sex
  ])
  assertEquals(r.length, 1)
  assertEquals(r[0].semanaSegunda, '2026-02-02')
  assertEquals(r[0].quantidadePlanejada, 50)
})

Deno.test('agruparPorSemana: dias em semanas diferentes → buckets separados ordenados', () => {
  const r = agruparPorSemana([
    { data: '2026-02-09', quantidade: 5 }, // semana 09-15
    { data: '2026-02-02', quantidade: 10 }, // semana 02-08
    { data: '2026-02-13', quantidade: 7 }, // semana 09-15
    { data: '2026-02-06', quantidade: 3 } // semana 02-08
  ])
  assertEquals(r.length, 2)
  assertEquals(r[0].semanaSegunda, '2026-02-02')
  assertEquals(r[0].quantidadePlanejada, 13)
  assertEquals(r[1].semanaSegunda, '2026-02-09')
  assertEquals(r[1].quantidadePlanejada, 12)
})

Deno.test('agruparPorSemana: soma total preserva qtd de calcularDuracaoDiaria', () => {
  const c = ctx()
  const r = calcularDuracaoDiaria(7500, 75, 1, parseISO('2026-01-05'), c)
  const semanas = agruparPorSemana(r.quantidadePorDia)
  const soma = semanas.reduce((acc, s) => acc + s.quantidadePlanejada, 0)
  assertAlmostEquals(soma, 7500, 0.001)
})

// ─── calcularDuracaoDiaria: cenário Fresagem (regression 125d→95d) ─────────
Deno.test('calcularDuracaoDiaria: Fresagem fator 1.0 → ~ceil(qtd/(prod×eqs))', () => {
  const c = ctx() // fator 1.0
  // 7500 unidades, prod 79/dia, 1 eq → 7500/79 = 94.93 → 95 dias úteis
  const r = calcularDuracaoDiaria(7500, 79, 1, parseISO('2026-01-05'), c)
  assertEquals(r.duracaoDiasUteis, 95)
})

Deno.test('calcularDuracaoDiaria: fator 0.8 em mês cruzado infla proporcionalmente', () => {
  // Sem fator: 100 unidades, prod 10/dia, 1 eq → 10 dias.
  // Com fator 0.8 nos primeiros dias: efetivo 8/dia até esgotar.
  // Esperado: ceil(100 / 8) = 13 dias (se TODOS no mês de fator).
  const c = ctx({ fatorMes: new Map([['2026-02', 0.8]]) })
  const r = calcularDuracaoDiaria(100, 10, 1, parseISO('2026-02-02'), c)
  assertEquals(r.duracaoDiasUteis, 13)
})

// ─── diffWorkDays (Motor CPM Fase 1) ─────────────────────────────────────────
// Cobertura do critério 3 (Total Float) e 4 (Free Float) — ambos usam diff
// em dias úteis sinalizado.

Deno.test('diffWorkDays: mesma data → 0', () => {
  const d = parseISO('2026-06-01')
  assertEquals(diffWorkDays(d, d, ctx()), 0)
})

Deno.test('diffWorkDays: seg → sex mesma semana → +4 dias úteis', () => {
  // Seg 2026-06-01 → Sex 2026-06-05.
  const from = parseISO('2026-06-01')
  const to = parseISO('2026-06-05')
  assertEquals(diffWorkDays(from, to, ctx()), 4)
})

Deno.test('diffWorkDays: sex → seg seguinte → +1 dia útil (sab/dom pulam)', () => {
  // Sex 2026-06-05 → Seg 2026-06-08. Entre eles: sab/dom = não úteis.
  const from = parseISO('2026-06-05')
  const to = parseISO('2026-06-08')
  assertEquals(diffWorkDays(from, to, ctx()), 1)
})

Deno.test('diffWorkDays: sentido inverso retorna valor negativo', () => {
  const from = parseISO('2026-06-08')
  const to = parseISO('2026-06-05')
  assertEquals(diffWorkDays(from, to, ctx()), -1)
})

Deno.test('diffWorkDays: feriado no meio reduz contagem', () => {
  // Seg → Sex com qua=feriado: 4 dias úteis (qua não conta).
  const c = ctx({
    excecoes: new Map([['2026-06-03', false]]) // qua é feriado
  })
  const from = parseISO('2026-06-01')
  const to = parseISO('2026-06-05')
  assertEquals(diffWorkDays(from, to, c), 3) // ter, qui, sex (qua pulada)
})

Deno.test('diffWorkDays: travessia de fim de semana sinalizada', () => {
  // Seg 2026-06-01 → Seg 2026-06-08. 5 dias úteis (seg a sex)
  // depois sab/dom pulados, chega na próxima seg.
  const from = parseISO('2026-06-01')
  const to = parseISO('2026-06-08')
  assertEquals(diffWorkDays(from, to, ctx()), 5)
})

Deno.test('diffWorkDays + shiftWorkDays: round-trip simétrico', () => {
  // Avança N dias úteis e mede com diff — deve retornar exatamente N.
  const c = ctx()
  const start = parseISO('2026-06-01')
  for (const n of [1, 3, 5, 10, 22]) {
    const end = shiftWorkDays(start, n, c)
    assertEquals(diffWorkDays(start, end, c), n)
  }
})

// ─── CPM básico (forward + backward) — assertions sobre helpers que o
//     motor usa internamente. Testes do cpm-engine.ts em si exigem vitest
//     no renderer (defer p/ futuro); aqui validamos as pure-funcs base.

Deno.test('CPM helper: ES + dur via addWorkDays gera EF coerente', () => {
  // Tarefa de 5 dias úteis começando seg 2026-06-01.
  // ES = 2026-06-01 (seg), dur = 5 → EF = 2026-06-05 (sex).
  const c = ctx()
  const es = nextWorkDay(parseISO('2026-06-01'), c)
  const ef = addWorkDays(es, 5, c) // 5 dias úteis a partir do início inclusivo
  assertEquals(isoDate(es), '2026-06-01')
  assertEquals(isoDate(ef), '2026-06-05')
  // Duração reversa via diff: deve bater (-1 por inclusivo).
  assertEquals(diffWorkDays(es, ef, c), 4)
})

Deno.test('CPM helper: FS lag=2 → ES sucessora = EF predecessora + 2 + 1 dias úteis', () => {
  // EF pred = 2026-06-05 (sex). lag=2 → 2026-06-08 (seg) e 2026-06-09 (ter).
  // ES suc = 2026-06-10 (qua).
  const c = ctx()
  const efPred = parseISO('2026-06-05')
  const esSuc = shiftWorkDays(efPred, 2 + 1, c)
  assertEquals(isoDate(esSuc), '2026-06-10')
})

Deno.test('CPM helper: FF lag=0 → LF pred = LF suc', () => {
  const c = ctx()
  const lfSuc = parseISO('2026-06-15') // seg
  const lfPred = shiftWorkDays(lfSuc, 0, c) // lag=0
  assertEquals(isoDate(lfPred), '2026-06-15')
})

// ─── Helpers indiretos ──────────────────────────────────────────────────

Deno.test('diffMonths: mesmo dia mês seguinte = 1.0', () => {
  assertAlmostEquals(diffMonths(parseISO('2026-01-15'), parseISO('2026-02-15')), 1.0, 0.001)
})

Deno.test('diffMonths: 15 jan → 1 mar 2026 = mesesInt(2) + (1-15)/31 ≈ 1.548', () => {
  // Convenção: mesesInteiros = (mB-mA), fracao = (dB-dA)/diasNoMesB.
  // 15jan→1mar: 2 meses - 14/31 ≈ 1.548.
  assertAlmostEquals(diffMonths(parseISO('2026-01-15'), parseISO('2026-03-01')), 2 - 14 / 31, 0.001)
})

Deno.test('diffMonths: mesmo dia mesmo mês = 0', () => {
  assertEquals(diffMonths(parseISO('2026-05-10'), parseISO('2026-05-10')), 0)
})

Deno.test('diffMonths: data inicial > final = 0', () => {
  assertEquals(diffMonths(parseISO('2026-05-15'), parseISO('2026-05-10')), 0)
})

Deno.test('diffYears: 1 ano exato', () => {
  assertAlmostEquals(diffYears(parseISO('2026-05-01'), parseISO('2027-05-01')), 1.0, 0.005)
})

Deno.test('diffYears: 6 meses ≈ 0.5', () => {
  assertAlmostEquals(diffYears(parseISO('2026-01-01'), parseISO('2026-07-01')), 0.5, 0.01)
})

Deno.test('sobreposicao: intervalos disjuntos → false', () => {
  assertEquals(
    sobreposicao(parseISO('2026-01-01'), parseISO('2026-01-31'), parseISO('2026-02-01'), parseISO('2026-02-28')),
    false
  )
})

Deno.test('sobreposicao: aFim toca bIni (mesmo dia) → true (dia inteiro conta)', () => {
  assertEquals(
    sobreposicao(parseISO('2026-01-01'), parseISO('2026-01-31'), parseISO('2026-01-31'), parseISO('2026-02-15')),
    true
  )
})

Deno.test('sobreposicao: a contido em b → true', () => {
  assertEquals(
    sobreposicao(parseISO('2026-01-10'), parseISO('2026-01-20'), parseISO('2026-01-01'), parseISO('2026-01-31')),
    true
  )
})

Deno.test('fracaoSobreposta: a 100% dentro de b → 1', () => {
  const f = fracaoSobreposta(
    parseISO('2026-01-10'),
    parseISO('2026-01-20'),
    parseISO('2026-01-01'),
    parseISO('2026-01-31')
  )
  assertAlmostEquals(f, 1.0, 0.01)
})

Deno.test('fracaoSobreposta: a 50% dentro de b', () => {
  // a = [01,10], b = [06,20]. Sobreposição = [06,10] = 5 dias. a = 10 dias. → 0.5
  const f = fracaoSobreposta(
    parseISO('2026-01-01'),
    parseISO('2026-01-10'),
    parseISO('2026-01-06'),
    parseISO('2026-01-20')
  )
  assertAlmostEquals(f, 0.5, 0.01)
})

Deno.test('fracaoSobreposta: disjuntos → 0', () => {
  const f = fracaoSobreposta(
    parseISO('2026-01-01'),
    parseISO('2026-01-10'),
    parseISO('2026-02-01'),
    parseISO('2026-02-10')
  )
  assertEquals(f, 0)
})
