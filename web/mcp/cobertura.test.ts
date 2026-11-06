/**
 * O MCP acompanha o sistema: cada tabela, view, RPC e Edge Function que existe nas migrações precisa estar coberta
 * por uma ferramenta (cobre) ou registrada com motivo em cobertura.ts — e nada do manifesto pode apontar para algo
 * que não existe mais. Também confere os parâmetros das RPCs chamadas pelas ferramentas.
 *
 * Se este teste falhou depois de uma mudança no sistema: adapte a ferramenta do MCP (ou crie uma) e o guia
 * (mcp/guia.ts), ou registre o motivo de ignorar em mcp/cobertura.ts.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lerEsquema } from './esquema'
import { FERRAMENTAS } from './ferramentas'
import {
  FUNCOES_IGNORADAS,
  LEGIVEIS,
  NAO_LEGIVEIS,
  RPCS_IGNORADAS,
  RPCS_INDIRETAS,
  TABELAS_IGNORADAS
} from './cobertura'

const RAIZ = resolve(__dirname, '..')
const esq = lerEsquema(resolve(RAIZ, 'supabase/migrations'), resolve(RAIZ, 'supabase/functions'))

const cobre = (k: 'tabelas' | 'rpcs' | 'funcoes') =>
  new Set(FERRAMENTAS.flatMap((f) => f.cobre[k] ?? []))

describe('cobertura do MCP', () => {
  it('lê o esquema das migrações', () => {
    expect(esq.tabelas.size).toBeGreaterThan(50)
    expect(esq.rpcs.size).toBeGreaterThan(80)
  })

  it('toda tabela é gravada por uma ferramenta ou ignorada com motivo', () => {
    const c = cobre('tabelas')
    const faltam = [...esq.tabelas].filter((t) => !c.has(t) && !(t in TABELAS_IGNORADAS))
    expect(
      faltam,
      'tabelas sem ferramenta no MCP (crie/ajuste ou registre em TABELAS_IGNORADAS)'
    ).toEqual([])
  })

  it('toda tabela e view é legível pela consultar ou está fora com motivo', () => {
    const faltam = [...esq.tabelas, ...esq.views].filter(
      (t) => !LEGIVEIS.includes(t) && !(t in NAO_LEGIVEIS)
    )
    expect(faltam, 'inclua em LEGIVEIS ou NAO_LEGIVEIS').toEqual([])
  })

  it('toda RPC é chamada por uma ferramenta ou ignorada com motivo', () => {
    const c = cobre('rpcs')
    const faltam = [...esq.rpcs.keys()].filter((r) => !c.has(r) && !(r in RPCS_IGNORADAS))
    expect(
      faltam,
      'RPCs sem ferramenta no MCP (crie/ajuste ou registre em RPCS_IGNORADAS)'
    ).toEqual([])
  })

  it('toda Edge Function é chamada por uma ferramenta ou ignorada com motivo', () => {
    const c = cobre('funcoes')
    const faltam = [...esq.funcoes].filter((f) => !c.has(f) && !(f in FUNCOES_IGNORADAS))
    expect(faltam, 'Edge Functions sem ferramenta no MCP').toEqual([])
  })

  it('o manifesto não cita nada que deixou de existir', () => {
    const objetos = new Set([...esq.tabelas, ...esq.views])
    const mortos = [
      ...[...cobre('tabelas'), ...Object.keys(TABELAS_IGNORADAS)].filter(
        (t) => !esq.tabelas.has(t)
      ),
      ...[...LEGIVEIS, ...Object.keys(NAO_LEGIVEIS)].filter((t) => !objetos.has(t)),
      ...[...cobre('rpcs'), ...Object.keys(RPCS_IGNORADAS)].filter((r) => !esq.rpcs.has(r)),
      ...[...cobre('funcoes'), ...Object.keys(FUNCOES_IGNORADAS)].filter((f) => !esq.funcoes.has(f))
    ]
    expect(mortos, 'remova do manifesto/ferramentas (o objeto não existe mais)').toEqual([])
  })

  it('o que é coberto por ferramenta não está também na lista de ignorados', () => {
    const dup = [
      ...[...cobre('tabelas')].filter((t) => t in TABELAS_IGNORADAS),
      ...[...cobre('rpcs')].filter((r) => r in RPCS_IGNORADAS),
      ...[...cobre('funcoes')].filter((f) => f in FUNCOES_IGNORADAS)
    ]
    expect(dup).toEqual([])
  })

  it('as RPCs chamadas pelas ferramentas usam parâmetros que existem', () => {
    const dir = resolve(__dirname, 'ferramentas')
    const erros: string[] = []
    const chamadas = new Set<string>()
    for (const arq of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(resolve(dir, arq), 'utf8')
      for (const m of src.matchAll(
        /rpc(?:<[^>]*>)?\(\s*'([a-z0-9_]+)'\s*(?:,\s*\{([\s\S]*?)\}\s*\))?/g
      )) {
        const nome = m[1]!
        chamadas.add(nome)
        const params = esq.rpcs.get(nome)
        if (!params) {
          erros.push(`${arq}: RPC ${nome} não existe`)
          continue
        }
        // só as chaves do 1º nível (ignora objetos aninhados)
        let nivel = 0
        let topo = ''
        for (const ch of m[2] ?? '') {
          if (ch === '{' || ch === '[' || ch === '(') nivel++
          else if (ch === '}' || ch === ']' || ch === ')') nivel--
          else if (nivel === 0) topo += ch
        }
        for (const k of topo.matchAll(/(?:^|,|\n)\s*([a-z_][a-z0-9_]*)\s*:/g))
          if (!params.includes(k[1]!)) erros.push(`${arq}: ${nome} não tem o parâmetro ${k[1]}`)
      }
    }
    for (const r of cobre('rpcs'))
      if (!chamadas.has(r) && !(r in RPCS_INDIRETAS))
        erros.push(
          `a ferramenta declara ${r} em cobre.rpcs mas não chama (ou registre em RPCS_INDIRETAS)`
        )
    for (const r of Object.keys(RPCS_INDIRETAS))
      if (!cobre('rpcs').has(r))
        erros.push(`${r} está em RPCS_INDIRETAS mas nenhuma ferramenta o declara`)
    expect(erros).toEqual([])
  })

  it('ferramentas com nomes únicos, descrição e no máximo 40 (limite de clientes como o Cursor)', () => {
    const nomes = FERRAMENTAS.map((f) => f.nome)
    expect(new Set(nomes).size).toBe(nomes.length)
    expect(nomes.length).toBeLessThanOrEqual(40)
    for (const f of FERRAMENTAS) {
      expect(f.descricao.length, f.nome).toBeGreaterThan(40)
      expect(/^[a-z_]+$/.test(f.nome), f.nome).toBe(true)
    }
  })
})
