// Dados de campo para uma obra do stack local (a obra de demonstração do seed-cronograma, por padrão a mais recente
// "DEMO-…"): parametrização dos serviços (material controlado, viagens, local obrigatório), frota da empresa, origens e
// destinos com as rotas (DMT), um apontador com a obra liberada e fichas de viagens de ontem. Idempotente: rodar de
// novo atualiza parâmetros, frota, locais e rotas, e não duplica as fichas.
//
//   SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_ANON_KEY=<anon> \
//   E2E_EMAIL=god@infrawork.local E2E_PASSWORD=... [SEED_OBRA=<obra_id>] node scripts/seed-campo.mjs
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:55321'
const ANON = process.env.SUPABASE_ANON_KEY
const EMAIL = process.env.E2E_EMAIL ?? 'god@infrawork.local'
const PASSWORD = process.env.E2E_PASSWORD
const APONTADOR = { email: 'apontador@infrawork.local', senha: 'Campo-local-2026', nome: 'Apontador Demo' }
if (!ANON || !PASSWORD) throw new Error('SUPABASE_ANON_KEY e E2E_PASSWORD são obrigatórios')
if (!/127\.0\.0\.1|localhost/.test(URL)) throw new Error('Este script só roda contra o stack local')

const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
if (authErr) throw authErr
const token = auth.session.access_token

