// Dados de demonstração do cronograma (motor do ApeX) contra o stack local: uma obra rodoviária com orçamento,
// composições, dois eixos sem mapa (só estaca inicial/final) e uma área ("OAE Km 3"), cada um com a planilha de
// quantidades por local (a do contorno também sai em scripts/exemplos/quantidades-demo.xlsx, no padrão do DynaRoad,
// para reimportar em Planejamento › Locais), calendário com feriados e fatores de chuva, equipes nomeadas e um plano
// em edição com tarefas-resumo, tarefas por local (manuais, "do template" e criadas das quantidades), dependências
// entre serviços, dependências do usuário e um marco. Idempotente por nome da empresa: roda de novo e cria outra obra.
//
//   SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_ANON_KEY=<anon> \
//   E2E_EMAIL=god@infrawork.local E2E_PASSWORD=... node scripts/seed-cronograma.mjs
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:55321'
const ANON = process.env.SUPABASE_ANON_KEY
const EMAIL = process.env.E2E_EMAIL ?? 'god@infrawork.local'
const PASSWORD = process.env.E2E_PASSWORD
if (!ANON || !PASSWORD) throw new Error('SUPABASE_ANON_KEY e E2E_PASSWORD são obrigatórios')
if (!/127\.0\.0\.1|localhost/.test(URL)) throw new Error('Este script só roda contra o stack local')

const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD
})
if (authErr) throw authErr
const token = auth.session.access_token

