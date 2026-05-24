// Conexão MySQL com o SIGA (read-only).
//
// SIGA_MYSQL_URL é configurado como Edge Function secret:
//   supabase secrets set SIGA_MYSQL_URL='mysql://user:pwd@host:3306/db'
//
// Usamos npm:mysql2/promise (Edge Runtime Deno suporta especificadores `npm:`).

import mysql from 'npm:mysql2@3.11.5/promise'

const url = Deno.env.get('SIGA_MYSQL_URL')

let pool: mysql.Pool | null = null

function getPool(): mysql.Pool {
  if (!url) throw new Error('SIGA_MYSQL_URL não configurado nos secrets das Edge Functions')
  if (!pool) {
    pool = mysql.createPool({
      uri: url,
      connectionLimit: 3,
      connectTimeout: 10000,
      enableKeepAlive: true
    })
  }
  return pool
}

export async function sigaQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const p = getPool()
  const [rows] = await p.query(sql, params)
  return rows as T[]
}

export async function sigaQueryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await sigaQuery<T>(sql, params)
  return rows[0] ?? null
}
