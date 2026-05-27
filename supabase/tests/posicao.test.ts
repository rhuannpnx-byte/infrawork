// supabase/tests/posicao.test.ts
//
// Testes do formatPosicao / parsePosicao (lib/format/posicao.ts).
// Sem DB, sem React — Deno consegue importar o arquivo TS direto.
//
// Execução: cd supabase/functions && deno task test

import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1'
import {
  formatPosicao,
  parsePosicao,
  type UnidadeEspaco
} from '../../src/renderer/src/lib/format/posicao.ts'

// ─── Format ─────────────────────────────────────────────────────────────────

Deno.test('formatPosicao km: 2508.50 → "2+508,50"', () => {
  assertEquals(formatPosicao(2508.5, 'km'), '2+508,50')
})

Deno.test('formatPosicao km: 50 metros padded a 3 dígitos', () => {
  assertEquals(formatPosicao(50, 'km'), '0+050,00')
})

Deno.test('formatPosicao km: 0 → "0+000,00"', () => {
  assertEquals(formatPosicao(0, 'km'), '0+000,00')
})

Deno.test('formatPosicao m: sem padding', () => {
  assertEquals(formatPosicao(2508.5, 'm'), '2508,50')
})

Deno.test('formatPosicao m: 50 → "50,00"', () => {
  assertEquals(formatPosicao(50, 'm'), '50,00')
})

Deno.test('formatPosicao estaca: 2508.50 → "EST 125+8,50"', () => {
  assertEquals(formatPosicao(2508.5, 'estaca'), 'EST 125+8,50')
})

Deno.test('formatPosicao estaca: offset 0 → "EST N+0,00"', () => {
  assertEquals(formatPosicao(2500, 'estaca'), 'EST 125+0,00') // 125 * 20 = 2500
})

Deno.test('formatPosicao estaca: 19.99 offset (limite)', () => {
  assertEquals(formatPosicao(2519.99, 'estaca'), 'EST 125+19,99')
})

// ─── Format: inputs inválidos ──────────────────────────────────────────────

Deno.test('formatPosicao: null → ""', () => {
  assertEquals(formatPosicao(null, 'km'), '')
})

Deno.test('formatPosicao: undefined → ""', () => {
  assertEquals(formatPosicao(undefined, 'm'), '')
})

Deno.test('formatPosicao: NaN → ""', () => {
  assertEquals(formatPosicao(Number.NaN, 'km'), '')
})

Deno.test('formatPosicao: Infinity → ""', () => {
  assertEquals(formatPosicao(Number.POSITIVE_INFINITY, 'km'), '')
})

Deno.test('formatPosicao: negativo → ""', () => {
  assertEquals(formatPosicao(-100, 'km'), '')
})

// ─── Parse: km ──────────────────────────────────────────────────────────────

Deno.test('parsePosicao km: "2+508,50" → 2508.50', () => {
  assertAlmostEquals(parsePosicao('2+508,50', 'km')!, 2508.5, 0.001)
})

Deno.test('parsePosicao km: ponto decimal "2+508.50"', () => {
  assertAlmostEquals(parsePosicao('2+508.50', 'km')!, 2508.5, 0.001)
})

Deno.test('parsePosicao km: sem decimal "2+508"', () => {
  assertAlmostEquals(parsePosicao('2+508', 'km')!, 2508, 0.001)
})

Deno.test('parsePosicao km: zero metros "5+0"', () => {
  assertAlmostEquals(parsePosicao('5+0', 'km')!, 5000, 0.001)
})

Deno.test('parsePosicao km: padding "0+050,00"', () => {
  assertAlmostEquals(parsePosicao('0+050,00', 'km')!, 50, 0.001)
})

Deno.test('parsePosicao km: com whitespace ao redor', () => {
  assertAlmostEquals(parsePosicao('  2+508,50  ', 'km')!, 2508.5, 0.001)
})

// ─── Parse: m ──────────────────────────────────────────────────────────────

Deno.test('parsePosicao m: "2508,50" → 2508.50', () => {
  assertAlmostEquals(parsePosicao('2508,50', 'm')!, 2508.5, 0.001)
})

Deno.test('parsePosicao m: ponto decimal', () => {
  assertAlmostEquals(parsePosicao('2508.50', 'm')!, 2508.5, 0.001)
})

Deno.test('parsePosicao m: inteiro "2508"', () => {
  assertAlmostEquals(parsePosicao('2508', 'm')!, 2508, 0.001)
})

// ─── Parse: estaca ─────────────────────────────────────────────────────────

Deno.test('parsePosicao estaca: "EST 125+8,50" → 2508.50', () => {
  assertAlmostEquals(parsePosicao('EST 125+8,50', 'estaca')!, 2508.5, 0.001)
})

Deno.test('parsePosicao estaca: sem prefixo EST', () => {
  assertAlmostEquals(parsePosicao('125+8,50', 'estaca')!, 2508.5, 0.001)
})

Deno.test('parsePosicao estaca: prefixo lowercase', () => {
  assertAlmostEquals(parsePosicao('est 125+8,50', 'estaca')!, 2508.5, 0.001)
})

