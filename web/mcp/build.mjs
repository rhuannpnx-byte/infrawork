// Bundle do MCP (esbuild): resolve os aliases do web (@/, @apex/*), troca o cliente Supabase do web pelo proxy
// do contexto e embute o modelo do motor (.dr5). Saídas: mcp/dist/stdio.mjs (local) e mcp/dist/http.mjs (Vercel).
//   node mcp/build.mjs [--modo=local]   (local: aponta para o stack em 127.0.0.1)
import { build } from 'esbuild'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(raiz, 'src')
const proxy = resolve(raiz, 'mcp/supabase-proxy.ts')
const clienteWeb = resolve(src, 'lib/supabase/client.ts')
const apex = (p) => resolve(raiz, 'vendor/apex/packages', p, 'src/index.ts')
const APEX = {
  '@apex/dr5': apex('dr5'),
  '@apex/model': apex('model'),
  '@apex/calendar': apex('calendar'),
  '@apex/lp': apex('lp'),
  '@apex/engine': apex('engine'),
  '@apex/mcp': apex('mcp-obra'),
  '@apex/obra': apex('obra')
}

function lerEnv(arq) {
  const p = resolve(raiz, arq)
  if (!existsSync(p)) return {}
  return Object.fromEntries(
    readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
  )
}
const local = process.argv.includes('--modo=local')
const env = {
  ...lerEnv('.env'),
  ...(local ? lerEnv('.env.development.local') : {}),
  ...process.env
}
const supabaseUrl = env.VITE_SUPABASE_URL
const anon = env.VITE_SUPABASE_ANON_KEY
if (!supabaseUrl || !anon)
  throw new Error('VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são necessários no build')
const site = local
  ? 'http://localhost:3000'
  : (env.INFRAWORK_SITE ?? 'https://infrawork-web.vercel.app')

function existe(base) {
  for (const s of ['', '.ts', '.tsx', '/index.ts', '/index.tsx'])
    if (existsSync(base + s) && statSync(base + s).isFile()) return base + s
  return null
}

const aliases = {
  name: 'aliases-do-web',
  setup(b) {
    b.onResolve({ filter: /^@apex\// }, (a) => ({ path: APEX[a.path] }))
    b.onResolve({ filter: /^@\// }, (a) => {
      const p = existe(resolve(src, a.path.slice(2)))
      if (!p) return { errors: [{ text: `não achei ${a.path}` }] }
      return { path: p === clienteWeb ? proxy : p }
    })
    b.onResolve({ filter: /\/client$/ }, (a) => {
      const p = existe(resolve(a.resolveDir, a.path))
      return p === clienteWeb ? { path: proxy } : undefined
    })
  }
}

const comum = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
  loader: { '.dr5': 'binary' },
  plugins: [aliases],
  define: {
    'import.meta.env': 'globalThis.__IW_ENV__',
    __IW_SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __IW_SUPABASE_ANON_KEY__: JSON.stringify(anon),
    __IW_SITE__: JSON.stringify(site)
  },
  banner: {
    js: "import { createRequire as __iwReq } from 'node:module'; const require = __iwReq(import.meta.url);"
  },
  logLevel: 'warning'
}

await build({
  ...comum,
  entryPoints: [resolve(raiz, 'mcp/stdio.ts')],
  outfile: resolve(raiz, 'mcp/dist/stdio.mjs')
})
await build({
  ...comum,
  entryPoints: [resolve(raiz, 'mcp/http.ts')],
  outfile: resolve(raiz, 'mcp/dist/http.mjs')
})
console.log(`MCP: bundles gerados (${local ? 'local' : 'remoto'}: ${supabaseUrl})`)