async function fn(name, body) {
  const r = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${name} ${r.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}
async function q(table, build) {
  const { data, error } = await build(sb.from(table))
  if (error) throw new Error(`${table}: ${error.message}`)
  return data
}

const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

// ── empresa e obra ────────────────────────────────────────────────────────
const empresa = await fn('create-empresa', { nome: `Construtora Demo ${STAMP}` })
const obra = await fn('create-obra', {
  empresa_id: empresa.id,
  nome: `BR-000 Duplicação Km 0–12 (${STAMP})`,
  codigo: `DEMO-${STAMP}`
})
const obraId = obra.id
console.log('obra', obra.codigo, obraId)

// ── recursos ──────────────────────────────────────────────────────────────
const recursos = [
  ['MO', 'MO-01', 'Servente', 'h', 14.2],
  ['MO', 'MO-02', 'Operador de equipamento', 'h', 24.5],
  ['MO', 'MO-03', 'Motorista de caminhão', 'h', 21.0],
  ['MO', 'MO-04', 'Pedreiro', 'h', 22.0],
  ['MVE', 'EQ-01', 'Escavadeira hidráulica 20 t', 'h', 210],
  ['MVE', 'EQ-02', 'Caminhão basculante 14 m³', 'h', 165],
  ['MVE', 'EQ-03', 'Motoniveladora', 'h', 230],
  ['MVE', 'EQ-04', 'Rolo pé de carneiro', 'h', 150],
  ['MVE', 'EQ-05', 'Caminhão pipa 10.000 L', 'h', 140],
  ['MVE', 'EQ-06', 'Rolo liso vibratório', 'h', 145],
  ['MVE', 'EQ-07', 'Distribuidor de asfalto', 'h', 175],
  ['MVE', 'EQ-08', 'Vibroacabadora', 'h', 320],
  ['MVE', 'EQ-09', 'Rolo pneumático', 'h', 160],
  ['MVE', 'EQ-10', 'Betoneira 400 L', 'h', 18],
  ['COMBUSTIVEL', 'CB-01', 'Diesel S10', 'L', 6.4],
  ['MATERIAL', 'MT-01', 'Brita graduada', 'm³', 92],
  ['MATERIAL', 'MT-02', 'Solo-brita (jazida)', 'm³', 38],
  ['MATERIAL', 'MT-03', 'Asfalto diluído CM-30', 't', 4200],
  ['MATERIAL', 'MT-04', 'Massa asfáltica CBUQ (usina)', 't', 395],
  ['MATERIAL', 'MT-05', 'Concreto fck 20 MPa', 'm³', 520]
]
await rpc('importar_recursos', {
  _obra_id: obraId,
  _linhas: recursos.map(([grupo, codigo, nome, unidade, preco], i) => ({
    row: i + 2,
    grupo,
    codigo,
    nome,
    unidade,
    preco
  })),
  _opcoes: {}
})

// ── composições (equipe do ApeX = recursos de equipamento e mão de obra) ──
const eq = (ref, qtd, lh, ind = 0.85) => ({
  grupo: 'EQUIPAMENTO',
  recurso_ref: ref,
  quantidade: qtd,
  horas_dia: 8,
  consumo_combustivel_lh: lh,
  indice_produtividade: ind
})
const mo = (ref, qtd) => ({ grupo: 'MO', recurso_ref: ref, quantidade: qtd, horas_dia: 8 })
const mat = (ref, c) => ({ grupo: 'MATERIAL', recurso_ref: ref, consumo_material_por_unid: c })
const comb = { grupo: 'COMBUSTIVEL', recurso_ref: 'CB-01' }
const numerar = (itens) => itens.map((x, i) => ({ row: i + 2, ...x }))
const comps = [
  { codigo: '01', nome: 'TERRAPLENAGEM' },
  {
    codigo: '01.01',
    nome: 'Escavação, carga e transporte de 1ª categoria',
    unidade: 'm³',
    producao_qtde: 900,
    itens: numerar([
      eq('EQ-01', 1, 22),
      eq('EQ-02', 5, 14, 0.8),
      mo('MO-01', 2),
      mo('MO-02', 1),
      mo('MO-03', 5),
      comb
    ])
  },
  {
    codigo: '01.02',
    nome: 'Compactação de aterros a 100% PN',
    unidade: 'm³',
    producao_qtde: 700,
    itens: numerar([
      eq('EQ-03', 1, 18),
      eq('EQ-04', 1, 12),
      eq('EQ-05', 1, 10, 0.7),
      mo('MO-01', 2),
      mo('MO-02', 2),
      mo('MO-03', 1),
      comb
    ])
  },
  { codigo: '02', nome: 'PAVIMENTAÇÃO' },
  {
    codigo: '02.01',
    nome: 'Sub-base estabilizada granulometricamente',
    unidade: 'm³',
    producao_qtde: 350,
    itens: numerar([
      eq('EQ-03', 1, 18),
      eq('EQ-04', 1, 12),
      eq('EQ-05', 1, 10, 0.7),
      mo('MO-01', 3),
      mo('MO-02', 2),
      mat('MT-02', 1.3),
      comb
    ])
  },
  {
    codigo: '02.02',
    nome: 'Base de brita graduada',
    unidade: 'm³',
    producao_qtde: 250,
    itens: numerar([
      eq('EQ-03', 1, 18, 0.8),
      eq('EQ-06', 1, 12, 1),
      mo('MO-01', 4),
      mo('MO-02', 1),
      mat('MT-01', 1.25),
      comb
    ])
  },
  {
    codigo: '02.03',
    nome: 'Imprimação com CM-30',
    unidade: 'm²',
    producao_qtde: 5000,
    itens: numerar([eq('EQ-07', 1, 9), mo('MO-01', 2), mo('MO-02', 1), mat('MT-03', 0.0012), comb])
  },
  {
    codigo: '02.04',
    nome: 'Concreto betuminoso usinado a quente (CBUQ)',
    unidade: 't',
    producao_qtde: 350,
    itens: numerar([
      eq('EQ-08', 1, 16),
      eq('EQ-09', 1, 11),
      eq('EQ-06', 1, 12),
      mo('MO-01', 6),
      mo('MO-02', 3),
      mat('MT-04', 1),
      comb
    ])
  },
  { codigo: '03', nome: 'DRENAGEM' },
  {
    codigo: '03.01',
    nome: 'Sarjeta triangular de concreto',
    unidade: 'm',
    producao_qtde: 140,
    itens: numerar([eq('EQ-10', 1, 0, 1), mo('MO-01', 6), mo('MO-04', 2), mat('MT-05', 0.08)])
  }
]
const comp = await rpc('importar_composicoes', {
  _obra_id: obraId,
  _composicoes: comps.map((c, i) => ({ row: i + 2, ...c })),
  _opcoes: { modo_existente: 'erro' }
})
if (!comp.ok) throw new Error('composições: ' + JSON.stringify(comp.erros))
const servicoDaComp = new Map(
  comp.resultados.filter((r) => r.servico_id).map((r) => [r.codigo, r.servico_id])
)

// ── orçamento: receitas → serviços (um por composição; receitas da mesma composição agrupadas no mesmo serviço) ──
const receitas = [
  ['01', 'TERRAPLENAGEM'],
  [
    '01.01',
    'Escavação, carga e transporte de material de 1ª categoria — DMT até 1.000 m',
    'm³',
    100000,
    9.2,
    '01.01'
  ],
  [
    '01.02',
    'Escavação, carga e transporte de material de 1ª categoria — DMT 1.000 a 3.000 m',
    'm³',
    80000,
    10.55,
    '01.01'
  ],
  ['01.03', 'Compactação de aterros a 100% do Proctor normal', 'm³', 120000, 6.4, '01.02'],
  ['02', 'PAVIMENTAÇÃO'],
  ['02.01', 'Sub-base estabilizada granulometricamente sem mistura', 'm³', 25200, 95, '02.01'],
  ['02.02', 'Base de brita graduada simples', 'm³', 21600, 135, '02.02'],
  ['02.03', 'Imprimação com asfalto diluído CM-30', 'm²', 144000, 6.2, '02.03'],
  ['02.04', 'Concreto betuminoso usinado a quente — faixa C', 't', 13000, 520, '02.04'],
  ['03', 'DRENAGEM'],
  ['03.01', 'Sarjeta triangular de concreto STC 02', 'm', 18000, 62, '03.01'],
  ['03.02', 'Sarjeta triangular de concreto STC 03', 'm', 10000, 68, '03.01']
]
const nomeComp = new Map(comps.map((c) => [c.codigo, c.nome]))
await fn('import-orcamento', {
  obra_id: obraId,
  itens: receitas.map(([codigo, descricao, unidade, quantidade, venda_unitaria], i) => ({
    row: i + 2,
    codigo,
    descricao,
    unidade: unidade ?? null,
    quantidade: quantidade ?? null,
    venda_unitaria: venda_unitaria ?? null
  })),
  alocacoes: receitas
    .map(([codigo, , , , , c], i) =>
      c
        ? {
            row: i + 2,
            codigo,
            criterio: 'percentual',
            compoe: true,
            destinos: [{ servico: nomeComp.get(c), valor: 100 }]
          }
        : null
    )
    .filter(Boolean),
  opcoes: {}
})
const itens = await q('item_orcamentario', (t) =>
  t.select('id, codigo, descricao, tipo').eq('obra_id', obraId).eq('tipo', 'servico_grupo')
)
const itemDaComp = new Map()
for (const [codigo, nome] of nomeComp) {
  const it = itens.find((i) => i.descricao === nome)
  if (!it || !servicoDaComp.get(codigo)) continue
  await q('item_orcamentario', (t) =>
    t
      .update({ servico_id: servicoDaComp.get(codigo) })
      .eq('id', it.id)
      .select('id')
  )
  itemDaComp.set(codigo, it.id)
}
console.log('serviços vinculados', itemDaComp.size)

// ── trechos e template de quantidades do Trecho 1 ─────────────────────────
const [tr1] = await q('obra_trecho', (t) =>
  t
    .insert({
      obra_id: obraId,
      nome: 'Trecho 1 — Km 0 ao Km 12',
      ordem: 0,
      cor: '#3b82f6',
      unidade_espaco_padrao: 'estaca',
      comprimento_m: 12000
    })
    .select()
)
const [tr2] = await q('obra_trecho', (t) =>
  t
    .insert({
      obra_id: obraId,
      nome: 'Trecho 2 — Contorno',
      ordem: 1,
      cor: '#f59e0b',
      unidade_espaco_padrao: 'km',
      comprimento_m: 4500
    })
    .select()
)
// área = local sem estacas (a "area" do DynaRoad): a tarefa ocupa a área inteira
const [arOae] = await q('obra_trecho', (t) =>
  t
    .insert({
      obra_id: obraId,
      nome: 'OAE Km 3',
      ordem: 2,
      cor: '#a855f7',
      tipo: 'area',
      unidade_espaco_padrao: 'm'
    })
    .select()
)
// escavação concentrada nos cortes do km 2–5 e 8–10; aterro nos vales; pavimento uniforme
const esc = [6000, 9000, 18000, 21000, 17000, 8000, 5000, 9000, 19000, 15000, 7000, 6000]
const ate = [9000, 12000, 4000, 3000, 5000, 11000, 13000, 9000, 4000, 5000, 10000, 10000]
await rpc('trecho_salvar_quantidades', {
  _trecho_id: tr1.id,
  _dados: {
    modo: 'analitico',
    servicos: ['01.01', '01.02', '02.01', '02.02', '02.04'].map((c) => itemDaComp.get(c)),
    segmentos: esc.map((e, k) => ({
      ini: k * 1000,
      fim: (k + 1) * 1000,
      label_ini: `${k * 50}+0`,
      label_fim: `${(k + 1) * 50}+0`,
      valores: {
        [itemDaComp.get('01.01')]: e,
        [itemDaComp.get('01.02')]: ate[k],
        [itemDaComp.get('02.01')]: 1440,
        [itemDaComp.get('02.02')]: 1260,
        [itemDaComp.get('02.04')]: 864
      }
    }))
  }
})

// ── Trecho 2 e área: as quantidades da planilha-exemplo (layout do DynaRoad: uma estaca por linha) ──
// por ponto → por faixa pela regra do DynaRoad: meio caminho das estacas vizinhas; nas pontas, a própria estaca
const kmPts = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]
const escC = [2000, 3000, 4000, 5000, 4000, 3000, 3000, 2000, 2000, 2000]
const ateC = [3000, 4000, 5000, 0, 0, 2000, 2000, 2000, 1000, 1000] // o zero fecha a sequência
const sarjC = [0, 0, 500, 500, 500, 0, 0, 0, 0, 0]
const faixaDe = (i) => [
  i === 0 ? kmPts[0] : (kmPts[i - 1] + kmPts[i]) / 2,
  i === kmPts.length - 1 ? kmPts[i] : (kmPts[i] + kmPts[i + 1]) / 2
]
await rpc('trecho_salvar_quantidades', {
  _trecho_id: tr2.id,
  _dados: {
    modo: 'simplificado',
    servicos: ['01.01', '01.02', '03.01'].map((c) => itemDaComp.get(c)),
    segmentos: kmPts.map((_, i) => {
      const [ini, fim] = faixaDe(i)
      return {
        ini,
        fim,
        label_ini: `km ${ini / 1000}`,
        label_fim: `km ${fim / 1000}`,
        valores: {
          [itemDaComp.get('01.01')]: escC[i],
          [itemDaComp.get('01.02')]: ateC[i],
          [itemDaComp.get('03.01')]: sarjC[i]
        }
      }
    })
  }
})
await rpc('trecho_salvar_quantidades', {
  _trecho_id: arOae.id,
  _dados: {
    modo: 'simplificado',
    servicos: [itemDaComp.get('02.02')],
    segmentos: [
      {
        ini: 0,
        fim: 1,
        label_ini: 'área',
        label_fim: 'área',
        valores: { [itemDaComp.get('02.02')]: 500 }
      }
    ]
  }
})
// a mesma planilha no padrão do DynaRoad (uma aba por local, coluna "Estaca"; aba "Áreas"): reimportar dá "igual"
{
  const { default: ExcelJS } = await import('exceljs')
  const { fileURLToPath } = await import('node:url')
  const { mkdir } = await import('node:fs/promises')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Trecho 2 — Contorno')
  ws.addRow(['Quantidades do contorno — exemplo no padrão do DynaRoad (uma aba por local)'])
  ws.addRow([])
  ws.addRow([
    'Estaca',
    'Escavação, carga e transporte de 1ª categoria',
    'Compactação de aterros a 100% PN',
    'Sarjeta triangular de concreto'
  ])
  ws.addRow(['km', 'm³', 'm³', 'm'])
  kmPts.forEach((m, i) => ws.addRow([m / 1000, escC[i], ateC[i], sarjC[i]]))
  ws.columns = [{ width: 10 }, { width: 40 }, { width: 32 }, { width: 28 }]
  const wa = wb.addWorksheet('Áreas')
  wa.addRow(['Área', 'Estaca', 'Distância', 'Base de brita graduada'])
  wa.addRow(['OAE Km 3', 3, 300, 500])
  wa.columns = [{ width: 18 }, { width: 10 }, { width: 10 }, { width: 28 }]
  const dir = new globalThis.URL('./exemplos/', import.meta.url)
  await mkdir(dir, { recursive: true })
  await wb.xlsx.writeFile(fileURLToPath(new globalThis.URL('quantidades-demo.xlsx', dir)))
  console.log('planilha-exemplo', fileURLToPath(new globalThis.URL('quantidades-demo.xlsx', dir)))
}

