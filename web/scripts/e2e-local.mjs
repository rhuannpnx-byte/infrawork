// E2E do backend contra o stack local (supabase start + supabase functions serve).
// Cria empresa/obra de teste, importa recursos/composições/orçamento, monta o cronograma (motor do ApeX, como o
// navegador faz: carrega a entrada, calcula e grava pela RPC), trava a linha de base e lança produção.
//
// Roda com o vite-node (os aliases do app: @apex/*, @/…):
//   VITE_SUPABASE_URL=http://127.0.0.1:55321 VITE_SUPABASE_ANON_KEY=<publishable> \
//   E2E_EMAIL=god@infrawork.local E2E_PASSWORD=... npx vite-node scripts/e2e-local.mjs
import { readFileSync } from 'node:fs'
import { supabase as sb } from '../src/lib/supabase/client'
import { carregarPlanoEntrada } from '../src/features/cronograma/dados'
import { calcularPlano, payloadGravacao } from '../src/features/cronograma/motor/calculo'

const URL = process.env.VITE_SUPABASE_URL ?? ''
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const EMAIL = process.env.E2E_EMAIL ?? 'god@infrawork.local'
const PASSWORD = process.env.E2E_PASSWORD
if (!ANON || !PASSWORD) throw new Error('VITE_SUPABASE_ANON_KEY e E2E_PASSWORD são obrigatórios')
if (!/127\.0\.0\.1|localhost/.test(URL)) throw new Error(`só contra o stack local (VITE_SUPABASE_URL=${URL})`)
if (!sb) throw new Error('cliente do Supabase não configurado')
const MODELO = new Uint8Array(readFileSync(new globalThis.URL('../src/features/cronograma/motor/modelo/default.dr5', import.meta.url)))
const STAMP = Date.now().toString(36)

const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
if (authErr) throw authErr
const token = auth.session.access_token

let falhas = 0
function check(nome, cond, info = '') {
  console.log(`${cond ? '✓' : '✗'} ${nome}${info ? ` — ${info}` : ''}`)
  if (!cond) falhas++
}
async function fn(name, body) {
  const r = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await r.text()
  let j
  try {
    j = JSON.parse(text)
  } catch {
    j = text
  }
  if (!r.ok) throw new Error(`${name} ${r.status}: ${text.slice(0, 400)}`)
  return j
}
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}
/** Cronograma no motor do ApeX, como o navegador: entrada do banco → cálculo → gravação (confere a revisão). */
async function calcular(planejamentoId) {
  const e = await carregarPlanoEntrada(planejamentoId)
  const r = calcularPlano(e, MODELO).resultado
  const g = await rpc('planejamento_gravar_calculo', { _planejamento_id: planejamentoId, _dados: payloadGravacao(e, r) })
  if (!g.ok) throw new Error(`gravar cálculo: ${JSON.stringify(g)}`)
  return r
}
/** "Restaurar como nova linha de base" (orquestrado no cliente): cópia → cálculo → trava. */
async function restaurar(planejamentoId, nome, marcarVigente) {
  const c = await rpc('planejamento_copiar', { _origem_id: planejamentoId, _nome: nome, _inicio: null })
  await calcular(c.novo_id)
  const pr = await rpc('planejamento_promover', { _planejamento_id: c.novo_id, _marcar_vigente: marcarVigente })
  return { novo_id: c.novo_id, vigente: pr.vigente }
}
async function q(table, build) {
  const { data, error } = await build(sb.from(table))
  if (error) throw new Error(`${table}: ${error.message}`)
  return data
}

// ── 1. Empresa ──────────────────────────────────────────────────────────────
const empresa = await fn('create-empresa', { nome: `E2E Construtora ${STAMP}` })
check('create-empresa', !!empresa.id, empresa.id)

// ── 2. Obra ────────────────────────────────────────────────────────────────
const obra = await fn('create-obra', { empresa_id: empresa.id, nome: `Obra E2E ${STAMP}`, codigo: `E2E-${STAMP}` })
check('create-obra', !!obra.id, obra.codigo)
const obraId = obra.id

// ── 3. Recursos + composições (RPC, como o cliente faz) ────────────────────
const rec = await rpc('importar_recursos', {
  _obra_id: obraId,
  _linhas: [
    { row: 2, grupo: 'MO', codigo: 'MO-01', nome: 'Servente', unidade: 'h', preco: 12.5 },
    { row: 3, grupo: 'MO', codigo: 'MO-02', nome: 'Operador de rolo', unidade: 'h', preco: 18 },
    { row: 4, grupo: 'MVE', codigo: 'EQ-01', nome: 'Rolo pé de carneiro', unidade: 'h', preco: 95 },
    { row: 5, grupo: 'MVE', codigo: 'EQ-02', nome: 'Motoniveladora', unidade: 'h', preco: 180 },
    { row: 6, grupo: 'COMBUSTIVEL', codigo: 'CB-01', nome: 'Diesel S10', unidade: 'L', preco: 6.2 },
    { row: 7, grupo: 'MATERIAL', codigo: 'MT-01', nome: 'Brita graduada', unidade: 'm³', preco: 85 },
    { row: 8, grupo: 'MATERIAL', codigo: 'MT-02', nome: 'Água', unidade: 'm³', preco: 15 }
  ],
  _opcoes: {}
})
check('importar_recursos', rec.ok && rec.stats.criados === 7, JSON.stringify(rec.stats))
const itensCpu = [
  { row: 2, grupo: 'EQUIPAMENTO', recurso_ref: 'EQ-02', quantidade: 1, horas_dia: 8, consumo_combustivel_lh: 18, indice_produtividade: 0.8 },
  { row: 3, grupo: 'EQUIPAMENTO', recurso_ref: 'EQ-01', quantidade: 1, horas_dia: 8, consumo_combustivel_lh: 12, indice_produtividade: 1 },
  { row: 4, grupo: 'MO', recurso_ref: 'MO-01', quantidade: 4, horas_dia: 8 },
  { row: 5, grupo: 'MO', recurso_ref: 'MO-02', quantidade: 1, horas_dia: 8 },
  { row: 6, grupo: 'MATERIAL', recurso_ref: 'MT-01', consumo_material_por_unid: 1.25 },
  { row: 7, grupo: 'MATERIAL', recurso_ref: 'MT-02', consumo_material_por_unid: 0.1 },
  { row: 8, grupo: 'COMBUSTIVEL', recurso_ref: 'CB-01' }
]
const comp = await rpc('importar_composicoes', {
  _obra_id: obraId,
  _composicoes: [
    { row: 2, codigo: '01', nome: 'PAVIMENTAÇÃO' },
    { row: 3, codigo: '01.01', nome: 'Base de brita graduada', unidade: 'm³', producao_qtde: 200, itens: itensCpu }
  ],
  _opcoes: { modo_existente: 'erro' }
})
check(
  'importar_composicoes custo_unit = 128,0172',
  comp.ok && Number(comp.resultados?.[0]?.custo_unit) === 128.0172,
  JSON.stringify(comp.resultados?.[0])
)
const servicoId = comp.resultados?.[0]?.servico_id

// ── 4. Orçamento: planilha de venda intacta + serviços por alocação/rateio ──
const pct = (dest) => dest.map(([servico, valor]) => ({ servico, valor }))
const orc = await fn('import-orcamento', {
  obra_id: obraId,
  itens: [
    { row: 2, codigo: '01', descricao: 'PAVIMENTAÇÃO' },
    { row: 3, codigo: '01.01', descricao: 'Base de brita graduada', unidade: 'm³', quantidade: 1500, venda_unitaria: 187.5 },
    { row: 4, codigo: '01.02', descricao: 'Sinalização provisória', unidade: 'vb', quantidade: 1, venda_unitaria: 12000 },
    { row: 5, codigo: '02', descricao: 'REVESTIMENTO' },
    { row: 6, codigo: '02.01', descricao: 'Imprimação', unidade: 'm²', quantidade: 1000, venda_unitaria: 10 },
    { row: 7, codigo: '02.02', descricao: 'Pintura de ligação', unidade: 'm²', quantidade: 2000, venda_unitaria: 5 },
    { row: 8, codigo: '02.03', descricao: 'Transp. comercial de material betuminoso', unidade: 'tkm', quantidade: 1000, venda_unitaria: 2 },
    { row: 9, codigo: '02.04', descricao: 'Desmatamento de jazida', unidade: 'vb', quantidade: 1, venda_unitaria: 900 },
    { row: 10, codigo: '02.05', descricao: 'Mobilização parcial', unidade: 'vb', quantidade: 1, venda_unitaria: 1000 },
    { row: 11, codigo: '02.06', descricao: 'Item ainda sem serviço', unidade: 'un', quantidade: 1, venda_unitaria: 500 }
  ],
  alocacoes: [
    { row: 3, codigo: '01.01', criterio: 'percentual', compoe: true, destinos: pct([['Base de brita graduada', 100]]) },
    { row: 4, codigo: '01.02', criterio: 'percentual', compoe: true, destinos: pct([['Sinalização', 100]]) },
    { row: 6, codigo: '02.01', criterio: 'percentual', compoe: true, destinos: pct([['Imprimação', 100]]) },
    { row: 7, codigo: '02.02', criterio: 'percentual', compoe: true, destinos: pct([['Pintura', 100]]) },
    // Rateio B (físico): 300 tkm p/ imprimação, 100 tkm p/ pintura → 75% / 25%
    { row: 8, codigo: '02.03', criterio: 'peso', compoe: false, destinos: pct([['Imprimação', 300], ['Pintura', 100]]) },
    // Rateio A (venda): base = venda das receitas que compõem cada serviço (10.000 / 10.000)
    { row: 9, codigo: '02.04', criterio: 'venda', compoe: false, destinos: pct([['Imprimação', null], ['Pintura', null]]) },
    // percentual com saldo: 60% → saldo 40%
    { row: 10, codigo: '02.05', criterio: 'percentual', compoe: false, destinos: pct([['Pintura', 60]]) }
  ],
  opcoes: {}
})
check(
  'import v4: 8 receitas, 4 serviços, 2 rateios',
  orc.ok && orc.stats.receitas_criadas === 8 && orc.stats.servicos_criados === 4 && orc.stats.receitas_rateadas === 2,
  JSON.stringify(orc.stats)
)
const itensOrc = await q('item_orcamentario', (t) =>
  t
    .select('id, codigo, descricao, tipo, parent_id, unidade_referencia, qtd_ref_modo, quantidade_referencia, venda_total_calc, custo_total_calc, servico_id, custo_unitario_calc')
    .eq('obra_id', obraId)
    .order('codigo')
)
const porCod = Object.fromEntries(itensOrc.map((i) => [i.codigo, i]))
const servico = (nome) => itensOrc.find((i) => i.tipo === 'servico_grupo' && i.descricao === nome)
check('receitas continuam na etapa original (planilha de venda intacta)', porCod['02.03'].parent_id === porCod['02'].id && porCod['01.01'].parent_id === porCod['01'].id)
check('serviços com código S0x, fora da árvore', itensOrc.filter((i) => i.tipo === 'servico_grupo').every((g) => /^S\d+$/.test(g.codigo) && g.parent_id === null))
const impr = servico('Imprimação')
const pint = servico('Pintura')
check('Imprimação: 10.000 + 75% de 2.000 + 50% de 900 = 11.950', Math.abs(Number(impr.venda_total_calc) - 11950) < 0.01, String(impr.venda_total_calc))
check('Pintura: 10.000 + 25% de 2.000 + 50% de 900 + 60% de 1.000 = 11.550', Math.abs(Number(pint.venda_total_calc) - 11050 - 500) < 0.01, String(pint.venda_total_calc))
check('qtd Imprimação herdada da receita que compõe = 1.000 m²', Number(impr.quantidade_referencia) === 1000 && impr.qtd_ref_modo === 'heranca' && impr.unidade_referencia === 'm²', JSON.stringify(impr))
const sinal = servico('Sinalização')
check('Sinalização: 1 vb herdado', Number(sinal.quantidade_referencia) === 1)
const [cons] = await q('vw_orcamento_consolidado', (t) => t.select('venda_total').eq('obra_id', obraId))
const vendaServicos = itensOrc.filter((i) => i.tipo === 'servico_grupo').reduce((a, i) => a + Number(i.venda_total_calc), 0)
check('venda total = planilha de venda (317.650)', Math.abs(Number(cons.venda_total) - 317650) < 0.01, String(cons.venda_total))
check('serviços + saldo (400) + sem serviço (500) = venda total', Math.abs(vendaServicos + 400 + 500 - 317650) < 0.01, String(vendaServicos))