Deno.test('parsePosicao estaca: EST sem espaço', () => {
  assertAlmostEquals(parsePosicao('EST125+8,50', 'estaca')!, 2508.5, 0.001)
})

Deno.test('parsePosicao estaca: offset 0', () => {
  assertAlmostEquals(parsePosicao('EST 125+0', 'estaca')!, 2500, 0.001)
})

Deno.test('parsePosicao estaca: offset 19.99 (limite)', () => {
  assertAlmostEquals(parsePosicao('EST 0+19,99', 'estaca')!, 19.99, 0.001)
})

// ─── Parse: malformados ────────────────────────────────────────────────────

const TODOS_OS_FORMATOS: UnidadeEspaco[] = ['km', 'm', 'estaca']

Deno.test('parsePosicao: string vazia → null', () => {
  for (const u of TODOS_OS_FORMATOS) {
    assertEquals(parsePosicao('', u), null)
  }
})

Deno.test('parsePosicao: apenas espaços → null', () => {
  for (const u of TODOS_OS_FORMATOS) {
    assertEquals(parsePosicao('   ', u), null)
  }
})

Deno.test('parsePosicao: NaN textual → null', () => {
  for (const u of TODOS_OS_FORMATOS) {
    assertEquals(parsePosicao('abc', u), null)
  }
})

Deno.test('parsePosicao: negativo explícito → null', () => {
  assertEquals(parsePosicao('-100', 'm'), null)
  assertEquals(parsePosicao('-2+508,50', 'km'), null)
  assertEquals(parsePosicao('EST -1+5,00', 'estaca'), null)
})

Deno.test('parsePosicao km: metros >= 1000 → null (overflow)', () => {
  assertEquals(parsePosicao('2+1000,00', 'km'), null)
  assertEquals(parsePosicao('2+1500,50', 'km'), null)
})

Deno.test('parsePosicao estaca: offset >= 20 → null (overflow)', () => {
  assertEquals(parsePosicao('EST 125+20,00', 'estaca'), null)
  assertEquals(parsePosicao('EST 125+25,50', 'estaca'), null)
})

// Modo "só metros" — input sem "+" interpreta como metros diretos em qualquer unidade.
// Justificativa UX: usuário pode preferir digitar "2508,50" sem precisar lembrar
// do formato canônico. Preview na UI mostra a forma canônica.
Deno.test('parsePosicao km: "2508" sem "+" → 2508 m (modo tolerante)', () => {
  assertAlmostEquals(parsePosicao('2508', 'km')!, 2508, 0.001)
})

Deno.test('parsePosicao km: "2500,50" sem "+" → 2500.50 m (modo tolerante)', () => {
  assertAlmostEquals(parsePosicao('2500,50', 'km')!, 2500.5, 0.001)
})

Deno.test('parsePosicao km: "2,508" → 2.508 m (parsed como decimal, NÃO como milhar)', () => {
  // Vírgula é o decimal separator PT-BR. "2,508" = 2.508.
  assertAlmostEquals(parsePosicao('2,508', 'km')!, 2.508, 0.001)
})

Deno.test('parsePosicao estaca: "2508" sem "+" → 2508 m (modo tolerante)', () => {
  assertAlmostEquals(parsePosicao('2508', 'estaca')!, 2508, 0.001)
})

Deno.test('parsePosicao m: contém letras → null', () => {
  assertEquals(parsePosicao('2508m', 'm'), null)
  assertEquals(parsePosicao('2.5km', 'm'), null)
})

Deno.test('parsePosicao m: múltiplos separadores → null', () => {
  assertEquals(parsePosicao('1.234,56', 'm'), null) // milhar PT-BR não suportado
  assertEquals(parsePosicao('1,234.56', 'm'), null)
})

// ─── Round-trip: format ↔ parse ────────────────────────────────────────────

Deno.test('round-trip km: format(parse) === input', () => {
  const valores = [0, 50, 500, 1000, 2508.5, 12345.78, 99999.99]
  for (const v of valores) {
    const s = formatPosicao(v, 'km')
    const back = parsePosicao(s, 'km')
    assert(back !== null, `parse falhou pra ${s}`)
    assertAlmostEquals(back!, v, 0.001, `roundtrip km falhou: ${v} → ${s} → ${back}`)
  }
})

Deno.test('round-trip m: format(parse) === input', () => {
  const valores = [0, 50, 2508.5, 99999.99]
  for (const v of valores) {
    const s = formatPosicao(v, 'm')
    const back = parsePosicao(s, 'm')
    assert(back !== null, `parse falhou pra ${s}`)
    assertAlmostEquals(back!, v, 0.001)
  }
})

Deno.test('round-trip estaca: format(parse) === input', () => {
  const valores = [0, 19.99, 2500, 2508.5, 12345.78]
  for (const v of valores) {
    const s = formatPosicao(v, 'estaca')
    const back = parsePosicao(s, 'estaca')
    assert(back !== null, `parse falhou pra ${s}`)
    assertAlmostEquals(back!, v, 0.001)
  }
})
