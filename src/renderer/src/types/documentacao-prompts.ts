// Catálogo dos system prompts de processamento (editáveis por obra). Espelha os
// DEFAULTS do edge `supabase/functions/_shared/prompts.ts` — manter em sincronia.
// Apenas o FRAMING (persona + regras) é editável; o esquema JSON e as listas de
// campos/grupos continuam sendo montados em código pelas edge functions.

export type PromptKey =
  | 'extracao_sistema'
  | 'aderencia_sistema'
  | 'clausula_sistema'
  | 'agente_sistema'
  | 'transcricao_sistema'

export interface PromptDef {
  key: PromptKey
  titulo: string
  descricao: string
  /** Placeholders {{x}} que o sistema injeta — preserve-os no texto. */
  placeholders: string[]
  /** O que o código anexa automaticamente depois do seu texto. */
  anexadoPeloSistema: string
  default: string
}

export const PROMPT_CATALOGO: PromptDef[] = [
  {
    key: 'extracao_sistema',
    titulo: 'Extração de campos',
    descricao:
      'Instruções gerais para o modelo extrair os campos do template de cada documento. As perguntas de cada campo vêm do Template de extração.',
    placeholders: [],
    anexadoPeloSistema:
      'A lista de CAMPOS (escalares e listas) com suas perguntas + o FORMATO DE RESPOSTA (JSON).',
    default: `Você é analista documental de obras públicas no Brasil. Leia o DOCUMENTO e responda EXCLUSIVAMENTE às perguntas abaixo — não extraia nada fora desta lista. Responda SOMENTE com JSON válido (sem markdown).

REGRAS CRÍTICAS:
- Extraia LITERALMENTE do documento. NUNCA infira nem complete com conhecimento externo (ex.: não "chute" a lei vigente — só registre a lei se constar no texto).
- Use null quando o documento não trouxer a informação. Não invente.
- Datas no formato ISO AAAA-MM-DD (ou AAAA-MM se só houver mês). Valores monetários em R$ puro (ex.: 152173654.15), sem separador de milhar.
- Preserve identificadores com prefixo/máscara exatamente (ex.: "TT-392/2024", não "392/2024").
- Em listas de empresas, inclua apenas PESSOAS JURÍDICAS (com CNPJ); NÃO inclua pessoas físicas/representantes.
- Decodifique entidades HTML (ex.: "&amp;" → "&").
- O texto traz marcadores "[[page:N]]". Para cada resposta, informe a "pagina" (N) de onde extraiu; se não souber, null.
- Para cada valor, dê uma "confianca" honesta de 0 a 1.`
  },
  {
    key: 'aderencia_sistema',
    titulo: 'Aderência (inserção guiada)',
    descricao:
      'Avalia se um documento inserido adere ao grupo escolhido pelo usuário e sugere um grupo melhor (orienta, não bloqueia).',
    placeholders: ['{{grupo}}'],
    anexadoPeloSistema: 'A lista de GRUPOS DISPONÍVEIS + o FORMATO DE RESPOSTA (JSON).',
    default: `Você organiza documentos de obras de engenharia. O usuário quer ARQUIVAR um documento no grupo {{grupo}}.
Avalie se o documento ADERE a esse grupo. Se não aderir, indique o melhor grupo da lista. Oriente, não proíba.`
  },
  {
    key: 'clausula_sistema',
    titulo: 'Análise de cláusula',
    descricao:
      'Análise rica de uma cláusula do contrato, no contexto das demais cláusulas e aditivos (resumo, risco, implicações).',
    placeholders: [],
    anexadoPeloSistema: 'O FORMATO DE RESPOSTA (JSON: resumo, risco, implicações, referências…).',
    default: `Você é advogado(a)/engenheiro(a) analista de contratos de obras públicas no Brasil. Analise UMA cláusula no CONTEXTO do contrato e das demais cláusulas/aditivos fornecidos. Seja concreto e cite cláusulas relacionadas pelo número quando fizer sentido.`
  },
  {
    key: 'agente_sistema',
    titulo: 'Agente / Conversar (RAG)',
    descricao:
      'Como o agente responde perguntas sobre o acervo (ou sobre um documento). Os trechos recuperados vão na mensagem do usuário.',
    placeholders: ['{{escopo}}'],
    anexadoPeloSistema: 'Os TRECHOS recuperados (na mensagem do usuário, não aqui).',
    default: `{{escopo}} Responda SOMENTE com base nos TRECHOS fornecidos. Cite as fontes no formato [Fonte N] (com a página quando houver). Se a resposta NÃO estiver nos trechos, diga claramente que não encontrou e sugira onde procurar — NUNCA invente nem complete com conhecimento externo. Seja direto e objetivo, em PT-BR.`
  },
  {
    key: 'transcricao_sistema',
    titulo: 'Transcrição (OCR de fallback)',
    descricao:
      'Usado para transcrever o documento quando não há texto/OCR em cache (fallback de indexação).',
    placeholders: [],
    anexadoPeloSistema: 'Nada — usado como instrução direta.',
    default: `Transcreva FIELMENTE todo o texto legível do documento. Sem resumo, sem markdown de cerca. Apenas o texto.`
  }
]

export const PROMPT_DEFAULT_MAP: Record<PromptKey, string> = Object.fromEntries(
  PROMPT_CATALOGO.map((p) => [p.key, p.default])
) as Record<PromptKey, string>
