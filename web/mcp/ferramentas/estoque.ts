import { z } from 'zod'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { eq, gravar, ler } from '../lib/banco'
import {
  alturaTotal,
  capacidade,
  tabelaArqueacao,
  validarTanque,
  VERSAO_TABELA,
  type Tanque
} from '@/features/estoque/lib/tanque'

const OBRA = z.string().uuid().describe('id da obra')
const AGORA = (): string => new Date().toISOString()

/** A tabela de arqueação em resumo: uma linha a cada `passo` cm (a inteira tem centenas de linhas). */
function resumir(tabela: number[], passo: number): Array<{ altura_cm: number; litros: number }> {
  const out: Array<{ altura_cm: number; litros: number }> = []
  const topo = tabela.length - 1
  for (let h = 0; h < topo; h += passo) out.push({ altura_cm: h, litros: tabela[h] })
  out.push({ altura_cm: topo, litros: tabela[topo] })
  return out
}

/** Confere as medidas do tanque e devolve o que o cadastro grava (a tabela é calculada aqui, como na tela). */
function medidasDoTanque(dimensoes: unknown): {
  tanque: Tanque
  tabela: number[]
} {
  const tanque = dimensoes as Tanque
  if (!tanque || typeof tanque !== 'object' || !('forma' in tanque))
    throw new Error('Informe "dimensoes" com o campo "forma" e as medidas do tanque, em cm.')
  const erro = validarTanque(tanque)
  if (erro) throw new Error(erro)
  return { tanque, tabela: tabelaArqueacao(tanque) }
}

