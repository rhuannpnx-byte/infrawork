// POST /functions/v1/siga — conector do SIGA (MySQL) de uma empresa.
// Da empresa (god informa empresa_id; adm usa a sua):
//   { acao: 'conectar', host, porta?, banco, usuario, senha }  testa a conexão e guarda a credencial no Vault
//   { acao: 'desconectar' }                                    apaga a credencial
//   { acao: 'diagnostico' }                                    lê a estrutura das tabelas e guarda o resultado (só god)
//   { acao: 'usuarios' }                                       os usuários ativos do SIGA e os já ligados aos do InfraWork
//   { acao: 'vincular_usuario', user_id, externo_id | null }   liga um usuário do InfraWork ao do SIGA (null desfaz)
// Da obra (quem planeja a obra; informa obra_id):
//   { acao: 'projetos' }                 os projetos do SIGA, para vincular
//   { acao: 'cadastros', projeto_id? }   serviços, equipes, encarregados e locais do projeto, para o de-para
//   { acao: 'sincronizar' }              lê a produção do projeto vinculado e aplica na obra
// Do serviço (pg_cron): { acao: 'sincronizar' } sem obra percorre todas as obras vinculadas e confere, no SIGA,
// quem dos usuários ligados continua ativo e com quais projetos.
// A empresa precisa ter a capacidade `integracao_siga`. Esta função só LÊ o SIGA: a gravação é outra etapa.
// A entrada do apontador com o usuário do SIGA é a função siga-login.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import {
  listarCadastros,
  listarProjetos,
  sincronizarObra,
  type ResumoSync,
  type VinculoObra
} from '../_shared/siga-obra.ts'
import {
  abrirSiga,
  consultar,
  credencialParaSegredo,
  CredencialInvalida,
  lerCredencial,
  motivoDoErroSiga,
  segredoParaCredencial,
  type ConexaoSiga
} from '../_shared/siga.ts'
import { listarUsuarios, projetosDoUsuario, situacaoDosUsuarios, usuarioPorId } from '../_shared/siga-usuario.ts'

const TIPO = 'siga'
// tabelas de cadastro que interessam para gravar a produção (além das que as tabelas do Monito referenciam)
const CADASTROS = /(projeto|servico|equipe|encarregado|unidade|trecho|usuario|colaborador|funcionario|pessoa)/i
const MAX_TABELAS_DETALHADAS = 60
const AMOSTRA_PREENCHIMENTO = 300
const AMOSTRA_LINHAS = 3

type Linha = Record<string, unknown>

const curto = (v: unknown): unknown => {
  if (v == null) return null
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v
  if (v instanceof Uint8Array) return `(binário, ${v.length} bytes)`
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80)
  return v
}