// vínculo com a composição é feito no sistema
await q('item_orcamentario', (t) => t.update({ servico_id: servicoId, unidade_referencia: 'm³' }).eq('id', servico('Base de brita graduada').id).select())
const wrapper = (await q('item_orcamentario', (t) => t.select('id, codigo, custo_unitario_calc, custo_total_calc, servico_id').eq('id', servico('Base de brita graduada').id)))[0]
const semVinculo = sinal
check(
  'serviço Base vinculado à composição: custo ao vivo 128,0172 (sem recalcular)',
  Math.abs(Number(wrapper?.custo_unitario_calc) - 128.0172) < 0.001,
  String(wrapper?.custo_unitario_calc)
)
const [r0101] = await q('item_orcamentario', (t) => t.select('custo_total_calc').eq('obra_id', obraId).eq('codigo', '01.01'))
check('custo do serviço apropriado na receita 01.01', Math.abs(Number(r0101.custo_total_calc) - Number(wrapper.custo_total_calc)) < 0.01, `${r0101.custo_total_calc} vs ${wrapper.custo_total_calc}`)

// atualização automática: muda a quantidade da receita rateada por peso
await q('item_orcamentario', (t) => t.update({ quantidade: 2000 }).eq('obra_id', obraId).eq('codigo', '02.03').select())
const [impr2] = await q('item_orcamentario', (t) => t.select('venda_total_calc').eq('id', impr.id))
check('rateio acompanha a planilha de venda (2.000 tkm → Imprimação 13.450)', Math.abs(Number(impr2.venda_total_calc) - 13450) < 0.01, String(impr2.venda_total_calc))

// receita alocada não pode ser excluída
const delAloc = await sb.from('item_orcamentario').delete().eq('obra_id', obraId).eq('codigo', '02.03')
check('excluir receita alocada é recusado', !!delAloc.error && /remova a alocação/.test(delAloc.error.message), delAloc.error?.message)

// rateio percentual acima de 100% é recusado
const acima = await sb.rpc('salvar_rateio_receita', {
  _receita_id: porCod['02.05'].id,
  _criterio: 'percentual',
  _destinos: [{ grupo_id: pint.id, valor: 70 }, { grupo_id: impr.id, valor: 40 }]
})
check('rateio percentual > 100% é recusado', !!acima.error, acima.error?.message)

// reimportar o mesmo arquivo não duplica
const reimp = await fn('import-orcamento', {
  obra_id: obraId,
  itens: [{ row: 3, codigo: '01.01', descricao: 'Base', unidade: 'm³', quantidade: 1500, venda_unitaria: 187.5 }],
  alocacoes: [{ row: 3, codigo: '01.01', criterio: 'percentual', compoe: true, destinos: pct([['Base de brita graduada', 100]]) }],
  opcoes: {}
})
check(
  'reimportar = pulado (receita e alocação)',
  reimp.ok && reimp.stats.pulados === 1 && reimp.stats.alocacoes_puladas === 1 && reimp.stats.servicos_criados === 0,
  JSON.stringify(reimp.stats)
)

// ── 5. Planejamento: calendário, equipe, tarefas, dependência, cronograma (motor do ApeX) ─────────
const [cal] = await q('calendario', (t) => t.select('id').eq('obra_id', obraId).eq('padrao', true))
check('calendário padrão criado com a obra', !!cal?.id)
await q('calendario_definicao', (t) =>
  t.insert({ calendario_id: cal.id, tipo: 'feriado', nome: 'Finados', data_inicio: '2026-11-02', data_fim: '2026-11-02', todo_ano: false, ordem: 0 }).select()
)
const [eqA] = await q('equipe', (t) => t.insert({ obra_id: obraId, nome: 'Equipe A', tipo: 'Pavimentação', cor: '#3b82f6', ordem: 1 }).select())
await q('equipe', (t) => t.insert({ obra_id: obraId, nome: 'Equipe B', tipo: 'Pavimentação', cor: '#10b981', ordem: 2 }).select())
const [plan] = await q('planejamento', (t) => t.insert({ obra_id: obraId, nome: 'Rev 0', data_referencia_inicio: '2026-11-02' }).select())
const tarSemVinculo = await sb.from('planejamento_tarefa').insert({ planejamento_id: plan.id, item_orcamentario_id: semVinculo.id, quantidade_alocada: 1, ordem: 9, tipo_no: 'tarefa', nivel: 1 })
check('tarefa em agrupamento sem composição é recusada', !!tarSemVinculo.error, tarSemVinculo.error?.message)
check('planejamento criado', !!plan?.id)
const [t1] = await q('planejamento_tarefa', (t) =>
  t.insert({ planejamento_id: plan.id, item_orcamentario_id: wrapper.id, quantidade_alocada: 1000, ordem: 0, tipo_no: 'tarefa', nivel: 1 }).select()
)
await rpc('planejamento_tarefa_equipes_salvar', { _tarefa_id: t1.id, _equipes: [eqA.id] })
let r = await calcular(plan.id)
const [v1] = await q('vw_planejamento_tarefa_completa', (t) =>
  t.select('id, data_inicio, data_fim, duracao_dias_uteis_calc, perfil_semanas, equipes').eq('id', t1.id)
)
console.log('tarefa 1:', { inicio: v1.data_inicio, fim: v1.data_fim, du: v1.duracao_dias_uteis_calc, perfil: v1.perfil_semanas })
check(
  '1.000 m³ a 200/dia (composição): 03/11 → 09/11 (5 d.u., feriado 02/11)',
  v1.data_inicio === '2026-11-03' && v1.data_fim === '2026-11-09' && Number(v1.duracao_dias_uteis_calc) === 5,
  `${v1.data_inicio} → ${v1.data_fim} (${v1.duracao_dias_uteis_calc})`
)
const perfil = Object.fromEntries((v1.perfil_semanas ?? []).map((p) => [p.semana_segunda, Number(p.quantidade_planejada)]))
check('perfil semanal 02/11→800, 09/11→200', Math.abs(perfil['2026-11-02'] - 800) < 1e-6 && Math.abs(perfil['2026-11-09'] - 200) < 1e-6, JSON.stringify(perfil))
check('equipe nomeada na tarefa', (v1.equipes ?? []).some((x) => x.id === eqA.id), JSON.stringify(v1.equipes))

// 2ª tarefa do mesmo serviço: 500 m³ na metade da taxa (coeficiente 0,5 → 100/dia), término-início depois da 1ª
const [t2] = await q('planejamento_tarefa', (t) =>
  t
    .insert({ planejamento_id: plan.id, item_orcamentario_id: wrapper.id, quantidade_alocada: 500, ordem: 1, tipo_no: 'tarefa', nivel: 1, nome_custom: 'Base — 2º trecho', coef_producao: 0.5 })
    .select()
)
await q('planejamento_dependencia', (t) =>
  t.insert({ planejamento_id: plan.id, predecessora_id: t1.id, sucessora_id: t2.id, tipo: 'FS', atraso_min: 0, atraso_max: null, dias_uteis: true }).select()
)
r = await calcular(plan.id)
const [v2] = await q('vw_planejamento_tarefa_completa', (t) => t.select('id, data_inicio, data_fim, duracao_dias_uteis_calc').eq('id', t2.id))
console.log('tarefa 2:', { inicio: v2.data_inicio, fim: v2.data_fim, du: v2.duracao_dias_uteis_calc })
check(
  '500 m³ a 100/dia após a 1ª: 10/11 → 16/11',
  v2.data_inicio === '2026-11-10' && v2.data_fim === '2026-11-16' && Number(v2.duracao_dias_uteis_calc) === 5,
  `${v2.data_inicio} → ${v2.data_fim}`
)
check('fim do projeto 16/11', new Date(r.fimProjeto * 1000).toISOString().slice(0, 10) === '2026-11-16', new Date(r.fimProjeto * 1000).toISOString())
const r2 = calcularPlano(await carregarPlanoEntrada(plan.id), MODELO).resultado
check('ponto fixo: recalcular a partir do banco não muda as datas', [...r.tarefas.values()].every((x) => r2.tarefas.get(x.id)?.inicio === x.inicio && r2.tarefas.get(x.id)?.fim === x.fim))
const estouro = await sb.from('planejamento_tarefa').insert({ planejamento_id: plan.id, item_orcamentario_id: wrapper.id, quantidade_alocada: 1, ordem: 2, tipo_no: 'tarefa', nivel: 1 })
check('Σ tarefas > quantidade do serviço é recusada (1.000 + 500 + 1 > 1.500)', !!estouro.error && /acima do serviço/.test(estouro.error.message), estouro.error?.message)
await q('planejamento_tarefa', (t) => t.update({ prioridade: 510 }).eq('id', t2.id).select())
const promoCedo = await sb.rpc('planejamento_promover', { _planejamento_id: plan.id, _marcar_vigente: null })
check('travar exige o cronograma calculado sobre os dados atuais', !!promoCedo.error, promoCedo.error?.message?.slice(0, 90))
await calcular(plan.id)

// ── 6. Baseline + curva-S planejada ────────────────────────────────────────
const prom = await rpc('planejamento_promover', { _planejamento_id: plan.id, _marcar_vigente: null })
check('travar como linha de base (vigente por padrão)', prom.vigente === true, JSON.stringify(prom))
const curva = await q('vw_acompanhamento_curva_s', (t) =>
  t.select('data, planejado_dia, planejado_acumulado').eq('obra_id', obraId).gte('data', '2026-11-02').lte('data', '2026-11-22').order('data')
)
const planDia = Object.fromEntries(curva.map((c) => [c.data, Number(c.planejado_dia)]))
console.log('curva-S planejado/dia:', planDia)
const soma = (de, ate) => curva.filter((c) => c.data >= de && c.data <= ate).reduce((acc, c) => acc + Number(c.planejado_dia), 0)
check(
  'curva-S pelo perfil diário: 02–08/11 = 800 · 09–15/11 = 600 · 16–22/11 = 100',
  Math.abs(soma('2026-11-02', '2026-11-08') - 800) < 0.01 &&
    Math.abs(soma('2026-11-09', '2026-11-15') - 600) < 0.01 &&
    Math.abs(soma('2026-11-16', '2026-11-22') - 100) < 0.01,
  `${soma('2026-11-02', '2026-11-08')} / ${soma('2026-11-09', '2026-11-15')} / ${soma('2026-11-16', '2026-11-22')}`
)
check('dia 02/11 (feriado) sem planejado', !planDia['2026-11-02'], String(planDia['2026-11-02']))

// ── 7. Produção nativa ─────────────────────────────────────────────────────
const [enc] = await q('encarregado', (t) => t.insert({ obra_id: obraId, nome: 'João' }).select())
const hoje = new Date()
const ontem = new Date(hoje)
ontem.setDate(hoje.getDate() - 1)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const [p1] = await q('acompanhamento_producao', (t) =>
  t
    .insert({ obra_id: obraId, data: iso(ontem), item_orcamentario_id: wrapper.id, equipe_id: eqA.id, encarregado_id: enc.id, quantidade: 180, frente: 'Km 12+300' })
    .select()
)
check('lançamento criado com snapshot do serviço', p1.servico_id === servicoId && p1.unidade === 'm³' && p1.servico_nome?.length > 0, `${p1.servico_nome} ${p1.unidade}`)
const prodSemVinculo = await sb.from('acompanhamento_producao').insert({ obra_id: obraId, data: iso(ontem), item_orcamentario_id: semVinculo.id, quantidade: 1 })
check('produção em agrupamento sem composição é recusada', !!prodSemVinculo.error, prodSemVinculo.error?.message)
const futuro = await sb.from('acompanhamento_producao').insert({ obra_id: obraId, data: '2099-01-01', item_orcamentario_id: wrapper.id, quantidade: 1 })
check('data futura é rejeitada', !!futuro.error, futuro.error?.message?.slice(0, 80))
const [pe] = await q('vw_acompanhamento_producao_enriquecida', (t) =>
  t
    .select('qtd, qtd_convertida, equipe_display_nome, encarregado_display_nome, servico_display_nome, servico_grupo_codigo, tarefa_baseline_id, fotos_count, origem')
    .eq('id', p1.id)
)
console.log('produção enriquecida:', pe)
check(
  'view enriquecida resolve equipe/encarregado/item',
  pe.equipe_display_nome === 'Equipe A' && pe.encarregado_display_nome === 'João' && pe.servico_grupo_codigo === wrapper.codigo && pe.fotos_count === 0
)
const [pr] = await q('vw_acompanhamento_previsto_x_realizado', (t) =>
  t.select('qtd_real, qtd_plan, status, codigo').eq('obra_id', obraId).eq('item_orcamentario_id', wrapper.id)
)
check('previsto × realizado: qtd_real = 180', Number(pr?.qtd_real) === 180, JSON.stringify(pr))
const dash = await fn('acompanhamento-dashboard-resumo', { obra_id: obraId, periodo_dias: 30 })
check('dashboard-resumo', dash.ok && dash.resumo?.lancamentos_total === 1, JSON.stringify({ lanc: dash.resumo?.lancamentos_total, ultimo: dash.resumo?.ultimo_lancamento_em }))
const alertas = await fn('acompanhamento-alertas-recalcular', { obra_id: obraId })
check('alertas-recalcular', alertas.ok !== false, JSON.stringify(alertas).slice(0, 160))
const fotos = await fn('acompanhamento-fotos-listar', { obra_id: obraId, filtros: { producao_id: p1.id }, page: 0, page_size: 10, with_urls: false })
check('fotos-listar (vazio)', fotos.ok && fotos.total === 0)

