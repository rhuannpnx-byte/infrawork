import { z } from 'zod'
import { CONFIRMAR, exigir, ferramenta, pedirConfirmacao } from '../ferramenta'
import { fn, rpc } from '../contexto'
import { eq, ler } from '../lib/banco'

const OBRA = z.string().uuid().describe('id da obra')

/** Uma linha do de-para entre o cadastro do SIGA e o do InfraWork. */
const DE_PARA = z.object({
  tipo: z.enum(['servico', 'equipe', 'encarregado', 'local']),
  externo_id: z.number().int().describe('código do registro no SIGA (vem de "cadastros")'),
  externo_nome: z.string().optional().describe('nome no SIGA (obrigatório, salvo com remover)'),
  externo_unidade: z.string().optional().describe('serviço: unidade em que o SIGA lança'),
  interno_id: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe(
      'serviço: id do agrupador do orçamento; equipe: id da equipe; encarregado: id do encarregado; local: id do trecho'
    ),
  fator_conversao: z
    .number()
    .positive()
    .optional()
    .describe('serviço: quantidade no InfraWork = quantidade do SIGA × fator (padrão 1)'),
  principal: z
    .boolean()
    .optional()
    .describe('entre os do SIGA ligados ao mesmo registro daqui, o que recebe a gravação'),
  ignorado: z
    .boolean()
    .optional()
    .describe('serviço fora do orçamento de propósito (não é pendência)'),
  criar: z
    .boolean()
    .optional()
    .describe('equipe e encarregado: cria no InfraWork com o nome do SIGA quando não há um igual'),
  remover: z.boolean().optional().describe('apaga este de-para')
})

/** A empresa da obra: as ações de usuário são da empresa, e o god precisa dizer qual. */
async function empresaDaObra(obraId: string): Promise<string> {
  const [obra] = await ler<{ empresa_id: string }>('obras', {
    colunas: 'empresa_id',
    filtros: [eq('id', obraId)]
  })
  if (!obra) throw new Error('Obra não encontrada')
  return obra.empresa_id
}

