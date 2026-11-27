// O conector do SIGA no nível da obra: os projetos e cadastros de lá (para vincular) e a leitura da produção.
// Só LÊ o SIGA. As colunas são as reais, conferidas pelo diagnóstico (web/docs/siga/MAPEAMENTO.md).

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { consultar, type ConexaoSiga } from './siga.ts'
import { faixaDaEstaca, type EixoDoLocal } from './siga-estaca.ts'

const VIVO = `p.controle_producao_deletado = 'N' and p.controle_producao_inativo = 'N'`
const LOTE = 1500

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
/** Código do SIGA: zero e vazio são "sem". */
const cod = (v: unknown): number | null => {
  const n = num(v)
  return n && n > 0 ? n : null
}
const txt = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}

export interface ProjetoSiga {
  id: number
  codigo: string
  obras: string | null
}

/** Os projetos ativos do SIGA, com as obras de cada um (para reconhecer na hora de vincular). */
export async function listarProjetos(con: ConexaoSiga): Promise<ProjetoSiga[]> {
  const linhas = await consultar<{ id: number; codigo: string; obras: string | null }>(
    con,
    `select p.projeto_id as id, p.projeto_codigo as codigo,
            (select group_concat(distinct o.obra_nome order by o.obra_nome separator ' | ')
               from cdt_obra o
              where o.obra_projeto_id = p.projeto_id and o.obra_deletado = 'N' and o.obra_inativo = 'N') as obras
       from cdt_projeto p
      where p.projeto_inativo = 'N' and p.projeto_deletado = 'N'
      order by p.projeto_codigo`
  )
  return linhas.map((l) => ({
    id: Number(l.id),
    codigo: String(l.codigo ?? '').trim(),
    obras: txt(l.obras)?.slice(0, 160) ?? null
  }))
}

export interface CadastroSiga {
  id: number
  nome: string
  /** quantos lançamentos do projeto usam este registro */
  lancamentos: number
  ultimo: string | null
}
export interface CadastrosSiga {
  servicos: Array<CadastroSiga & { unidade: string | null; material: string | null; material_unidade: string | null }>
  equipes: Array<CadastroSiga & { encarregado_id: number | null; encarregado: string | null }>
  encarregados: CadastroSiga[]
  locais: CadastroSiga[]
}

/**
 * O que o projeto usa no SIGA: o que está no cadastro do projeto e o que já apareceu em algum lançamento dele
 * (o histórico tem equipe e trecho que saíram do cadastro).
 */
