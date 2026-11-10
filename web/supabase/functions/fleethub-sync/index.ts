// POST /functions/v1/fleethub-sync — frota a partir da FleetHub (só leitura lá).
// { acao: 'conectar', email, senha } testa o login e guarda a credencial da empresa no Vault;
// { acao: 'desconectar' } apaga; { acao: 'sincronizar' } (padrão) atualiza a frota.
// Quem chama: god/adm (god informa empresa_id) ou o cron (service role: todas as empresas conectadas).

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { handlePreflight, json } from '../_shared/cors.ts'
import { lerTodas } from '../_shared/paginar.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import {
  cubagemM3,
  ehPaginaDeLogin,
  equipamentosDeCarga,
  extrairToken,
  FormatoFleetHubError,
  parseCapacidade,
  parseEquipamentos,
  parseObras,
  temCubagem,
  textoCapacidade,
  type EquipamentoFleet,
} from '../_shared/fleethub-parse.ts'

const BASE = (Deno.env.get('FLEETHUB_BASE_URL') ?? 'https://fleethub.app.br').replace(/\/$/, '')
const INTERVALO_MANUAL_MS = 5 * 60_000
const PRAZO_MS = 60_000
const UA = 'InfraWork-Frota/1.0'
const LEITURAS_SIMULTANEAS = 10

interface Cubagem {
  texto: string | null
  m3: number | null
}

