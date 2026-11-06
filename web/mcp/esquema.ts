/**
 * Esquema público do banco lido das migrações (em ordem): tabelas, views e funções (RPC × gatilho), aplicando
 * drops e renomeações, mais a assinatura (nomes dos parâmetros) da última definição de cada função. Base do teste
 * de cobertura do MCP — não depende do banco estar no ar.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface Esquema {
  tabelas: Set<string>
  views: Set<string>
  rpcs: Map<string, string[]>
  gatilhos: Set<string>
  funcoes: Set<string>
}

const FORA = /^(auth|storage|extensions|cron|net|vault|realtime|graphql|pgsodium)\./i

/** Remove comentários de linha e de bloco (sem mexer dentro de corpos $$ não é preciso para os padrões usados). */
function semComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/** Parâmetros de "fn(a uuid, b text default x)" → ['a','b'] (sem tipos). */
function parametros(lista: string): string[] {
  const out: string[] = []
  let nivel = 0
  let atual = ''
  for (const ch of lista) {
    if (ch === '(') nivel++
    if (ch === ')') nivel--
    if (ch === ',' && nivel === 0) {
      out.push(atual)
      atual = ''
    } else atual += ch
  }
  if (atual.trim()) out.push(atual)
  return out
    .map((p) => p.trim().replace(/^(in|out|inout|variadic)\s+/i, ''))
    .map((p) => p.split(/\s+/)[0]!.replace(/"/g, ''))
    .filter((p) => p && !/^(uuid|text|int|integer|jsonb|boolean|date|numeric)$/i.test(p))
}

function listaDeNomes(trecho: string): string[] {
  return trecho
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0]!.replace(/\(.*$/, ''))
    .filter((s) => s && !FORA.test(s))
    .map((s) => s.replace(/^public\./i, '').replace(/"/g, ''))
}

export function lerEsquema(dirMigracoes: string, dirFuncoes: string): Esquema {
  const e: Esquema = {
    tabelas: new Set(),
    views: new Set(),
    rpcs: new Map(),
    gatilhos: new Set(),
    funcoes: new Set()
  }
  const arquivos = readdirSync(dirMigracoes)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const arq of arquivos) {
    const sql = semComentarios(readFileSync(join(dirMigracoes, arq), 'utf8'))
    const re = new RegExp(
      [
        String.raw`create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(\S+)`,
        String.raw`create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(\S+)`,
        String.raw`create\s+(?:or\s+replace\s+)?function\s+(\S+?)\s*\(`,
        String.raw`drop\s+table\s+(?:if\s+exists\s+)?([^;]+);`,
        String.raw`drop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?([^;]+);`,
        String.raw`drop\s+function\s+(?:if\s+exists\s+)?([^;]+);`,
        String.raw`alter\s+table\s+(?:if\s+exists\s+)?(\S+)\s+rename\s+to\s+(\S+?)\s*;`,
        String.raw`alter\s+function\s+(\S+?)\s*\([^)]*\)\s*rename\s+to\s+(\S+?)\s*;`,
        // do $$ … array['a','b'] … drop function if exists %s … $$ (limpeza em lote)
        String.raw`do\s*\$\$(?:(?!\$\$)[\s\S])*?array\s*\[((?:(?!\$\$)[^\]])*)\](?:(?!\$\$)[\s\S])*?drop\s+function\s+if\s+exists\s+%s(?:(?!\$\$)[\s\S])*\$\$`
      ].join('|'),
      'gi'
    )
    let m: RegExpExecArray | null
    while ((m = re.exec(sql))) {
      const nome = (s: string) =>
        s
          .replace(/^public\./i, '')
          .replace(/"/g, '')
          .replace(/\(.*$/, '')
      if (m[1] && !FORA.test(m[1])) e.tabelas.add(nome(m[1]))
      else if (m[2] && !FORA.test(m[2])) e.views.add(nome(m[2]))
      else if (m[3] && !FORA.test(m[3])) {
        const n = nome(m[3])
        // lista de parâmetros e tipo de retorno
        let i = re.lastIndex
        let nivel = 1
        const ini = i
        while (i < sql.length && nivel > 0) {
          if (sql[i] === '(') nivel++
          else if (sql[i] === ')') nivel--
          i++
        }
        const params = parametros(sql.slice(ini, i - 1))
        const retorno = /^\s*returns\s+(\S+)/i.exec(sql.slice(i, i + 200))?.[1]?.toLowerCase() ?? ''
        if (retorno.startsWith('trigger')) {
          e.gatilhos.add(n)
          e.rpcs.delete(n)
        } else {
          e.rpcs.set(n, params)
          e.gatilhos.delete(n)
        }
      } else if (m[4])
        for (const n of listaDeNomes(m[4].replace(/\s+cascade\s*$/i, ''))) e.tabelas.delete(n)
      else if (m[5])
        for (const n of listaDeNomes(m[5].replace(/\s+cascade\s*$/i, ''))) e.views.delete(n)
      else if (m[6]) {
        // drop function a(…), b(…) — remove só se não for recriada depois (a próxima create volta a pôr)
        for (const n of m[6].split(/\)\s*,/).map((s) => s.trim().split('(')[0]!.trim())) {
          const k = n.replace(/^public\./i, '').replace(/"/g, '')
          if (FORA.test(n)) continue
          e.rpcs.delete(k)
          e.gatilhos.delete(k)
        }
      } else if (m[7] && m[8] && !FORA.test(m[7])) {
        const de = nome(m[7])
        if (e.tabelas.delete(de)) e.tabelas.add(nome(m[8]))
      } else if (m[11]) {
        for (const q of m[11].matchAll(/'([a-z_][a-z0-9_]*)'/g)) {
          e.rpcs.delete(q[1]!)
          e.gatilhos.delete(q[1]!)
        }
      } else if (m[9] && m[10] && !FORA.test(m[9])) {
        const de = nome(m[9])
        const para = nome(m[10])
        if (e.rpcs.has(de)) {
          e.rpcs.set(para, e.rpcs.get(de)!)
          e.rpcs.delete(de)
        }
      }
    }
  }
  if (existsSync(dirFuncoes))
    for (const d of readdirSync(dirFuncoes))
      if (!d.startsWith('_') && statSync(join(dirFuncoes, d)).isDirectory()) e.funcoes.add(d)
  return e
}