// ── 7b. Linha de base vigente, trava da cadeia e premissas ─────────────────
const recRec = (await q('item_orcamentario', (t) => t.select('id, quantidade').eq('obra_id', obraId).eq('codigo', '01.01')))[0]
const travado = await sb.from('item_orcamentario').update({ quantidade: 1600 }).eq('id', recRec.id)
check('com vigente, o orçamento fica travado', !!travado.error && /Orçamento travado/.test(travado.error.message), travado.error?.message)
const [diesel] = await q('recurso', (t) => t.select('id').eq('obra_id', obraId).eq('nome', 'Diesel S10'))
const precoTravado = await sb.from('recurso_preco').insert({ recurso_id: diesel.id, custo_unitario: 6.5, vigencia_inicio: '2026-10-01', is_vigente: false })
check('com vigente, preço de recurso fica travado', !!precoTravado.error, precoTravado.error?.message)

await rpc('desmarcar_vigente', { _obra_id: obraId })
const motivo1 = await rpc('cadeia_trava_motivo', { _obra_id: obraId })
check('sem vigente e sem plano em edição: continua travado', /plano em edição/.test(motivo1 ?? ''), motivo1)
const ref1 = await rpc('planejamento_referencia', { _obra_id: obraId })
check('sem vigente: a última vigente segue como referência provisória', ref1 === plan.id)

const copia = await rpc('planejamento_copiar', { _origem_id: plan.id, _nome: 'Rev 1 (edição)', _inicio: null })
const rc = await calcular(copia.novo_id)
const datasCopia = await q('planejamento_tarefa', (t) => t.select('quantidade_alocada, inicio_em, fim_em').eq('planejamento_id', copia.novo_id).eq('tipo_no', 'tarefa'))
const datasLb = await q('planejamento_tarefa', (t) => t.select('quantidade_alocada, inicio_em, fim_em').eq('planejamento_id', plan.id).eq('tipo_no', 'tarefa'))
const chaveDatas = (l) => l.map((x) => `${Number(x.quantidade_alocada)}|${x.inicio_em}|${x.fim_em}`).sort().join(';')
check('cópia calculada = linha de base (mesmas datas)', rc.tarefas.size === 2 && chaveDatas(datasCopia) === chaveDatas(datasLb), chaveDatas(datasCopia))
const motivo2 = await rpc('cadeia_trava_motivo', { _obra_id: obraId })
check('com plano em edição: cadeia editável', motivo2 === null, String(motivo2))
const dup = await sb.from('planejamento').insert({ obra_id: obraId, nome: 'Outro', data_referencia_inicio: '2026-11-02' })
check('só 1 plano em edição por obra', !!dup.error, dup.error?.message?.slice(0, 80))

const [np] = await q('recurso_preco', (t) => t.insert({ recurso_id: diesel.id, custo_unitario: 6.5, vigencia_inicio: '2026-10-01', is_vigente: false }).select())
await rpc('set_recurso_preco_vigente', { _preco_id: np.id })
const [baseViva] = await q('item_orcamentario', (t) => t.select('custo_unitario_calc').eq('id', wrapper.id))
check('preço do diesel → custo do serviço ao vivo (128,0172 → 128,3340)', Math.abs(Number(baseViva.custo_unitario_calc) - 128.334) < 0.0001, String(baseViva.custo_unitario_calc))
const [lbT1] = await q('vw_planejamento_tarefa_completa', (t) => t.select('custo_unit_snapshot').eq('id', t1.id))
const [edT1] = await q('vw_planejamento_tarefa_completa', (t) => t.select('custo_unit_snapshot').eq('planejamento_id', copia.novo_id).eq('quantidade_alocada', 1000))
check(
  'linha de base mantém a premissa (128,0172); plano em edição acompanha (128,3340)',
  Math.abs(Number(lbT1.custo_unit_snapshot) - 128.0172) < 0.0001 && Math.abs(Number(edT1.custo_unit_snapshot) - 128.334) < 0.0001,
  `${lbT1.custo_unit_snapshot} / ${edT1.custo_unit_snapshot}`
)
const [edPlan] = await q('planejamento', (t) => t.select('recalculo_pendente').eq('id', copia.novo_id))
check('plano em edição marcado para recalcular o cronograma', edPlan.recalculo_pendente === true)
const diff = await rpc('lb_premissas_diff', { _planejamento_id: plan.id })
check('premissas da LB mudaram (custo unitário)', diff.mudou && diff.itens.some((i) => i.custo_unit), JSON.stringify(diff.itens?.[0]))
const vigErr = await sb.rpc('marcar_vigente', { _planejamento_id: plan.id })
check('LB com premissas mudadas não volta a ser vigente', !!vigErr.error && /premissas/.test(vigErr.error.message), vigErr.error?.message)

let restErr = null
try {
  await restaurar(plan.id, 'Rev 0 restaurada', null)
} catch (e) {
  restErr = e.message
}
check('restaurar exige não haver plano em edição', /plano em edição/.test(restErr ?? ''), restErr?.slice(0, 120))
await q('planejamento', (t) => t.delete().eq('id', copia.novo_id).select())
const rest = await restaurar(plan.id, 'Rev 0 restaurada', true)
const diffNova = await rpc('lb_premissas_diff', { _planejamento_id: rest.novo_id })
const diffVelha = await rpc('lb_premissas_diff', { _planejamento_id: plan.id })
const lbs = await q('planejamento', (t) => t.select('id, vigente').eq('obra_id', obraId).eq('is_baseline', true))
check(
  'restaurar como nova LB: nova vigente em dia, antiga intacta',
  rest.vigente && !diffNova.mudou && diffVelha.mudou && lbs.length === 2 && lbs.find((l) => l.vigente)?.id === rest.novo_id,
  JSON.stringify({ nova: diffNova.mudou, velha: diffVelha.mudou, lbs: lbs.length })
)
const delVig = await sb.from('planejamento').delete().eq('id', rest.novo_id)
check('linha de base vigente não pode ser excluída', !!delVig.error, delVig.error?.message?.slice(0, 80))

// ── 7c. Aditivo com plano vigente: Planilha Inicial, supressão × executado ──
const [vendaAntesAd] = await q('vw_orcamento_consolidado', (t) => t.select('venda_total').eq('obra_id', obraId))
const [ad1] = await q('orcamento_aditivo', (t) => t.insert({ obra_id: obraId, data: '2026-12-01', descricao: 'E2E aditivo 1' }).select())
const recBase = (await q('item_orcamentario', (t) => t.select('id, quantidade').eq('obra_id', obraId).eq('codigo', '01.01')))[0]
await q('orcamento_aditivo_item', (t) =>
  t
    .insert([
      { aditivo_id: ad1.id, obra_id: obraId, ordem: 0, tipo: 'quantidade', receita_id: recBase.id, codigo: '01.01', quantidade_nova: 1800 },
      {
        aditivo_id: ad1.id, obra_id: obraId, ordem: 1, tipo: 'novo', codigo: '01.03', descricao: 'Transporte adicional de brita',
        unidade: 'tkm', quantidade_nova: 1000, venda_unitaria: 2,
        alocacao: { criterio: 'percentual', compoe: false, destinos: [{ grupo_id: wrapper.id, valor: 100 }] }
      },
      { aditivo_id: ad1.id, obra_id: obraId, ordem: 2, tipo: 'novo', codigo: '02.07', descricao: 'Item novo em saldo', unidade: 'un', quantidade_nova: 2, venda_unitaria: 300 }
    ])
    .select()
)
const apl = await rpc('aplicar_aditivo', { _aditivo_id: ad1.id })
check(
  'aditivo aplicado com plano vigente: Δ venda = 300×187,50 + 1.000×2 + 2×300 = 58.850',
  apl.ok && Math.abs(apl.venda_depois - apl.venda_antes - 58850) < 0.01 && Math.abs(apl.venda_antes - Number(vendaAntesAd.venda_total)) < 0.01,
  JSON.stringify(apl)
)
const [ini] = await q('orcamento_planilha_inicial', (t) => t.select('snapshot').eq('obra_id', obraId))
const iniBase = ini?.snapshot?.itens?.find((i) => i.codigo === '01.01')
check('Planilha Inicial arquivada com a quantidade original (1.500)', Number(iniBase?.quantidade) === 1500, String(iniBase?.quantidade))
const [baseAd] = await q('item_orcamentario', (t) => t.select('quantidade_referencia, venda_total_calc').eq('id', wrapper.id))
check(
  'serviço Base: qtd 1.800 (compõe) e venda 1.800×187,50 + 1.000×2 = 339.500',
  Number(baseAd.quantidade_referencia) === 1800 && Math.abs(Number(baseAd.venda_total_calc) - 339500) < 0.01,
  JSON.stringify(baseAd)
)
const novoSaldo = (await q('item_orcamentario', (t) => t.select('id, aditivo_id').eq('obra_id', obraId).eq('codigo', '02.07')))[0]
check('item novo nasce com aditivo_id', novoSaldo?.aditivo_id === ad1.id)
await rpc('alocar_receitas', { _grupo_id: wrapper.id, _receita_ids: [novoSaldo.id] })
const nAlocNovo = (await q('item_orc_alocacao', (t) => t.select('id').eq('receita_id', novoSaldo.id))).length
check('com vigente, receita de aditivo pode ser agrupada', nAlocNovo === 1)
const recOutra = (await q('item_orcamentario', (t) => t.select('id').eq('obra_id', obraId).eq('codigo', '02.06')))[0]
const alocTravada = await sb.rpc('alocar_receitas', { _grupo_id: wrapper.id, _receita_ids: [recOutra.id] })
check('com vigente, receita original continua travada', !!alocTravada.error, alocTravada.error?.message?.slice(0, 90))
const diffAd = await rpc('lb_premissas_diff', { _planejamento_id: rest.novo_id })
check('LB vigente acusa premissas mudadas pelo aditivo (quantidade)', diffAd.mudou && diffAd.itens.some((i) => i.quantidade), JSON.stringify(diffAd.itens?.[0]?.quantidade))

const [ad2] = await q('orcamento_aditivo', (t) => t.insert({ obra_id: obraId, data: '2026-12-15', descricao: 'E2E supressão' }).select())
await q('orcamento_aditivo_item', (t) =>
  t.insert({ aditivo_id: ad2.id, obra_id: obraId, tipo: 'quantidade', receita_id: recBase.id, codigo: '01.01', quantidade_nova: 100 }).select()
)
const sup = await sb.rpc('aplicar_aditivo', { _aditivo_id: ad2.id })
check('supressão abaixo do executado é recusada (100 < 180)', !!sup.error && /abaixo do executado/.test(sup.error.message), sup.error?.message)

await rpc('desmarcar_vigente', { _obra_id: obraId })
const copia2 = await rpc('planejamento_copiar', { _origem_id: rest.novo_id, _nome: 'Rev 2 (edição)', _inicio: null })
const direta = await sb.from('item_orcamentario').update({ quantidade: 1900 }).eq('id', recBase.id)
check('depois do 1º aditivo, a planilha de venda não aceita edição direta', !!direta.error && /só muda por aditivo/.test(direta.error.message), direta.error?.message)
await q('planejamento', (t) => t.delete().eq('id', copia2.novo_id).select())

