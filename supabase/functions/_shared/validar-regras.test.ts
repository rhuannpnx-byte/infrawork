// Testes de regressão do validador de TAP (fixtures T-01..T-10), baseados no
// TAP real da BR-030 (TT-392/2024). Rode: `deno test supabase/functions/_shared`.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { validarTap, podeEmitirDefinitivo, type VDado } from './validar-regras.ts'

const base = (over: Partial<VDado['contrato']> = {}, rest: Partial<VDado> = {}): VDado => ({
  contrato: {
    numero: 'TT-392/2024',
    contratante: 'DNIT',
    objeto: 'Obras na BR-030',
    processo: '50600.025354/2024-51',
    edital: '50600.037876/2023-15',
    lei: '8.666/1993',
    regime: 'RDC',
    cnae: '4211-1/01',
    indice_reajuste: 'item 3.3',
    valor_p0: 479546076.34,
    valor_vigente: 514629882.36,
    data_base: '2023-01',
    assinatura: '2024-06-26',
    publicacao: '2024-07-01',
    prazo_exec_dias: 1080,
    prazo_vig_dias: 1270,
    inicio_exec: '2024-07-22',
    termino_exec: '2027-07-06',
    termino_vig: '2027-12-31',
    ...over
  },
  partes: [
    { papel: 'consorcio_lider', nome: 'GAE Construção e Comércio Ltda', cnpj: '12.345.678/0001-95' },
    { papel: 'consorciada', nome: 'SVC Engenharia Ltda', cnpj: '11.444.777/0001-61' }
  ],
  eventos: [
    { tipo: 'apostilamento', data_norm: '2024-08-12', delta: 3144414.46, valor_resultante: 482690490.8, rotulo: '1º Apostilamento' },
    { tipo: 'apostilamento', data_norm: '2025-03-13', delta: 31939391.56, valor_resultante: 514629882.36, rotulo: '2º Apostilamento' }
  ],
  textos: ['GAE Construção e Comércio Ltda'],
  proveniencia: { 'contrato.assinatura': { doc_id: 'd1', pagina: 2, confianca: 0.95 } },
  hoje: '2026-06-24',
  ...rest
})

const has = (fs: { regra_id: string }[], id: string): boolean => fs.some((x) => x.regra_id === id)

Deno.test('T-01 assinatura = data de apostilamento → R-10 BLOCKER', () => {
  const fs = validarTap(base({ assinatura: '2025-03-13' }))
  assert(has(fs, 'R-10'))
  assertEquals(podeEmitirDefinitivo(fs), false)
})

Deno.test('T-02 data-base posterior à assinatura → R-11 BLOCKER', () => {
  const fs = validarTap(base({ data_base: '2025-01', assinatura: '2024-06-26' }))
  assert(has(fs, 'R-11'))
})

Deno.test('T-03 início+prazo ≠ término → R-12 BLOCKER', () => {
  const fs = validarTap(base({ inicio_exec: '2024-10-01', prazo_exec_dias: 1080, termino_exec: '2027-07-06' }))
  assert(has(fs, 'R-12'))
})

Deno.test('T-04 financeiro coerente → sem R-20', () => {
  const fs = validarTap(base())
  assertEquals(has(fs, 'R-20'), false)
})

Deno.test('T-05 duplicata + pessoa física → R-30 e R-31 BLOCKER', () => {
  const fs = validarTap(
    base(
      {},
      {
        partes: [
          { papel: 'consorciada', nome: 'CONSÓRCIO RODOVIA BR-030', cnpj: null },
          { papel: 'consorciada', nome: 'Consorcio Rodovia BR-30', cnpj: null },
          { papel: 'consorciada', nome: 'Daniel Jean Laperche', cnpj: null }
        ]
      }
    )
  )
  assert(has(fs, 'R-30'))
  assert(has(fs, 'R-31'))
})

Deno.test('T-06 entidade HTML não decodificada → R-33 BLOCKER', () => {
  const fs = validarTap(base({}, { textos: ['GAE Construção &amp; Comércio'] }))
  assert(has(fs, 'R-33'))
})

Deno.test('T-07 RDC + 14.133 → R-41 BLOCKER', () => {
  const fs = validarTap(base({ regime: 'RDC', lei: '14.133/2021' }))
  assert(has(fs, 'R-41'))
})

Deno.test('T-09 processo = edital → R-35 WARN', () => {
  const fs = validarTap(base({ processo: '50600.037876/2023-15', edital: '50600.037876/2023-15' }))
  assert(has(fs, 'R-35'))
})

Deno.test('T-10 dossiê corrigido → 0 BLOCKER (emite definitivo)', () => {
  const fs = validarTap(base())
  assertEquals(podeEmitirDefinitivo(fs), true)
})
