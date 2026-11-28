// Gravação no SIGA: lê o próximo lote da fila de saída (siga_saida_lote), monta a linha de pnj_controle_producao
// como o Monito a preenche (web/docs/siga/MAPEAMENTO.md) e grava. Em simulação monta e guarda o que gravaria,
// sem tocar no SIGA. Nada é apagado lá: excluir é marcar deletado = 'S'.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { consultar, executar, motivoDoErroSiga, type ConexaoSiga } from './siga.ts'
import { faixaDaEstaca, metrosParaTextoDoMarcador, type EixoDoLocal } from './siga-estaca.ts'
import { projetosDoUsuario, usuarioPorId } from './siga-usuario.ts'

interface ItemDaFila {
  id: number
  obra_id: string
  projeto_id: number
  operacao: 'gravar' | 'excluir'
  simulacao: boolean
  registro_id: string
  externo_id: number | null
  nasceu_no_siga: boolean
  usuario: { externo_id: number; nome: string; ativo: boolean } | null
  producao: {
    data: string
    quantidade: number
    fator_conversao: number | null
    obs: string | null
    estaca_inicial: string | null
    estaca_final: string | null
    /** o texto da estaca como está no SIGA (lançamento que veio de lá) */
    externo_estaca: string | null
    posicao_inicio_m: number | null
    posicao_fim_m: number | null
    chuva: boolean
  } | null
  servico: { externo_id: number; fator: number | null } | null
  equipe: { externo_id: number; nome: string } | null
  encarregado: { externo_id: number; nome: string } | null
  local: { externo_id: number; nome: string; eixo: EixoDoLocal | null } | null
  material: { nome: string; quantidade: number; unidade: string | null } | null
}

export interface ResumoEnvio {
  enviados: number
  simulados: number
  erros: number
  falhas: Array<{ id: number; erro: string }>
}

/** Recusa que não adianta tentar de novo sem alguém corrigir o cadastro. */
class Recusa extends Error {}

const corte = (v: unknown, n: number): string | null => {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s.slice(0, n)
}
const arred2 = (n: number): number => Math.round(n * 100) / 100
const cod = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

interface ServicoDoCatalogo {
  unidade_id: number | null
  unidade: string | null
  material_id: number | null
  material: string | null
  material_unidade_id: number | null
  material_unidade: string | null
}

/** O que o conector precisa do cadastro do SIGA, lido uma vez por rodada. */
function catalogo(con: ConexaoSiga) {
  const servicos = new Map<number, ServicoDoCatalogo | null>()
  const nomes = new Map<string, string | null>()
  const usuarios = new Map<number, { ativo: boolean; projetos: number[] | null }>()
  const nome = async (chave: string, sql: string, id: number): Promise<string | null> => {
    const k = `${chave}:${id}`
    if (!nomes.has(k)) {
      const l = await consultar<{ nome: unknown }>(con, sql, [id])
      nomes.set(k, corte(l[0]?.nome, 255))
    }
    return nomes.get(k) ?? null
  }
  return {
    async servico(id: number): Promise<ServicoDoCatalogo | null> {
      if (!servicos.has(id)) {
        const l = await consultar<Record<string, unknown>>(
          con,
          `select s.servico_executado_unidade_id as unidade_id, u.unidade_nome as unidade,
                  s.servico_executado_material_id as material_id, m.material_nome as material,
                  m.material_unidade_id as material_unidade_id, mu.unidade_nome as material_unidade
             from cdt_servico_executado s
             left join cdt_unidade u on u.unidade_id = s.servico_executado_unidade_id
             left join cdt_material m on m.material_id = s.servico_executado_material_id
             left join cdt_unidade mu on mu.unidade_id = m.material_unidade_id
            where s.servico_executado_id = ? limit 1`,
          [id]
        )
        servicos.set(
          id,
          l[0]
            ? {
                unidade_id: cod(l[0].unidade_id),
                unidade: corte(l[0].unidade, 60),
                material_id: cod(l[0].material_id),
                material: corte(l[0].material, 255),
                material_unidade_id: cod(l[0].material_unidade_id),
                material_unidade: corte(l[0].material_unidade, 60)
              }
            : null
        )
      }
      return servicos.get(id) ?? null
    },
    equipe: (id: number) => nome('equipe', 'select equipe_nome as nome from cdt_equipe where equipe_id = ? limit 1', id),
    encarregado: (id: number) =>
      nome('encarregado', 'select encarregado_nome as nome from cdt_encarregado where encarregado_id = ? limit 1', id),
    // "techo" é o nome real da coluna no SIGA
    trecho: (id: number) =>
      nome('trecho', 'select projeto_tem_techo_trecho as nome from cdt_projeto_tem_trecho where projeto_tem_trecho_id = ? limit 1', id),
    /** Confere de novo, no SIGA, se quem lançou continua ativo e com o projeto. */
    async usuario(id: number): Promise<{ ativo: boolean; projetos: number[] | null }> {
      if (!usuarios.has(id)) {
        const u = await usuarioPorId(con, id)
        usuarios.set(id, u ? { ativo: true, projetos: await projetosDoUsuario(con, id) } : { ativo: false, projetos: [] })
      }
      return usuarios.get(id)!
    }
  }
}