async function fn(name, body) {
  const r = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${name} ${r.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}
async function q(table, build) {
  const { data, error } = await build(sb.from(table))
  if (error) throw new Error(`${table}: ${error.message}`)
  return data
}

// ── obra ───────────────────────────────────────────────────────────────────
const [obra] = process.env.SEED_OBRA
  ? await q('obras', (t) => t.select('id, codigo, nome, empresa_id').eq('id', process.env.SEED_OBRA))
  : await q('obras', (t) =>
      t.select('id, codigo, nome, empresa_id').like('codigo', 'DEMO-%').order('created_at', { ascending: false }).limit(1)
    )
if (!obra) throw new Error('Obra de demonstração não encontrada (rode o seed-cronograma ou passe SEED_OBRA)')
console.log('obra', obra.codigo, obra.id)

const itens = await q('item_orcamentario', (t) =>
  t.select('id, codigo, descricao').eq('obra_id', obra.id).eq('tipo', 'servico_grupo')
)
const item = (re) => {
  const i = itens.find((x) => re.test(x.descricao))
  if (!i) throw new Error(`serviço ${re} não encontrado`)
  return i
}
const materiais = await q('recurso', (t) => t.select('id, nome').eq('obra_id', obra.id).eq('grupo', 'MATERIAL'))
const material = (re) => materiais.find((m) => re.test(m.nome))?.id ?? null
const trechos = await q('obra_trecho', (t) => t.select('id, nome, tipo').eq('obra_id', obra.id))
const trecho = (re) => trechos.find((x) => re.test(x.nome))?.id ?? null

// ── parametrização dos serviços ────────────────────────────────────────────
const P = (re, campos) => ({
  item_orcamentario_id: item(re).id,
  obra_id: obra.id,
  modo_lancamento: 'quantidade',
  controla_material: false,
  material_recurso_id: null,
  material_unidade: null,
  material_obrigatorio: true,
  habilita_obs: true,
  exige_local: false,
  ...campos
})
const parametros = [
  P(/Escavação/, { modo_lancamento: 'viagens', habilita_obs: false }),
  P(/Sub-base/, { modo_lancamento: 'viagens', controla_material: true, material_recurso_id: material(/Solo-brita/) }),
  P(/Compactação/, { exige_local: true }),
  P(/Base de brita/, { controla_material: true, material_recurso_id: material(/Brita/), exige_local: true }),
  P(/Imprimação/, { controla_material: true, material_recurso_id: material(/CM-30/) }),
  P(/CBUQ/, { controla_material: true, material_recurso_id: material(/Massa asfáltica/), exige_local: true }),
  P(/Sarjeta/, { controla_material: true, material_recurso_id: material(/Concreto/), material_obrigatorio: false })
]
await q('servico_parametro', (t) => t.upsert(parametros, { onConflict: 'item_orcamentario_id' }).select('item_orcamentario_id'))
console.log('parâmetros', parametros.length)

// ── frota da empresa ───────────────────────────────────────────────────────
const frota = await q('frota_veiculo', (t) =>
  t
    .upsert(
      [
        { empresa_id: obra.empresa_id, prefixo: 'CB-01', placa: 'QWE1A23', tipo: 'basculante', modelo: 'Volvo FMX 460', proprietario: 'proprio', capacidade_m3: 12 },
        { empresa_id: obra.empresa_id, prefixo: 'CB-02', placa: 'RTY4B56', tipo: 'basculante', modelo: 'Scania P360', proprietario: 'terceiro', fornecedor: 'Transportes Silva', capacidade_m3: 14 },
        { empresa_id: obra.empresa_id, prefixo: 'CR-01', placa: 'UIO7C89', tipo: 'carreta', modelo: 'Mercedes Actros', proprietario: 'proprio', capacidade_m3: 20 }
      ],
      { onConflict: 'empresa_id,prefixo' }
    )
    .select('id, prefixo, capacidade_m3')
)
const veiculo = (p) => frota.find((v) => v.prefixo === p)
console.log('frota', frota.length)

// ── origens, destinos e rotas ──────────────────────────────────────────────
const locais = await q('transporte_local', (t) =>
  t
    .upsert(
      [
        { obra_id: obra.id, nome: 'Jazida Km 8', tipo: 'jazida' },
        { obra_id: obra.id, nome: 'Bota-fora Km 5', tipo: 'bota_fora' },
        { obra_id: obra.id, nome: 'Usina de asfalto', tipo: 'usina' },
        { obra_id: obra.id, nome: 'Pista — Trecho 1', tipo: 'pista', trecho_id: trecho(/Trecho 1/) },
        { obra_id: obra.id, nome: 'Pista — Contorno', tipo: 'pista', trecho_id: trecho(/Trecho 2/) }
      ],
      { onConflict: 'obra_id,nome' }
    )
    .select('id, nome')
)
const local = (n) => locais.find((l) => l.nome === n).id
await q('transporte_rota', (t) =>
  t
    .upsert(
      [
        { obra_id: obra.id, origem_id: local('Jazida Km 8'), destino_id: local('Pista — Trecho 1'), dmt_km: 6.5 },
        { obra_id: obra.id, origem_id: local('Jazida Km 8'), destino_id: local('Pista — Contorno'), dmt_km: 9 },
        { obra_id: obra.id, origem_id: local('Pista — Trecho 1'), destino_id: local('Bota-fora Km 5'), dmt_km: 3.2 },
        { obra_id: obra.id, origem_id: local('Pista — Contorno'), destino_id: local('Bota-fora Km 5'), dmt_km: 5.4 }
      ],
      { onConflict: 'origem_id,destino_id' }
    )
    .select('id')
)
console.log('origens/destinos', locais.length)

// ── apontador ──────────────────────────────────────────────────────────────
let [apontador] = await q('profiles', (t) => t.select('id, role, empresa_id').eq('email', APONTADOR.email))
if (!apontador) {
  apontador = await fn('create-usuario', {
    email: APONTADOR.email,
    nome: APONTADOR.nome,
    role: 'apontador',
    empresa_id: obra.empresa_id,
    password: APONTADOR.senha
  })
} else if (apontador.empresa_id !== obra.empresa_id) {
  await fn('update-usuario', { id: apontador.id, role: 'apontador', empresa_id: obra.empresa_id })
}
await fn('grant-obra-permissao', { obra_id: obra.id, user_id: apontador.id })
console.log('apontador', APONTADOR.email, '/', APONTADOR.senha)

// ── fichas de viagens de ontem (uma vez por dia/obra) ──────────────────────
const d = new Date()
d.setDate(d.getDate() - 1)
const ontem = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const ja = await q('viagem_ficha', (t) => t.select('id').eq('obra_id', obra.id).eq('data', ontem))
if (ja.length === 0) {
  const uuid = () => crypto.randomUUID()
  const hora = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  // CB-01: escavação no corte do Trecho 1 (EST 120 a EST 124) para o bota-fora
  await rpc('campo_sync_ficha', {
    _ficha: {
      id: uuid(), obra_id: obra.id, data: ontem, veiculo_id: veiculo('CB-01').id, motorista: 'José Almeida',
      origem: 'web',
      viagens: [0, 1, 2, 3, 4].map((k) => ({
        id: uuid(), item_orcamentario_id: item(/Escavação/).id, origem_id: local('Pista — Trecho 1'),
        destino_id: local('Bota-fora Km 5'), hora_carga: hora(7 + k, 10), hora_descarga: hora(7 + k, 40),
        quantidade: 12, estaca_carga_m: 2400 + k * 20
      }))
    }
  })
  // CB-02: solo-brita da jazida para a sub-base do Trecho 1 (EST 40 a EST 43)
  await rpc('campo_sync_ficha', {
    _ficha: {
      id: uuid(), obra_id: obra.id, data: ontem, veiculo_id: veiculo('CB-02').id, motorista: 'Carlos Pereira',
      origem: 'web',
      viagens: [0, 1, 2, 3].map((k) => ({
        id: uuid(), item_orcamentario_id: item(/Sub-base/).id, origem_id: local('Jazida Km 8'),
        destino_id: local('Pista — Trecho 1'), hora_carga: hora(7 + 2 * k, 0), hora_descarga: hora(7 + 2 * k, 50),
        quantidade: 14, nf_ticket: `T-${1040 + k}`, estaca_descarga_m: 800 + k * 20
      }))
    }
  })
  console.log('fichas de viagens', ontem)
} else console.log('fichas de', ontem, 'já existem')