export const integracoes = ferramenta({
  nome: 'integracoes',
  titulo: 'Integrações (SIGA)',
  descricao:
    'Obra cuja produção vem de outro sistema (SIGA). O InfraWork continua sendo o modelo: o conector copia para ' +
    'cá a produção do projeto ligado à obra (a cada 10 minutos) e aplica o de-para. O SIGA é a verdade: ' +
    'lançamento de origem "siga" não é alterado nem excluído aqui. A conexão com o SIGA (servidor e senha) é ' +
    'feita só na tela Gerencial › Integrações. ' +
    'acao: status (o vínculo da obra, a última sincronização e o que está sem vínculo) | projetos (os projetos do ' +
    'SIGA, para escolher) | vincular (projeto_id, projeto_codigo, data_corte?: liga a obra ao projeto; trocar o ' +
    'projeto descarta o espelho e os de-para do anterior) | desvincular (tira da obra o que veio do SIGA) | ' +
    'cadastros (serviços, equipes com encarregado, encarregados e locais do projeto no SIGA, com quantos ' +
    'lançamentos usam cada um) | de_para (o que já está ligado) | salvar_de_para (linhas: liga ou desliga; vale ' +
    'para os lançamentos que já vieram) | sincronizar (lê o SIGA agora) | usuarios (os usuários ativos do SIGA e ' +
    'quem do InfraWork já está ligado a cada um; só god e adm) | vincular_usuario (user_id, externo_id: liga um ' +
    'usuário do InfraWork ao dele no SIGA; externo_id nulo desfaz). ' +
    'Para gravar no SIGA o lançamento leva o nome do usuário de lá: o apontador entra no app de campo com o ' +
    'usuário e a senha do SIGA (a conta nasce sozinha, e as obras são as dos projetos liberados para ele lá); ' +
    'engenheiro e apoio seguem com a conta do InfraWork, ligada ao usuário do SIGA por vincular_usuario. ' +
    'Gravação: gravacao (modo: desligada | simulacao | ligada; só god e adm) define se a obra recebe lançamento ' +
    'pelo InfraWork. Desligada: só leitura. Simulação: aceita o lançamento e guarda o que gravaria, sem gravar. ' +
    'Ligada: o que é lançado, alterado ou excluído na obra (pelas ferramentas de produção) vai para o SIGA por uma ' +
    'fila; nada é apagado lá (exclusão é marca). fila (o que foi, o que falta e o que falhou, com o motivo) | ' +
    'enviar (processa a fila agora) | reenviar (id?: tenta de novo o que falhou) | descartar (id: desiste de um ' +
    'envio; o lançamento que nunca chegou ao SIGA é excluído daqui). ' +
    'Um serviço do SIGA cai num agrupador do orçamento que tenha composição; sem vínculo, a produção entra com ' +
    'o nome do SIGA e fica como pendência (não conta no previsto e realizado).',
  entrada: {
    acao: z.enum([
      'status',
      'projetos',
      'vincular',
      'desvincular',
      'cadastros',
      'de_para',
      'salvar_de_para',
      'sincronizar',
      'usuarios',
      'vincular_usuario',
      'gravacao',
      'fila',
      'enviar',
      'reenviar',
      'descartar'
    ]),
    obra_id: OBRA,
    projeto_id: z.number().int().optional().describe('vincular: id do projeto no SIGA'),
    projeto_codigo: z.string().optional().describe('vincular: código do projeto no SIGA'),
    data_corte: z
      .string()
      .optional()
      .describe('vincular: AAAA-MM-DD; lançamentos anteriores não são trazidos'),
    linhas: z.array(DE_PARA).optional().describe('salvar_de_para'),
    user_id: z.string().uuid().optional().describe('vincular_usuario: id do usuário do InfraWork'),
    modo: z
      .enum(['desligada', 'simulacao', 'ligada'])
      .optional()
      .describe('gravacao: o modo da obra'),
    id: z.number().int().optional().describe('reenviar e descartar: id do envio (vem de "fila")'),
    externo_id: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe(
        'vincular_usuario: id do usuário no SIGA (vem de "usuarios"); nulo desfaz o vínculo'
      ),
    confirmar: CONFIRMAR
  },
  destrutiva: true,
  cobre: {
    tabelas: ['integracao_obra', 'integracao_de_para', 'integracao_usuario', 'integracao_saida'],
    rpcs: [
      'siga_vincular_obra',
      'siga_desvincular_obra',
      'siga_de_para_salvar',
      'siga_gravacao_definir',
      'siga_saida_reenviar',
      'siga_saida_descartar'
    ],
    funcoes: ['siga']
  },
  async executar(a) {
    const obra = [eq('obra_id', a.obra_id)]
    switch (a.acao) {
      case 'status': {
        const [vinculo] = await ler('integracao_obra', {
          colunas:
            'externo_projeto_id, externo_projeto_codigo, data_corte, traz_fotos, gravacao, ultimo_sync_em, ultimo_sync_ok, ultimo_sync_resumo, ultimo_sync_erro',
          filtros: obra
        })
        if (!vinculo) return { vinculada: false }
        return {
          vinculada: true,
          vinculo,
          pendencias: await ler('vw_siga_pendencias', {
            colunas: 'tipo, externo_id, externo_nome, lancamentos, ultimo',
            filtros: obra,
            ordem: [{ coluna: 'lancamentos', asc: false }],
            limite: 200
          })
        }
      }
      case 'projetos':
        return fn('siga', { acao: 'projetos', obra_id: a.obra_id })
      case 'cadastros':
        return fn('siga', { acao: 'cadastros', obra_id: a.obra_id })
      case 'vincular': {
        const projeto = exigir(a.projeto_id, 'projeto_id', a.acao)
        const [atual] = await ler<{ externo_projeto_id: number }>('integracao_obra', {
          colunas: 'externo_projeto_id',
          filtros: obra
        })
        if (atual && Number(atual.externo_projeto_id) !== projeto) {
          const pedido = pedirConfirmacao(a.confirmar, 'trocar o projeto do SIGA desta obra', {
            projeto_atual: atual.externo_projeto_id,
            projeto_novo: projeto,
            efeito: 'a produção trazida do projeto atual e os de-para saem da obra'
          })
          if (pedido) return pedido
        }
        await rpc('siga_vincular_obra', {
          _obra_id: a.obra_id,
          _projeto_id: projeto,
          _projeto_codigo: a.projeto_codigo ?? null,
          _data_corte: a.data_corte ?? null
        })
        return { vinculada: true, projeto_id: projeto }
      }
      case 'desvincular': {
        const pedido = pedirConfirmacao(a.confirmar, 'desvincular a obra do SIGA', {
          efeito: 'a produção que veio do SIGA e os de-para saem da obra (continuam no SIGA)'
        })
        if (pedido) return pedido
        await rpc('siga_desvincular_obra', { _obra_id: a.obra_id })
        return { vinculada: false }
      }
      case 'de_para':
        return ler('integracao_de_para', {
          colunas:
            'tipo, externo_id, externo_nome, externo_unidade, interno_id, fator_conversao, principal, ignorado',
          filtros: obra,
          ordem: [{ coluna: 'tipo' }, { coluna: 'externo_nome' }],
          limite: 1000
        })
      case 'salvar_de_para':
        return rpc('siga_de_para_salvar', {
          _obra_id: a.obra_id,
          _linhas: exigir(a.linhas, 'linhas', a.acao)
        })
      case 'sincronizar':
        return fn('siga', { acao: 'sincronizar', obra_id: a.obra_id })
      case 'gravacao': {
        const modo = exigir(a.modo, 'modo', a.acao)
        if (modo === 'ligada') {
          const pedido = pedirConfirmacao(a.confirmar, 'ligar a gravação desta obra no SIGA', {
            efeito:
              'o que for lançado, alterado ou excluído nesta obra passa a ser gravado no SIGA de produção'
          })
          if (pedido) return pedido
        }
        await rpc('siga_gravacao_definir', { _obra_id: a.obra_id, _modo: modo })
        return { gravacao: modo }
      }
      case 'fila':
        return ler('integracao_saida', {
          colunas:
            'id, operacao, estado, simulacao, tentativas, erro, enviado, rotulo, created_at, processado_em',
          filtros: obra,
          ordem: [{ coluna: 'id', asc: false }],
          limite: 100
        })
      case 'enviar':
        return fn('siga', { acao: 'enviar', obra_id: a.obra_id })
      case 'reenviar': {
        const n = await rpc('siga_saida_reenviar', { _obra_id: a.obra_id, _id: a.id ?? null })
        return { recolocados: n, envio: await fn('siga', { acao: 'enviar', obra_id: a.obra_id }) }
      }
      case 'descartar': {
        const id = exigir(a.id, 'id', a.acao)
        const pedido = pedirConfirmacao(a.confirmar, 'desistir deste envio ao SIGA', {
          efeito:
            'o lançamento que nunca chegou ao SIGA é excluído do InfraWork; o que já existe lá volta a ser o que está lá'
        })
        if (pedido) return pedido
        await rpc('siga_saida_descartar', { _obra_id: a.obra_id, _id: id })
        return { descartado: id }
      }
      case 'usuarios':
        return fn('siga', { acao: 'usuarios', empresa_id: await empresaDaObra(a.obra_id) })
      case 'vincular_usuario': {
        const usuario = exigir(a.user_id, 'user_id', a.acao)
        if (a.externo_id === undefined)
          throw new Error('vincular_usuario: informe externo_id (ou null para desfazer o vínculo)')
        if (a.externo_id === null) {
          const pedido = pedirConfirmacao(a.confirmar, 'desfazer o vínculo do usuário com o SIGA', {
            efeito: 'o usuário deixa de poder lançar em obra do SIGA'
          })
          if (pedido) return pedido
        }
        return fn('siga', {
          acao: 'vincular_usuario',
          empresa_id: await empresaDaObra(a.obra_id),
          user_id: usuario,
          externo_id: a.externo_id
        })
      }
    }
  }
})
