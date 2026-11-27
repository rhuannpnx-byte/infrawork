// POST /functions/v1/siga-login  { usuario, senha, empresa_id? }
// Entrada do apontador no app de campo com o usuário e a senha do SIGA (não há sessão ainda: é a entrada).
//   1. confere o limite de tentativas;
//   2. lê no SIGA quem é o usuário (ativo) e em quais projetos pode lançar;
//   3. manda o usuário e a senha para a tela de login do SIGA da empresa; a senha não é guardada nem registrada;
//   4. no primeiro acesso cria o usuário no InfraWork (apontador); em todo acesso atualiza as obras liberadas;
//   5. devolve uma sessão normal do InfraWork.
// Usuário do SIGA ligado a uma conta criada no InfraWork (engenheiro, apoio…) não entra por aqui: entra com o e-mail.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { handlePreflight, json } from '../_shared/cors.ts'
import { abrirSiga, segredoParaCredencial, type ConexaoSiga } from '../_shared/siga.ts'
import {
  autenticarNoSiga,
  projetosDoUsuario,
  urlDeLogin,
  usuarioPorLogin,
  type UsuarioSiga
} from '../_shared/siga-usuario.ts'

const TIPO = 'siga'
const RECUSA = 'Usuário ou senha inválidos.'
// endereço só para identificar a conta: ninguém recebe e-mail nele
const DOMINIO = 'siga.infrawork-web.vercel.app'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch { /* sem corpo */ }
  const usuario = String(body.usuario ?? '').trim()
  const senha = String(body.senha ?? '')
  const empresaPedida = typeof body.empresa_id === 'string' ? body.empresa_id : null
  if (!usuario || !senha) return json({ error: 'Informe o usuário e a senha.' }, 400)
  if (usuario.length > 40 || senha.length > 200 || usuario.includes('@')) return json({ error: RECUSA }, 401)

  const URL_BASE = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(URL_BASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const origem = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'desconhecida'
  const registrar = (ok: boolean) =>
    admin.rpc('siga_login_registrar', { _login: usuario, _origem: origem, _ok: ok }).then(() => undefined)

  const { data: liberado, error: limErr } = await admin.rpc('siga_login_liberado', { _login: usuario, _origem: origem })
  if (limErr) return json({ error: 'Não foi possível entrar agora. Tente de novo.' }, 500)
  if (liberado === false)
    return json({ error: 'Muitas tentativas com a senha errada. Aguarde 15 minutos e tente de novo.' }, 429)

  // as empresas que entram pelo SIGA
  let consulta = admin.from('integracao').select('id, empresa_id, config').eq('tipo', TIPO).eq('ativa', true)
  if (empresaPedida) consulta = consulta.eq('empresa_id', empresaPedida)
  const { data: integracoes, error: intErr } = await consulta
  if (intErr) return json({ error: 'Não foi possível entrar agora. Tente de novo.' }, 500)
  const habilitadas: Array<{ id: string; empresa_id: string; config: Record<string, unknown> }> = []
  for (const i of integracoes ?? []) {
    const { data: tem } = await admin.rpc('empresa_tem', {
      _empresa_id: i.empresa_id,
      _chave: 'integracao_siga',
      _padrao: false
    })
    if (tem) habilitadas.push(i as { id: string; empresa_id: string; config: Record<string, unknown> })
  }
  if (habilitadas.length === 0)
    return json({ error: 'A entrada com usuário não está disponível. Entre com o seu e-mail.' }, 404)

  // 2. em qual SIGA este usuário existe: leitura do cadastro, ainda sem a senha. Com mais de uma empresa
  //    conectada, é assim que se sabe a de quem está entrando.
  const achados: Array<{ integracao: (typeof habilitadas)[number]; u: UsuarioSiga; projetos: number[] | null }> = []
  let semResposta = false
  for (const i of habilitadas) {
    let con: ConexaoSiga | null = null
    try {
      const { data: seg, error: segErr } = await admin
        .rpc('integracao_segredo', { _empresa_id: i.empresa_id, _tipo: TIPO })
        .maybeSingle()
      if (segErr || !seg) continue
      con = await abrirSiga(segredoParaCredencial((seg as { segredo: string }).segredo))
      const u = await usuarioPorLogin(con, usuario)
      if (u) achados.push({ integracao: i, u, projetos: await projetosDoUsuario(con, u.id) })
    } catch {
      semResposta = true
    } finally {
      await con?.end().catch(() => undefined)
    }
  }
  if (achados.length === 0) {
    if (semResposta) return json({ error: 'O SIGA não respondeu. Tente de novo em instantes.' }, 503)
    await registrar(false)
    return json({ error: RECUSA }, 401)
  }
  if (achados.length > 1) return json({ error: 'Este usuário existe em mais de uma empresa. Avise o administrador.' }, 400)
  const { integracao, u, projetos } = achados[0]

  // 3. a senha é conferida pelo próprio SIGA daquela empresa
  const fora = await autenticarNoSiga(urlDeLogin(integracao.config), usuario, senha)
  if (!fora.ok) {
    if (fora.motivo === 'indisponivel')
      return json({ error: 'O SIGA não respondeu. Tente de novo em instantes.' }, 503)
    await registrar(false)
    return json({ error: RECUSA }, 401)
  }

  // 4. o usuário do InfraWork
  const { data: vinculo, error: vincErr } = await admin
    .from('integracao_usuario')
    .select('user_id, origem')
    .eq('integracao_id', integracao.id)
    .eq('externo_id', u.id)
    .maybeSingle()
  if (vincErr) return json({ error: 'Não foi possível entrar agora. Tente de novo.' }, 500)
  if (vinculo && vinculo.origem !== 'login')
    return json({ error: 'Este usuário tem conta no InfraWork: entre com o e-mail.' }, 403)

  let userId = vinculo?.user_id as string | undefined
  if (!userId) {
    const email = `siga-${u.id}@${integracao.empresa_id.slice(0, 8)}.${DOMINIO}`
    // criação anterior interrompida no meio: a conta existe sem o vínculo
    const { data: existente } = await admin.from('profiles').select('id, role').eq('email', email).maybeSingle()
    if (existente) userId = existente.id as string
    else {
      const { data: novo, error: novoErr } = await admin.auth.admin.createUser({
        email,
        // senha que ninguém conhece: esta conta só entra por esta função
        password: `${crypto.randomUUID()}${crypto.randomUUID()}`,
        email_confirm: true,
        user_metadata: { nome: u.nome, siga: true }
      })
      if (novoErr || !novo.user) return json({ error: 'Não foi possível criar o usuário. Avise o administrador.' }, 500)
      userId = novo.user.id
      const { error: perfilErr } = await admin.from('profiles').insert({
        id: userId,
        email,
        nome: u.nome,
        role: 'apontador',
        empresa_id: integracao.empresa_id,
        engenheiro_id: null,
        ativo: true
      })
      if (perfilErr) {
        await admin.auth.admin.deleteUser(userId).catch(() => undefined)
        return json({ error: 'Não foi possível criar o usuário. Avise o administrador.' }, 500)
      }
    }
  }

  const { error: gravaErr } = await admin.rpc('siga_usuario_gravar', {
    _user_id: userId,
    _integracao_id: integracao.id,
    _externo_id: u.id,
    _login: u.login,
    _nome: u.nome,
    _origem: 'login',
    _projetos: projetos,
    _por: null
  })
  if (gravaErr) return json({ error: 'Não foi possível entrar agora. Avise o administrador.' }, 500)

  const { data: perfil } = await admin.from('profiles').select('email, ativo, role').eq('id', userId).maybeSingle()
  if (!perfil || !perfil.ativo) return json({ error: 'Usuário desativado no InfraWork. Fale com o administrador.' }, 403)
  if (perfil.role !== 'apontador')
    return json({ error: 'Este usuário tem conta no InfraWork: entre com o e-mail.' }, 403)

  // 5. sessão do InfraWork, sem senha: um acesso de uso único, trocado aqui mesmo
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: perfil.email })
  const hash = link?.properties?.hashed_token
  if (linkErr || !hash) return json({ error: 'Não foi possível abrir a sessão. Tente de novo.' }, 500)
  const publico = createClient(URL_BASE, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: sessao, error: sessErr } = await publico.auth.verifyOtp({ token_hash: hash, type: 'magiclink' })
  if (sessErr || !sessao.session) return json({ error: 'Não foi possível abrir a sessão. Tente de novo.' }, 500)

  await registrar(true)
  return json({
    access_token: sessao.session.access_token,
    refresh_token: sessao.session.refresh_token,
    usuario: u.login
  })
})