/** A estrutura do SIGA que interessa ao conector: tabelas, colunas, chaves, gatilhos e como estão preenchidas. */
async function diagnosticar(con: ConexaoSiga): Promise<Record<string, unknown>> {
  const [{ banco, versao, usuario }] = await consultar<{ banco: string; versao: string; usuario: string }>(
    con,
    'select database() as banco, version() as versao, current_user() as usuario'
  )
  let permissoes: string[] = []
  try {
    permissoes = (await consultar<Linha>(con, 'show grants')).map((l) => String(Object.values(l)[0]))
  } catch { /* sem permissão para ver as próprias permissões: segue sem */ }

  const tabelas = await consultar<{ tabela: string; linhas: string | null; motor: string | null }>(
    con,
    `select table_name as tabela, table_rows as linhas, engine as motor
       from information_schema.tables
      where table_schema = database() and table_type = 'BASE TABLE'
        and (table_name like 'pnj\\_%' or table_name like 'cdt\\_%')
      order by table_name`
  )
  const nomes = tabelas.map((t) => t.tabela)
  const doMonito = nomes.filter((n) => n.startsWith('pnj_'))

  const chaves = nomes.length
    ? await consultar<{ tabela: string; coluna: string; ref_tabela: string; ref_coluna: string }>(
        con,
        `select table_name as tabela, column_name as coluna,
                referenced_table_name as ref_tabela, referenced_column_name as ref_coluna
           from information_schema.key_column_usage
          where table_schema = database() and referenced_table_name is not null and table_name in (?)`,
        [nomes]
      )
    : []
  const referenciadas = new Set(chaves.filter((c) => doMonito.includes(c.tabela)).map((c) => c.ref_tabela))
  const detalhadas = [
    ...doMonito,
    ...nomes.filter((n) => !n.startsWith('pnj_') && (referenciadas.has(n) || CADASTROS.test(n)))
  ].slice(0, MAX_TABELAS_DETALHADAS)

  const colunas = detalhadas.length
    ? await consultar<{
        tabela: string; coluna: string; ordem: number; tipo: string; nulo: string
        padrao: string | null; chave: string; extra: string
      }>(
        con,
        `select table_name as tabela, column_name as coluna, ordinal_position as ordem, column_type as tipo,
                is_nullable as nulo, column_default as padrao, column_key as chave, extra as extra
           from information_schema.columns
          where table_schema = database() and table_name in (?)
          order by table_name, ordinal_position`,
        [detalhadas]
      )
    : []
  const gatilhos = detalhadas.length
    ? await consultar<Linha>(
        con,
        `select event_object_table as tabela, trigger_name as gatilho, action_timing as quando,
                event_manipulation as evento
           from information_schema.triggers
          where trigger_schema = database() and event_object_table in (?)`,
        [detalhadas]
      )
    : []

  // como o Monito preenche as tabelas dele: quantas das últimas linhas têm cada coluna, e algumas linhas de exemplo
  const uso: Record<string, unknown> = {}
  for (const tabela of ['pnj_controle_producao', 'pnj_foto']) {
    if (!nomes.includes(tabela)) continue
    const cols = colunas.filter((c) => c.tabela === tabela)
    const pk = cols.find((c) => c.chave === 'PRI')?.coluna
    if (!pk) continue
    const linhas = await consultar<Linha>(
      con,
      `select * from \`${tabela}\` order by \`${pk}\` desc limit ${AMOSTRA_PREENCHIMENTO}`
    )
    const preenchidas: Record<string, number> = {}
    for (const c of cols)
      preenchidas[c.coluna] = linhas.filter((l) => l[c.coluna] != null && l[c.coluna] !== '').length
    uso[tabela] = {
      chave: pk,
      linhas_lidas: linhas.length,
      preenchidas,
      exemplos: linhas
        .slice(0, AMOSTRA_LINHAS)
        .map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, curto(v)])))
    }
  }

  return {
    banco,
    versao,
    usuario,
    permissoes,
    tabelas,
    tabelas_detalhadas: detalhadas,
    colunas,
    chaves_estrangeiras: chaves.filter((c) => detalhadas.includes(c.tabela)),
    gatilhos,
    uso,
    tem_producao: nomes.includes('pnj_controle_producao'),
    tem_foto: nomes.includes('pnj_foto')
  }
}

/** A credencial guardada da empresa, ou null se o SIGA não foi conectado. */
async function credencialDaEmpresa(
  admin: SupabaseClient,
  empresa: string
): Promise<{ integracao_id: string; segredo: string } | null> {
  const { data, error } = await admin
    .rpc('integracao_segredo', { _empresa_id: empresa, _tipo: TIPO })
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { integracao_id: string; segredo: string } | null) ?? null
}

/** Grava o resultado da sincronização na obra e, quando houve mudança, erro ou foi pedida à mão, no histórico. */
async function registrarSync(
  admin: SupabaseClient,
  v: VinculoObra & { empresa_id: string },
  origem: 'manual' | 'cron',
  por: string | null,
  iniciado: string,
  resumo: ResumoSync | null,
  erro: string | null
): Promise<void> {
  const agora = new Date().toISOString()
  await admin
    .from('integracao_obra')
    .update({
      ultimo_sync_em: agora,
      ultimo_sync_ok: erro == null,
      ultimo_sync_resumo: resumo,
      ultimo_sync_erro: erro,
      updated_at: agora
    })
    .eq('obra_id', v.obra_id)
  const mudou = !!resumo && (resumo.novos > 0 || resumo.alterados > 0 || resumo.removidos > 0 || resumo.erros.length > 0)
  if (origem === 'manual' || erro || mudou)
    await admin.from('integracao_execucao').insert({
      integracao_id: v.integracao_id,
      empresa_id: v.empresa_id,
      obra_id: v.obra_id,
      acao: 'sync',
      origem,
      iniciado_em: iniciado,
      terminado_em: agora,
      ok: erro == null,
      resumo,
      erro,
      iniciado_por: por
    })
}