// ── 7d. Reajuste anual por grupos (prospectivo) ────────────────────────────
const [rj1] = await q('orcamento_reajuste', (t) => t.insert({ obra_id: obraId, data: '2026-12-01', descricao: 'E2E reajuste 1' }).select())
const [gr1] = await q('orcamento_reajuste_grupo', (t) => t.insert({ reajuste_id: rj1.id, obra_id: obraId, nome: 'Pavimentação', indice_anterior: 100, indice_atual: 110 }).select())
await q('orcamento_reajuste_item', (t) => t.insert({ reajuste_id: rj1.id, obra_id: obraId, receita_id: recBase.id, grupo_id: gr1.id }).select())
const semBase = await sb.rpc('aplicar_reajuste', { _reajuste_id: rj1.id })
check('reajuste exige data-base do orçamento', !!semBase.error && /data-base/.test(semBase.error.message), semBase.error?.message)
await rpc('definir_data_base', { _obra_id: obraId, _data: '2026-01-15' })
const cedo = await sb.rpc('aplicar_reajuste', { _reajuste_id: rj1.id })
check('1º reajuste só 12 meses após a data-base', !!cedo.error && /12 meses/.test(cedo.error.message), cedo.error?.message)
await q('orcamento_reajuste', (t) => t.update({ data: '2027-01-15' }).eq('id', rj1.id).select())
const rjOk = await rpc('aplicar_reajuste', { _reajuste_id: rj1.id })
check(
  'reajuste de 10% em 01.01: Δ venda = 1.800 × 18,75 = 33.750 (mesmo com vigente/aditivo)',
  rjOk.ok && Math.abs(rjOk.venda_depois - rjOk.venda_antes - 33750) < 0.01,
  JSON.stringify(rjOk)
)
const precoAntes = await rpc('receita_preco_em', { _receita_id: recBase.id, _data: '2027-01-14' })
const precoDepois = await rpc('receita_preco_em', { _receita_id: recBase.id, _data: '2027-01-15' })
check('preço por data: 187,50 até 14/01/2027 e 206,25 a partir de 15/01/2027', Number(precoAntes) === 187.5 && Number(precoDepois) === 206.25, `${precoAntes} / ${precoDepois}`)
const [rj2] = await q('orcamento_reajuste', (t) => t.insert({ obra_id: obraId, data: '2027-06-01' }).select())
const [gr2] = await q('orcamento_reajuste_grupo', (t) => t.insert({ reajuste_id: rj2.id, obra_id: obraId, nome: 'Pavimentação', indice_anterior: 110, indice_atual: 115 }).select())
await q('orcamento_reajuste_item', (t) => t.insert({ reajuste_id: rj2.id, obra_id: obraId, receita_id: recBase.id, grupo_id: gr2.id }).select())
const intervalo = await sb.rpc('aplicar_reajuste', { _reajuste_id: rj2.id })
check('2º reajuste só 12 meses após o 1º', !!intervalo.error && /12 meses do anterior/.test(intervalo.error.message), intervalo.error?.message)
const baseFixa = await sb.rpc('definir_data_base', { _obra_id: obraId, _data: '2026-02-01' })
check('data-base não muda depois de reajuste aplicado', !!baseFixa.error)

// ── 8. Rateio por peso na importação (obra sem planejamento) ───────────────
const obraRev = await fn('create-obra', { empresa_id: empresa.id, nome: `Obra rateio ${STAMP}`, codigo: `RAT-${STAMP}` })
await fn('import-orcamento', {
  obra_id: obraRev.id,
  itens: [
    { row: 2, codigo: '01', descricao: 'REVESTIMENTO' },
    { row: 3, codigo: '01.01', descricao: 'Imprimação', unidade: 'm²', quantidade: 1000, venda_unitaria: 10 },
    { row: 4, codigo: '01.02', descricao: 'Pintura', unidade: 'm²', quantidade: 2000, venda_unitaria: 5 },
    { row: 5, codigo: '01.03', descricao: 'Transp. betuminoso', unidade: 'tkm', quantidade: 1000, venda_unitaria: 2 }
  ],
  alocacoes: [
    { row: 3, codigo: '01.01', criterio: 'percentual', compoe: true, destinos: [{ servico: 'Imprimação', valor: 100 }] },
    { row: 4, codigo: '01.02', criterio: 'percentual', compoe: true, destinos: [{ servico: 'Pintura', valor: 100 }] },
    { row: 5, codigo: '01.03', criterio: 'peso', compoe: false, destinos: [{ servico: 'Imprimação', valor: 3 }, { servico: 'Pintura', valor: 1 }] }
  ],
  opcoes: {}
})
const vendaServ = async () =>
  Object.fromEntries(
    (await q('item_orcamentario', (t) => t.select('descricao, venda_total_calc').eq('obra_id', obraRev.id).eq('tipo', 'servico_grupo'))).map((g) => [g.descricao, Number(g.venda_total_calc)])
  )
const vendas = await vendaServ()
const nAloc = (await q('item_orc_alocacao', (t) => t.select('id').eq('obra_id', obraRev.id))).length
check(
  'rateio por peso 3:1 do transporte (Imprimação 11.500 · Pintura 10.500)',
  nAloc === 4 && vendas['Imprimação'] === 11500 && vendas['Pintura'] === 10500,
  JSON.stringify({ vendas, nAloc })
)
const semTabela = await sb.from('revisao_orcamento').select('id').limit(1)
check('módulo antigo de revisões do orçamento removido', !!semTabela.error, semTabela.error?.message)

// ── 9. Trecho e quantidades por local (obra própria) ───────────────────────
const obraTr = await fn('create-obra', { empresa_id: empresa.id, nome: `Obra trecho ${STAMP}`, codigo: `TR-${STAMP}` })
await rpc('importar_recursos', { _obra_id: obraTr.id, _linhas: [
  { row: 2, grupo: 'MO', codigo: 'MO-01', nome: 'Servente', unidade: 'h', preco: 12.5 },
  { row: 3, grupo: 'MVE', codigo: 'EQ-01', nome: 'Rolo pé de carneiro', unidade: 'h', preco: 95 },
  { row: 4, grupo: 'COMBUSTIVEL', codigo: 'CB-01', nome: 'Diesel S10', unidade: 'L', preco: 6.2 }
], _opcoes: {} })
const compTr = await rpc('importar_composicoes', { _obra_id: obraTr.id, _composicoes: [
  { row: 2, codigo: '01', nome: 'PAVIMENTAÇÃO' },
  { row: 3, codigo: '01.01', nome: 'Base', unidade: 'm³', producao_qtde: 100, itens: [
    { row: 2, grupo: 'EQUIPAMENTO', recurso_ref: 'EQ-01', quantidade: 1, horas_dia: 8, consumo_combustivel_lh: 12, indice_produtividade: 1 },
    { row: 3, grupo: 'MO', recurso_ref: 'MO-01', quantidade: 2, horas_dia: 8 },
    { row: 4, grupo: 'COMBUSTIVEL', recurso_ref: 'CB-01' }
  ] }
], _opcoes: { modo_existente: 'erro' } })
await fn('import-orcamento', { obra_id: obraTr.id, itens: [
  { row: 2, codigo: '01', descricao: 'PAVIMENTAÇÃO' },
  { row: 3, codigo: '01.01', descricao: 'Base', unidade: 'm³', quantidade: 1500, venda_unitaria: 150 }
], alocacoes: [{ row: 3, codigo: '01.01', criterio: 'percentual', compoe: true, destinos: [{ servico: 'Base', valor: 100 }] }], opcoes: {} })
const [svTr] = await q('item_orcamentario', (t) => t.select('id').eq('obra_id', obraTr.id).eq('tipo', 'servico_grupo'))
await q('item_orcamentario', (t) => t.update({ servico_id: compTr.resultados[0].servico_id }).eq('id', svTr.id).select())
const [tr] = await q('obra_trecho', (t) => t.insert({ obra_id: obraTr.id, nome: 'Eixo principal', unidade_espaco_padrao: 'km', comprimento_m: 2000 }).select())
const segs = (a, b) => [
  { ini: 0, fim: 1000, label_ini: 'km 0', label_fim: 'km 1', valores: { [svTr.id]: a } },
  { ini: 1000, fim: 2000, label_ini: 'km 1', label_fim: 'km 2', valores: { [svTr.id]: b } }
]
const trAcima = await sb.rpc('trecho_salvar_quantidades', { _trecho_id: tr.id, _dados: { modo: 'analitico', servicos: [svTr.id], segmentos: segs(800, 900) } })
check('trecho acima do orçamento é recusado (800 + 900 > 1.500)', !!trAcima.error && /acima do orçamento/.test(trAcima.error.message), trAcima.error?.message)
const salvo = await rpc('trecho_salvar_quantidades', { _trecho_id: tr.id, _dados: { modo: 'analitico', servicos: [svTr.id], segmentos: segs(600, 900) } })
check('template do trecho salvo (2 faixas, 2 valores)', salvo.ok && salvo.segmentos === 2 && salvo.celulas === 2, JSON.stringify(salvo))
const [planTr] = await q('planejamento', (t) => t.insert({ obra_id: obraTr.id, nome: 'Rev 0', data_referencia_inicio: '2026-11-02' }).select())
const [tt] = await q('planejamento_tarefa', (t) =>
  t.insert({ planejamento_id: planTr.id, item_orcamentario_id: svTr.id, quantidade_alocada: 1, ordem: 0, tipo_no: 'tarefa', nivel: 1 }).select()
)
await rpc('planejamento_tarefa_locais_salvar', { _tarefa_id: tt.id, _locais: [{ trecho_id: tr.id, inicio_m: 500, fim_m: 1500, qtd_origem: 'trecho' }] })
const qtdTarefa = async () => Number((await q('planejamento_tarefa', (t) => t.select('quantidade_alocada').eq('id', tt.id)))[0].quantidade_alocada)
const local = async () => (await q('planejamento_tarefa_local', (t) => t.select('id, quantidade, qtd_origem').eq('tarefa_id', tt.id)))[0]
let lc = await local()
check(
  'local da tarefa "do trecho": faixa km 0,5 → 1,5 = 300 + 450 = 750 m³ (a tarefa soma os locais)',
  Number(lc.quantidade) === 750 && lc.qtd_origem === 'trecho' && (await qtdTarefa()) === 750,
  JSON.stringify(lc)
)
const rTr = await calcular(planTr.id)
const wpsTr = rTr.tarefas.get(tt.id)?.wps ?? []
check(
  'cronograma: um trecho de tarefa por faixa do template (km 0,5–1 = 300; km 1–1,5 = 450)',
  wpsTr.length === 2 && Math.abs(wpsTr[0].quantidade - 300) < 1e-6 && Math.abs(wpsTr[1].quantidade - 450) < 1e-6,
  JSON.stringify(wpsTr.map((w) => [w.inicio_m, w.fim_m, w.quantidade]))
)
await rpc('trecho_salvar_quantidades', { _trecho_id: tr.id, _dados: { modo: 'analitico', servicos: [svTr.id], segmentos: segs(400, 900), nova_versao: true, comentario: 'rev 2' } })
lc = await local()
check('nova versão do template recalcula o local vinculado (200 + 450 = 650)', Number(lc.quantidade) === 650 && (await qtdTarefa()) === 650, JSON.stringify(lc))
const [planTrRev] = await q('planejamento', (t) => t.select('calculo_rev, dados_rev, recalculo_pendente').eq('id', planTr.id))
check('mudança do template pede novo cálculo do cronograma', planTrRev.calculo_rev !== planTrRev.dados_rev || planTrRev.recalculo_pendente === true, JSON.stringify(planTrRev))
// supressão no orçamento abaixo do trecho → "do trecho" indisponível, o local volta para manual
await q('item_orcamentario', (t) => t.update({ quantidade: 1000 }).eq('obra_id', obraTr.id).eq('codigo', '01.01').select())
lc = await local()
const disp = await rpc('trecho_servico_disponivel', { _trecho_id: tr.id, _item_id: svTr.id })
check(
  'orçamento abaixo do trecho (1.000 < 1.300): o local volta para manual e o trecho fica indisponível',
  lc.qtd_origem === 'manual' && disp === false && Number(lc.quantidade) === 650,
  JSON.stringify({ lc, disp })
)
const relink = await sb.from('planejamento_tarefa_local').update({ qtd_origem: 'trecho' }).eq('id', lc.id)
check('com o trecho acima do orçamento, "do trecho" é recusado', !!relink.error && /indisponível/.test(relink.error.message), relink.error?.message?.slice(0, 90))

