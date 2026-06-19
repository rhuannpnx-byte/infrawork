-- InfraWork — WhatsApp: âncora de mensagem por grupo (para backfill on-demand)
--
-- O backfill do histórico (whatsapp_job) usa fetchMessageHistory do Baileys, que
-- exige uma "âncora": a chave + timestamp de uma mensagem existente do grupo, a
-- partir da qual o WhatsApp pagina mensagens mais antigas. O agente registra
-- aqui a última mensagem vista de cada grupo monitorado (ao vivo / no sync),
-- de modo que a âncora sobreviva a reinícios do agente.
--
-- Formato de ultima_msg: { "id": text, "fromMe": bool, "ts": bigint(segundos) }

alter table public.whatsapp_grupo
  add column if not exists ultima_msg jsonb;
