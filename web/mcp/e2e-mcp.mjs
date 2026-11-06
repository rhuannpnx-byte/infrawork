// E2E do MCP do InfraWork contra o stack local: um cliente MCP de verdade (stdio) monta uma obra do zero só pelas
// ferramentas — recursos, composição, orçamento com rateio, plano, cronograma (motor), linha de base, produção,
// transporte e viagens (com a medição em QDM) — confere confirmação, papéis e exclui a obra no fim.
//
//   node mcp/build.mjs --modo=local
//   E2E_EMAIL=<adm> E2E_PASSWORD=<senha> [E2E_APONTADOR=<email> E2E_APONTADOR_SENHA=<senha>] node mcp/e2e-mcp.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import ExcelJS from 'exceljs'
import { fileURLToPath } from 'node:url'

const BUNDLE = fileURLToPath(new URL('./dist/stdio.mjs', import.meta.url))
const URL_LOCAL = process.env.INFRAWORK_SUPABASE_URL ?? 'http://127.0.0.1:55321'
if (!/127\.0\.0\.1|localhost/.test(URL_LOCAL)) throw new Error('só contra o stack local')
const EMAIL = process.env.E2E_EMAIL
const SENHA = process.env.E2E_PASSWORD
if (!EMAIL || !SENHA)
  throw new Error('E2E_EMAIL e E2E_PASSWORD (usuário adm ou god) são obrigatórios')

let falhas = 0
function check(nome, cond, info = '') {
  console.log(`${cond ? '✓' : '✗'} ${nome}${info ? ` — ${info}` : ''}`)
  if (!cond) falhas++
}

async function conectar(email, senha) {
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE],
    env: { ...process.env, INFRAWORK_EMAIL: email, INFRAWORK_SENHA: senha },
    stderr: 'inherit'
  })
  const c = new Client({ name: 'e2e-mcp', version: '1' })
  await c.connect(t)
  const chamar = async (nome, args = {}) => {
    const r = await c.callTool({ name: nome, arguments: args })
    const txt = r.content.map((x) => x.text).join('\n')
    if (r.isError) throw new Error(`${nome}.${args.acao ?? ''}: ${txt}`)
    return JSON.parse(txt)
  }
  const tentar = async (nome, args) => {
    const r = await c.callTool({ name: nome, arguments: args })
    return { erro: !!r.isError, texto: r.content.map((x) => x.text).join('\n') }
  }
  return { c, chamar, tentar }
}

const { c, chamar, tentar } = await conectar(EMAIL, SENHA)
const STAMP = Date.now().toString(36).slice(-5).toUpperCase()

// ── 0. Descoberta ──────────────────────────────────────────────────────────────────────────────────
const { tools } = await c.listTools()
check('lista de ferramentas (≤ 40)', tools.length >= 30 && tools.length <= 40, String(tools.length))
const guia = await c.readResource({ uri: 'infrawork://guia' })
check('guia disponível', guia.contents[0].text.length > 500)
const eu = await chamar('quem_sou')
check('quem_sou', !!eu.usuario?.id && ['adm', 'god'].includes(eu.usuario.role), eu.usuario?.role)

// ── 1. Obra e local ────────────────────────────────────────────────────────────────────────────────
const obra = await chamar('obras', {
  acao: 'criar',
  nome: `MCP E2E ${STAMP}`,
  codigo: `MCP-${STAMP}`,
  empresa_id: eu.usuario.empresa_id ?? eu.empresas[0]?.id
})
const O = obra.id
check('obra criada', !!O)