// ── 9b. Eixos sem mapa, áreas e as operações do ApeX sobre os locais (migração 0031) ────────────────────────
{ // escopo próprio: nomes locais não colidem com as seções anteriores
// orçamento de volta a 1.500: o template (1.300) volta a caber e "do template" fica disponível
await q('item_orcamentario', (t) => t.update({ quantidade: 1500 }).eq('obra_id', obraTr.id).eq('codigo', '01.01').select())
const semComp = await sb.from('obra_trecho').insert({ obra_id: obraTr.id, nome: 'Eixo sem comprimento', unidade_espaco_padrao: 'km' })
check('eixo sem comprimento é recusado', !!semComp.error && /comprimento/i.test(semComp.error.message), semComp.error?.message?.slice(0, 90))
const [eixo2] = await q('obra_trecho', (t) => t.insert({ obra_id: obraTr.id, nome: 'Acesso', unidade_espaco_padrao: 'm', comprimento_m: 800 }).select())
const [area1] = await q('obra_trecho', (t) => t.insert({ obra_id: obraTr.id, nome: 'OAE Córrego', tipo: 'area' }).select())
check('eixo sem KML e área criados', eixo2.tipo === 'eixo' && Number(eixo2.comprimento_m) === 800 && area1.tipo === 'area' && area1.comprimento_m === null, JSON.stringify({ eixo2: eixo2.comprimento_m, area1: area1.comprimento_m }))

// gravar locais: upsert por id; "do template" indisponível é ERRO (não degrada mais em silêncio)
const r1 = await rpc('planejamento_tarefa_locais_salvar', { _tarefa_id: tt.id, _locais: [{ id: lc.id, trecho_id: tr.id, inicio_m: 500, fim_m: 1500, qtd_origem: 'trecho' }] })
lc = await local()
check('local volta a "do template" com o mesmo id: 500–1500 = 200 + 450 = 650', r1.ids[0] === lc.id && lc.qtd_origem === 'trecho' && Number(lc.quantidade) === 650, JSON.stringify({ r1, lc }))
const semTpl = await sb.rpc('planejamento_tarefa_locais_salvar', { _tarefa_id: tt.id, _locais: [{ id: lc.id, trecho_id: eixo2.id, inicio_m: 0, fim_m: 800, qtd_origem: 'trecho' }] })
check('"do template" num eixo sem template é erro (a quantidade não zera em silêncio)', !!semTpl.error && /indisponível/.test(semTpl.error.message), semTpl.error?.message?.slice(0, 110))
check('depois do erro o local continua como estava', Number((await local()).quantidade) === 650)
const foraEixo = await sb.rpc('planejamento_tarefa_locais_salvar', { _tarefa_id: tt.id, _locais: [{ id: lc.id, trecho_id: tr.id, inicio_m: 500, fim_m: 2500, qtd_origem: 'trecho' }] })
check('local além do fim do eixo é recusado', !!foraEixo.error && /fora do trecho/.test(foraEixo.error.message), foraEixo.error?.message?.slice(0, 110))

// encurtar o eixo: recusado abaixo do que está em uso (o template vai até 2.000 m)
const encEixo = await sb.from('obra_trecho').update({ comprimento_m: 1900 }).eq('id', tr.id)
check('encurtar o eixo abaixo das quantidades por estaca é recusado', !!encEixo.error && /quantidades por estaca/.test(encEixo.error.message), encEixo.error?.message?.slice(0, 120))
const t2 = await rpc('planejamento_tarefa_criar', { _planejamento_id: planTr.id, _campos: { item_orcamentario_id: svTr.id, nome_custom: 'Base acesso' }, _locais: [{ trecho_id: eixo2.id, inicio_m: 0, fim_m: 800, quantidade: 150, qtd_origem: 'manual' }] })
check('planejamento_tarefa_criar: tarefa + local numa transação', typeof t2 === 'string' && Number((await q('planejamento_tarefa', (t) => t.select('quantidade_alocada').eq('id', t2)))[0].quantidade_alocada) === 150)
const encLocal = await sb.from('obra_trecho').update({ comprimento_m: 500 }).eq('id', eixo2.id)
check('encurtar o eixo abaixo de um local de tarefa é recusado', !!encLocal.error && /locais de tarefa/.test(encLocal.error.message), encLocal.error?.message?.slice(0, 120))
await q('obra_trecho', (t) => t.update({ comprimento_m: 900 }).eq('id', eixo2.id).select())
check('alongar o eixo é aceito', Number((await q('obra_trecho', (t) => t.select('comprimento_m').eq('id', eixo2.id)))[0].comprimento_m) === 900)
await q('planejamento_dependencia', (t) => t.insert({ planejamento_id: planTr.id, predecessora_id: tt.id, sucessora_id: t2, tipo: 'FS', atraso_min: 0, dias_uteis: true }).select())

// dividir por estaca: 500–1500 "do template" cortado em 1.000 → 200 e 450
const fora = await sb.rpc('planejamento_tarefa_dividir_estaca', { _tarefa_id: tt.id, _trecho_id: tr.id, _estaca_m: 100 })
check('dividir fora da faixa da tarefa é recusado', !!fora.error && /fora da faixa/.test(fora.error.message), fora.error?.message?.slice(0, 100))
const clone = await rpc('planejamento_tarefa_dividir_estaca', { _tarefa_id: tt.id, _trecho_id: tr.id, _estaca_m: 1000 })
const locTt = await q('planejamento_tarefa_local', (t) => t.select('inicio_m, fim_m, quantidade, qtd_origem').eq('tarefa_id', tt.id))
const locCl = await q('planejamento_tarefa_local', (t) => t.select('inicio_m, fim_m, quantidade, qtd_origem').eq('tarefa_id', clone))
const [ttRow] = await q('planejamento_tarefa', (t) => t.select('ordem').eq('id', tt.id))
const [clRow] = await q('planejamento_tarefa', (t) => t.select('ordem, prioridade').eq('id', clone))
const depsCl = await q('planejamento_dependencia', (t) => t.select('sucessora_id').eq('predecessora_id', clone))
check(
  'dividir por estaca: 500–1000 = 200 fica; 1000–1500 = 450 vai para a cópia logo abaixo, com a dependência clonada',
  locTt.length === 1 && Number(locTt[0].inicio_m) === 500 && Number(locTt[0].fim_m) === 1000 && Number(locTt[0].quantidade) === 200 && locTt[0].qtd_origem === 'trecho' &&
    locCl.length === 1 && Number(locCl[0].inicio_m) === 1000 && Number(locCl[0].fim_m) === 1500 && Number(locCl[0].quantidade) === 450 && locCl[0].qtd_origem === 'trecho' &&
    clRow.ordem === ttRow.ordem + 1 && depsCl.some((d) => d.sucessora_id === t2),
  JSON.stringify({ locTt, locCl, ttRow, clRow, depsCl })
)

// dividir por quantidade: só locais manuais, mesmas estacas
const [locT2] = await q('planejamento_tarefa_local', (t) => t.select('id').eq('tarefa_id', t2))
const tplQtd = await sb.rpc('planejamento_tarefa_dividir_quantidade', { _tarefa_id: clone, _partes: [{ local_id: locCl[0] ? (await q('planejamento_tarefa_local', (t) => t.select('id').eq('tarefa_id', clone)))[0].id : null, quantidade: 100 }] })
check('local "do template" não se divide por quantidade', !!tplQtd.error && /por estaca/.test(tplQtd.error.message), tplQtd.error?.message?.slice(0, 90))
const t2b = await rpc('planejamento_tarefa_dividir_quantidade', { _tarefa_id: t2, _partes: [{ local_id: locT2.id, quantidade: 50 }] })
const q2 = Number((await q('planejamento_tarefa', (t) => t.select('quantidade_alocada').eq('id', t2)))[0].quantidade_alocada)
const q2b = Number((await q('planejamento_tarefa', (t) => t.select('quantidade_alocada').eq('id', t2b)))[0].quantidade_alocada)
check('dividir por quantidade: 150 → 100 + 50 nas mesmas estacas', q2 === 100 && q2b === 50, `${q2} / ${q2b}`)

// combinar: as duas metades voltam a ser uma tarefa 500–1500 "do template"
const difer = await sb.rpc('planejamento_tarefas_combinar', { _ids: [tt.id, t2] })
check('combinar tarefas em trechos diferentes é recusado', !!difer.error && /mesmos trechos/.test(difer.error.message), difer.error?.message?.slice(0, 80))
const kept = await rpc('planejamento_tarefas_combinar', { _ids: [tt.id, clone] })
const locK = await q('planejamento_tarefa_local', (t) => t.select('inicio_m, fim_m, quantidade, qtd_origem').eq('tarefa_id', kept))
const cloneResta = await q('planejamento_tarefa', (t) => t.select('id').eq('id', clone))
check(
  'combinar: fica a primeira, faixa 500–1500 fundida "do template" = 650, a absorvida some',
  kept === tt.id && locK.length === 1 && Number(locK[0].inicio_m) === 500 && Number(locK[0].fim_m) === 1500 && Number(locK[0].quantidade) === 650 && locK[0].qtd_origem === 'trecho' && cloneResta.length === 0,
  JSON.stringify({ kept, locK })
)

// criar das quantidades: o que ainda não está coberto (0–500 e 1500–2000), em janelas de 1 km
const criadas = await rpc('planejamento_tarefas_criar_das_quantidades', { _planejamento_id: planTr.id, _parent_id: null, _trechos: [tr.id], _itens: [svTr.id], _opcoes: { modo: 'janela', janela_m: 1000 } })
const locNovas = await q('planejamento_tarefa_local', (t) => t.select('tarefa_id, inicio_m, fim_m, quantidade, qtd_origem').in('tarefa_id', criadas).order('inicio_m'))
check(
  'criar das quantidades (janela 1 km): 0–500 = 200 e 1500–2000 = 450, "do template"',
  criadas.length === 2 && locNovas.length === 2 && Number(locNovas[0].inicio_m) === 0 && Number(locNovas[0].fim_m) === 500 && Number(locNovas[0].quantidade) === 200 &&
    Number(locNovas[1].inicio_m) === 1500 && Number(locNovas[1].fim_m) === 2000 && Number(locNovas[1].quantidade) === 450 && locNovas.every((l) => l.qtd_origem === 'trecho'),
  JSON.stringify({ criadas, locNovas })
)
const denovo = await rpc('planejamento_tarefas_criar_das_quantidades', { _planejamento_id: planTr.id, _parent_id: null, _trechos: [tr.id], _itens: [svTr.id], _opcoes: {} })
check('criar das quantidades de novo não cria nada (tudo coberto)', denovo.length === 0, JSON.stringify(denovo))

// renomear automaticamente: "Base Eixo principal 1/2/3" em ordem de estaca
const nRen = await rpc('planejamento_tarefas_renomear_auto', { _planejamento_id: planTr.id })
const nomes = await q('planejamento_tarefa', (t) => t.select('id, nome_custom').in('id', [tt.id, ...criadas]))
const nomeDe = (id) => nomes.find((x) => x.id === id)?.nome_custom
const [tarefa0, tarefa1] = Number(locNovas[0].inicio_m) === 0 ? [locNovas[0].tarefa_id, locNovas[1].tarefa_id] : [locNovas[1].tarefa_id, locNovas[0].tarefa_id]
check(
  'renomear: 0–500 → "Base Eixo principal 1", 500–1500 → 2, 1500–2000 → 3',
  nRen >= 2 && nomeDe(tarefa0) === 'Base Eixo principal 1' && nomeDe(tt.id) === 'Base Eixo principal 2' && nomeDe(tarefa1) === 'Base Eixo principal 3',
  JSON.stringify({ nRen, nomes })
)

// mudar de trecho: cabe → mesmas estacas (sem template → manual com aviso); para área → um local sem estacas
const mud = await rpc('planejamento_tarefa_mudar_trecho', { _tarefa_id: tarefa0, _trecho_id: eixo2.id })
const [locMud] = await q('planejamento_tarefa_local', (t) => t.select('trecho_id, inicio_m, fim_m, quantidade, qtd_origem').eq('tarefa_id', tarefa0))
check('mudar para eixo de 900 m: faixa 0–500 mantida, vira manual (200) com aviso', locMud.trecho_id === eixo2.id && Number(locMud.inicio_m) === 0 && Number(locMud.fim_m) === 500 && Number(locMud.quantidade) === 200 && locMud.qtd_origem === 'manual' && mud.avisos.length === 1, JSON.stringify({ mud, locMud }))
await rpc('planejamento_tarefa_mudar_trecho', { _tarefa_id: tarefa0, _trecho_id: area1.id })
const [locArea] = await q('planejamento_tarefa_local', (t) => t.select('trecho_id, inicio_m, fim_m, quantidade').eq('tarefa_id', tarefa0))
check('mudar para área: um local sem estacas com a quantidade', locArea.trecho_id === area1.id && locArea.inicio_m === null && Number(locArea.quantidade) === 200, JSON.stringify(locArea))
const rArea = await calcular(planTr.id)
const wpArea = (await q('planejamento_tarefa_wp', (t) => t.select('trecho_id, inicio_m, fim_m, quantidade').eq('tarefa_id', tarefa0)))[0]
check('cálculo com tarefa em área: work place da área gravado sem estacas', rArea.tarefas.has(tarefa0) && wpArea?.trecho_id === area1.id && wpArea.inicio_m === null && Number(wpArea.quantidade) === 200, JSON.stringify(wpArea))

// produção lançada com local e faixa (controle por estaca)
const prodFora = await sb.from('acompanhamento_producao').insert({ obra_id: obraTr.id, data: iso(ontem), item_orcamentario_id: svTr.id, quantidade: 10, trecho_id: tr.id, posicao_inicio_m: 1800, posicao_fim_m: 2500 })
check('produção com faixa fora do eixo é recusada', !!prodFora.error && /fora do trecho/.test(prodFora.error.message), prodFora.error?.message?.slice(0, 80))
const [prodOk] = await q('acompanhamento_producao', (t) => t.insert({ obra_id: obraTr.id, data: iso(ontem), item_orcamentario_id: svTr.id, quantidade: 10, trecho_id: tr.id, posicao_inicio_m: 700, posicao_fim_m: 600 }).select())
check('produção com local e faixa (invertida é normalizada)', Number(prodOk.posicao_inicio_m) === 600 && Number(prodOk.posicao_fim_m) === 700, JSON.stringify([prodOk.posicao_inicio_m, prodOk.posicao_fim_m]))
}

