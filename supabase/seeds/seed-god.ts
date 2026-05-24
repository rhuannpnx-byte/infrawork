// Seed idempotente do usuário God.
//
// Pré-requisitos:
//   - Migrations já aplicadas no projeto (schema + RLS).
//   - Variáveis de ambiente:
//       SUPABASE_URL                URL do projeto Supabase
//       SUPABASE_SERVICE_ROLE_KEY   service_role (NUNCA exponha ao cliente)
//       SEED_GOD_EMAIL              email do God (default: rhuann.nunes@tecpav.com.br)
//       SEED_GOD_PASSWORD           senha do God (obrigatório)
//
// Como rodar:
//   deno run --allow-env --allow-net supabase/seeds/seed-god.ts
//
// Comportamento:
//   1. Procura o usuário pelo email.
//   2. Se não existe: cria via auth.admin.createUser (email já confirmado).
//   3. Se existe: atualiza apenas a senha.
//   4. Upserta a row em public.profiles com role='god', empresa_id=NULL.
//
// É seguro rodar repetidas vezes.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SEED_GOD_EMAIL = Deno.env.get('SEED_GOD_EMAIL') ?? 'rhuann.nunes@tecpav.com.br'
const SEED_GOD_PASSWORD = Deno.env.get('SEED_GOD_PASSWORD')
const SEED_GOD_NAME = Deno.env.get('SEED_GOD_NAME') ?? 'God Administrador'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✖ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.')
  Deno.exit(1)
}
if (!SEED_GOD_PASSWORD || SEED_GOD_PASSWORD.length < 8) {
  console.error('✖ SEED_GOD_PASSWORD obrigatória e com >=8 caracteres.')
  Deno.exit(1)
}
if (SEED_GOD_PASSWORD.length < 12) {
  console.warn('⚠ SEED_GOD_PASSWORD com <12 chars — considere uma senha mais longa para o God.')
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  // listUsers retorna paginado; para o seed assumimos < 1000 usuários no Auth.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  return found ? { id: found.id } : null
}

async function ensureAuthUser(): Promise<string> {
  const existing = await findUserByEmail(SEED_GOD_EMAIL)
  if (existing) {
    console.log(`• Usuário ${SEED_GOD_EMAIL} já existe no Auth (id=${existing.id}).`)
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: SEED_GOD_PASSWORD,
      email_confirm: true,
      user_metadata: { nome: SEED_GOD_NAME }
    })
    if (error) throw error
    console.log('  ↳ Senha atualizada.')
    return existing.id
  }

  console.log(`• Criando usuário ${SEED_GOD_EMAIL} no Auth…`)
  const { data, error } = await admin.auth.admin.createUser({
    email: SEED_GOD_EMAIL,
    password: SEED_GOD_PASSWORD,
    email_confirm: true,
    user_metadata: { nome: SEED_GOD_NAME }
  })
  if (error) throw error
  if (!data.user) throw new Error('createUser retornou sem user')
  console.log(`  ↳ Criado (id=${data.user.id}).`)
  return data.user.id
}

async function ensureProfile(userId: string): Promise<void> {
  // upsert garante idempotência.
  const { error } = await admin
    .from('profiles')
    .upsert(
      {
        id: userId,
        email: SEED_GOD_EMAIL,
        nome: SEED_GOD_NAME,
        role: 'god',
        empresa_id: null,
        engenheiro_id: null,
        ativo: true
      },
      { onConflict: 'id' }
    )
  if (error) throw error
  console.log('• Profile do God upsertado (role=god, empresa_id=null).')
}

try {
  const userId = await ensureAuthUser()
  await ensureProfile(userId)
  console.log('✓ Seed do God concluído.')
  Deno.exit(0)
} catch (err) {
  console.error('✖ Falha no seed:', err instanceof Error ? err.message : err)
  Deno.exit(1)
}
