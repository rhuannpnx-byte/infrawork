// POST /functions/v1/siga — conector do SIGA (MySQL) de uma empresa.
//   { acao: 'conectar', host, porta?, banco, usuario, senha }  testa a conexão e guarda a credencial no Vault
//   { acao: 'desconectar' }                                    apaga a credencial
//   { acao: 'diagnostico' }                                    lê a estrutura das tabelas (só leitura) e guarda o resultado
// Quem chama: god (informa empresa_id) ou adm da empresa. O diagnóstico é só do god. A empresa precisa ter a
// capacidade `integracao_siga` ligada. Esta função só LÊ o SIGA: a gravação é outra etapa, com a estrutura conferida.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
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

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch { /* sem corpo */ }

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const acao = String(body.acao ?? '')
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