// ── calendário: seg–qui 9 h, sex 8 h; feriados, Páscoa, recesso e fatores de chuva ──
const [cal] = await q('calendario', (t) => t.select('id').eq('obra_id', obraId).eq('padrao', true))
const dia = (horas) => ({ inicio: '07:00', horas })
await q('calendario', (t) =>
  t
    .update({ semana: [dia(9), dia(9), dia(9), dia(9), dia(8), dia(0), dia(0)] })
    .eq('id', cal.id)
    .select('id')
)
await q('calendario_definicao', (t) =>
  t
    .insert([
      {
        calendario_id: cal.id,
        tipo: 'feriado',
        nome: 'Finados',
        data_inicio: '2026-11-02',
        data_fim: '2026-11-02',
        todo_ano: true,
        ordem: 1
      },
      {
        calendario_id: cal.id,
        tipo: 'feriado',
        nome: 'Proclamação da República',
        data_inicio: '2026-11-15',
        data_fim: '2026-11-15',
        todo_ano: true,
        ordem: 2
      },
      {
        calendario_id: cal.id,
        tipo: 'feriado',
        nome: 'Consciência Negra',
        data_inicio: '2026-11-20',
        data_fim: '2026-11-20',
        todo_ano: true,
        ordem: 3
      },
      {
        calendario_id: cal.id,
        tipo: 'feriado',
        nome: 'Recesso de fim de ano',
        data_inicio: '2026-12-21',
        data_fim: '2027-01-03',
        todo_ano: false,
        ordem: 4
      },
      {
        calendario_id: cal.id,
        tipo: 'feriado',
        nome: 'Tiradentes',
        data_inicio: '2027-04-21',
        data_fim: '2027-04-21',
        todo_ano: true,
        ordem: 5
      },
      {
        calendario_id: cal.id,
        tipo: 'feriado',
        nome: 'Dia do Trabalho',
        data_inicio: '2027-05-01',
        data_fim: '2027-05-01',
        todo_ano: true,
        ordem: 6
      },
      {
        calendario_id: cal.id,
        tipo: 'pascoa',
        nome: 'Páscoa',
        data_inicio: null,
        data_fim: null,
        todo_ano: false,
        ordem: 7
      }
    ])
    .select('id')
)
await q('obra_produtividade_mes', (t) =>
  t
    .insert([
      { obra_id: obraId, ano_mes: '2027-01-01', fator: 0.6 },
      { obra_id: obraId, ano_mes: '2027-02-01', fator: 0.7 },
      { obra_id: obraId, ano_mes: '2027-03-01', fator: 0.85 }
    ])
    .select('ano_mes')
)

