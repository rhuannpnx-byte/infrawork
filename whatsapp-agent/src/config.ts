// Carrega e valida a configuração via variáveis de ambiente.
// Node 20+ carrega .env automaticamente quando rodado com `--env-file=.env`
// (ver script start/dev). Não dependemos de dotenv.

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`)
  return v
}

function num(name: string, fallback: number): number {
  const v = process.env[name]
  if (!v) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export const config = {
  supabaseUrl: req('SUPABASE_URL'),
  supabaseServiceKey: req('SUPABASE_SERVICE_ROLE_KEY'),
  openrouterApiKey: req('OPENROUTER_API_KEY'),
  openrouterModel: process.env.OPENROUTER_MODEL || 'google/gemini-3.5-flash',
  // Modelo de texto do Oráculo (tool-calling). Pode ser mais forte que o de visão.
  openrouterModelRag:
    process.env.OPENROUTER_MODEL_RAG || process.env.OPENROUTER_MODEL || 'google/gemini-3.5-flash',
  bucketFotos: process.env.SUPABASE_BUCKET_FOTOS || 'monito-fotos',
  // Sync completo do histórico a cada conexão é um forte sinal de bot. Default
  // false; o backfill ainda funciona via fetchMessageHistory sob demanda.
  baileysSyncFullHistory:
    (process.env.BAILEYS_SYNC_FULL_HISTORY ?? 'false').toLowerCase() === 'true',
  pollConfigMs: num('POLL_CONFIG_MS', 5000),
  discoverGroupsMs: num('DISCOVER_GROUPS_MS', 300_000),
  confiancaMinima: num('CONFIANCA_MINIMA', 0.6),
  // Oráculo
  oraculoMaxFotos: num('ORACULO_MAX_FOTOS', 10),
  // Teto de tokens de SAÍDA por chamada ao OpenRouter. Sem isto o OpenRouter
  // reserva o máximo do modelo (dezenas de milhares) como caução de crédito e
  // rejeita com 402 quando o saldo não cobre a reserva. Respostas do Oráculo são
  // curtas (mensagens de WhatsApp); 2048 é folgado e mantém a reserva baixa.
  oraculoMaxTokens: num('ORACULO_MAX_TOKENS', 2048),
  visionMaxTokens: num('VISION_MAX_TOKENS', 1024),
  // Janela DESLIZANTE da sessão de conversa sobre uma obra. A cada mensagem o
  // relógio reinicia; após este tempo de inatividade a obra "expira" e o usuário
  // escolhe de novo. Trocar de obra (comando/linguagem) também renova a janela.
  oraculoSessaoTtlMin: num('ORACULO_SESSAO_TTL_MIN', num('ORACULO_CONVERSA_TTL_MIN', 30)),
  oraculoHistoricoMax: num('ORACULO_HISTORICO_MAX', 10),
  logLevel: process.env.LOG_LEVEL || 'info'
} as const
