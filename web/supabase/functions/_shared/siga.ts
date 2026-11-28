// Conexão com o SIGA (MySQL) de uma empresa. A credencial é da empresa e mora no Vault (integracao_segredo);
// cada chamada abre e fecha a própria conexão, porque a função atende empresas diferentes.

import mysql from 'npm:mysql2@3.11.5/promise'

export interface CredencialSiga {
  host: string
  porta: number
  banco: string
  usuario: string
  senha: string
}

export class CredencialInvalida extends Error {}

/** Endereços que não são de um servidor na internet: a função não pode ser usada para bater na rede de dentro. */
function redeInterna(host: string): boolean {
  const h = host.trim().toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '::1') return true
  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!ip) return false
  const [a, b] = [Number(ip[1]), Number(ip[2])]
  return (
    a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  )
}

/** Confere e normaliza o que veio do formulário. Lança `CredencialInvalida` com a mensagem para a tela. */
export function lerCredencial(c: Partial<Record<keyof CredencialSiga, unknown>>): CredencialSiga {
  const host = String(c.host ?? '').trim()
  const banco = String(c.banco ?? '').trim()
  const usuario = String(c.usuario ?? '').trim()
  const senha = String(c.senha ?? '')
  const porta = c.porta == null || c.porta === '' ? 3306 : Number(c.porta)
  if (!host) throw new CredencialInvalida('Informe o servidor do SIGA.')
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new CredencialInvalida('O servidor deve ser um nome ou um endereço IP, sem "http://" nem barras.')
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new CredencialInvalida('A porta deve ser um número entre 1 e 65535.')
  if (!banco) throw new CredencialInvalida('Informe o nome do banco de dados.')
  if (!usuario) throw new CredencialInvalida('Informe o usuário.')
  if (!senha) throw new CredencialInvalida('Informe a senha.')
  // no ambiente local o MySQL de teste fica na rede do Docker
  if (redeInterna(host) && Deno.env.get('SIGA_PERMITIR_REDE_LOCAL') !== '1')
    throw new CredencialInvalida('O servidor informado é um endereço de rede interna. Informe o endereço público do SIGA.')
  return { host, porta, banco, usuario, senha }
}

/** A credencial inteira numa linha só, para guardar no Vault. */
export const credencialParaSegredo = (c: CredencialSiga): string => JSON.stringify(c)

export function segredoParaCredencial(segredo: string): CredencialSiga {
  const c = JSON.parse(segredo) as CredencialSiga
  return { host: c.host, porta: Number(c.porta), banco: c.banco, usuario: c.usuario, senha: c.senha }
}

export type ConexaoSiga = mysql.Connection

export async function abrirSiga(c: CredencialSiga): Promise<ConexaoSiga> {
  return await mysql.createConnection({
    host: c.host,
    port: c.porta,
    database: c.banco,
    user: c.usuario,
    password: c.senha,
    connectTimeout: 10_000,
    // datas como texto: o fuso do servidor do SIGA não é o nosso, e a data do lançamento não pode andar um dia
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  })
}

export async function consultar<T = Record<string, unknown>>(
  con: ConexaoSiga,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const [linhas] = await con.query(sql, params)
  return linhas as T[]
}

/** Gravação (insert ou update): devolve quantas linhas mudaram e o id gerado. */
export async function executar(
  con: ConexaoSiga,
  sql: string,
  params: unknown[] = []
): Promise<{ afetadas: number; id: number }> {
  const [r] = await con.query(sql, params)
  const cab = r as { affectedRows?: number; insertId?: number }
  return { afetadas: Number(cab.affectedRows ?? 0), id: Number(cab.insertId ?? 0) }
}

/** Mensagem para a tela a partir do erro do MySQL (sem despejar o erro cru, que traz usuário e endereço). */
export function motivoDoErroSiga(e: unknown): string {
  const err = e as { code?: string; errno?: number; message?: string }
  switch (err?.code) {
    case 'ER_ACCESS_DENIED_ERROR':
      return 'O SIGA recusou o usuário ou a senha.'
    case 'ER_DBACCESS_DENIED_ERROR':
      return 'O usuário não tem acesso a esse banco de dados.'
    case 'ER_BAD_DB_ERROR':
      return 'Não existe banco de dados com esse nome no servidor.'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Servidor não encontrado. Confira o endereço.'
    case 'ECONNREFUSED':
      return 'O servidor recusou a conexão. Confira a porta e se o SIGA aceita conexões de fora.'
    case 'ETIMEDOUT':
    case 'PROTOCOL_SEQUENCE_TIMEOUT':
      return 'O servidor não respondeu a tempo. Confira o endereço, a porta e a liberação de acesso externo.'
    default:
      return `Não foi possível conectar ao SIGA${err?.code ? ` (${err.code})` : ''}.`
  }
}