type Catalogo = ReturnType<typeof catalogo>

/**
 * A linha de pnj_controle_producao (sem o prefixo das colunas) para um lançamento do InfraWork. `estacaMudou`:
 * a posição lançada aqui não é a que o texto do SIGA já diz (só interessa no lançamento que nasceu lá).
 */
async function montarLinha(
  item: ItemDaFila,
  cat: Catalogo
): Promise<{ linha: Record<string, unknown>; estacaMudou: boolean }> {
  const p = item.producao
  if (!p) throw new Recusa('O lançamento não existe mais no InfraWork.')
  if (!item.servico) throw new Recusa('O serviço do lançamento não está ligado a um serviço do SIGA.')
  const servico = await cat.servico(item.servico.externo_id)
  if (!servico || servico.unidade_id == null || !servico.unidade)
    throw new Recusa(`O serviço ${item.servico.externo_id} não foi encontrado no SIGA ou está sem unidade.`)

  const fator = Number(item.servico.fator) > 0 ? Number(item.servico.fator) : 1
  const quantidade = arred2((Number(p.quantidade) * (Number(p.fator_conversao) || 1)) / fator)

  // a estaca vai como o SIGA a escreve; sem posição no eixo, vai o texto digitado
  let inicial = corte(p.estaca_inicial, 255)
  let final = corte(p.estaca_final, 255)
  const eixo = item.local?.eixo
  let estacaMudou = false
  if (eixo && p.posicao_inicio_m != null && p.posicao_fim_m != null) {
    const a = metrosParaTextoDoMarcador(Number(p.posicao_inicio_m), eixo)
    const b = metrosParaTextoDoMarcador(Number(p.posicao_fim_m), eixo)
    if (a && b) {
      const doTexto = faixaDaEstaca({ estaca: p.externo_estaca, inicial, final }, eixo)
      estacaMudou =
        !doTexto ||
        Math.abs(doTexto.inicio_m - Number(p.posicao_inicio_m)) >= 1 ||
        Math.abs(doTexto.fim_m - Number(p.posicao_fim_m)) >= 1
      // do menor para o maior marcador, como se lê na pista
      ;[inicial, final] = eixo.sentido === 'invertido' ? [b, a] : [a, b]
    }
  }
  const estaca = inicial && final ? `${inicial} - ${final}` : (inicial ?? final)

  const m = item.material
  const linha = {
    projeto_id: item.projeto_id,
    servico_executado_id: item.servico.externo_id,
    dt: p.data,
    equipe_id: item.equipe?.externo_id ?? null,
    equipe_nome: item.equipe ? corte((await cat.equipe(item.equipe.externo_id)) ?? item.equipe.nome, 30) : null,
    encarregado_id: item.encarregado?.externo_id ?? null,
    encarregado_nome: item.encarregado
      ? corte((await cat.encarregado(item.encarregado.externo_id)) ?? item.encarregado.nome, 50)
      : null,
    servico_executado_qtd: quantidade,
    servico_executado_prioridade: 'N',
    servico_executado_unidade_id: servico.unidade_id,
    servico_executado_unidade_nome: servico.unidade,
    material_id: m ? servico.material_id : null,
    material_nome: m ? (servico.material ?? corte(m.nome, 255)) : null,
    material_qtd: m ? arred2(Number(m.quantidade)) : null,
    material_unidade_id: m ? servico.material_unidade_id : null,
    material_unidade_nome: m ? (servico.material_unidade ?? corte(m.unidade, 60)) : null,
    trecho_id: item.local?.externo_id ?? null,
    trecho_nome: item.local ? corte((await cat.trecho(item.local.externo_id)) ?? item.local.nome, 255) : null,
    estaca: corte(estaca, 255),
    estaca_inicial: inicial,
    estaca_final: final,
    chuva: p.chuva ? 'S' : 'N',
    obs: corte(p.obs, 60000)
  }
  return { linha, estacaMudou }
}