// ── dependências entre serviços (por estacas, automáticas) ────────────────
const sd = (a, b, atraso) => ({
  obra_id: obraId,
  predecessor_id: servicoDaComp.get(a),
  sucessor_id: servicoDaComp.get(b),
  atraso_dias: atraso
})
await q('servico_dependencia', (t) =>
  t
    .insert([
      sd('01.01', '01.02', 2),
      sd('01.02', '02.01', 3),
      sd('02.01', '02.02', 2),
      sd('02.02', '02.03', 1),
      sd('02.03', '02.04', 2)
    ])
    .select('id')
)

// ── equipes nomeadas (recursos identificados: não trabalham em duas tarefas ao mesmo tempo) ──
const [eqT] = await q('equipe', (t) =>
  t
    .insert({
      obra_id: obraId,
      nome: 'Equipe de terraplenagem',
      tipo: 'Terraplenagem',
      cor: '#a16207',
      ordem: 1
    })
    .select()
)
const [eqP] = await q('equipe', (t) =>
  t
    .insert({
      obra_id: obraId,
      nome: 'Equipe de pavimentação',
      tipo: 'Pavimentação',
      cor: '#334155',
      ordem: 2
    })
    .select()
)
const [eqD] = await q('equipe', (t) =>
  t
    .insert({
      obra_id: obraId,
      nome: 'Equipe de drenagem',
      tipo: 'Drenagem',
      cor: '#0e7490',
      ordem: 3
    })
    .select()
)

