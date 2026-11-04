/**
 * Integração com o stack local (supabase start + scripts/seed-cronograma.mjs): carrega um plano real do banco, calcula
 * pelo motor do ApeX, grava pela RPC e confere o ponto fixo (recarregar e recalcular não muda nada).
 *
 *   CRONOGRAMA_LOCAL=<planejamento_id> VITE_SUPABASE_URL=http://127.0.0.1:55321 VITE_SUPABASE_ANON_KEY=<anon> \
 *   E2E_EMAIL=god@infrawork.local E2E_PASSWORD=... npx vitest run src/features/cronograma/integracao-local
 *
 * Sem CRONOGRAMA_LOCAL a suíte é pulada.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { supabase } from '@/lib/supabase/client'
import { carregarPlanoEntrada } from './dados'
import { calcularPlano, payloadGravacao } from './motor/calculo'
import { segParaTimestamp } from './motor/tempo'

const PLANO = process.env.CRONOGRAMA_LOCAL
const MODELO = new Uint8Array(
  readFileSync(resolve(__dirname, '../../../vendor/apex/fixtures/default.dr5'))
)

describe.skipIf(!PLANO)('cronograma contra o banco local', () => {
  it('carrega, calcula, grava e chega ao ponto fixo', async () => {
    expect(String(import.meta.env.VITE_SUPABASE_URL)).toMatch(/127\.0\.0\.1|localhost/)
    const { error } = await supabase!.auth.signInWithPassword({
      email: process.env.E2E_EMAIL!,
      password: process.env.E2E_PASSWORD!
    })
    expect(error).toBeNull()

    const e1 = await carregarPlanoEntrada(PLANO!)
    const t0 = performance.now()
    const c1 = calcularPlano(e1, MODELO)
    const ms = performance.now() - t0
    const r1 = c1.resultado
    console.log(
      `plano ${e1.plano.nome}: ${e1.tarefas.length} linhas, ${r1.tarefas.size} tarefas no motor, ${ms.toFixed(0)} ms`
    )
    for (const t of e1.tarefas.filter((x) => x.tipo_no === 'tarefa')) {
      const r = r1.tarefas.get(t.id)
      console.log(
        `  ${t.nome.padEnd(22)} ${String(t.quantidade).padStart(9)}  ${r ? `${segParaTimestamp(r.inicio)} → ${segParaTimestamp(r.fim)}  ${r.duracao_dias_uteis.toFixed(1)} d.u.  folga ${(r.folga_total_h / 9).toFixed(1)} d  wps ${r.wps.length}${r.violacoes.length ? '  ⚑ ' + r.violacoes.map((v) => v.tipo).join(',') : ''}` : '(fora do motor)'}`
      )
    }
    console.log(
      '  automáticas:',
      r1.automaticas.length,
      ' avisos:',
      r1.avisos.join(' | ') || '—',
      ' marcos:',
      JSON.stringify(r1.marcos.map((m) => m.tarefas.length))
    )
    expect(r1.tarefas.size).toBeGreaterThan(0)

    const g1 = await supabase!.rpc('planejamento_gravar_calculo', {
      _planejamento_id: PLANO,
      _dados: payloadGravacao(e1, r1)
    })
    expect(g1.error).toBeNull()
    expect((g1.data as { ok: boolean }).ok).toBe(true)

    // depois de gravar: os inícios gravados viram os desejados; o recálculo chega ao mesmo resultado
    const e2 = await carregarPlanoEntrada(PLANO!)
    expect(e2.plano.calculo_rev).toBe(e2.plano.dados_rev)
    const r2 = calcularPlano(e2, MODELO).resultado
    for (const [id, a] of r1.tarefas) {
      const b = r2.tarefas.get(id)!
      expect([segParaTimestamp(b.inicio), segParaTimestamp(b.fim)]).toEqual([
        segParaTimestamp(a.inicio),
        segParaTimestamp(a.fim)
      ])
    }
  }, 120000)
})