export const estoque = ferramenta({
  nome: 'estoque',
  titulo: 'Estoque (tanques e depósitos)',
  descricao:
    'Controle de estoque da obra. Ativo = tanque de material betuminoso (saldo em litros) ou depósito de agregado/' +
    'solo (saldo na unidade do material), cada um num ponto do mapa (lat, lng) e ligado a um recurso do grupo ' +
    'MATERIAL. Saldo: a leitura que ajusta é o ponto de partida; saldo = quantidade dessa leitura + entradas − ' +
    'saídas depois dela. A diferença de cada leitura é calculada, nunca gravada. A primeira leitura é o saldo ' +
    'inicial. Saldo negativo não é bloqueado. ' +
    'acao: listar (ativos com saldo, nível, status normal|baixo|zerado|negativo|sem_saldo, última leitura e ' +
    'autonomia em dias) | extrato (id: movimentos e leituras em ordem, com o saldo depois de cada linha) | ' +
    'calcular (dimensoes: capacidade e tabela resumida, sem gravar) | salvar_tanque | salvar_deposito | ' +
    'excluir_ativo | entrada | saida (id do ativo, quantidade; no tanque aceita unidade "t" com densidade_kg_l, ' +
    'convertida para litros) | leitura (tanque: leitura_cm, o número lido na régua, que o banco converte em ' +
    'litros; depósito: quantidade medida; ajusta_saldo false = só conferência) | excluir_lancamento | tabela ' +
    '(id do tanque: litros a cada passo_cm). ' +
    'dimensoes do tanque, em cm e internas: {forma:"cilindrico_horizontal", diametro, comprimento, tampo:{tipo:' +
    '"plano"|"semieliptico"|"hemisferico"} | {tipo:"abaulado", flecha} | {tipo:"torisferico", fc, fk}} | ' +
    '{forma:"cilindrico_vertical", diametro, altura, fundo:{tipo:"plano"} | {tipo:"conico", altura} | ' +
    '{tipo:"abaulado", flecha}} | {forma:"eliptico_horizontal"|"oval_horizontal", largura, altura, comprimento, ' +
    'flecha (0 = tampos planos)} | {forma:"retangular", comprimento, largura, altura} | {forma:"tabela", ' +
    'pontos:[{altura, volume}]} (tabela do fabricante, altura em cm e volume em litros). Torisférico: fc e fk são ' +
    'os raios da calota e do rebordo ÷ diâmetro (ASME F&D 1 e 0,06; DIN 28011 1 e 0,1).',
  entrada: {
    acao: z.enum([
      'listar',
      'extrato',
      'calcular',
      'salvar_tanque',
      'salvar_deposito',
      'excluir_ativo',
      'entrada',
      'saida',
      'leitura',
      'excluir_lancamento',
      'tabela'
    ]),
    obra_id: OBRA.optional().describe('obrigatório em listar e ao criar um ativo'),
    id: z.string().uuid().optional().describe('ativo de estoque (salvar: omita para criar)'),
    nome: z.string().optional(),
    recurso_id: z
      .string()
      .uuid()
      .optional()
      .describe('material guardado (recurso MATERIAL da obra)'),
    lat: z.number().optional(),
    lng: z.number().optional(),
    estoque_minimo: z.number().optional().describe('abaixo ou igual a ele o ativo fica "baixo"'),
    ativo: z.boolean().optional().describe('false = fora de uso (o histórico fica)'),
    obs: z.string().nullable().optional(),
    dimensoes: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('tanque: formato e medidas em cm (ver a descrição)'),
    leitura_por: z
      .enum(['cheio', 'vazio'])
      .optional()
      .describe(
        'como a régua do tanque é lida: cheio = altura do líquido; vazio = da boca até o líquido'
      ),
    altura_referencia_cm: z
      .number()
      .nullable()
      .optional()
      .describe('régua pelo vazio: altura da boca de medição até o fundo'),
    densidade_kg_l: z
      .number()
      .nullable()
      .optional()
      .describe('tanque: densidade do material; entrada/saida em "t": a densidade da conversão'),
    unidade: z
      .string()
      .optional()
      .describe('depósito: unidade de controle; entrada/saida no tanque: "L" (padrão) ou "t"'),
    capacidade: z.number().optional().describe('depósito (no tanque vem das medidas)'),
    quantidade: z
      .number()
      .optional()
      .describe('entrada/saida; leitura do depósito (medido no monte)'),
    leitura_cm: z.number().optional().describe('leitura do tanque: o número lido na régua'),
    temperatura_c: z.number().nullable().optional(),
    ajusta_saldo: z
      .boolean()
      .optional()
      .describe('leitura: true (padrão) ajusta o saldo para o medido'),
    momento: z.string().optional().describe('data e hora ISO do lançamento (padrão: agora)'),
    documento: z.string().nullable().optional().describe('nota ou ticket'),
    terceiro: z.string().nullable().optional().describe('fornecedor (entrada) ou destino (saída)'),
    origem: z
      .enum(['movimento', 'leitura'])
      .optional()
      .describe('excluir_lancamento: de qual tabela'),
    lancamento_id: z.string().uuid().optional(),
    passo_cm: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('tabela: intervalo das linhas (padrão 10)'),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: { tabelas: ['estoque_ativo', 'estoque_movimento', 'estoque_leitura'] },
  async executar(a) {
    const id = (): string => exigir(a.id, 'id', a.acao)
    switch (a.acao) {
      case 'listar':
        return ler('vw_estoque_saldo', {
          filtros: [eq('obra_id', exigir(a.obra_id, 'obra_id', a.acao))],
          ordem: [{ coluna: 'tipo', asc: false }, { coluna: 'nome' }]
        })
      case 'extrato':
        return ler('vw_estoque_extrato', {
          filtros: [eq('ativo_id', id())],
          ordem: [{ coluna: 'ordem' }]
        })
      case 'calcular': {
        const { tanque, tabela } = medidasDoTanque(exigir(a.dimensoes, 'dimensoes', a.acao))
        return {
          capacidade_litros: Math.round(capacidade(tanque) * 100) / 100,
          altura_cm: alturaTotal(tanque),
          tabela: resumir(tabela, a.passo_cm ?? 10)
        }
      }
      case 'salvar_tanque': {
        const comuns: Record<string, unknown> = {}
        for (const k of [
          'nome',
          'recurso_id',
          'lat',
          'lng',
          'estoque_minimo',
          'ativo',
          'obs',
          'leitura_por',
          'altura_referencia_cm',
          'densidade_kg_l'
        ] as const)
          if (a[k] !== undefined) comuns[k] = a[k]
        if (a.dimensoes !== undefined) {
          const { tanque, tabela } = medidasDoTanque(a.dimensoes)
          Object.assign(comuns, {
            forma: tanque.forma,
            dimensoes: tanque,
            tabela,
            tabela_versao: VERSAO_TABELA,
            capacidade: tabela[tabela.length - 1]
          })
        }
        if (a.id) return (await gravar('estoque_ativo', 'update', comuns, [eq('id', a.id)]))[0]
        exigir(a.dimensoes, 'dimensoes', a.acao)
        return (
          await gravar('estoque_ativo', 'insert', {
            ...comuns,
            obra_id: exigir(a.obra_id, 'obra_id', a.acao),
            tipo: 'tanque',
            unidade: 'L',
            nome: exigir(a.nome, 'nome', a.acao),
            recurso_id: exigir(a.recurso_id, 'recurso_id', a.acao),
            lat: exigir(a.lat, 'lat', a.acao),
            lng: exigir(a.lng, 'lng', a.acao)
          })
        )[0]
      }
      case 'salvar_deposito': {
        const p: Record<string, unknown> = {}
        for (const k of [
          'nome',
          'recurso_id',
          'lat',
          'lng',
          'estoque_minimo',
          'ativo',
          'obs',
          'unidade',
          'capacidade'
        ] as const)
          if (a[k] !== undefined) p[k] = a[k]
        if (a.id) return (await gravar('estoque_ativo', 'update', p, [eq('id', a.id)]))[0]
        return (
          await gravar('estoque_ativo', 'insert', {
            ...p,
            obra_id: exigir(a.obra_id, 'obra_id', a.acao),
            tipo: 'deposito',
            // sem unidade, o banco usa a do material
            unidade: a.unidade ?? '',
            nome: exigir(a.nome, 'nome', a.acao),
            recurso_id: exigir(a.recurso_id, 'recurso_id', a.acao),
            capacidade: exigir(a.capacidade, 'capacidade', a.acao),
            lat: exigir(a.lat, 'lat', a.acao),
            lng: exigir(a.lng, 'lng', a.acao)
          })
        )[0]
      }
      case 'excluir_ativo': {
        const pedido = pedirConfirmacao(a.confirmar, 'excluir o ativo de estoque', {
          id: id(),
          aviso: 'os movimentos e as leituras dele também são excluídos'
        })
        if (pedido) return pedido
        await gravar('estoque_ativo', 'delete', null, [eq('id', id())])
        return { excluido: id() }
      }
      case 'entrada':
      case 'saida': {
        const informada = exigir(a.quantidade, 'quantidade', a.acao)
        const emToneladas = a.unidade === 't'
        let quantidade = informada
        if (emToneladas) {
          // toneladas viram litros: 1 t = 1000 kg ÷ (kg/L); sem densidade no pedido, vale a do tanque
          let densidade = a.densidade_kg_l ?? null
          if (!densidade) {
            const [at] = await ler<{ densidade_kg_l: number | null }>('vw_estoque_saldo', {
              colunas: 'densidade_kg_l',
              filtros: [eq('id', id())]
            })
            densidade = at?.densidade_kg_l ? Number(at.densidade_kg_l) : null
          }
          if (!densidade)
            throw new Error('Para lançar em toneladas, informe densidade_kg_l (o tanque não tem).')
          quantidade = Math.round(((informada * 1000) / densidade) * 100) / 100
          a.densidade_kg_l = densidade
        }
        return (
          await gravar('estoque_movimento', 'insert', {
            ativo_id: id(),
            tipo: a.acao,
            momento: a.momento ?? AGORA(),
            quantidade,
            quantidade_informada: emToneladas ? informada : null,
            unidade_informada: emToneladas ? 't' : null,
            densidade_kg_l: emToneladas ? a.densidade_kg_l : null,
            documento: a.documento ?? null,
            terceiro: a.terceiro ?? null,
            obs: a.obs ?? null
          })
        )[0]
      }
      case 'leitura': {
        if (a.leitura_cm === undefined && a.quantidade === undefined)
          throw new Error(
            'A leitura precisa de "leitura_cm" (tanque: número lido na régua) ou "quantidade" (depósito).'
          )
        const [linha] = await gravar<{ id: string }>('estoque_leitura', 'insert', {
          ativo_id: id(),
          momento: a.momento ?? AGORA(),
          leitura_cm: a.leitura_cm ?? null,
          // no tanque o banco calcula a quantidade pela tabela; a coluna é obrigatória, vai zero
          quantidade: a.quantidade ?? 0,
          temperatura_c: a.temperatura_c ?? null,
          ajusta_saldo: a.ajusta_saldo ?? true,
          obs: a.obs ?? null
        })
        // devolve a linha do extrato: traz os litros, o saldo depois dela e a diferença apurada
        const [noExtrato] = await ler('vw_estoque_extrato', { filtros: [eq('id', linha.id)] })
        return noExtrato ?? linha
      }
      case 'excluir_lancamento': {
        const origem = exigir(a.origem, 'origem', a.acao)
        const alvo = exigir(a.lancamento_id, 'lancamento_id', a.acao)
        const pedido = pedirConfirmacao(a.confirmar, `excluir ${origem} do estoque`, { id: alvo })
        if (pedido) return pedido
        await gravar(
          origem === 'movimento' ? 'estoque_movimento' : 'estoque_leitura',
          'delete',
          null,
          [eq('id', alvo)]
        )
        return { excluido: alvo }
      }
      case 'tabela': {
        const [at] = await ler<{ tabela: Array<number | string> | null; nome: string }>(
          'estoque_ativo',
          { colunas: 'nome, tabela, leitura_por, altura_referencia_cm', filtros: [eq('id', id())] }
        )
        if (!at?.tabela)
          throw new Error('Este ativo não é um tanque (não tem tabela de arqueação).')
        return { ...at, tabela: resumir(at.tabela.map(Number), a.passo_cm ?? 10) }
      }
    }
  }
})
