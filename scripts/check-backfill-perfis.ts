// READ-ONLY: conta quantas tarefas precisam de backfill de perfil_semana.
//
// Uso: deno run --allow-env --allow-net --env-file=.env scripts/check-backfill-perfis.ts
//
// Usa raw fetch contra PostgREST (sem supabase-js, sem node_modules).

const url = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL')
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!url || !key) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no env.')
  Deno.exit(1)
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json'
}

interface TarefaRow {
  id: string
  obra_id: string | null
  planejamento_id: string
  data_inicio: string | null
  data_fim: string | null
  cpu_snapshot_id: string | null
}

// 1) Lista tarefas baseline=false com datas
const qTarefas =
  `${url}/rest/v1/vw_planejamento_tarefa_completa` +
  `?is_baseline=eq.false` +
  `&data_inicio=not.is.null&data_fim=not.is.null` +
  `&select=id,obra_id,planejamento_id,data_inicio,data_fim,cpu_snapshot_id`

const r1 = await fetch(qTarefas, { headers })
if (!r1.ok) {
  console.error('Erro fetch tarefas:', r1.status, await r1.text())
  Deno.exit(1)
}
const tarefas = (await r1.json()) as TarefaRow[]
console.log(`Total tarefas baseline=false com datas: ${tarefas.length}`)

if (tarefas.length === 0) {
  console.log('Nada pra backfillar — saindo.')
  Deno.exit(0)
}

// 2) Quais dessas JA tem perfil
const ids = tarefas.map((t) => t.id)
const idsParam = ids.map((id) => `"${id}"`).join(',')
const qPerfil =
  `${url}/rest/v1/planejamento_tarefa_perfil_semana?tarefa_id=in.(${idsParam})&select=tarefa_id`

const r2 = await fetch(qPerfil, { headers })
if (!r2.ok) {
  console.error('Erro fetch perfil:', r2.status, await r2.text())
  Deno.exit(1)
}
const comPerfilRows = (await r2.json()) as Array<{ tarefa_id: string }>
const comPerfil = new Set(comPerfilRows.map((p) => p.tarefa_id))
const semPerfil = tarefas.filter((t) => !comPerfil.has(t.id))

console.log(`  - com perfil já preenchido: ${comPerfil.size}`)
console.log(`  - SEM perfil (universo do backfill): ${semPerfil.length}`)

if (semPerfil.length > 0) {
  const porObra = new Map<string, number>()
  for (const t of semPerfil) {
    const k = t.obra_id ?? '(null)'
    porObra.set(k, (porObra.get(k) ?? 0) + 1)
  }
  console.log('\nDistribuição por obra:')
  for (const [obra, n] of porObra) console.log(`  ${obra}: ${n}`)
}