export async function listarCadastros(con: ConexaoSiga, projeto: number): Promise<CadastrosSiga> {
  const uso = async (coluna: string): Promise<Map<number, { n: number; ultimo: string | null; nome: string | null }>> => {
    const nome = coluna.replace(/_id$/, '_nome')
    const temNome = coluna !== 'controle_producao_servico_executado_id'
    const linhas = await consultar<{ id: number; n: number; ultimo: string | null; nome: string | null }>(
      con,
      `select p.${coluna} as id, count(*) as n, max(p.controle_producao_dt) as ultimo,
              ${temNome ? `max(p.${nome})` : 'null'} as nome
         from pnj_controle_producao p
        where p.controle_producao_projeto_id = ? and ${VIVO} and p.${coluna} is not null
        group by p.${coluna}`,
      [projeto]
    )
    return new Map(
      linhas
        .filter((l) => cod(l.id) != null)
        .map((l) => [Number(l.id), { n: Number(l.n), ultimo: txt(l.ultimo), nome: txt(l.nome) }])
    )
  }
  const [usoServico, usoEquipe, usoEnc, usoLocal] = [
    await uso('controle_producao_servico_executado_id'),
    await uso('controle_producao_equipe_id'),
    await uso('controle_producao_encarregado_id'),
    await uso('controle_producao_trecho_id')
  ]
  const ids = (m: Map<number, unknown>): number[] => (m.size > 0 ? [...m.keys()] : [0])
  const comUso = <T extends { id: number; nome: string }>(
    cadastro: T[],
    usados: Map<number, { n: number; ultimo: string | null; nome: string | null }>
  ): Array<T & CadastroSiga> => {
    const porId = new Map(cadastro.map((c) => [c.id, c]))
    // o que só existe no histórico entra com o nome que ficou gravado no lançamento
    for (const [id, u] of usados)
      if (!porId.has(id)) porId.set(id, { id, nome: u.nome ?? `(código ${id})` } as T)
    return [...porId.values()]
      .map((c) => ({ ...c, lancamentos: usados.get(c.id)?.n ?? 0, ultimo: usados.get(c.id)?.ultimo ?? null }))
      .sort((a, b) => b.lancamentos - a.lancamentos || a.nome.localeCompare(b.nome))
  }

  const servicos = await consultar<Record<string, unknown>>(
    con,
    `select s.servico_executado_id as id, s.servico_executado_nome as nome, u.unidade_nome as unidade,
            m.material_nome as material, mu.unidade_nome as material_unidade
       from cdt_servico_executado s
       left join cdt_unidade u on u.unidade_id = s.servico_executado_unidade_id
       left join cdt_material m on m.material_id = s.servico_executado_material_id
       left join cdt_unidade mu on mu.unidade_id = m.material_unidade_id
      where s.servico_executado_id in (?)
         or s.servico_executado_id in (
              select ps.projeto_tem_servico_executado_servico_executado_id
                from cdt_projeto_tem_servico_executado ps
               where ps.projeto_tem_servico_executado_projeto_id = ?)`,
    [ids(usoServico), projeto]
  )
  const equipes = await consultar<Record<string, unknown>>(
    con,
    `select e.equipe_id as id, e.equipe_nome as nome,
            pe.projeto_tem_equipe_encarregado_id as encarregado_id, en.encarregado_nome as encarregado
       from cdt_equipe e
       left join cdt_projeto_tem_equipe pe
              on pe.projeto_tem_equipe_equipe_id = e.equipe_id and pe.projeto_tem_equipe_projeto_id = ?
       left join cdt_encarregado en on en.encarregado_id = pe.projeto_tem_equipe_encarregado_id
      where e.equipe_id in (?) or pe.projeto_tem_equipe_equipe_id is not null`,
    [projeto, ids(usoEquipe)]
  )
  const encarregados = await consultar<Record<string, unknown>>(
    con,
    `select en.encarregado_id as id, en.encarregado_nome as nome
       from cdt_encarregado en
      where en.encarregado_id in (?)
         or en.encarregado_id in (
              select pe.projeto_tem_equipe_encarregado_id from cdt_projeto_tem_equipe pe
               where pe.projeto_tem_equipe_projeto_id = ?)`,
    [ids(usoEnc), projeto]
  )
  const locais = await consultar<Record<string, unknown>>(
    con,
    // "techo" é o nome real da coluna no SIGA
    `select t.projeto_tem_trecho_id as id, t.projeto_tem_techo_trecho as nome
       from cdt_projeto_tem_trecho t
      where t.projeto_tem_trecho_projeto_id = ?
        and t.projeto_tem_trecho_inativo = 'N' and t.projeto_tem_trecho_deletado = 'N'`,
    [projeto]
  )

  const limpo = <T extends Record<string, unknown>>(linhas: T[]): Array<T & { id: number; nome: string }> => {
    const vistos = new Set<number>()
    const out: Array<T & { id: number; nome: string }> = []
    for (const l of linhas) {
      const id = cod(l.id)
      if (id == null || vistos.has(id)) continue
      vistos.add(id)
      out.push({ ...l, id, nome: txt(l.nome) ?? `(código ${id})` })
    }
    return out
  }
  return {
    servicos: comUso(limpo(servicos), usoServico).map((s) => ({
      id: s.id,
      nome: s.nome,
      lancamentos: s.lancamentos,
      ultimo: s.ultimo,
      unidade: txt(s.unidade),
      material: txt(s.material),
      material_unidade: txt(s.material_unidade)
    })),
    equipes: comUso(limpo(equipes), usoEquipe).map((e) => ({
      id: e.id,
      nome: e.nome,
      lancamentos: e.lancamentos,
      ultimo: e.ultimo,
      encarregado_id: cod(e.encarregado_id),
      encarregado: txt(e.encarregado)
    })),
    encarregados: comUso(limpo(encarregados), usoEnc).map((e) => ({
      id: e.id,
      nome: e.nome,
      lancamentos: e.lancamentos,
      ultimo: e.ultimo
    })),
    locais: comUso(limpo(locais), usoLocal).map((l) => ({
      id: l.id,
      nome: l.nome,
      lancamentos: l.lancamentos,
      ultimo: l.ultimo
    }))
  }
}

export interface VinculoObra {
  obra_id: string
  integracao_id: string
  externo_projeto_id: number
  data_corte: string | null
}

export interface ResumoSync {
  lidos: number
  novos: number
  alterados: number
  iguais: number
  removidos: number
  erros: Array<{ externo_id: number; erro: string }>
}