// ── plano em edição ───────────────────────────────────────────────────────
const [plan] = await q('planejamento', (t) =>
  t
    .insert({
      obra_id: obraId,
      nome: 'Plano executivo',
      data_referencia_inicio: '2026-11-03',
      prazo: '2027-08-31'
    })
    .select()
)
const grupo = async (nome, ordem) =>
  (
    await q('planejamento_tarefa', (t) =>
      t
        .insert({ planejamento_id: plan.id, tipo_no: 'grupo', nivel: 1, nome_custom: nome, ordem })
        .select()
    )
  )[0]
const gT = await grupo('Terraplenagem', 0)
const gP = await grupo('Pavimentação', 1)
const gD = await grupo('Drenagem', 2)

let ordem = 0
async function tarefa(pai, comp, o, locais, equipes = []) {
  const [t] = await q('planejamento_tarefa', (x) =>
    x
      .insert({
        planejamento_id: plan.id,
        tipo_no: 'tarefa',
        nivel: 2,
        parent_id: pai.id,
        ordem: ordem++,
        item_orcamentario_id: itemDaComp.get(comp),
        quantidade_alocada: null,
        asap: true,
        ...o
      })
      .select()
  )
  for (const [k, l] of locais.entries())
    await q('planejamento_tarefa_local', (x) =>
      x.insert({ tarefa_id: t.id, ordem: k, ...l }).select('id')
    )
  for (const e of equipes)
    await q('planejamento_tarefa_equipe', (x) =>
      x.insert({ tarefa_id: t.id, equipe_id: e.id, qtd_equipes: 1 }).select('tarefa_id')
    )
  return t
}
const doTrecho = (ini, fim) => ({
  trecho_id: tr1.id,
  inicio_m: ini,
  fim_m: fim,
  qtd_origem: 'trecho'
})
const manual = (tr, ini, fim, quantidade) => ({
  trecho_id: tr.id,
  inicio_m: ini,
  fim_m: fim,
  quantidade,
  qtd_origem: 'manual'
})

