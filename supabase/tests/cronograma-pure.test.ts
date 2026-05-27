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
  calcularDuracaoDiaria,
  type CalendarioCtx,
  parseISO
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