async function assinar(o: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(o))
  const hash = await crypto.subtle.digest('SHA-1', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Lê os lançamentos do projeto no SIGA e aplica no InfraWork (siga_aplicar_producao). */
export async function sincronizarObra(
  admin: SupabaseClient,
  con: ConexaoSiga,
  v: VinculoObra
): Promise<ResumoSync> {
  // os locais vinculados a um eixo, para a estaca virar posição
  const [{ data: dePara }, { data: trechos }] = await Promise.all([
    admin.from('integracao_de_para').select('externo_id, interno_id').eq('obra_id', v.obra_id).eq('tipo', 'local'),
    admin
      .from('obra_trecho')
      .select('id, tipo, unidade_espaco_padrao, marcador_valor_inicial, geometry_sentido')
      .eq('obra_id', v.obra_id)
  ])
  const eixos = new Map<number, EixoDoLocal>()
  for (const d of dePara ?? []) {
    const t = (trechos ?? []).find((x) => x.id === d.interno_id)
    if (!t || t.tipo !== 'eixo') continue
    eixos.set(Number(d.externo_id), {
      unidade: t.unidade_espaco_padrao,
      marcador_inicial: Number(t.marcador_valor_inicial ?? 0),
      sentido: t.geometry_sentido === 'invertido' ? 'invertido' : 'natural'
    })
  }

  const filtros = ['p.controle_producao_projeto_id = ?']
  const params: unknown[] = [v.externo_projeto_id]
  if (v.data_corte) {
    filtros.push('p.controle_producao_dt >= ?')
    params.push(v.data_corte)
  }
  const lidas = await consultar<Record<string, unknown>>(
    con,
    `select p.controle_producao_id as id, p.controle_producao_app_uuid as app_uuid, p.controle_producao_dt as dt,
            p.controle_producao_servico_executado_id as servico_id, s.servico_executado_nome as servico,
            p.controle_producao_servico_executado_qtd as qtd,
            p.controle_producao_servico_executado_unidade_nome as unidade,
            p.controle_producao_equipe_id as equipe_id, p.controle_producao_equipe_nome as equipe,
            p.controle_producao_encarregado_id as encarregado_id, p.controle_producao_encarregado_nome as encarregado,
            p.controle_producao_material_nome as material, p.controle_producao_material_qtd as material_qtd,
            p.controle_producao_material_unidade_nome as material_unidade,
            p.controle_producao_trecho_id as trecho_id, p.controle_producao_trecho_nome as trecho,
            p.controle_producao_estaca as estaca, p.controle_producao_estaca_inicial as estaca_inicial,
            p.controle_producao_estaca_final as estaca_final, p.controle_producao_chuva as chuva,
            p.controle_producao_obs as obs, p.controle_producao_cadastrador_nome as cadastrador,
            p.controle_producao_inativo as inativo, p.controle_producao_deletado as deletado
       from pnj_controle_producao p
       left join cdt_servico_executado s on s.servico_executado_id = p.controle_producao_servico_executado_id
      where ${filtros.join(' and ')}
      order by p.controle_producao_id`,
    params
  )

  const vivos: number[] = []
  const linhas: Array<Record<string, unknown>> = []
  for (const l of lidas) {
    const externo_id = Number(l.id)
    const excluido = l.deletado === 'S' || l.inativo === 'S'
    if (excluido) {
      linhas.push({ externo_id, app_uuid: txt(l.app_uuid), excluido: true })
      continue
    }
    vivos.push(externo_id)
    const trecho_id = cod(l.trecho_id)
    const eixo = trecho_id != null ? eixos.get(trecho_id) : undefined
    const faixa = eixo
      ? faixaDaEstaca({ estaca: txt(l.estaca), inicial: txt(l.estaca_inicial), final: txt(l.estaca_final) }, eixo)
      : null
    const material = txt(l.material)
    const linha = {
      externo_id,
      app_uuid: txt(l.app_uuid),
      data: txt(l.dt),
      servico_id: cod(l.servico_id),
      servico: txt(l.servico),
      unidade: txt(l.unidade),
      quantidade: num(l.qtd) ?? 0,
      equipe_id: cod(l.equipe_id),
      equipe: txt(l.equipe),
      encarregado_id: cod(l.encarregado_id),
      encarregado: txt(l.encarregado),
      trecho_id,
      trecho: txt(l.trecho),
      estaca: txt(l.estaca),
      estaca_inicial: txt(l.estaca_inicial),
      estaca_final: txt(l.estaca_final),
      pos_inicio_m: faixa?.inicio_m ?? null,
      pos_fim_m: faixa?.fim_m ?? null,
      obs: txt(l.obs),
      cadastrador: txt(l.cadastrador),
      chuva: l.chuva === 'S',
      material: material
        ? { nome: material, quantidade: num(l.material_qtd) ?? 0, unidade: txt(l.material_unidade) }
        : null
    }
    linhas.push({ ...linha, assinatura: await assinar(linha) })
  }

  const resumo: ResumoSync = { lidos: lidas.length, novos: 0, alterados: 0, iguais: 0, removidos: 0, erros: [] }
  for (let i = 0; i < Math.max(linhas.length, 1); i += LOTE) {
    const ultimo = i + LOTE >= linhas.length
    const { data, error } = await admin.rpc('siga_aplicar_producao', {
      _obra_id: v.obra_id,
      _linhas: linhas.slice(i, i + LOTE),
      _vivos: ultimo ? vivos : null
    })
    if (error) throw new Error(error.message)
    const r = data as Omit<ResumoSync, 'lidos'>
    resumo.novos += r.novos
    resumo.alterados += r.alterados
    resumo.iguais += r.iguais
    resumo.removidos += r.removidos
    resumo.erros.push(...(r.erros ?? []))
  }
  return resumo
}