const escT1 = await tarefa(
  gT,
  '01.01',
  { nome_custom: 'Escavação T1', qtd_equipes: 2 },
  [doTrecho(0, 12000)],
  [eqT]
)
await tarefa(gT, '01.02', { nome_custom: 'Aterro T1', qtd_equipes: 2 }, [doTrecho(0, 12000)])
const escT2 = await tarefa(
  gT,
  '01.01',
  { nome_custom: 'Escavação Contorno' },
  [manual(tr2, 0, 4500, 40000)],
  [eqT]
)
const ateT2 = await tarefa(gT, '01.02', { nome_custom: 'Aterro Contorno' }, [
  manual(tr2, 0, 4500, 25000)
])
await tarefa(gP, '02.01', { nome_custom: 'Sub-base T1' }, [doTrecho(0, 12000)], [eqP])
await tarefa(gP, '02.02', { nome_custom: 'Base T1' }, [doTrecho(0, 12000)], [eqP])
await tarefa(gP, '02.03', { nome_custom: 'Imprimação T1', sentido: 'crescente' }, [
  manual(tr1, 0, 12000, 86400)
])
await tarefa(gP, '02.04', { nome_custom: 'CBUQ T1', qtd_equipes: 1 }, [doTrecho(0, 12000)])
const sarj = await tarefa(
  gD,
  '03.01',
  { nome_custom: 'Sarjetas T1', asap: false, sentido: 'decrescente' },
  [manual(tr1, 2000, 12000, 20000)],
  [eqD]
)
// tarefa numa área (local sem estacas, quantidade da planilha da área)
await tarefa(gP, '02.02', { nome_custom: 'Base OAE Km 3' }, [
  { trecho_id: arOae.id, inicio_m: null, fim_m: null, qtd_origem: 'trecho' }
])
// sarjetas do contorno criadas das quantidades por local: uma tarefa por sequência contígua (km 0,75–2,25)
await rpc('planejamento_tarefas_criar_das_quantidades', {
  _planejamento_id: plan.id,
  _parent_id: gD.id,
  _trechos: [tr2.id],
  _itens: [itemDaComp.get('03.01')],
  _opcoes: { modo: 'sequencia', sentido: 'crescente' }
})

// dependências do usuário
await q('planejamento_dependencia', (t) =>
  t
    .insert([
      {
        planejamento_id: plan.id,
        predecessora_id: escT2.id,
        sucessora_id: ateT2.id,
        tipo: 'SS',
        atraso_min: 5,
        dias_uteis: true
      },
      {
        planejamento_id: plan.id,
        predecessora_id: escT1.id,
        sucessora_id: sarj.id,
        tipo: 'FS',
        atraso_min: 0,
        dias_uteis: false
      }
    ])
    .select('id')
)
// marco: liberação da primeira metade do trecho 1 até o fim de março
await q('planejamento_marco', (t) =>
  t
    .insert({
      planejamento_id: plan.id,
      nome: 'Liberação do Km 0 ao Km 6',
      fim: '2027-03-31T23:59:59',
      filtro_estacas: true,
      faixas: [{ trecho_id: tr1.id, inicio_m: 0, fim_m: 6000 }]
    })
    .select('id')
)
const [p] = await q('planejamento', (t) => t.select('dados_rev, calculo_rev').eq('id', plan.id))
console.log('plano', plan.id, 'dados_rev', p.dados_rev)
console.log('✓ dados de demonstração criados')
process.exit(0)
