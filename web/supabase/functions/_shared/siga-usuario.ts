// Usuários do SIGA: quem são, em quais projetos podem lançar e a conferência da senha.
// A senha tem formato próprio do SIGA, que não reproduzimos: quem confere é a tela de login dele (como faz o
// Monito). Nada aqui guarda nem registra a senha.

import { consultar, type ConexaoSiga } from './siga.ts'

export interface UsuarioSiga {
  id: number
  login: string
  nome: string
}

const ATIVO = "usuario_inativo = 'N' and usuario_deletado = 'N'"
const COLUNAS = 'usuario_id as id, trim(usuario_login) as login, trim(usuario_nome) as nome'

const paraUsuario = (l: { id: unknown; login: unknown; nome: unknown }): UsuarioSiga => ({
  id: Number(l.id),
  login: String(l.login ?? ''),
  nome: String(l.nome ?? '')
})

/** Os usuários ativos do SIGA, por nome. */
export async function listarUsuarios(con: ConexaoSiga): Promise<UsuarioSiga[]> {
  const linhas = await consultar<{ id: unknown; login: unknown; nome: unknown }>(
    con,
    `select ${COLUNAS} from sys_usuario where ${ATIVO} order by usuario_nome`
  )
  return linhas.map(paraUsuario)
}

export async function usuarioPorLogin(con: ConexaoSiga, login: string): Promise<UsuarioSiga | null> {
  const linhas = await consultar<{ id: unknown; login: unknown; nome: unknown }>(
    con,
    `select ${COLUNAS} from sys_usuario where usuario_login = ? and ${ATIVO} limit 1`,
    [login]
  )
  return linhas[0] ? paraUsuario(linhas[0]) : null
}

export async function usuarioPorId(con: ConexaoSiga, id: number): Promise<UsuarioSiga | null> {
  const linhas = await consultar<{ id: unknown; login: unknown; nome: unknown }>(
    con,
    `select ${COLUNAS} from sys_usuario where usuario_id = ? and ${ATIVO} limit 1`,
    [id]
  )
  return linhas[0] ? paraUsuario(linhas[0]) : null
}

/**
 * Projetos em que o usuário pode lançar; null = todos. A regra é a do SIGA, como o Monito a lê:
 *   - usuário de apoio (tem chefe em sys_usuario_tem_usuario): os projetos do chefe;
 *   - chefe (chefia obra ativa ou tem apoio): os projetos dele em sys_usuario_tem_projeto;
 *   - quem não é nem um nem outro é administrador: todos.
 */
export async function projetosDoUsuario(con: ConexaoSiga, id: number): Promise<number[] | null> {
  const apoio = await consultar<{ chefe: unknown }>(
    con,
    `select usuario_tem_usuario_chefe_equipe_id as chefe from sys_usuario_tem_usuario
      where usuario_tem_usuario_usuario_id = ? limit 1`,
    [id]
  )
  let dono: number
  if (apoio[0]) dono = Number(apoio[0].chefe)
  else {
    const chefia = await consultar<{ n: unknown }>(
      con,
      `select (select count(*) from cdt_obra where obra_chefe_administrativo_id = ? and obra_status = 'A')
            + (select count(*) from sys_usuario_tem_usuario where usuario_tem_usuario_chefe_equipe_id = ?) as n`,
      [id, id]
    )
    if (Number(chefia[0]?.n ?? 0) === 0) return null
    dono = id
  }
  const projetos = await consultar<{ projeto: unknown }>(
    con,
    `select usuario_tem_projeto_projeto_id as projeto from sys_usuario_tem_projeto
      where usuario_tem_projeto_usuario_id = ?`,
    [dono]
  )
  return projetos.map((p) => Number(p.projeto))
}

export interface SituacaoUsuario {
  externo_id: number
  ativo: boolean
  login?: string
  nome?: string
  projetos?: number[] | null
}

/** Para a rodada automática: quem, entre os ids dados, continua ativo e com quais projetos. */
export async function situacaoDosUsuarios(con: ConexaoSiga, ids: number[]): Promise<SituacaoUsuario[]> {
  const saida: SituacaoUsuario[] = []
  for (const id of ids) {
    const u = await usuarioPorId(con, id)
    if (!u) saida.push({ externo_id: id, ativo: false })
    else saida.push({ externo_id: id, ativo: true, login: u.login, nome: u.nome, projetos: await projetosDoUsuario(con, id) })
  }
  return saida
}

/** Endereço da tela de login do SIGA: o do cadastro da integração ou, por padrão, o do próprio servidor. */
export function urlDeLogin(config: Record<string, unknown> | null | undefined): string {
  const fixo = Deno.env.get('SIGA_LOGIN_URL')
  if (fixo) return fixo
  const doCadastro = typeof config?.login_url === 'string' ? config.login_url.trim() : ''
  if (doCadastro) return doCadastro
  return `https://${String(config?.host ?? '')}/action/action.php`
}

export type ResultadoLogin = { ok: true } | { ok: false; motivo: 'credencial' | 'indisponivel' }

/** Confere o usuário e a senha na tela de login do SIGA (code 1030 = aceito). */
export async function autenticarNoSiga(url: string, usuario: string, senha: string): Promise<ResultadoLogin> {
  const form = new FormData()
  form.set('pacote', 'sys')
  form.set('modulo', 'login')
  form.set('metodo', 'AutenticarAcesso')
  form.set('login_login', usuario)
  form.set('login_senha', senha)
  const prazo = new AbortController()
  const relogio = setTimeout(() => prazo.abort(), 12000)
  try {
    const r = await fetch(url, {
      method: 'POST',
      body: form,
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' },
      redirect: 'manual',
      signal: prazo.signal
    })
    const corpo = (await r.json().catch(() => null)) as { code?: unknown } | null
    if (!corpo || typeof corpo !== 'object' || !('code' in corpo)) return { ok: false, motivo: 'indisponivel' }
    return Number(corpo.code) === 1030 ? { ok: true } : { ok: false, motivo: 'credencial' }
  } catch {
    return { ok: false, motivo: 'indisponivel' }
  } finally {
    clearTimeout(relogio)
  }
}