// ── 10. Parametrização dos serviços, viagens e o app de campo (migração 0034) ──────────────────────────────────
const obraCampo = await fn('create-obra', { empresa_id: empresa.id, nome: `Obra campo ${STAMP}`, codigo: `CP-${STAMP}` })
{
await rpc('importar_recursos', { _obra_id: obraCampo.id, _linhas: [
  { row: 2, grupo: 'MO', codigo: 'MO-01', nome: 'Servente', unidade: 'h', preco: 12.5 },
  { row: 3, grupo: 'MVE', codigo: 'EQ-01', nome: 'Caminhão basculante', unidade: 'h', preco: 120 },
  { row: 4, grupo: 'MATERIAL', codigo: 'MT-01', nome: 'Brita graduada', unidade: 'm³', preco: 85 },
  { row: 5, grupo: 'MATERIAL', codigo: 'MT-02', nome: 'Solo de jazida', unidade: 'm³', preco: 10 }
], _opcoes: {} })
const compCp = await rpc('importar_composicoes', { _obra_id: obraCampo.id, _composicoes: [
  { row: 2, codigo: '01', nome: 'TERRAPLENAGEM E PAVIMENTO' },
  { row: 3, codigo: '01.01', nome: 'Base', unidade: 'm³', producao_qtde: 100, itens: [
    { row: 2, grupo: 'MO', recurso_ref: 'MO-01', quantidade: 2, horas_dia: 8 },
    { row: 3, grupo: 'MATERIAL', recurso_ref: 'MT-01', consumo_material_por_unid: 1.2 }
  ] },
  { row: 4, codigo: '01.02', nome: 'Aterro', unidade: 'm³', producao_qtde: 400, itens: [
    { row: 2, grupo: 'EQUIPAMENTO', recurso_ref: 'EQ-01', quantidade: 3, horas_dia: 8 },
    { row: 3, grupo: 'MATERIAL', recurso_ref: 'MT-02', consumo_material_por_unid: 1 }
  ] }
], _opcoes: { modo_existente: 'erro' } })
await fn('import-orcamento', { obra_id: obraCampo.id, itens: [
  { row: 2, codigo: '01', descricao: 'TERRAPLENAGEM E PAVIMENTO' },
  { row: 3, codigo: '01.01', descricao: 'Base', unidade: 'm³', quantidade: 1000, venda_unitaria: 150 },
  { row: 4, codigo: '01.02', descricao: 'Aterro', unidade: 'm³', quantidade: 5000, venda_unitaria: 30 }
], alocacoes: [
  { row: 3, codigo: '01.01', criterio: 'percentual', compoe: true, destinos: [{ servico: 'Base', valor: 100 }] },
  { row: 4, codigo: '01.02', criterio: 'percentual', compoe: true, destinos: [{ servico: 'Aterro', valor: 100 }] }
], opcoes: {} })
const itensCp = await q('item_orcamentario', (t) => t.select('id, descricao, servico_id').eq('obra_id', obraCampo.id).eq('tipo', 'servico_grupo').order('ordem'))
const svBase = itensCp.find((i) => /Base/.test(i.descricao))
const svAterro = itensCp.find((i) => /Aterro/.test(i.descricao))
for (const [sv, r] of [[svBase, 0], [svAterro, 1]])
  if (!sv.servico_id) await q('item_orcamentario', (t) => t.update({ servico_id: compCp.resultados[r].servico_id }).eq('id', sv.id).select())
const recsCp = await q('recurso', (t) => t.select('id, codigo').eq('obra_id', obraCampo.id))
const recId = (c) => recsCp.find((r) => r.codigo === c).id

// parametrização
const parErr = await sb.from('servico_parametro').insert({ item_orcamentario_id: svBase.id, obra_id: obraCampo.id, controla_material: true, material_recurso_id: recId('EQ-01') })
check('parametrizar material com recurso que não é material é recusado', !!parErr.error && /não é um material/.test(parErr.error.message), parErr.error?.message)
await q('servico_parametro', (t) => t.insert([
  { item_orcamentario_id: svBase.id, obra_id: obraCampo.id, controla_material: true, material_recurso_id: recId('MT-01'), exige_local: true, habilita_obs: false },
  { item_orcamentario_id: svAterro.id, obra_id: obraCampo.id, modo_lancamento: 'viagens', controla_material: true, material_recurso_id: recId('MT-02') }
], { defaultToNull: false }).select())
const [parBase] = await q('servico_parametro', (t) => t.select('material_unidade').eq('item_orcamentario_id', svBase.id))
check('unidade do material vem do recurso', parBase.material_unidade === 'm³', parBase.material_unidade)

// locais, origens/destinos, rota e frota
const [pista] = await q('obra_trecho', (t) => t.insert({ obra_id: obraCampo.id, nome: 'Pista', unidade_espaco_padrao: 'm', comprimento_m: 3000 }).select())
const [jazida, destPista] = await q('transporte_local', (t) => t.insert([
  { obra_id: obraCampo.id, nome: 'Jazida Norte', tipo: 'jazida' },
  { obra_id: obraCampo.id, nome: 'Pista', tipo: 'pista', trecho_id: pista.id }
]).select().order('nome'))
await q('transporte_rota', (t) => t.insert({ obra_id: obraCampo.id, origem_id: jazida.id, destino_id: destPista.id, dmt_km: 4.2 }).select())
const [cam] = await q('frota_veiculo', (t) => t.insert({ empresa_id: empresa.id, prefixo: `CB-${STAMP}`, placa: 'ABC1D23', tipo: 'basculante', capacidade_m3: 12 }).select())
check('frota da empresa cadastrada', !!cam.id)

// regras do lançamento manual
const manualAterro = await sb.from('acompanhamento_producao').insert({ obra_id: obraCampo.id, data: iso(ontem), item_orcamentario_id: svAterro.id, quantidade: 10 })
check('serviço de viagens recusa lançamento manual', !!manualAterro.error && /alimentado por viagens/.test(manualAterro.error.message), manualAterro.error?.message)
const semLocal = await sb.from('acompanhamento_producao').insert({ obra_id: obraCampo.id, data: iso(ontem), item_orcamentario_id: svBase.id, quantidade: 10 })
check('serviço com local obrigatório recusa lançamento sem local', !!semLocal.error && /local/.test(semLocal.error.message), semLocal.error?.message)
const [pBase] = await q('acompanhamento_producao', (t) => t.insert({ obra_id: obraCampo.id, data: iso(ontem), item_orcamentario_id: svBase.id, quantidade: 10, trecho_id: pista.id, posicao_inicio_m: 0, posicao_fim_m: 100, obs: 'não fica' }).select())
check('observação desabilitada não é gravada', pBase.obs === null)
const forjado = await sb.from('acompanhamento_producao').insert({ obra_id: obraCampo.id, data: iso(ontem), item_orcamentario_id: svBase.id, quantidade: 1, origem: 'viagens', trecho_id: pista.id, posicao_inicio_m: 0, posicao_fim_m: 1 })
check('produção "viagens" não é gravada à mão', !!forjado.error, forjado.error?.message)

// viagens → produção do dia (Σ das viagens, faixa das estacas de descarga)
const uuid = () => crypto.randomUUID()
const fichaId = uuid()
const vg = [uuid(), uuid(), uuid()]
const viagemDe = (id, estaca) => ({ id, item_orcamentario_id: svAterro.id, origem_id: jazida.id, destino_id: destPista.id, quantidade: 12, estaca_descarga_m: estaca, hora_carga: '07:30' })
const ficha = (viagens, data = iso(ontem)) => ({ id: fichaId, obra_id: obraCampo.id, data, veiculo_id: cam.id, motorista: 'Zé', viagens })
await rpc('campo_sync_ficha', { _ficha: ficha([viagemDe(vg[0], 500), viagemDe(vg[1], 800), viagemDe(vg[2], 1200)]) })
await rpc('campo_sync_ficha', { _ficha: ficha([viagemDe(vg[0], 500), viagemDe(vg[1], 800), viagemDe(vg[2], 1200)]) })
const prodViagens = async () => q('acompanhamento_producao', (t) => t.select('id, data, quantidade, trecho_id, posicao_inicio_m, posicao_fim_m, obs, origem').eq('obra_id', obraCampo.id).eq('origem', 'viagens'))
let pv = await prodViagens()
const nViagens = (await q('viagem', (t) => t.select('id, dmt_km').eq('ficha_id', fichaId)))
check('ficha reenviada não duplica (3 viagens, DMT da rota)', nViagens.length === 3 && nViagens.every((v) => Number(v.dmt_km) === 4.2), JSON.stringify(nViagens.map((v) => v.dmt_km)))
check('produção do dia = Σ viagens (36 m³) na pista, faixa 500–1200', pv.length === 1 && Number(pv[0].quantidade) === 36 && pv[0].trecho_id === pista.id && Number(pv[0].posicao_inicio_m) === 500 && Number(pv[0].posicao_fim_m) === 1200 && pv[0].obs === '3 viagens', JSON.stringify(pv))
const matV = await q('acompanhamento_producao_material', (t) => t.select('recurso_id, quantidade, unidade').eq('producao_id', pv[0].id))
check('material das viagens = quantidade (mesma unidade)', matV.length === 1 && matV[0].recurso_id === recId('MT-02') && Number(matV[0].quantidade) === 36, JSON.stringify(matV))
await rpc('campo_sync_ficha', { _ficha: ficha([viagemDe(vg[0], 500), viagemDe(vg[1], 800)]) })
pv = await prodViagens()
check('viagem removida recompõe (24 m³, faixa 500–800)', pv.length === 1 && Number(pv[0].quantidade) === 24 && Number(pv[0].posicao_fim_m) === 800, JSON.stringify(pv))
await rpc('campo_sync_ficha', { _ficha: ficha([viagemDe(vg[0], 500), viagemDe(vg[1], 800)], iso(hoje)) })
pv = await prodViagens()
check('mudar a data da ficha move a produção', pv.length === 1 && pv[0].data === iso(hoje), JSON.stringify(pv.map((p) => p.data)))
const vgQtdManual = await sb.from('acompanhamento_producao').update({ quantidade: 99 }).eq('id', pv[0].id)
check('produção das viagens não aceita quantidade à mão', !!vgQtdManual.error, vgQtdManual.error?.message)

// apontador: só o app de campo, só nas obras liberadas
const apEmail = `apontador-${STAMP}@e2e.local`
const apSenha = `Campo-${STAMP}-123`
const ap = await fn('create-usuario', { email: apEmail, nome: 'Apontador E2E', role: 'apontador', empresa_id: empresa.id, password: apSenha })
check('create-usuario apontador', ap.role === 'apontador' && !ap.engenheiro_id, JSON.stringify({ role: ap.role }))
const { createClient } = await import('@supabase/supabase-js')
const sbAp = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const { error: apLoginErr } = await sbAp.auth.signInWithPassword({ email: apEmail, password: apSenha })
check('apontador faz login', !apLoginErr, apLoginErr?.message)
const obrasAntes = await sbAp.rpc('campo_obras')
const catNegado = await sbAp.rpc('campo_catalogo', { _obra_id: obraCampo.id })
check('apontador sem obra liberada não vê obras nem catálogo', obrasAntes.data?.length === 0 && !!catNegado.error, catNegado.error?.message)
await fn('grant-obra-permissao', { obra_id: obraCampo.id, user_id: ap.id })
const obrasDepois = await sbAp.rpc('campo_obras')
const cat = (await sbAp.rpc('campo_catalogo', { _obra_id: obraCampo.id })).data
const catBase = cat?.servicos?.find((s) => s.id === svBase.id)
const catAterro = cat?.servicos?.find((s) => s.id === svAterro.id)
check('catálogo do campo: serviços parametrizados, local, frota, origens e rota', obrasDepois.data?.length === 1 && catBase?.controla_material && catBase?.material?.nome === 'Brita graduada' && !catBase?.habilita_obs && catBase?.exige_local && catAterro?.modo_lancamento === 'viagens' && cat.locais.length === 1 && cat.veiculos.some((v) => v.id === cam.id) && cat.origens_destinos.length === 2 && cat.rotas.length === 1 && typeof cat.versao === 'string', JSON.stringify({ servicos: cat?.servicos?.length, versao: cat?.versao }))
const apItens = await sbAp.from('item_orcamentario').select('id').eq('obra_id', obraCampo.id)
check('apontador não lê o orçamento', (apItens.data ?? []).length === 0)
const regBase = (u, extra = {}) => ({ app_uuid: u, obra_id: obraCampo.id, data: iso(ontem), item_orcamentario_id: svBase.id, quantidade: 10, trecho_id: pista.id, posicao_inicio_m: 1000, posicao_fim_m: 1100, ...extra })
const u1 = uuid()
const s1 = (await sbAp.rpc('campo_sync_producao', { _registros: [regBase(u1), regBase(uuid(), { item_orcamentario_id: svAterro.id, material_qtd: 1 }), regBase(uuid(), { material_qtd: 11 })] })).data
check('sync do campo: sem material recusado, serviço de viagens recusado, válido aceito', s1?.aceitos?.length === 1 && s1?.rejeitados?.length === 2 && /material/.test(s1.rejeitados[0].motivo) && /viagens/.test(s1.rejeitados[1].motivo), JSON.stringify(s1))
const okUuid = s1?.aceitos?.[0]
await sbAp.rpc('campo_sync_producao', { _registros: [regBase(okUuid, { material_qtd: 13 })] })
const campoRows = await q('acompanhamento_producao', (t) => t.select('id, origem, criado_por').eq('app_uuid', okUuid))
check('reenvio do campo não duplica (upsert por app_uuid)', campoRows.length === 1 && campoRows[0].origem === 'campo' && campoRows[0].criado_por === ap.id, JSON.stringify(campoRows))
const [consumo] = await q('vw_servico_consumo_material', (t) => t.select('media_por_unidade, material_total, producao_total, lancamentos').eq('item_orcamentario_id', svBase.id))
check('média de material por unidade (13 m³ ÷ 10 m³ = 1,3)', Number(consumo?.media_por_unidade) === 1.3 && Number(consumo?.lancamentos) === 1, JSON.stringify(consumo))
const apAlteraOutro = await sbAp.from('acompanhamento_producao').update({ quantidade: 1 }).eq('id', pBase.id).select()
check('apontador não altera lançamento de outro usuário', (apAlteraOutro.data ?? []).length === 0)
// foto: upload direto ao bucket + registro idempotente
const fotoUuid = uuid()
const chave = `${empresa.id}/${obraCampo.id}/avulsa/${fotoUuid}.jpg`
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9])
const up = await sbAp.storage.from('acompanhamento-fotos').upload(chave, jpg, { contentType: 'image/jpeg' })
check('apontador sobe a foto na pasta da obra', !up.error, up.error?.message)
const meta = { app_uuid: fotoUuid, obra_id: obraCampo.id, producao_app_uuid: okUuid, storage_key: chave, mime: 'image/jpeg', size_bytes: jpg.length, lat: -15.6, lng: -56.1 }
const f1 = (await sbAp.rpc('campo_registrar_foto', { _meta: meta })).data
const f2 = (await sbAp.rpc('campo_registrar_foto', { _meta: meta })).data
const [fotoRow] = await q('acompanhamento_foto', (t) => t.select('producao_id, item_orcamentario_id').eq('app_uuid', fotoUuid))
check('foto registrada uma vez, ligada ao lançamento do campo', f1?.duplicada === false && f2?.duplicada === true && fotoRow?.producao_id === campoRows[0].id && fotoRow?.item_orcamentario_id === svBase.id, JSON.stringify({ f1, f2, fotoRow }))
await sbAp.auth.signOut()
}