/** Compara o que está no SIGA com o que iria: número com número (duas casas), texto sem as pontas, vazio = nulo. */
function igual(a: unknown, b: unknown): boolean {
  const x = a == null || String(a).trim() === '' ? null : String(a).trim()
  const y = b == null || String(b).trim() === '' ? null : String(b).trim()
  if (x == null || y == null) return x === y
  const numero = /^-?\d+(\.\d+)?$/
  if (numero.test(x) && numero.test(y)) return Math.abs(Number(x) - Number(y)) < 0.005
  return x === y
}

const COL = (c: string): string => `controle_producao_${c}`

async function gravarLinha(
  con: ConexaoSiga,
  item: ItemDaFila,
  linha: Record<string, unknown>,
  estacaMudou: boolean,
  quem: string
): Promise<{ id: number; mudou?: Record<string, [unknown, unknown]> }> {
  const colunas = Object.keys(linha)
  if (item.nasceu_no_siga) {
    // O lançamento nasceu no SIGA: muda pelo número dele e só no que foi alterado aqui. O que o usuário não mexeu
    // (texto da estaca, prioridade, material, quem cadastrou) fica como está lá.
    if (!item.externo_id) throw new Recusa('Lançamento do SIGA sem o número dele.')
    const lidas = await consultar<Record<string, unknown>>(
      con,
      `select * from pnj_controle_producao
        where ${COL('id')} = ? and ${COL('projeto_id')} = ? and ${COL('deletado')} = 'N' limit 1`,
      [item.externo_id, item.projeto_id]
    )
    const atual = lidas[0]
    if (!atual) throw new Recusa('O lançamento não existe mais no SIGA (foi excluído lá).')
    const difere = (c: string): boolean => !igual(atual[COL(c)], linha[c])
    const mudar: string[] = []
    for (const c of ['dt', 'servico_executado_qtd', 'obs']) if (difere(c)) mudar.push(c)
    // o nome e a unidade acompanham o código: só mudam quando o código muda
    if (difere('servico_executado_id'))
      mudar.push('servico_executado_id', 'servico_executado_unidade_id', 'servico_executado_unidade_nome')
    if (difere('equipe_id')) mudar.push('equipe_id', 'equipe_nome')
    if (difere('encarregado_id')) mudar.push('encarregado_id', 'encarregado_nome')
    if (difere('trecho_id')) mudar.push('trecho_id', 'trecho_nome')
    if (estacaMudou) mudar.push('estaca', 'estaca_inicial', 'estaca_final')
    if (linha.material_qtd != null && difere('material_qtd')) {
      mudar.push('material_qtd')
      if (atual[COL('material_id')] == null && atual[COL('material_nome')] == null)
        mudar.push('material_id', 'material_nome', 'material_unidade_id', 'material_unidade_nome')
    }
    const mudou: Record<string, [unknown, unknown]> = {}
    for (const c of mudar) mudou[c] = [atual[COL(c)] ?? null, linha[c] ?? null]
    if (mudar.length > 0)
      await executar(
        con,
        `update pnj_controle_producao
            set ${mudar.map((c) => `${COL(c)} = ?`).join(', ')},
                ${COL('alterador_nome')} = ?, ${COL('alterador_dh')} = now()
          where ${COL('id')} = ? and ${COL('projeto_id')} = ? and ${COL('deletado')} = 'N'`,
        [...mudar.map((c) => linha[c]), quem, item.externo_id, item.projeto_id]
      )
    return { id: item.externo_id, mudou }
  }
  // o lançamento nasceu aqui: a chave é o nosso id no app_uuid, então repetir o envio não duplica
  const naAlteracao = colunas.filter((c) => c !== 'projeto_id')
  await executar(
    con,
    `insert into pnj_controle_producao
       (${COL('app_uuid')}, ${colunas.map(COL).join(', ')}, ${COL('cadastrador_nome')}, ${COL('cadastrador_dh')})
     values (?, ${colunas.map(() => '?').join(', ')}, ?, now())
     on duplicate key update
       ${naAlteracao.map((c) => `${COL(c)} = values(${COL(c)})`).join(', ')},
       ${COL('alterador_nome')} = values(${COL('cadastrador_nome')}), ${COL('alterador_dh')} = now()`,
    [item.registro_id, ...colunas.map((c) => linha[c]), quem]
  )
  const gravada = await consultar<{ id: unknown; projeto: unknown }>(
    con,
    `select ${COL('id')} as id, ${COL('projeto_id')} as projeto from pnj_controle_producao
      where ${COL('app_uuid')} = ? limit 1`,
    [item.registro_id]
  )
  if (!gravada[0]) throw new Error('O SIGA aceitou a gravação, mas o lançamento não foi encontrado em seguida.')
  return { id: Number(gravada[0].id) }
}

