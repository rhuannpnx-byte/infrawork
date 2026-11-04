// Verificação numérica do tempo-caminho contra o cálculo do motor (ApeX), num plano do stack local (as conferências
// estão em src/features/cronograma/visoes/conferir-tempo-caminho.ts).
//
//   VITE_SUPABASE_URL=http://127.0.0.1:55321 VITE_SUPABASE_ANON_KEY=<anon> E2E_EMAIL=... E2E_PASSWORD=... \
//   npx vite-node scripts/verificar-tempo-caminho.mjs <planejamento_id>
import { readFileSync } from 'node:fs'
import { supabase as sb } from '../src/lib/supabase/client'
import { carregarPlanoEntrada } from '../src/features/cronograma/dados'
import { calcularPlano } from '../src/features/cronograma/motor/calculo'
import { conferirTempoCaminho } from '../src/features/cronograma/visoes/conferir-tempo-caminho'

const planoId = process.argv[2]
if (!planoId) throw new Error('uso: verificar-tempo-caminho.mjs <planejamento_id>')
const { error: authErr } = await sb.auth.signInWithPassword({
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASSWORD
})
if (authErr) throw authErr
const MODELO = new Uint8Array(
  readFileSync(
    new globalThis.URL('../src/features/cronograma/motor/modelo/default.dr5', import.meta.url)
  )
)
const e = await carregarPlanoEntrada(planoId)
const r = calcularPlano(e, MODELO).resultado
let falhou = false
for (const o of [{ fimDeSemana: false }, { fimDeSemana: true }]) {
  const c = conferirTempoCaminho(e, r, o)
  console.log(
    `${o.fimDeSemana ? 'com' : 'sem'} fins de semana no eixo — tarefas ${c.tarefas} · pedaços ${c.pedacos} · pontos ${c.pontos}`
  )
  for (const f of c.falhas.slice(0, 40)) console.log('✗ ' + f)
  if (c.falhas.length) falhou = true
}
console.log(falhou ? 'FALHOU' : '✓ tempo-caminho coerente com o cálculo em todos os pontos')
process.exit(falhou ? 1 : 0)