// ── 11. Segurança e papéis (migração 0035): duas empresas, um usuário de cada papel ───────────────────────────
{
  const { createClient: cc } = await import('@supabase/supabase-js')
  const novoCliente = () => cc(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const entrar = async (email, senha) => {
    const c = novoCliente()
    const { data, error } = await c.auth.signInWithPassword({ email, password: senha })
    return { c, token: data?.session?.access_token ?? null, erro: error?.message ?? null }
  }
  const fnComo = async (tk, name, body) => {
    const r = await fetch(`${URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tk}`, apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    let j = null
    try {
      j = await r.json()
    } catch {
      /* corpo vazio */
    }
    return { status: r.status, j }
  }
  const SENHA = 'Senha-e2e-2026'
  const mk = (papel, emp, extra = {}) =>
    fn('create-usuario', {
      email: `${papel}.${STAMP}.${emp.id.slice(0, 4)}@e2e.local`,
      nome: `${papel} E2E`,
      role: papel,
      empresa_id: emp.id,
      password: SENHA,
      ...extra
    })

  const semSenha = await fetch(`${URL}/functions/v1/create-usuario`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `sem.${STAMP}@e2e.local`, nome: 'Sem senha', role: 'apontador', empresa_id: empresa.id })
  })
  check('criar usuário sem senha é recusado (sem SMTP não há convite)', semSenha.status === 400)

  const empB = await fn('create-empresa', { nome: `Outra Construtora ${STAMP}` })
  const admA = await mk('adm', empresa)
  const eng = await mk('engenheiro', empresa)
  const cli = await mk('cliente', empresa)
  const apt = await mk('apontador', empresa)
  const admB = await mk('adm', empB)
  const u = {}
  for (const [k, p] of Object.entries({ admA, eng, cli, apt, admB })) {
    u[k] = await entrar(p.email, SENHA)
    check(`login ${k}`, !!u[k].token, u[k].erro ?? '')
  }
  await fn('grant-obra-permissao', { obra_id: obraId, user_id: eng.id })
  await fn('grant-obra-permissao', { obra_id: obraId, user_id: cli.id })

  // autopromoção e promoção pelo adm, direto no banco
  for (const k of ['apt', 'cli', 'eng', 'admA']) {
    const me = { apt, cli, eng, admA }[k].id
    const r = await u[k].c.from('profiles').update({ role: 'god', empresa_id: null }).eq('id', me).select('role')
    check(`${k} não se promove a god por UPDATE direto`, !!r.error, r.error?.message?.slice(0, 70))
  }
  const promo = await u.admA.c.from('profiles').update({ role: 'god', empresa_id: null }).eq('id', eng.id).select('role')
  check('adm não promove outro usuário a god por UPDATE direto', !!promo.error)
  const troca = await u.admB.c.from('profiles').update({ empresa_id: empresa.id }).eq('id', eng.id).select('id')
  check('adm de outra empresa não puxa usuário alheio', !troca.error && (troca.data ?? []).length === 0)
  const nome = await u.admA.c.from('profiles').update({ nome: 'Engenheiro E2E (renomeado)' }).eq('id', eng.id).select('nome')
  check('adm ainda edita o nome direto', !nome.error && nome.data?.[0]?.nome === 'Engenheiro E2E (renomeado)', nome.error?.message)

  // views sem vazamento entre empresas
  for (const v of ['vw_acompanhamento_curva_s', 'vw_acompanhamento_previsto_x_realizado']) {
    const a = await u.admA.c.from(v).select('*').eq('obra_id', obraId).limit(5)
    const b = await u.admB.c.from(v).select('*').eq('obra_id', obraId).limit(5)
    check(`${v}: a empresa dona vê, a outra não`, (a.data ?? []).length > 0 && !b.error && (b.data ?? []).length === 0, `A=${a.data?.length} B=${b.data?.length} ${a.error?.message ?? ''}`)
  }

  // funções do app fechadas para anônimo
  const anon = await novoCliente().rpc('campo_obras')
  check('campo_obras recusa chamada anônima', !!anon.error, anon.error?.message?.slice(0, 60))

  // migração 0053: sem login nada do banco fica exposto; função sensível confere a permissão na obra
  const api = await (await fetch(`${URL}/rest/v1/`, { headers: { apikey: ANON } })).json()
  const exposto = Object.keys(api.paths ?? {}).filter((p) => p !== '/')
  check('sem login a API não expõe tabela nem função', !!api.paths && exposto.length === 0, exposto.slice(0, 5).join(', '))
  const semLogin = novoCliente()
  const tabAnon = await semLogin.from('obras').select('id').limit(1)
  check('anônimo não lê tabela', !!tabAnon.error, tabAnon.error?.message?.slice(0, 60))
  const sensiveis = [
    ['snapshot_orcamento_atual', { _obra_id: obraId }],
    ['recalcular_orcamento', { _obra_id: obraId }],
    ['trecho_sync_tarefas', { _obra_id: obraId }],
    ['lb_premissas_diff', { _planejamento_id: plan.id }],
    ['set_recurso_preco_vigente', { _preco_id: np.id }],
    ['obra_prontidao', { _obra_id: obraId }],
    ['importar_orcamento', { _obra_id: obraId, _itens: [], _alocacoes: [], _servicos: [], _opcoes: {} }]
  ]
  for (const [f, a] of sensiveis) {
    const an = await semLogin.rpc(f, a)
    const ou = await u.admB.c.rpc(f, a)
    check(`${f}: recusa anônimo e adm de outra empresa`, !!an.error && !!ou.error, `${an.error?.code ?? 'passou'} / ${ou.error?.code ?? 'passou'}`)
  }
  for (const f of ['recalcular_orcamento', 'lb_premissas_diff', 'obra_prontidao']) {
    const a = sensiveis.find((s) => s[0] === f)[1]
    const daObra = await u.eng.c.rpc(f, a)
    const cliente = await u.cli.c.rpc(f, a)
    check(`${f}: engenheiro da obra chama, cliente não`, !daObra.error && !!cliente.error, daObra.error?.message?.slice(0, 80))
  }
  const precoA = await u.admA.c.rpc('receita_preco_em', { _receita_id: recBase.id, _data: '2026-01-01' })
  const precoB = await u.admB.c.rpc('receita_preco_em', { _receita_id: recBase.id, _data: '2026-01-01' })
  check('receita_preco_em: a outra empresa recebe vazio', precoA.data != null && !precoB.error && precoB.data == null, `A=${precoA.data} B=${precoB.data}`)
  const travaB = await u.admB.c.rpc('cadeia_trava_motivo', { _obra_id: obraId })
  check('cadeia_trava_motivo: a outra empresa recebe vazio', !travaB.error && travaB.data == null, String(travaB.data))

  // engenheiro: libera e revoga obra do apontador, redefine a senha dele; não a de outros
  const lib = await fnComo(u.eng.token, 'grant-obra-permissao', { obra_id: obraId, user_id: apt.id })
  check('engenheiro libera a obra para o apontador', lib.status >= 200 && lib.status < 300, JSON.stringify(lib.j).slice(0, 100))
  const vis = await u.eng.c.from('obra_permissoes').select('obra_id').eq('user_id', apt.id)
  check('engenheiro vê as obras liberadas ao apontador', (vis.data ?? []).some((x) => x.obra_id === obraId), vis.error?.message)
  const nova = 'Nova-senha-2026-x'
  const red = await fnComo(u.eng.token, 'update-usuario', { id: apt.id, senha: nova })
  check('engenheiro redefine a senha do apontador da obra dele', red.status === 200, JSON.stringify(red.j).slice(0, 100))
  const comNova = await entrar(apt.email, nova)
  check('apontador entra com a senha redefinida', !!comNova.token, comNova.erro ?? '')
  const outra = await fnComo(u.eng.token, 'update-usuario', { id: admA.id, senha: nova })
  check('engenheiro não redefine a senha de outro papel', outra.status === 403, String(outra.status))
  const papel = await fnComo(u.eng.token, 'update-usuario', { id: apt.id, role: 'adm' })
  check('engenheiro não muda papel pela função', papel.status === 403, String(papel.status))
  const obrasApt = await comNova.c.rpc('campo_obras')
  check('apontador liberado vê a obra no app', (obrasApt.data ?? []).some((o) => o.id === obraId), JSON.stringify(obrasApt.error ?? obrasApt.data).slice(0, 120))

  // desativar: sessão aberta perde o acesso e o login é recusado; reativar devolve
  const des = await fnComo(u.admA.token, 'update-usuario', { id: apt.id, ativo: false })
  check('adm desativa o apontador', des.status === 200, JSON.stringify(des.j).slice(0, 100))
  const aberta = await comNova.c.rpc('campo_obras')
  check('sessão aberta do inativo não vê obras', !!aberta.error || (aberta.data ?? []).length === 0, JSON.stringify(aberta.error ?? aberta.data).slice(0, 100))
  const bloqueado = await entrar(apt.email, nova)
  check('inativo não consegue entrar', !bloqueado.token, bloqueado.erro ?? '')
  await fnComo(u.admA.token, 'update-usuario', { id: apt.id, ativo: true })
  const devolta = await entrar(apt.email, nova)
  check('reativado entra de novo', !!devolta.token, devolta.erro ?? '')
  const rev = await fnComo(u.eng.token, 'revoke-obra-permissao', { obra_id: obraId, user_id: apt.id })
  const semObra = await devolta.c.rpc('campo_obras')
  check('engenheiro revoga e o apontador deixa de ver a obra', rev.status === 200 && !(semObra.data ?? []).some((o) => o.id === obraId), JSON.stringify(rev.j).slice(0, 80))

  // cliente e outra empresa
  const cliOrc = await u.cli.c.from('item_orcamentario').select('id').eq('obra_id', obraId).limit(1)
  check('cliente não lê o orçamento (preços)', (cliOrc.data ?? []).length === 0)
  const bObra = await u.admB.c.from('obras').select('id').eq('id', obraId)
  check('adm de outra empresa não vê a obra', (bObra.data ?? []).length === 0)
  for (const k of Object.keys(u)) await u[k].c.auth.signOut()
}

