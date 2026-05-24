// Versão Node do seed do God (equivalente funcional ao seed-god.ts em Deno).
// Use esta quando o ambiente não tem Deno disponível.
//
// Como rodar (PowerShell):
//   $env:SUPABASE_URL = "https://<ref>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service-role>"
//   $env:SEED_GOD_PASSWORD = "<senha>"
//   node supabase/seeds/seed-god.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SEED_GOD_EMAIL = process.env.SEED_GOD_EMAIL ?? 'rhuann.nunes@tecpav.com.br'
const SEED_GOD_PASSWORD = process.env.SEED_GOD_PASSWORD
const SEED_GOD_NAME = process.env.SEED_GOD_NAME ?? 'God Administrador'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✖ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.')
  process.exit(1)
}
if (!SEED_GOD_PASSWORD || SEED_GOD_PASSWORD.length < 8) {
  console.error('✖ SEED_GOD_PASSWORD obrigatória e com >=8 caracteres.')
  process.exit(1)
}
if (SEED_GOD_PASSWORD.length < 12) {
  console.warn('⚠ SEED_GOD_PASSWORD com <12 chars — considere uma senha mais longa para o God.')
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function findUserByEmail(email) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  return found ? { id: found.id } : null
}

async function ensureAuthUser() {
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

async function ensureProfile(userId) {
  const { error } = await admin.from('profiles').upsert(
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
  process.exit(0)
} catch (err) {
  console.error('✖ Falha no seed:', err instanceof Error ? err.message : err)
  process.exit(1)
}