class Sessao {
  private jar = new Map<string, string>()
  private guarda(r: Response) {
    for (const c of r.headers.getSetCookie()) {
      const par = c.split(';')[0] ?? ''
      const i = par.indexOf('=')
      if (i > 0) this.jar.set(par.slice(0, i).trim(), par.slice(i + 1))
    }
  }
  async req(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('User-Agent', UA)
    if (this.jar.size) headers.set('Cookie', [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '))
    const r = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(PRAZO_MS) })
    this.guarda(r)
    return r
  }
  async form(path: string, campos: Record<string, string>) {
    return this.req(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/login` },
      body: new URLSearchParams(campos),
    })
  }
}

class LoginRecusado extends Error {}

async function entrar(email: string, senha: string) {
  const s = new Sessao()
  const login = await s.req('/login')
  const token = extrairToken(await login.text())
  if (!token) throw new FormatoFleetHubError('Página de login da FleetHub mudou')
  const r = await s.form('/login', { _token: token, email, password: senha })
  await r.body?.cancel()
  if (r.status !== 302 || /\/login\b/.test(r.headers.get('location') ?? '')) {
    throw new LoginRecusado('Login recusado pela FleetHub — confira o e-mail e a senha')
  }
  return s
}

async function sair(s: Sessao, html: string) {
  const tk = extrairToken(html)
  if (tk) await s.form('/logout', { _token: tk }).then((x) => x.body?.cancel()).catch(() => undefined)
}

/** Login e acesso à página de equipamentos (usado ao conectar). */
async function testar(email: string, senha: string) {
  const s = await entrar(email, senha)
  const p = await s.req(`/equipamento?${new URLSearchParams({ 'statusEquipamento[]': 'Ativo' })}`)
  const html = await p.text()
  await sair(s, html)
  if (p.status !== 200 || ehPaginaDeLogin(html)) {
    throw new Error('Este usuário entra na FleetHub mas não tem acesso à página de Equipamentos')
  }
  parseEquipamentos(html)
}

async function lerFleetHub(email: string, senha: string) {
  const s = await entrar(email, senha)
  const pagina = async (status: string) => {
    const q = new URLSearchParams({ 'statusEquipamento[]': status })
    const p = await s.req(`/equipamento?${q}`)
    const html = await p.text()
    if (p.status !== 200 || ehPaginaDeLogin(html)) throw new Error(`FleetHub não abriu os equipamentos (${p.status})`)
    return html
  }
  const htmlAtivos = await pagina('Ativo')
  const htmlTransf = await pagina('Em transferência')
  const ativos = parseEquipamentos(htmlAtivos)
  const transf = parseEquipamentos(htmlTransf)
  const obras = parseObras(htmlAtivos)
  if (ativos.length === 0) {
    await sair(s, htmlAtivos)
    throw new FormatoFleetHubError('FleetHub devolveu a lista de equipamentos vazia')
  }
  const status = new Map<number, string>()
  for (const e of ativos) status.set(e.fleet_id, 'Ativo')
  for (const e of transf) status.set(e.fleet_id, 'Em transferência')
  const todos = new Map<number, EquipamentoFleet>()
  for (const e of [...ativos, ...transf]) todos.set(e.fleet_id, e)
  const equipamentos = [...todos.values()]
  const cubagens = await lerCubagens(s, equipamentosDeCarga(equipamentos).filter(temCubagem))
  await sair(s, htmlAtivos)
  return { equipamentos, status, obras, cubagens }
}

/**
 * Capacidade (cubagem) de cada veículo, lida da página de edição — só GET, o formulário nunca é enviado.
 * Sem acesso a essa página (usuário sem permissão), devolve `null` e a capacidade fica como está no InfraWork;
 * uma página que falhe sozinha só deixa aquele veículo de fora.
 */
async function lerCubagens(s: Sessao, lista: EquipamentoFleet[]): Promise<Map<number, Cubagem> | null> {
  const out = new Map<number, Cubagem>()
  const fila = [...lista]
  let semAcesso = false
  const trabalhador = async () => {
    while (fila.length && !semAcesso) {
      const e = fila.shift()!
      try {
        const r = await s.req(`/equipamento/editar/${e.fleet_id}`)
        const html = await r.text()
        if (r.status === 403 || r.status === 302 || ehPaginaDeLogin(html)) {
          semAcesso = true
          return
        }
        if (r.status !== 200) continue
        const { valor, unidade } = parseCapacidade(html)
        out.set(e.fleet_id, { texto: textoCapacidade(valor, unidade), m3: cubagemM3(valor, unidade) })
      } catch {
        // página que não abriu ou mudou: o veículo fica com a capacidade que já tem
      }
    }
  }
  await Promise.all(Array.from({ length: LEITURAS_SIMULTANEAS }, trabalhador))
  return semAcesso ? null : out
}

async function gravar(admin: SupabaseClient, empresa: string, dados: Awaited<ReturnType<typeof lerFleetHub>>) {
  const agora = new Date().toISOString()
  const { error: eObras } = await admin.from('fleet_obra').upsert(
    dados.obras.map((o) => ({ empresa_id: empresa, fleet_id: o.fleet_id, nome: o.nome, atualizado_em: agora })),
    { onConflict: 'empresa_id,fleet_id' },
  )
  if (eObras) throw eObras
  const { data: obras, error: eLer } = await admin.from('fleet_obra').select('id, fleet_id, nome').eq('empresa_id', empresa)
  if (eLer) throw eLer
  const obraPorNome = new Map<string, string>()
  for (const o of obras ?? []) if (!obraPorNome.has(o.nome)) obraPorNome.set(o.nome, o.id)
  const obraPorNomeCI = new Map<string, string>()
  for (const o of obras ?? []) if (!obraPorNomeCI.has(o.nome.toUpperCase())) obraPorNomeCI.set(o.nome.toUpperCase(), o.id)

  // a frota da empresa passa de 1000: ler tudo, senão veículos existentes parecem novos
  const { data: frota, error: eFrota } = await lerTodas<Record<string, unknown>>((de, ate) =>
    admin
      .from('frota_veiculo')
      .select('id, fleet_id, prefixo, origem, ativo')
      .eq('empresa_id', empresa)
      .order('id')
      .range(de, ate)
  )
  if (eFrota) throw eFrota
  const porFleet = new Map((frota ?? []).filter((v) => v.fleet_id != null).map((v) => [v.fleet_id as number, v]))
  const porPrefixo = new Map((frota ?? []).map((v) => [v.prefixo as string, v]))

  const carga = equipamentosDeCarga(dados.equipamentos)
  const novos: Record<string, unknown>[] = []
  const atualizar: { id: string; campos: Record<string, unknown> }[] = []
  for (const e of carga) {
    const campos = {
      origem: 'fleethub',
      fleet_id: e.fleet_id,
      placa: e.placa,
      marca: e.marca,
      modelo: e.modelo,
      ano: e.ano,
      fleet_tipo: e.tipo,
      fleet_obra_id: e.obra ? (obraPorNome.get(e.obra) ?? obraPorNomeCI.get(e.obra.toUpperCase()) ?? null) : null,
      fleet_status: dados.status.get(e.fleet_id) ?? 'Ativo',
      ativo: true,
      sincronizado_em: agora,
      ...camposCubagem(dados.cubagens?.get(e.fleet_id)),
    }
    const atual = porFleet.get(e.fleet_id) ?? (porPrefixo.get(e.codigo)?.origem === 'manual' ? porPrefixo.get(e.codigo) : undefined)
    const ocupado = porPrefixo.get(e.codigo)
    const prefixo = ocupado && ocupado.id !== atual?.id ? `${e.codigo}-${e.fleet_id}` : e.codigo
    if (atual) atualizar.push({ id: atual.id, campos: { ...campos, prefixo } })
    else novos.push({ capacidade_fleethub: false, fleet_capacidade: null, ...campos, empresa_id: empresa, prefixo, tipo: e.tipo_infrawork, proprietario: 'proprio' })
  }
  if (novos.length) {
    const { error } = await admin.from('frota_veiculo').insert(novos)
    if (error) throw error
  }
  for (let i = 0; i < atualizar.length; i += 20) {
    const lote = atualizar.slice(i, i + 20)
    const res = await Promise.all(lote.map((u) => admin.from('frota_veiculo').update(u.campos).eq('id', u.id)))
    const erro = res.find((r) => r.error)?.error
    if (erro) throw erro
  }
  const vistos = new Set(carga.map((e) => e.fleet_id))
  const sair = (frota ?? []).filter((v) => v.origem === 'fleethub' && v.ativo && !vistos.has(v.fleet_id as number))
  if (sair.length) {
    const { error } = await admin
      .from('frota_veiculo')
      .update({ ativo: false, fleet_status: 'Fora da FleetHub', sincronizado_em: agora })
      .in('id', sair.map((v) => v.id))
    if (error) throw error
  }
  return {
    lidos: dados.equipamentos.length,
    novos: novos.length,
    atualizados: atualizar.length,
    inativados: sair.length,
    obras: dados.obras.length,
    capacidades: dados.cubagens ? [...dados.cubagens.values()].filter((c) => c.m3 !== null).length : null,
  }
}

/** Cubagem válida em m³ passa a valer no InfraWork; sem ela, a capacidade digitada aqui volta a ser editável. */
function camposCubagem(c: Cubagem | undefined): Record<string, unknown> {
  if (!c) return {}
  return c.m3 !== null
    ? { fleet_capacidade: c.texto, capacidade_m3: c.m3, capacidade_fleethub: true }
    : { fleet_capacidade: c.texto, capacidade_fleethub: false }
}

const textoErro = (e: unknown): string =>
  e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)

/** 502/503/504, tempo esgotado ou rede: vale tentar de novo. */
const transitorio = (e: unknown): boolean =>
  /^\s*<|\b50[234]\b|timed? ?out|fetch failed|network|connection/i.test(textoErro(e))

/** Página de erro (HTML do proxy) vira uma frase. */
function mensagem(e: unknown): string {
  const t = textoErro(e)
  if (!/^\s*</.test(t)) return t
  const cod = t.match(/\b(5\d\d)\b/)?.[1]
  return `Falha temporária de comunicação${cod ? ` (${cod})` : ''} — tente de novo`
}

async function sincronizar(admin: SupabaseClient, empresa: string, quem: string | null, cron: boolean) {
  const { data: cred } = await admin.rpc('fleethub_credencial', { _empresa_id: empresa }).maybeSingle()
  const c = cred as { email: string; senha: string } | null
  if (!c?.senha) return { status: 400, body: { ok: false, error: 'A FleetHub não está conectada para esta empresa' } }

  const { data: ultima } = await admin
    .from('fleet_sync_execucao')
    .select('iniciado_em, terminado_em')
    .eq('empresa_id', empresa)
    .order('iniciado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (ultima) {
    const desde = Date.now() - new Date(ultima.iniciado_em).getTime()
    if (!ultima.terminado_em && desde < 10 * 60_000) {
      return { status: 409, body: { ok: false, error: 'Já há uma sincronização em andamento' } }
    }
    if (!cron && desde < INTERVALO_MANUAL_MS) {
      return { status: 429, body: { ok: false, error: 'A frota foi sincronizada há poucos minutos — aguarde um pouco' } }
    }
  }
  const { data: exec, error: eExec } = await admin
    .from('fleet_sync_execucao')
    .insert({ empresa_id: empresa, disparado_por: quem, origem: cron ? 'cron' : 'manual' })
    .select('id')
    .single()
  if (eExec) return { status: 500, body: { ok: false, error: eExec.message } }
  try {
    let r
    try {
      r = await gravar(admin, empresa, await lerFleetHub(c.email, c.senha))
    } catch (e) {
      if (!transitorio(e)) throw e
      await new Promise((ok) => setTimeout(ok, 15_000))
      r = await gravar(admin, empresa, await lerFleetHub(c.email, c.senha))
    }
    await admin.from('fleet_sync_execucao').update({ ...r, ok: true, terminado_em: new Date().toISOString() }).eq('id', exec.id)
    return { status: 200, body: { ok: true, ...r } }
  } catch (e) {
    const msg = mensagem(e)
    await admin
      .from('fleet_sync_execucao')
      .update({ ok: false, mensagem: msg.slice(0, 500), terminado_em: new Date().toISOString() })
      .eq('id', exec.id)
    return { status: 502, body: { ok: false, error: msg } }
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  let body: { acao?: string; origem?: string; empresa_id?: string; email?: string; senha?: string } = {}
  try {
    body = await req.json()
  } catch { /* sem corpo */ }

  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  let servico = !!SERVICE_KEY && token === SERVICE_KEY
  if (!servico && token) {
    try {
      servico = JSON.parse(atob(token.split('.')[1] ?? ''))?.role === 'service_role'
    } catch { /* jwt de usuário */ }
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const acao = body.acao ?? 'sincronizar'

  // cron: todas as empresas conectadas, uma de cada vez
  if (servico) {
    if (acao !== 'sincronizar') return json({ error: 'Ação não permitida' }, 400)
    const { data: cfgs } = await admin.from('fleethub_config').select('empresa_id')
    const resultados = []
    for (const c of cfgs ?? []) {
      const r = await sincronizar(admin, c.empresa_id, null, true)
      resultados.push({ empresa_id: c.empresa_id, ...r.body })
    }
    return json({ ok: true, empresas: resultados })
  }

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm'])
  if (roleErr) return roleErr
  const empresa = ctx.caller.role === 'god' ? body.empresa_id : ctx.caller.empresa_id
  if (!empresa) return json({ error: 'Informe a empresa' }, 400)

  if (acao === 'conectar') {
    const email = (body.email ?? '').trim().toLowerCase()
    const senha = body.senha ?? ''
    if (!email || !senha) return json({ ok: false, error: 'Informe o e-mail e a senha da FleetHub' }, 400)
    try {
      await testar(email, senha)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return json({ ok: false, error: msg }, e instanceof LoginRecusado ? 400 : 502)
    }
    const { error } = await admin.rpc('fleethub_gravar_credencial', {
      _empresa_id: empresa,
      _email: email,
      _senha: senha,
      _por: ctx.caller.id,
    })
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })
  }
  if (acao === 'desconectar') {
    const { error } = await admin.rpc('fleethub_remover_credencial', { _empresa_id: empresa })
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })
  }
  if (acao !== 'sincronizar') return json({ error: 'Ação desconhecida' }, 400)
  const r = await sincronizar(admin, empresa, ctx.caller.id, false)
  return json(r.body, r.status)
})