async function excluirLinha(con: ConexaoSiga, item: ItemDaFila, quem: string): Promise<void> {
  await executar(
    con,
    `update pnj_controle_producao
        set ${COL('deletado')} = 'S', ${COL('excluidor_nome')} = ?, ${COL('excluidor_dh')} = now(),
            ${COL('alterador_nome')} = ?, ${COL('alterador_dh')} = now()
      where ${COL('projeto_id')} = ? and ${COL('deletado')} = 'N'
        and (${COL('app_uuid')} = ? or ${COL('id')} = ?)`,
    [quem, quem, item.projeto_id, item.registro_id, item.externo_id ?? 0]
  )
}

/**
 * Envia o que está na fila (de uma integração ou de uma obra). Uma linha com problema não para as outras: fica
 * com o motivo e é tentada de novo na próxima rodada.
 */
export async function enviarFila(
  admin: SupabaseClient,
  con: ConexaoSiga,
  filtro: { integracao_id?: string; obra_id?: string }
): Promise<ResumoEnvio> {
  const resumo: ResumoEnvio = { enviados: 0, simulados: 0, erros: 0, falhas: [] }
  const cat = catalogo(con)
  // um lote por rodada: o que falhar não é tentado de novo na mesma chamada (gastaria as tentativas de uma vez)
  {
    const { data, error } = await admin.rpc('siga_saida_lote', {
      _integracao_id: filtro.integracao_id ?? null,
      _obra_id: filtro.obra_id ?? null,
      _limite: 200
    })
    if (error) throw new Error(error.message)
    const lote = (data ?? []) as ItemDaFila[]
    for (const item of lote) {
      const concluir = async (
        estado: 'enviado' | 'simulado' | 'erro',
        extra: { externo_id?: number | null; enviado?: unknown; erro?: string } = {}
      ): Promise<void> => {
        const { error: e } = await admin.rpc('siga_saida_concluir', {
          _id: item.id,
          _estado: estado,
          _externo_id: extra.externo_id ?? null,
          _enviado: extra.enviado ?? null,
          _erro: extra.erro ?? null
        })
        if (e) throw new Error(e.message)
      }
      try {
        if (!item.usuario) throw new Recusa('Quem lançou não está ligado a um usuário do SIGA.')
        const noSiga = await cat.usuario(item.usuario.externo_id)
        if (!noSiga.ativo) throw new Recusa(`O usuário ${item.usuario.nome} está inativo no SIGA.`)
        if (noSiga.projetos && !noSiga.projetos.includes(Number(item.projeto_id)))
          throw new Recusa(`O usuário ${item.usuario.nome} não tem o projeto desta obra no SIGA.`)
        const quem = corte(item.usuario.nome, 100)!

        if (item.operacao === 'excluir') {
          const chave = { app_uuid: item.registro_id, id: item.externo_id, projeto_id: item.projeto_id }
          if (item.simulacao) {
            await concluir('simulado', { enviado: { excluir: chave, excluidor_nome: quem } })
            resumo.simulados++
          } else {
            await excluirLinha(con, item, quem)
            await concluir('enviado', { enviado: { excluir: chave, excluidor_nome: quem } })
            resumo.enviados++
          }
        } else {
          const { linha, estacaMudou } = await montarLinha(item, cat)
          const cabecalho = item.nasceu_no_siga
            ? { id: item.externo_id, alterador_nome: quem }
            : { app_uuid: item.registro_id, cadastrador_nome: quem }
          if (item.simulacao) {
            await concluir('simulado', { enviado: { ...cabecalho, ...linha } })
            resumo.simulados++
          } else {
            const gravado = await gravarLinha(con, item, linha, estacaMudou, quem)
            // do lançamento que nasceu no SIGA fica registrado só o que mudou: [antes, depois]
            await concluir('enviado', {
              externo_id: gravado.id,
              enviado: gravado.mudou ? { ...cabecalho, mudou: gravado.mudou } : { ...cabecalho, ...linha }
            })
            resumo.enviados++
          }
        }
      } catch (e) {
        const erro =
          e instanceof Recusa
            ? e.message
            : (e as { code?: string })?.code
              ? motivoDoErroSiga(e)
              : e instanceof Error
                ? e.message
                : String(e)
        resumo.erros++
        if (resumo.falhas.length < 20) resumo.falhas.push({ id: item.id, erro })
        await concluir('erro', { erro }).catch(() => undefined)
        // conexão perdida: as próximas falhariam pelo mesmo motivo e gastariam as tentativas
        if (!(e instanceof Recusa) && (e as { fatal?: boolean })?.fatal) return resumo
      }
    }
  }
  return resumo
}