/** A rodada automática: todas as obras vinculadas, uma conexão por empresa. Uma obra com erro não para as outras. */
async function sincronizarTodas(admin: SupabaseClient): Promise<Record<string, unknown>> {
  const { data: vinculos, error } = await admin
    .from('integracao_obra')
    .select('obra_id, integracao_id, externo_projeto_id, data_corte, integracao:integracao_id ( empresa_id, ativa, tipo )')
  if (error) throw new Error(error.message)
  const porIntegracao = new Map<string, Array<VinculoObra & { empresa_id: string }>>()
  for (const v of vinculos ?? []) {
    const i = (v as unknown as { integracao: { empresa_id: string; ativa: boolean; tipo: string } | null }).integracao
    if (!i || !i.ativa || i.tipo !== TIPO) continue
    const lista = porIntegracao.get(v.integracao_id) ?? []
    lista.push({
      obra_id: v.obra_id,
      integracao_id: v.integracao_id,
      externo_projeto_id: Number(v.externo_projeto_id),
      data_corte: v.data_corte,
      empresa_id: i.empresa_id
    })
    porIntegracao.set(v.integracao_id, lista)
  }
  const obras: Array<Record<string, unknown>> = []
  for (const lista of porIntegracao.values()) {
    let con: ConexaoSiga | null = null
    let falhaConexao: string | null = null
    try {
      const cred = await credencialDaEmpresa(admin, lista[0].empresa_id)
      if (!cred) throw new Error('SIGA não conectado')
      con = await abrirSiga(segredoParaCredencial(cred.segredo))
    } catch (e) {
      falhaConexao = (e as { code?: string })?.code ? motivoDoErroSiga(e) : e instanceof Error ? e.message : String(e)
    }
    for (const v of lista) {
      const iniciado = new Date().toISOString()
      try {
        if (!con) throw new Error(falhaConexao ?? 'Sem conexão com o SIGA')
        const resumo = await sincronizarObra(admin, con, v)
        await registrarSync(admin, v, 'cron', null, iniciado, resumo, null)
        obras.push({ obra_id: v.obra_id, ok: true, ...resumo, erros: resumo.erros.length })
      } catch (e) {
        const erro = e instanceof Error ? e.message : String(e)
        await registrarSync(admin, v, 'cron', null, iniciado, null, erro)
        obras.push({ obra_id: v.obra_id, ok: false, erro })
      }
    }
    // quem entra ou lança pelo SIGA: continua ativo lá? com quais projetos? (não para a rodada)
    if (con) {
      try {
        const { data: ligados } = await admin
          .from('integracao_usuario')
          .select('externo_id')
          .eq('integracao_id', lista[0].integracao_id)
        const ids = (ligados ?? []).map((x) => Number(x.externo_id))
        if (ids.length)
          await admin.rpc('siga_usuarios_conferir', {
            _integracao_id: lista[0].integracao_id,
            _situacao: await situacaoDosUsuarios(con, ids)
          })
      } catch { /* fica para a próxima rodada */ }
    }
    await con?.end().catch(() => undefined)
  }
  return { ok: true, obras }
}

