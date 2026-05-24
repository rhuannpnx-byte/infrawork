// RBAC integration tests
//
// Cenários cobertos (do prompt):
//   1. God cria empresa.
//   2. Adm NÃO cria empresa.
//   3. Engenheiro não vê obra sem permissão explícita.
//   4. Apoio vê o que o Engenheiro vê.
//   5. Revogar a permissão do Engenheiro derruba o acesso do Apoio em cascata.
//
// Pré-requisitos:
//   - supabase start (banco local com migrations já rodadas)
//   - Variáveis de ambiente:
//       SUPABASE_URL                http://localhost:54321 (ou o seu projeto)
//       SUPABASE_ANON_KEY           anon key
//       SUPABASE_SERVICE_ROLE_KEY   service_role key
//
// Execução:
//   deno test --allow-env --allow-net supabase/tests/rbac.test.ts
//
// Convenção: cada teste cria seus próprios usuários e empresa, com sufixo
// aleatório para evitar colisão. Não há cleanup global — confie em CASCADE +
// recriação do banco entre rodadas locais.

import { assertEquals, assertExists } from 'jsr:@std/assert@1'
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const rid = (): string => Math.random().toString(36).slice(2, 8)

async function createUser(opts: {
  email: string
  password: string
  role: 'god' | 'adm' | 'engenheiro' | 'apoio'
  empresa_id: string | null
  engenheiro_id?: string | null
  nome?: string
}): Promise<{ id: string; client: SupabaseClient }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
    user_metadata: { nome: opts.nome ?? opts.email }
  })
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`)

  const { error: pErr } = await admin.from('profiles').insert({
    id: data.user.id,
    email: opts.email,
    nome: opts.nome ?? opts.email,
    role: opts.role,
    empresa_id: opts.empresa_id,
    engenheiro_id: opts.engenheiro_id ?? null
  })
  if (pErr) throw new Error(`insert profile: ${pErr.message}`)

  // Cliente autenticado como o user
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { error: signErr } = await c.auth.signInWithPassword({
    email: opts.email,
    password: opts.password
  })
  if (signErr) throw new Error(`signIn ${opts.email}: ${signErr.message}`)

  return { id: data.user.id, client: c }
}

async function createEmpresa(nome: string): Promise<string> {
  const { data, error } = await admin
    .from('empresas')
    .insert({ nome, cnpj: `${rid()}-test` })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

// ─────────────────────────────────────────────────────────────────────────
// 1. God cria empresa
// ─────────────────────────────────────────────────────────────────────────
Deno.test('1. God cria empresa', async () => {
  const tag = rid()
  // Precisamos de um God de teste — criamos diretamente via admin
  const god = await createUser({
    email: `god-${tag}@infrawork.test`,
    password: 'GodPassword123!',
    role: 'god',
    empresa_id: null
  })

  const { data, error } = await god.client
    .from('empresas')
    .insert({ nome: `Empresa Teste ${tag}`, cnpj: `${tag}-1234` })
    .select('id, nome')
    .single()

  assertEquals(error, null)
  assertExists(data)
  assertEquals(data!.nome, `Empresa Teste ${tag}`)
})

// ─────────────────────────────────────────────────────────────────────────
// 2. Adm NÃO cria empresa (RLS deve negar)
// ─────────────────────────────────────────────────────────────────────────
Deno.test('2. Adm não cria empresa', async () => {
  const tag = rid()
  const empresaId = await createEmpresa(`Empresa Adm ${tag}`)
  const adm = await createUser({
    email: `adm-${tag}@infrawork.test`,
    password: 'AdmPassword123!',
    role: 'adm',
    empresa_id: empresaId
  })

  const { data, error } = await adm.client
    .from('empresas')
    .insert({ nome: `Hostil ${tag}`, cnpj: `hostil-${tag}` })
    .select('id')
    .single()

  // RLS deve negar: nenhuma row retornada e erro de policy
  assertEquals(data, null)
  assertExists(error)
})

// ─────────────────────────────────────────────────────────────────────────
// 3. Engenheiro NÃO vê obra sem permissão
// ─────────────────────────────────────────────────────────────────────────
Deno.test('3. Engenheiro não vê obra sem permissão', async () => {
  const tag = rid()
  const empresaId = await createEmpresa(`Empresa Eng ${tag}`)
  const eng = await createUser({
    email: `eng-${tag}@infrawork.test`,
    password: 'EngPassword123!',
    role: 'engenheiro',
    empresa_id: empresaId
  })

  // Adm cria a obra
  const { data: obra, error: obraErr } = await admin
    .from('obras')
    .insert({ empresa_id: empresaId, nome: `Obra ${tag}`, codigo: `OB-${tag}` })
    .select('id')
    .single()
  if (obraErr || !obra) throw obraErr

  // Engenheiro ainda SEM obra_permissao para esta obra
  const { data: lista } = await eng.client
    .from('obras')
    .select('id')
    .eq('id', obra.id)

  assertEquals(lista, [], 'engenheiro não deveria ver a obra')
})

// ─────────────────────────────────────────────────────────────────────────
// 4. Apoio vê o que o Engenheiro vê (com permissão concedida)
// ─────────────────────────────────────────────────────────────────────────
Deno.test('4. Apoio vê o que o Engenheiro vê', async () => {
  const tag = rid()
  const empresaId = await createEmpresa(`Empresa Apoio ${tag}`)

  const adm = await createUser({
    email: `adm-${tag}@infrawork.test`,
    password: 'AdmPassword123!',
    role: 'adm',
    empresa_id: empresaId
  })

  const eng = await createUser({
    email: `eng-${tag}@infrawork.test`,
    password: 'EngPassword123!',
    role: 'engenheiro',
    empresa_id: empresaId
  })

  const apoio = await createUser({
    email: `apo-${tag}@infrawork.test`,
    password: 'ApoioPassword123!',
    role: 'apoio',
    empresa_id: empresaId,
    engenheiro_id: eng.id
  })

  const { data: obra } = await admin
    .from('obras')
    .insert({ empresa_id: empresaId, nome: `Obra Apo ${tag}`, codigo: `OBA-${tag}` })
    .select('id')
    .single()
  if (!obra) throw new Error('obra insert')

  // Adm concede permissão ao Engenheiro
  const { error: grantErr } = await adm.client
    .from('obra_permissoes')
    .insert({ obra_id: obra.id, user_id: eng.id, concedido_por: adm.id })
  assertEquals(grantErr, null)

  // Engenheiro vê
  const { data: visEng } = await eng.client.from('obras').select('id').eq('id', obra.id)
  assertEquals(visEng?.length, 1)

  // Apoio também vê
  const { data: visApo } = await apoio.client.from('obras').select('id').eq('id', obra.id)
  assertEquals(visApo?.length, 1, 'apoio deveria herdar acesso do engenheiro')
})

// ─────────────────────────────────────────────────────────────────────────
// 5. Revogar Engenheiro derruba o Apoio em cascata
// ─────────────────────────────────────────────────────────────────────────
Deno.test('5. Revogar Engenheiro derruba o Apoio', async () => {
  const tag = rid()
  const empresaId = await createEmpresa(`Empresa Rev ${tag}`)

  const adm = await createUser({
    email: `adm-${tag}@infrawork.test`,
    password: 'AdmPassword123!',
    role: 'adm',
    empresa_id: empresaId
  })

  const eng = await createUser({
    email: `eng-${tag}@infrawork.test`,
    password: 'EngPassword123!',
    role: 'engenheiro',
    empresa_id: empresaId
  })

  const apoio = await createUser({
    email: `apo-${tag}@infrawork.test`,
    password: 'ApoioPassword123!',
    role: 'apoio',
    empresa_id: empresaId,
    engenheiro_id: eng.id
  })

  const { data: obra } = await admin
    .from('obras')
    .insert({ empresa_id: empresaId, nome: `Obra Rev ${tag}`, codigo: `OBR-${tag}` })
    .select('id')
    .single()
  if (!obra) throw new Error('obra insert')

  await adm.client
    .from('obra_permissoes')
    .insert({ obra_id: obra.id, user_id: eng.id, concedido_por: adm.id })

  // Antes: ambos veem
  {
    const { data: e } = await eng.client.from('obras').select('id').eq('id', obra.id)
    const { data: a } = await apoio.client.from('obras').select('id').eq('id', obra.id)
    assertEquals(e?.length, 1)
    assertEquals(a?.length, 1)
  }

  // Adm revoga
  const { error: revErr } = await adm.client
    .from('obra_permissoes')
    .delete()
    .eq('obra_id', obra.id)
    .eq('user_id', eng.id)
  assertEquals(revErr, null)

  // Depois: nenhum dos dois vê
  {
    const { data: e } = await eng.client.from('obras').select('id').eq('id', obra.id)
    const { data: a } = await apoio.client.from('obras').select('id').eq('id', obra.id)
    assertEquals(e ?? [], [], 'engenheiro deveria ter perdido acesso')
    assertEquals(a ?? [], [], 'apoio deveria ter perdido acesso em cascata')
  }
})