try {
  const principal = await chamar('trechos', {
    acao: 'criar',
    obra_id: O,
    nome: 'Eixo principal',
    tipo: 'eixo',
    comprimento_m: 5000,
    unidade_espaco_padrao: 'km'
  })
  check('eixo de 5 km criado', !!principal?.id)

  // ── 2. Recursos e composições ──────────────────────────────────────────────────────────────────
  const imp = await chamar('recursos', {
    acao: 'importar',
    obra_id: O,
    linhas: [
      { row: 2, grupo: 'MO', codigo: 'MO-01', nome: 'Servente', unidade: 'h', preco: 12.5 },
      { row: 3, grupo: 'MO', codigo: 'MO-02', nome: 'Operador de rolo', unidade: 'h', preco: 18 },
      {
        row: 4,
        grupo: 'MVE',
        codigo: 'EQ-01',
        nome: 'Rolo pé de carneiro',
        unidade: 'h',
        preco: 95
      },
      { row: 5, grupo: 'MVE', codigo: 'EQ-02', nome: 'Motoniveladora', unidade: 'h', preco: 180 },
      {
        row: 6,
        grupo: 'COMBUSTIVEL',
        codigo: 'CB-01',
        nome: 'Diesel S10',
        unidade: 'L',
        preco: 6.2
      },
      {
        row: 7,
        grupo: 'MATERIAL',
        codigo: 'MT-01',
        nome: 'Brita graduada',
        unidade: 'm³',
        preco: 85
      },
      { row: 8, grupo: 'MATERIAL', codigo: 'MT-02', nome: 'Água', unidade: 'm³', preco: 15 }
    ]
  })
  check('importar sem confirmar só mostra a prévia', imp.precisa_confirmar === true)
  const rec = await chamar('recursos', {
    acao: 'importar',
    obra_id: O,
    linhas: [
      { row: 2, grupo: 'MO', codigo: 'MO-01', nome: 'Servente', unidade: 'h', preco: 12.5 },
      { row: 3, grupo: 'MO', codigo: 'MO-02', nome: 'Operador de rolo', unidade: 'h', preco: 18 },
      {
        row: 4,
        grupo: 'MVE',
        codigo: 'EQ-01',
        nome: 'Rolo pé de carneiro',
        unidade: 'h',
        preco: 95
      },
      { row: 5, grupo: 'MVE', codigo: 'EQ-02', nome: 'Motoniveladora', unidade: 'h', preco: 180 },
      {
        row: 6,
        grupo: 'COMBUSTIVEL',
        codigo: 'CB-01',
        nome: 'Diesel S10',
        unidade: 'L',
        preco: 6.2
      },
      {
        row: 7,
        grupo: 'MATERIAL',
        codigo: 'MT-01',
        nome: 'Brita graduada',
        unidade: 'm³',
        preco: 85
      },
      { row: 8, grupo: 'MATERIAL', codigo: 'MT-02', nome: 'Água', unidade: 'm³', preco: 15 }
    ],
    confirmar: true
  })
  check('recursos importados (7)', rec.ok && rec.stats.criados === 7, JSON.stringify(rec.stats))
  const recursos = await chamar('recursos', { acao: 'listar', obra_id: O })
  const rid = (cod) => recursos.find((r) => r.codigo === cod)?.id
  const base = await chamar('composicoes', {
    acao: 'salvar',
    obra_id: O,
    codigo: '01.01',
    nome: 'Base de brita graduada',
    unidade: 'm³',
    producao_qtde: 200,
    itens: [
      {
        grupo: 'EQUIPAMENTO',
        recurso_id: rid('EQ-02'),
        quantidade: 1,
        horas_dia: 8,
        consumo_combustivel_lh: 18,
        indice_produtividade: 0.8
      },
      {
        grupo: 'EQUIPAMENTO',
        recurso_id: rid('EQ-01'),
        quantidade: 1,
        horas_dia: 8,
        consumo_combustivel_lh: 12,
        indice_produtividade: 1
      },
      { grupo: 'MO', recurso_id: rid('MO-01'), quantidade: 4, horas_dia: 8 },
      { grupo: 'MO', recurso_id: rid('MO-02'), quantidade: 1, horas_dia: 8 },
      {
        grupo: 'MATERIAL',
        recurso_id: rid('MT-01'),
        quantidade: null,
        consumo_material_por_unid: 1.25
      },
      {
        grupo: 'MATERIAL',
        recurso_id: rid('MT-02'),
        quantidade: null,
        consumo_material_por_unid: 0.1
      },
      { grupo: 'COMBUSTIVEL', recurso_id: rid('CB-01'), quantidade: null }
    ]
  })
  check(
    'composição Base: custo 128,0172 (mesmo do web)',
    Number(base.custo_unit) === 128.0172,
    String(base.custo_unit)
  )
  const escav = await chamar('composicoes', {
    acao: 'salvar',
    obra_id: O,
    codigo: '02.01',
    nome: 'Escavação e transporte',
    unidade: 'm³',
    producao_qtde: 300,
    itens: [{ grupo: 'MO', recurso_id: rid('MO-01'), quantidade: 2, horas_dia: 8 }]
  })
  check('composição Escavação', !!escav.servico_id)

  // ── 3. Orçamento com rateio ────────────────────────────────────────────────────────────────────
  const pct = (d) => d.map(([servico, valor]) => ({ servico, valor }))
  const orc = await chamar('orcamento_importar', {
    acao: 'importar',
    obra_id: O,
    itens: [
      { row: 2, codigo: '01', descricao: 'PAVIMENTAÇÃO' },
      {
        row: 3,
        codigo: '01.01',
        descricao: 'Base de brita graduada',
        unidade: 'm³',
        quantidade: 1500,
        venda_unitaria: 187.5
      },
      {
        row: 4,
        codigo: '01.02',
        descricao: 'Transporte de brita',
        unidade: 'tkm',
        quantidade: 1000,
        venda_unitaria: 2
      },
      { row: 5, codigo: '02', descricao: 'TERRAPLENAGEM' },
      {
        row: 6,
        codigo: '02.01',
        descricao: 'Escavação 1ª categoria',
        unidade: 'm³',
        quantidade: 2000,
        venda_unitaria: 20
      }
    ],
    alocacoes: [
      {
        row: 3,
        codigo: '01.01',
        criterio: 'percentual',
        compoe: true,
        destinos: pct([['Base', 100]])
      },
      {
        row: 4,
        codigo: '01.02',
        criterio: 'percentual',
        compoe: false,
        destinos: pct([['Base', 100]])
      },
      {
        row: 6,
        codigo: '02.01',
        criterio: 'percentual',
        compoe: true,
        destinos: pct([['Escavação', 100]])
      }
    ],
    confirmar: true
  })
  check(
    'orçamento importado (3 receitas, 2 serviços)',
    orc.ok && orc.stats.receitas_criadas === 3 && orc.stats.servicos_criados === 2,
    JSON.stringify(orc.stats)
  )
  const ag = await chamar('agrupadores', { acao: 'listar', obra_id: O })
  const sBase = ag.servicos.find((s) => s.descricao === 'Base')
  const sEsc = ag.servicos.find((s) => s.descricao === 'Escavação')
  check(
    'Base: venda 281.250 + 2.000 = 283.250',
    Math.abs(Number(sBase.venda_total_calc) - 283250) < 0.01,
    String(sBase.venda_total_calc)
  )
  await chamar('agrupadores', { acao: 'editar', id: sBase.id, servico_id: base.servico_id })
  await chamar('agrupadores', { acao: 'editar', id: sEsc.id, servico_id: escav.servico_id })
  const ag2 = await chamar('agrupadores', { acao: 'listar', obra_id: O })
  const sBase2 = ag2.servicos.find((s) => s.id === sBase.id)
  check(
    'custo ao vivo da composição no serviço (128,0172)',
    Math.abs(Number(sBase2.custo_unitario_calc) - 128.0172) < 0.001,
    String(sBase2.custo_unitario_calc)
  )

  // ── 4. Planejamento e cronograma ───────────────────────────────────────────────────────────────
  const cals = await chamar('calendarios', { acao: 'listar', obra_id: O })
  const cal = cals.calendarios.find((x) => x.padrao)
  await chamar('calendarios', {
    acao: 'definicao',
    obra_id: O,
    definicao: {
      calendario_id: cal.id,
      tipo: 'feriado',
      nome: 'Finados',
      data_inicio: '2026-11-02',
      data_fim: '2026-11-02',
      todo_ano: false,
      dia_semana: null,
      semana: null
    }
  })
  const enc = await chamar('equipes', { acao: 'criar_encarregado', obra_id: O, nome: 'João' })
  const eqA = await chamar('equipes', {
    acao: 'criar_equipe',
    obra_id: O,
    nome: 'Equipe A',
    tipo: 'Pavimentação',
    encarregado_id: enc.id
  })
  const plano = await chamar('planos', {
    acao: 'criar',
    obra_id: O,
    nome: 'Rev 0',
    data_referencia_inicio: '2026-11-02'
  })
  const t1 = await chamar('tarefas', {
    acao: 'criar',
    planejamento_id: plano.id,
    item_orcamentario_id: sBase.id,
    quantidade: 1000
  })
  await chamar('tarefas', {
    acao: 'equipes',
    planejamento_id: plano.id,
    id: t1.resultado.id,
    equipes: [eqA.id]
  })
  const t2 = await chamar('tarefas', {
    acao: 'criar',
    planejamento_id: plano.id,
    item_orcamentario_id: sBase.id,
    quantidade: 500,
    nome: 'Base — 2º trecho',
    campos: { coef_producao: 0.5 }
  })
  await chamar('dependencias_marcos', {
    acao: 'dependencia',
    planejamento_id: plano.id,
    predecessora_id: t1.resultado.id,
    sucessora_id: t2.resultado.id,
    tipo: 'FS'
  })
  const lista = await chamar('tarefas', { acao: 'listar', planejamento_id: plano.id })
  const v1 = lista.find((t) => t.id === t1.resultado.id)
  const v2 = lista.find((t) => t.id === t2.resultado.id)
  check(
    't1: 03/11 → 09/11 (5 d.u., feriado 02/11)',
    v1.data_inicio === '2026-11-03' && v1.data_fim === '2026-11-09',
    `${v1.data_inicio} → ${v1.data_fim}`
  )
  check(
    't2 depois da t1: 10/11 → 16/11',
    v2.data_inicio === '2026-11-10' && v2.data_fim === '2026-11-16',
    `${v2.data_inicio} → ${v2.data_fim}`
  )
  const leitura = await chamar('cronograma', { acao: 'ler', planejamento_id: plano.id })
  check('cronograma.ler devolve as 2 tarefas', leitura.tarefas.length === 2)
  const prev = await chamar('planos', { acao: 'promover', planejamento_id: plano.id })
  check('promover sem confirmar não trava', prev.precisa_confirmar === true)
  const lb = await chamar('planos', {
    acao: 'promover',
    planejamento_id: plano.id,
    confirmar: true
  })
  check('linha de base travada e vigente', lb.vigente === true, JSON.stringify(lb))

  // ── 5. Produção ────────────────────────────────────────────────────────────────────────────────
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const prod = await chamar('producao', {
    acao: 'lancar',
    obra_id: O,
    lancamento: {
      data: ontem,
      item_orcamentario_id: sBase.id,
      quantidade: 150,
      equipe_id: eqA.id,
      encarregado_id: enc.id
    }
  })
  check('produção lançada', !!prod.id)
  const futura = await tentar('producao', {
    acao: 'lancar',
    obra_id: O,
    lancamento: { data: '2099-01-01', item_orcamentario_id: sBase.id, quantidade: 1 }
  })
  check(
    'produção no futuro é recusada (regra do banco chega à IA)',
    futura.erro,
    futura.texto.slice(0, 90)
  )

  // ── 6. Transporte e viagens ────────────────────────────────────────────────────────────────────
  await chamar('parametros_servico', {
    acao: 'salvar',
    obra_id: O,
    item_orcamentario_id: sEsc.id,
    modo_lancamento: 'viagens'
  })
  const corte = await chamar('transporte', {
    acao: 'salvar_local',
    obra_id: O,
    nome: 'Corte km 1',
    tipo: 'pista',
    trecho_id: principal.id
  })
  const bf = await chamar('transporte', {
    acao: 'salvar_local',
    obra_id: O,
    nome: 'Bota-fora',
    tipo: 'bota_fora'
  })
  await chamar('transporte', {
    acao: 'rota',
    obra_id: O,
    origem_id: corte.id,
    destino_id: bf.id,
    dmt_km: 2.5
  })
  const ficha = await chamar('viagens', {
    acao: 'salvar',
    obra_id: O,
    data: ontem,
    motorista: 'Zé',
    equipe_id: eqA.id,
    encarregado_id: enc.id,
    viagens: [
      {
        item_orcamentario_id: sEsc.id,
        origem_id: corte.id,
        destino_id: bf.id,
        quantidade: 12,
        posicao_inicio_m: 1000
      },
      {
        item_orcamentario_id: sEsc.id,
        origem_id: corte.id,
        destino_id: bf.id,
        quantidade: 12,
        posicao_inicio_m: 1100
      }
    ]
  })
  const pv = await chamar('producao', { acao: 'listar', obra_id: O, item_orcamentario_id: sEsc.id })
  check(
    'viagens viram produção com equipe (24 m³)',
    pv.length === 1 && Number(pv[0].qtd ?? pv[0].quantidade) === 24 && pv[0].equipe_id === eqA.id,
    JSON.stringify(pv.map((x) => [x.qtd ?? x.quantidade, x.equipe_id]))
  )
  const fichas = await chamar('viagens', { acao: 'listar', obra_id: O })
  check(
    'ficha listada com DMT da rota',
    fichas[0]?.viagens?.every((v) => Number(v.dmt_km) === 2.5),
    String(ficha.id)
  )

  // ── 7. Medição (QDM das viagens) ───────────────────────────────────────────────────────────────
  const med = await chamar('analises', {
    acao: 'medicao_xlsx',
    obra_id: O,
    de: '2026-11-01',
    ate: ontem,
    incluir_fotos: false
  })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(med.base64, 'base64'))
  const abaQdm = wb.worksheets.find((w) =>
    String(w.getCell(1, 1).value).includes('quadro de distribuição')
  )
  check(
    'medição em xlsx com a aba do QDM',
    !!abaQdm && med.total_medido > 0,
    `${wb.worksheets.map((w) => w.name).join(', ')}`
  )

  // ── 8. Papéis ──────────────────────────────────────────────────────────────────────────────────
  if (process.env.E2E_APONTADOR && process.env.E2E_APONTADOR_SENHA) {
    const apt = await conectar(process.env.E2E_APONTADOR, process.env.E2E_APONTADOR_SENHA)
    const r = await apt.tentar('equipes', { acao: 'criar_equipe', obra_id: O, nome: 'X' })
    check(
      'apontador não cria equipe (permissão do banco)',
      r.erro && /permiss|policy|row-level|security/i.test(r.texto),
      r.texto.slice(0, 120)
    )
    await apt.c.close()
  }
} finally {
  // ── 9. Exclusão com confirmação ────────────────────────────────────────────────────────────────
  const p = await chamar('obras', { acao: 'excluir', obra_id: O })
  check(
    'excluir obra sem confirmar mostra o impacto',
    p.precisa_confirmar === true,
    JSON.stringify(p.impacto?.obra)
  )
  const ex = await chamar('obras', { acao: 'excluir', obra_id: O, confirmar: true })
  check('obra excluída', ex.ok === true)
}

await c.close()
console.log(falhas ? `\n${falhas} falha(s)` : '\nTUDO OK')
process.exit(falhas ? 1 : 0)