const ACOES_DA_OBRA = ['projetos', 'cadastros', 'sincronizar']

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch { /* sem corpo */ }
  const acao = String(body.acao ?? '')

  // rodada automática: o pg_cron chama com a chave de serviço
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  let servico = !!SERVICE_KEY && token === SERVICE_KEY
  if (!servico && token) {
    try {
      servico = JSON.parse(atob(token.split('.')[1] ?? ''))?.role === 'service_role'
    } catch { /* jwt de usuário */ }
  }
  if (servico) {
    if (acao !== 'sincronizar') return json({ error: 'Ação não permitida' }, 400)
    const adminServico = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    try {
      return json(await sincronizarTodas(adminServico))
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
    }
  }

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx

  // ── ações da obra: quem planeja a obra ──
  if (ACOES_DA_OBRA.includes(acao)) {
    const obraId = String(body.obra_id ?? '')
    if (!obraId) return json({ ok: false, error: 'Informe a obra' }, 400)
    const { data: pode, error: podeErr } = await ctx.authed.rpc('pode_planejar_obra', { _obra_id: obraId })
    if (podeErr) return json({ ok: false, error: podeErr.message }, 500)
    if (pode !== true) return json({ ok: false, error: 'Sem permissão para vincular esta obra ao SIGA' }, 403)
    const { data: obra } = await admin.from('obras').select('empresa_id').eq('id', obraId).maybeSingle()
    if (!obra) return json({ ok: false, error: 'Obra não encontrada' }, 404)
    const { data: tem } = await admin.rpc('empresa_tem', {
      _empresa_id: obra.empresa_id,
      _chave: 'integracao_siga',
      _padrao: false
    })
    if (!tem)
      return json({ ok: false, error: 'A integração com o SIGA não está habilitada para esta empresa.' }, 403)
    const { data: vinc } = await admin
      .from('integracao_obra')
      .select('obra_id, integracao_id, externo_projeto_id, data_corte')
      .eq('obra_id', obraId)
      .maybeSingle()

    let con: ConexaoSiga | null = null
    const iniciado = new Date().toISOString()
    try {
      const cred = await credencialDaEmpresa(admin, obra.empresa_id)
      if (!cred)
        return json({ ok: false, error: 'O SIGA ainda não foi conectado: conecte em Gerencial › Integrações.' }, 400)
      con = await abrirSiga(segredoParaCredencial(cred.segredo))

      if (acao === 'projetos') return json({ ok: true, projetos: await listarProjetos(con) })

      if (acao === 'cadastros') {
        const projeto = Number(body.projeto_id ?? vinc?.externo_projeto_id ?? 0)
        if (!projeto) return json({ ok: false, error: 'Ligue a obra a um projeto do SIGA primeiro.' }, 400)
        return json({ ok: true, projeto_id: projeto, ...(await listarCadastros(con, projeto)) })
      }

      if (!vinc) return json({ ok: false, error: 'Esta obra ainda não está ligada a um projeto do SIGA.' }, 400)
      const v = {
        obra_id: vinc.obra_id,
        integracao_id: vinc.integracao_id,
        externo_projeto_id: Number(vinc.externo_projeto_id),
        data_corte: vinc.data_corte,
        empresa_id: obra.empresa_id as string
      }
      try {
        const resumo = await sincronizarObra(admin, con, v)
        await registrarSync(admin, v, 'manual', caller.id, iniciado, resumo, null)
        return json({ ok: true, resumo })
      } catch (e) {
        const erro = (e as { code?: string })?.code ? motivoDoErroSiga(e) : e instanceof Error ? e.message : String(e)
        await registrarSync(admin, v, 'manual', caller.id, iniciado, null, erro)
        return json({ ok: false, error: erro }, 502)
      }
    } catch (e) {
      const erro = (e as { code?: string })?.code ? motivoDoErroSiga(e) : e instanceof Error ? e.message : String(e)
      return json({ ok: false, error: erro }, 502)
    } finally {
      await con?.end().catch(() => undefined)
    }
  }

  // ── ações da empresa ──
  const roleErr = assertRole(caller, acao === 'diagnostico' ? ['god'] : ['god', 'adm'])
  if (roleErr) return roleErr
  const empresa = caller.role === 'god' ? (body.empresa_id as string | undefined) : caller.empresa_id
  if (!empresa) return json({ ok: false, error: 'Informe a empresa' }, 400)

  const { data: habilitada, error: capErr } = await admin.rpc('empresa_tem', {
    _empresa_id: empresa,
    _chave: 'integracao_siga',
    _padrao: false
  })
  if (capErr) return json({ ok: false, error: capErr.message }, 500)
  if (!habilitada)
    return json({ ok: false, error: 'A integração com o SIGA não está habilitada para esta empresa.' }, 403)

  if (acao === 'conectar') {
    let cred
    try {
      cred = lerCredencial(body)
    } catch (e) {
      if (e instanceof CredencialInvalida) return json({ ok: false, error: e.message }, 400)
      throw e
    }
    let con: ConexaoSiga | null = null
    let temProducao = false
    try {
      con = await abrirSiga(cred)
      const t = await consultar<{ n: string }>(
        con,
        `select count(*) as n from information_schema.tables
          where table_schema = database() and table_name = 'pnj_controle_producao'`
      )
      temProducao = Number(t[0]?.n ?? 0) > 0
    } catch (e) {
      return json({ ok: false, error: motivoDoErroSiga(e) }, 400)
    } finally {
      await con?.end().catch(() => undefined)
    }
    if (!temProducao)
      return json(
        { ok: false, error: 'A conexão funcionou, mas esse banco não tem a tabela de produção do SIGA (pnj_controle_producao). Confira o nome do banco.' },
        400
      )
    const { error } = await admin.rpc('integracao_gravar', {
      _empresa_id: empresa,
      _tipo: TIPO,
      _config: { host: cred.host, porta: cred.porta, banco: cred.banco, usuario: cred.usuario },
      _segredo: credencialParaSegredo(cred),
      _por: caller.id
    })
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })
  }

  if (acao === 'desconectar') {
    const { error } = await admin.rpc('integracao_remover', { _empresa_id: empresa, _tipo: TIPO })
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })
  }

  // ── usuários: quem do InfraWork é quem no SIGA ──
  if (acao === 'usuarios' || acao === 'vincular_usuario') {
    const cred = await credencialDaEmpresa(admin, empresa)
    if (!cred) return json({ ok: false, error: 'O SIGA ainda não foi conectado para esta empresa.' }, 400)
    const userId = String(body.user_id ?? '')
    if (acao === 'vincular_usuario') {
      if (!userId) return json({ ok: false, error: 'Informe o usuário' }, 400)
      const { data: alvo } = await admin.from('profiles').select('id, empresa_id').eq('id', userId).maybeSingle()
      if (!alvo || alvo.empresa_id !== empresa)
        return json({ ok: false, error: 'Usuário não encontrado nesta empresa' }, 404)
      if (body.externo_id == null) {
        const { error } = await admin.rpc('siga_usuario_remover', { _user_id: userId })
        if (error) return json({ ok: false, error: error.message }, 400)
        return json({ ok: true, vinculado: false })
      }
    }
    let con: ConexaoSiga | null = null
    try {
      con = await abrirSiga(segredoParaCredencial(cred.segredo))
      if (acao === 'usuarios') {
        const { data: vinculos } = await admin
          .from('integracao_usuario')
          .select('user_id, externo_id, externo_login, externo_nome, origem, ativo, conferido_em')
          .eq('integracao_id', cred.integracao_id)
        return json({ ok: true, usuarios: await listarUsuarios(con), vinculos: vinculos ?? [] })
      }
      // o nome e o login gravados são os que estão no SIGA, não os que vieram da tela
      const u = await usuarioPorId(con, Number(body.externo_id))
      if (!u) return json({ ok: false, error: 'Usuário não encontrado ou inativo no SIGA' }, 404)
      const { error } = await admin.rpc('siga_usuario_gravar', {
        _user_id: userId,
        _integracao_id: cred.integracao_id,
        _externo_id: u.id,
        _login: u.login,
        _nome: u.nome,
        _origem: 'vinculo',
        _projetos: await projetosDoUsuario(con, u.id),
        _por: caller.id
      })
      if (error) return json({ ok: false, error: error.message }, 400)
      return json({ ok: true, vinculado: true, usuario: u })
    } catch (e) {
      const erro = (e as { code?: string })?.code ? motivoDoErroSiga(e) : e instanceof Error ? e.message : String(e)
      return json({ ok: false, error: erro }, 502)
    } finally {
      await con?.end().catch(() => undefined)
    }
  }

  if (acao !== 'diagnostico') return json({ ok: false, error: 'Ação desconhecida' }, 400)

  const { data: seg, error: segErr } = await admin
    .rpc('integracao_segredo', { _empresa_id: empresa, _tipo: TIPO })
    .maybeSingle()
  if (segErr) return json({ ok: false, error: segErr.message }, 500)
  const guardado = seg as { integracao_id: string; segredo: string } | null
  if (!guardado) return json({ ok: false, error: 'O SIGA ainda não foi conectado para esta empresa.' }, 400)

  const { data: exec, error: execErr } = await admin
    .from('integracao_execucao')
    .insert({
      integracao_id: guardado.integracao_id,
      empresa_id: empresa,
      acao: 'diagnostico',
      origem: 'manual',
      iniciado_por: caller.id
    })
    .select('id')
    .single()
  if (execErr) return json({ ok: false, error: execErr.message }, 500)

  let con: ConexaoSiga | null = null
  try {
    con = await abrirSiga(segredoParaCredencial(guardado.segredo))
    const resumo = await diagnosticar(con)
    await admin
      .from('integracao_execucao')
      .update({ ok: true, resumo, terminado_em: new Date().toISOString() })
      .eq('id', exec.id)
    return json({ ok: true, execucao_id: exec.id, resumo })
  } catch (e) {
    const erro = (e as { code?: string })?.code ? motivoDoErroSiga(e) : e instanceof Error ? e.message : String(e)
    await admin
      .from('integracao_execucao')
      .update({ ok: false, erro, terminado_em: new Date().toISOString() })
      .eq('id', exec.id)
    return json({ ok: false, error: erro }, 502)
  } finally {
    await con?.end().catch(() => undefined)
  }
})