// ── 12. Visão estratégica no app (campo_painel, migração 0037): quem vê e se os números batem com o web ─────────
{
  const { createClient: cc } = await import('@supabase/supabase-js')
  const { criarValorizacao, montarComparativoPorServico } = await import('../src/features/acompanhamento/lib/valor-agregado-calc')
  const entrar = async (email, senha) => {
    const c = cc(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    await c.auth.signInWithPassword({ email, password: senha })
    return c
  }
  const SENHA = 'Senha-e2e-2026'
  const mk = (papel, emp, extra = {}) =>
    fn('create-usuario', {
      email: `p12.${papel}.${STAMP}.${Math.random().toString(36).slice(2, 7)}@e2e.local`,
      nome: `${papel} painel`,
      role: papel,
      empresa_id: emp.id,
      password: SENHA,
      ...extra
    })
  const empOutra = await fn('create-empresa', { nome: `Outra do painel ${STAMP}` })
  const eng = await mk('engenheiro', empresa)
  const engSem = await mk('engenheiro', empresa)
  const apt = await mk('apontador', empresa)
  const cli = await mk('cliente', empresa)
  const apo = await mk('apoio', empresa, { engenheiro_id: eng.id })
  const admOutra = await mk('adm', empOutra)
  for (const u of [eng, apt, cli]) await fn('grant-obra-permissao', { obra_id: obraId, user_id: u.id })
  const painelComo = async (u) => (await entrar(u.email, SENHA)).rpc('campo_painel', { _obra_id: obraId })

  const okEng = await painelComo(eng)
  check('engenheiro com a obra recebe o painel', !okEng.error && !!okEng.data?.versao, okEng.error?.message)
  for (const [nome, u] of [['apontador', apt], ['apoio', apo], ['cliente', cli], ['engenheiro sem a obra', engSem], ['adm de outra empresa', admOutra]]) {
    const r = await painelComo(u)
    check(`${nome} não recebe o painel`, !!r.error, r.error?.message?.slice(0, 60))
  }
  const anon = await cc(URL, ANON, { auth: { persistSession: false } }).rpc('campo_painel', { _obra_id: obraId })
  check('anônimo não recebe o painel', !!anon.error)
  const preco = await (await entrar(eng.email, SENHA)).rpc('fn_valor_servico_em', { _grupo_id: obraId, _data: '2026-01-01' })
  check('a função de valor não é chamável direto', !!preco.error)

  const p = okEng.data
  const outra = (await painelComo(eng)).data
  check('versão estável sem mudança de dados', outra?.versao === p.versao)

  // números físicos = view do web
  const pxr = await q('vw_acompanhamento_previsto_x_realizado', (t) => t.select('item_orcamentario_id, qtd_real, qtd_plan, pct_avanco, status').eq('obra_id', obraId))
  const difFis = pxr.filter((r) => {
    const s = p.servicos.find((x) => x.id === r.item_orcamentario_id)
    return !s || Number(s.qtd_real) !== Number(r.qtd_real) || Number(s.qtd_plan) !== Number(r.qtd_plan) || s.status !== r.status
  })
  check('serviços do painel = previsto × realizado do web', pxr.length > 0 && difFis.length === 0 && p.servicos.length === pxr.length, `${pxr.length} serviços; ${difFis.length} divergentes`)
  const [resumo] = await q('vw_acompanhamento_obra_resumo', (t) => t.select('avanco_pct').eq('obra_id', obraId))
  check('avanço físico = dashboard do web', Math.abs(Number(p.resumo.avanco) - Number(resumo.avanco_pct)) < 0.00005, `${p.resumo.avanco} × ${resumo.avanco_pct}`)

  // valor executado e previsto = Valor Agregado do web (mesma regra, com o reajuste da seção 7d)
  const ref = (await q('planejamento', (t) => t.select('id, travada_em, vigente').eq('obra_id', obraId).eq('is_baseline', true).not('vigente_em', 'is', null).order('vigente', { ascending: false }).order('vigente_em', { ascending: false }).limit(1)))[0]
  const tarefas = await q('vw_planejamento_tarefa_completa', (t) => t.select('*').eq('planejamento_id', ref.id))
  const curvaSRows = await q('vw_acompanhamento_curva_s', (t) => t.select('item_orcamentario_id, data, planejado_dia, realizado_dia').eq('obra_id', obraId).limit(20000))
  const itens = await q('item_orcamentario', (t) => t.select('id, codigo, descricao, tipo, quantidade, venda_unitaria, quantidade_referencia, unidade, unidade_referencia, custo_unitario_calc').eq('obra_id', obraId).in('tipo', ['servico_grupo', 'receita']))
  const alocs = await q('item_orc_alocacao', (t) => t.select('grupo_id, receita_id, fracao').eq('obra_id', obraId))
  const receitas = new Map(itens.filter((i) => i.tipo === 'receita').map((r) => [r.id, r]))
  const grupos = itens.filter((i) => i.tipo === 'servico_grupo').map((g) => ({
    id: g.id, codigo: g.codigo ?? '', descricao: g.descricao ?? '', quantidade_referencia: Number(g.quantidade_referencia ?? 0),
    unidade_referencia: g.unidade_referencia ?? '', custo_unitario: Number(g.custo_unitario_calc ?? 0),
    filhos: alocs.filter((a) => a.grupo_id === g.id && receitas.has(a.receita_id)).map((a) => {
      const c = receitas.get(a.receita_id)
      return { id: c.id, codigo: c.codigo ?? '', descricao: c.descricao ?? '', unidade: c.unidade ?? '', quantidade: Number(c.quantidade ?? 0) * Number(a.fracao ?? 0), venda_unitaria: Number(c.venda_unitaria ?? 0) }
    })
  }))
  const rjs = await q('orcamento_reajuste', (t) => t.select('id, data').eq('obra_id', obraId).eq('status', 'aplicado'))
  const rjItens = await q('orcamento_reajuste_item', (t) => t.select('reajuste_id, receita_id, preco_antes').eq('obra_id', obraId).not('preco_antes', 'is', null))
  const dataDe = new Map(rjs.map((r) => [r.id, r.data]))
  const hist = new Map()
  for (const i of rjItens) {
    const d = dataDe.get(i.reajuste_id)
    if (!d) continue
    hist.set(i.receita_id, [...(hist.get(i.receita_id) ?? []), { data: d, preco_antes: Number(i.preco_antes) }])
  }
  for (const a of hist.values()) a.sort((x, y) => (x.data < y.data ? -1 : 1))
  const val = criarValorizacao(grupos, hist, ref.travada_em?.slice(0, 10) ?? null)
  const comp = montarComparativoPorServico({ tarefas, curvaSRows, de: '0000-01-01', ate: p.hoje, valorizacao: val })
  const webExec = comp.reduce((a, c) => a + c.projetado, 0)
  const webPrev = comp.reduce((a, c) => a + c.planejado, 0)
  check('reajuste aplicado na obra do teste (paridade com preço do dia)', rjs.length > 0, `${rjs.length} reajuste(s)`)
  check('valor executado = Valor Agregado do web', Math.abs(webExec - Number(p.financeiro.executado)) < 0.05 && webExec > 0, `web ${webExec.toFixed(2)} × painel ${p.financeiro.executado}`)
  check('valor previsto até hoje = Valor Agregado do web', Math.abs(webPrev - Number(p.financeiro.previsto)) < 0.05, `web ${webPrev.toFixed(2)} × painel ${p.financeiro.previsto}`)
  const porServ = comp.filter((c) => {
    const s = p.servicos.find((x) => x.id === c.item_orcamentario_id)
    return !s || Math.abs(Number(s.valor_executado) - c.projetado) >= 0.01 || Math.abs(Number(s.valor_previsto) - c.planejado) >= 0.01
  })
  check('valores por serviço = web', porServ.length === 0, JSON.stringify(porServ.slice(0, 2)))
  check('equipes e encarregados presentes', Array.isArray(p.equipes) && Array.isArray(p.encarregados) && p.equipes.length > 0, `${p.equipes.length} equipe(s), ${p.encarregados.length} encarregado(s)`)
}

// ── 9. Excluir obra inteira: as travas de exclusão (aditivo aplicado, linha de base, cadeia) não impedem ────────
const recDireto = await sb.from('recurso').delete().eq('obra_id', obraTr.id)
check('fora da exclusão da obra, recurso usado em composição continua protegido', !!recDireto.error, recDireto.error?.message?.slice(0, 90))
for (const o of [obraRev, obraTr, obraCampo]) {
  const del = await fn('delete-obra', { obra_id: o.id })
  const resto = await q('obras', (t) => t.select('id').eq('id', o.id))
  check(`excluir obra ${o.codigo} (composições, orçamento, planos)`, del.ok === true && resto.length === 0, JSON.stringify(del).slice(0, 120))
}

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} falha(s)`} — obra ${obra.codigo} (${obraId}) mantida no stack local para inspeção.`)
process.exit(falhas === 0 ? 0 : 1)
