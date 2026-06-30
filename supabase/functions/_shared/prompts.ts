// Prompts de processamento (system prompts) das etapas de IA do módulo
// Documentação Oficial. Editáveis por obra via extracao_template.prompts
// (chave→texto). Aqui ficam os DEFAULTS e o loader. Apenas o FRAMING (persona +
// regras) é editável; as partes MÁQUINA-CRÍTICAS (esquema JSON, lista de
// campos/grupos, trechos) continuam sendo montadas em CÓDIGO nas funções.
//
// ⚠️ Mantenha PROMPT_DEFAULTS em sincronia com o catálogo do renderer
// (src/renderer/src/types/documentacao-prompts.ts).

// deno-lint-ignore no-explicit-any
type Admin = any

export type PromptKey =
  | 'extracao_sistema'
  | 'aderencia_sistema'
  | 'clausula_sistema'
  | 'agente_sistema'
  | 'transcricao_sistema'

export const PROMPT_KEYS: PromptKey[] = [
  'extracao_sistema',
  'aderencia_sistema',
  'clausula_sistema',
  'agente_sistema',
  'transcricao_sistema'
]

export const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  extracao_sistema: `Você é analista documental de obras públicas no Brasil. Leia o DOCUMENTO e responda EXCLUSIVAMENTE às perguntas abaixo — não extraia nada fora desta lista. Responda SOMENTE com JSON válido (sem markdown).

REGRAS CRÍTICAS:
- Extraia LITERALMENTE do documento. NUNCA infira nem complete com conhecimento externo (ex.: não "chute" a lei vigente — só registre a lei se constar no texto).
- Use null quando o documento não trouxer a informação. Não invente.
- Datas no formato ISO AAAA-MM-DD (ou AAAA-MM se só houver mês). Valores monetários em R$ puro (ex.: 152173654.15), sem separador de milhar.
- Preserve identificadores com prefixo/máscara exatamente (ex.: "TT-392/2024", não "392/2024").
- Em listas de empresas, inclua apenas PESSOAS JURÍDICAS (com CNPJ); NÃO inclua pessoas físicas/representantes.
- Decodifique entidades HTML (ex.: "&amp;" → "&").
- O texto traz marcadores "[[page:N]]". Para cada resposta, informe a "pagina" (N) de onde extraiu; se não souber, null.
- Para cada valor, dê uma "confianca" honesta de 0 a 1.`,

  aderencia_sistema: `Você organiza documentos de obras de engenharia. O usuário quer ARQUIVAR um documento no grupo {{grupo}}.
Avalie se o documento ADERE a esse grupo. Se não aderir, indique o melhor grupo da lista. Oriente, não proíba.`,

  clausula_sistema: `Você é advogado(a)/engenheiro(a) analista de contratos de obras públicas no Brasil. Analise UMA cláusula no CONTEXTO do contrato e das demais cláusulas/aditivos fornecidos. Seja concreto e cite cláusulas relacionadas pelo número quando fizer sentido.`,

  agente_sistema: `{{escopo}} Responda SOMENTE com base nos TRECHOS fornecidos. Cite as fontes no formato [Fonte N] (com a página quando houver). Se a resposta NÃO estiver nos trechos, diga claramente que não encontrou e sugira onde procurar — NUNCA invente nem complete com conhecimento externo. Seja direto e objetivo, em PT-BR.`,

  transcricao_sistema: `Transcreva FIELMENTE todo o texto legível do documento. Sem resumo, sem markdown de cerca. Apenas o texto.`
}

/** Carrega os overrides de prompts da obra; cai p/ base da empresa; senão {}. */
export async function carregarPrompts(
  admin: Admin,
  obra_id: string
): Promise<Record<string, string>> {
  const { data: obra } = await admin
    .from('extracao_template')
    .select('prompts')
    .eq('obra_id', obra_id)
    .maybeSingle()
  let prompts = (obra?.prompts ?? {}) as Record<string, string>
  if (!prompts || Object.keys(prompts).length === 0) {
    const { data: o } = await admin.from('obras').select('empresa_id').eq('id', obra_id).maybeSingle()
    if (o?.empresa_id) {
      const { data: base } = await admin
        .from('extracao_template')
        .select('prompts')
        .is('obra_id', null)
        .eq('empresa_id', o.empresa_id)
        .maybeSingle()
      prompts = (base?.prompts ?? {}) as Record<string, string>
    }
  }
  return prompts && typeof prompts === 'object' ? prompts : {}
}

/**
 * Resolve o prompt da chave: usa o override (se não-vazio) ou o DEFAULT, e
 * substitui placeholders {{nome}} pelos valores de `vars`.
 */
export function promptDe(
  prompts: Record<string, string> | null | undefined,
  key: PromptKey,
  vars?: Record<string, string>
): string {
  const override = prompts && typeof prompts[key] === 'string' ? prompts[key].trim() : ''
  let t = override || PROMPT_DEFAULTS[key]
  if (vars) for (const [k, v] of Object.entries(vars)) t = t.split(`{{${k}}}`).join(v)
  return t
}
