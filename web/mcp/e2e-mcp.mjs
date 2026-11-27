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
  const patio = await chamar('trechos', { acao: 'criar', obra_id: O, nome: 'Pátio', tipo: 'area' })
  const contorno = await chamar('trechos', {
    acao: 'geometria',
    obra_id: O,
    id: patio.id,
    coordenadas: [
      [-49.25, -16.68],
      [-49.24, -16.68],
      [-49.24, -16.67],
      [-49.25, -16.67]
    ]
  })
  check(
    'área recebe o contorno (polígono fechado) pelo MCP',
    contorno.contorno === 5 && contorno.limites.north === -16.67,
    JSON.stringify(contorno)
  )

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
  // a obra decide se o lançamento aponta o encarregado (padrão sim); desligar e religar pela ferramenta
  const apPadrao = await chamar('equipes', { acao: 'listar', obra_id: O })
  const apOff = await chamar('equipes', { acao: 'apontar_encarregado', obra_id: O, aponta: false })
  const apLido = await chamar('equipes', { acao: 'listar', obra_id: O })
  await chamar('equipes', { acao: 'apontar_encarregado', obra_id: O, aponta: true })
  check(
    'equipes: apontar o encarregado vem ligado, desliga pela ferramenta e o listar acompanha',
    apPadrao.aponta_encarregado === true &&
      apOff.aponta_encarregado === false &&
      apLido.aponta_encarregado === false,
    `${apPadrao.aponta_encarregado} / ${apOff.aponta_encarregado} / ${apLido.aponta_encarregado}`
  )

  // estoque: tanque pelas medidas, entrada em toneladas, leitura que ajusta, saída e o saldo pela regra da âncora
  const material = recursos.find((r) => r.grupo === 'MATERIAL')
  const calc = await chamar('estoque', {
    acao: 'calcular',
    dimensoes: {
      forma: 'cilindrico_horizontal',
      diametro: 200,
      comprimento: 600,
      tampo: { tipo: 'plano' }
    }
  })
  check(
    'estoque: cilindro de 2 m × 6 m tem 18.849,56 L',
    Math.abs(calc.capacidade_litros - 18849.56) < 0.01 && calc.altura_cm === 200,
    `${calc.capacidade_litros} L, ${calc.altura_cm} cm`
  )
  const tanque = await chamar('estoque', {
    acao: 'salvar_tanque',
    obra_id: O,
    nome: 'Tanque e2e',
    recurso_id: material.id,
    lat: -16.5,
    lng: -49.2,
    estoque_minimo: 3000,
    densidade_kg_l: 1.02,
    dimensoes: {
      forma: 'cilindrico_horizontal',
      diametro: 200,
      comprimento: 600,
      tampo: { tipo: 'plano' }
    }
  })
  await chamar('estoque', {
    acao: 'entrada',
    id: tanque.id,
    quantidade: 5,
    unidade: 't',
    documento: 'NF 1',
    momento: '2026-11-02T10:00:00-03:00'
  })
  const leit = await chamar('estoque', {
    acao: 'leitura',
    id: tanque.id,
    leitura_cm: 100,
    momento: '2026-11-03T08:00:00-03:00'
  })
  await chamar('estoque', {
    acao: 'saida',
    id: tanque.id,
    quantidade: 1000,
    terceiro: 'Usina',
    momento: '2026-11-04T09:00:00-03:00'
  })
  const [saldoT] = (await chamar('estoque', { acao: 'listar', obra_id: O })).filter(
    (x) => x.id === tanque.id
  )
  // meia altura do cilindro = metade da capacidade; a entrada de 5 t (4.901,96 L) é anterior à leitura
  check(
    'estoque: a leitura vira o saldo, a diferença é calculada e a saída desconta dela',
    Math.abs(Number(leit.quantidade) - 9424.78) < 0.01 &&
      Math.abs(Number(leit.diferenca) - (9424.78 - 4901.96)) < 0.01 &&
      Math.abs(Number(saldoT.saldo) - 8424.78) < 0.01 &&
      saldoT.status === 'normal',
    `leitura ${leit.quantidade} L, diferença ${leit.diferenca}, saldo ${saldoT.saldo}, ${saldoT.status}`
  )
  const foraRegua = await tentar('estoque', { acao: 'leitura', id: tanque.id, leitura_cm: 250 })
  check(
    'estoque: leitura fora da régua é recusada',
    foraRegua.erro && /régua/i.test(foraRegua.texto),
    foraRegua.texto.slice(0, 90)
  )
  const tabela = await chamar('estoque', { acao: 'tabela', id: tanque.id, passo_cm: 50 })
  check(
    'estoque: tabela do tanque em resumo',
    tabela.tabela.length === 5 &&
      tabela.tabela[2].altura_cm === 100 &&
      tabela.tabela[4].altura_cm === 200,
    JSON.stringify(tabela.tabela)
  )
  const semConf = await chamar('estoque', { acao: 'excluir_ativo', id: tanque.id })
  check(
    'estoque: excluir pede confirmação',
    semConf.precisa_confirmar === true,
    JSON.stringify(semConf).slice(0, 80)
  )
  await chamar('estoque', { acao: 'excluir_ativo', id: tanque.id, confirmar: true })
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
  const escopo = await chamar('planos', { acao: 'escopo', planejamento_id: plano.id })
  check(
    'planos.escopo soma as tarefas de cada serviço do orçamento',
    Array.isArray(escopo.servicos) &&
      escopo.servicos.length > 0 &&
      escopo.servicos.every((x) => Math.abs(x.orcado - x.distribuido - x.saldo) < 1e-6) &&
      escopo.servicos.some((x) => x.tarefas.length > 0),
    JSON.stringify(escopo).slice(0, 300)
  )
  const prev = await chamar('planos', { acao: 'promover', planejamento_id: plano.id })
  check('promover sem confirmar não trava', prev.precisa_confirmar === true)
  const lb = await chamar('planos', {
    acao: 'promover',
    planejamento_id: plano.id,
    confirmar: true
  })
  check('linha de base travada e vigente', lb.vigente === true, JSON.stringify(lb))
  const ctl = await chamar('cronograma', { acao: 'controle', planejamento_id: plano.id })
  check(
    'plano travado fica em controle: executado e término previsto por tarefa',
    !!ctl.obra &&
      ctl.tarefas.length === 2 &&
      ctl.tarefas.every((t) => 'grau' in t && 'fim_previsto' in t),
    JSON.stringify({ obra: ctl.obra, extra: ctl.indireto_a_mais_total })
  )
  const trava = await chamar('planos', { acao: 'trava', obra_id: O })
  check('trava da cadeia cita o plano vigente', String(trava).includes('vigente'), String(trava))
  const diff = await chamar('planos', { acao: 'premissas_diff', planejamento_id: plano.id })
  check('premissas da linha de base sem mudança', diff.mudou === false, JSON.stringify(diff))
  const orcRecalc = await chamar('orcamento_resumo', { acao: 'recalcular', obra_id: O })
  check('recálculo do orçamento pelo MCP', orcRecalc.ok === true, JSON.stringify(orcRecalc))
  const pront = await chamar('obras', { acao: 'prontidao', obra_id: O })
  const etapa = (k) => pront.etapas.find((e) => e.chave === k)?.situacao
  check(
    'prontidão: composições e linha de base ok, produção pendente',
    etapa('composicoes') === 'ok' &&
      etapa('linha_base') === 'ok' &&
      etapa('producao') === 'pendente',
    pront.etapas.map((e) => `${e.chave}:${e.situacao}`).join(' ')
  )
  const exVigente = await tentar('quantidades_locais', {
    acao: 'excluir',
    trecho_id: principal.id,
    confirmar: true
  })
  check(
    'excluir quantidades é recusado com plano vigente',
    exVigente.erro && /vigente/.test(exVigente.texto),
    exVigente.texto.slice(0, 160)
  )
  const totais = await chamar('quantidades_locais', { acao: 'totais', obra_id: O })
  check(
    'totais nos trechos: um por serviço, numa chamada',
    totais.length > 0 && totais.every((s) => typeof s.distribuido_nos_trechos === 'number'),
    JSON.stringify(totais.map((s) => [s.codigo, s.distribuido_nos_trechos]))
  )
  check(
    'totais: saldo sem local e divisão por trecho de cada serviço',
    totais.every(
      (s) =>
        typeof s.sem_local === 'number' &&
        Math.abs(
          Object.values(s.por_trecho).reduce((t, v) => t + v, 0) - s.distribuido_nos_trechos
        ) < 0.001
    ),
    JSON.stringify(totais.map((s) => [s.codigo, s.sem_local, s.por_trecho]))
  )
  const qtdLocal = await chamar('quantidades_locais', { acao: 'ler', trecho_id: principal.id })
  check(
    'quantidades do local lidas numa chamada (faixas com os valores por serviço)',
    Array.isArray(qtdLocal.segmentos) &&
      qtdLocal.segmentos.every((f) => typeof f.ini === 'number' && typeof f.valores === 'object'),
    JSON.stringify({ modo: qtdLocal.modo, faixas: qtdLocal.segmentos.length })
  )

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
  // quantidade lançada pelo usuário; DMT pelo eixo (acesso + estacas) e por distância fixa; peso exige ticket
  await chamar('parametros_servico', {
    acao: 'salvar',
    obra_id: O,
    item_orcamentario_id: sEsc.id,
    modo_lancamento: 'viagens',
    medicao_viagem: 'volume'
  })
  const pista = await chamar('transporte', {
    acao: 'salvar_local',
    obra_id: O,
    nome: 'Pista (corte/aterro)',
    tipo: 'pista',
    trecho_id: principal.id
  })
  const jaz = await chamar('transporte', {
    acao: 'salvar_local',
    obra_id: O,
    nome: 'Jazida J1',
    tipo: 'jazida',
    trecho_id: principal.id,
    estaca_acesso_m: 1000,
    distancia_acesso_km: 2.5
  })
  const caixa = await chamar('transporte', {
    acao: 'salvar_local',
    obra_id: O,
    nome: 'Caixa de empréstimo CE-1',
    tipo: 'caixa_emprestimo',
    trecho_id: principal.id,
    estaca_acesso_m: 4000,
    distancia_acesso_km: 0.3
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
    origem_id: pista.id,
    destino_id: bf.id,
    dmt_km: 2.5
  })
  const semDmt = await tentar('viagens', {
    acao: 'salvar',
    obra_id: O,
    data: ontem,
    viagens: [
      { item_orcamentario_id: sEsc.id, origem_id: jaz.id, destino_id: bf.id, quantidade: 12 }
    ]
  })
  check(
    'viagem sem DMT possível (sem estaca de acesso nem distância fixa) é recusada',
    semDmt.erro && /DMT/.test(semDmt.texto),
    semDmt.texto.slice(0, 120)
  )
  const ficha = await chamar('viagens', {
    acao: 'salvar',
    obra_id: O,
    data: ontem,
    motorista: 'Zé',
    equipe_id: eqA.id,
    encarregado_id: enc.id,
    viagens: [
      // jazida (acesso 2,5 km na estaca 1000 m) → aterro na estaca 3000 m: 2,5 + 2,0 = 4,5 km
      {
        item_orcamentario_id: sEsc.id,
        origem_id: jaz.id,
        destino_id: pista.id,
        estaca_descarga_m: 3000,
        quantidade: 12
      },
      // corte 1500 → aterro 2700: 1,2 km
      {
        item_orcamentario_id: sEsc.id,
        origem_id: pista.id,
        destino_id: pista.id,
        estaca_carga_m: 1500,
        estaca_descarga_m: 2700,
        quantidade: 12
      },
      // caixa de empréstimo (0,3 km na estaca 4000) → aterro 3500: 0,8 km
      {
        item_orcamentario_id: sEsc.id,
        origem_id: caixa.id,
        destino_id: pista.id,
        estaca_descarga_m: 3500,
        quantidade: 12
      },
      // corte 1000 → bota-fora pela distância fixa
      {
        item_orcamentario_id: sEsc.id,
        origem_id: pista.id,
        destino_id: bf.id,
        estaca_carga_m: 1000,
        quantidade: 12
      }
    ]
  })
  await chamar('parametros_servico', {
    acao: 'salvar',
    obra_id: O,
    item_orcamentario_id: sEsc.id,
    medicao_viagem: 'peso'
  })
  const semTicket = await tentar('viagens', {
    acao: 'salvar',
    obra_id: O,
    data: ontem,
    viagens: [
      {
        item_orcamentario_id: sEsc.id,
        origem_id: pista.id,
        destino_id: pista.id,
        estaca_carga_m: 100,
        estaca_descarga_m: 200,
        quantidade: 20
      }
    ]
  })
  check(
    'serviço medido por peso exige o ticket',
    semTicket.erro && /ticket/.test(semTicket.texto),
    semTicket.texto.slice(0, 120)
  )
  const pv = await chamar('producao', { acao: 'listar', obra_id: O, item_orcamentario_id: sEsc.id })
  const somaPv = pv.reduce((t, x) => t + Number(x.qtd ?? x.quantidade), 0)
  check(
    'viagens viram produção com equipe (4 × 12 = 48)',
    Math.abs(somaPv - 48) < 1e-6 && pv.every((x) => x.equipe_id === eqA.id),
    JSON.stringify(pv.map((x) => [x.qtd ?? x.quantidade, x.equipe_id, x.posicao_inicio_m]))
  )
  const fichas = await chamar('viagens', { acao: 'listar', obra_id: O })
  const vs = (fichas.find((f) => f.id === ficha.id)?.viagens ?? []).sort(
    (a, b) => a.ordem - b.ordem
  )
  check(
    'DMT pelo eixo e pela distância fixa (4,5 · 1,2 · 0,8 · 2,5 km)',
    JSON.stringify(vs.map((v) => [Number(v.dmt_km), v.dmt_origem])) ===
      JSON.stringify([
        [4.5, 'geometria'],
        [1.2, 'geometria'],
        [0.8, 'geometria'],
        [2.5, 'rota']
      ]),
    JSON.stringify(vs.map((v) => [v.dmt_km, v.dmt_origem, v.quantidade]))
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

  // ── 8. Alertas ─────────────────────────────────────────────────────────────────────────────────
  // chave estável: a rodada seguinte não recria; silenciado continua calado; "sem foto" é um por serviço
  const recalc = async () =>
    (await chamar('alertas', { acao: 'recalcular', obra_id: O })).resultados[0]
  const ra = await recalc()
  const rb = await recalc()
  check(
    'alertas: a rodada seguinte não recria nem resolve',
    rb.inseridos === 0 && rb.resolvidos === 0 && rb.abertos === ra.abertos && ra.abertos > 0,
    JSON.stringify(rb)
  )
  const abertos = await chamar('alertas', { acao: 'listar', obra_id: O, status: 'aberto' })
  const semFoto = abertos.filter((a) => a.tipo === 'sem_foto_periodo')
  check(
    'sem foto: um alerta por serviço, sem a produção das viagens',
    semFoto.length === 1 && semFoto[0].contexto?.item_orcamentario_id === sBase.id,
    JSON.stringify(semFoto.map((a) => a.titulo))
  )
  if (semFoto[0]) {
    const amanha = new Date(Date.now() + 86400000).toISOString()
    await chamar('alertas', { acao: 'silenciar', obra_id: O, id: semFoto[0].id, ate: amanha })
    const rc = await recalc()
    const todos = await chamar('alertas', { acao: 'listar', obra_id: O })
    check(
      'alerta silenciado não reabre na rodada seguinte',
      todos.find((a) => a.id === semFoto[0].id)?.status === 'silenciado' &&
        rc.inseridos === 0 &&
        !todos.some((a) => a.status === 'aberto' && a.tipo === 'sem_foto_periodo'),
      JSON.stringify(rc)
    )
  }

  // integrações: obra sem vínculo; sem o SIGA conectado na empresa, vincular é recusado com o motivo
  const semVinculo = await chamar('integracoes', { acao: 'status', obra_id: O })
  const vincular = await tentar('integracoes', {
    acao: 'vincular',
    obra_id: O,
    projeto_id: 1,
    projeto_codigo: 'E2E'
  })
  check(
    'integracoes: obra sem vínculo e vincular sem o SIGA conectado é recusado com o motivo',
    semVinculo.vinculada === false && vincular.erro && /SIGA/.test(vincular.texto),
    `${JSON.stringify(semVinculo)} / ${vincular.texto.slice(0, 100)}`
  )

  // ── 9. Papéis ──────────────────────────────────────────────────────────────────────────────────
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
  // ── 10. Exclusão com confirmação ────────────────────────────────────────────────────────────────
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
