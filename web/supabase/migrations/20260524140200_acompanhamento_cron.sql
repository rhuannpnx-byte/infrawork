-- InfraWork — Acompanhamento (Fase A): pg_cron agenda sync a cada 30 min.
--
-- Pré-requisito: secret 'service_role_key' deve existir em vault.secrets
-- (criado via SQL one-shot — não checado em migration porque depende do ambiente).

-- Idempotente: desagenda o job se já existir antes de re-agendar.
select cron.unschedule(jobid) from cron.job where jobname = 'acompanhamento-sync-todos';

select cron.schedule(
  'acompanhamento-sync-todos',
  '*/30 * * * *',
  $$
    select net.http_post(
      url := 'https://nuobtckwgfkqmwdzkugc.supabase.co/functions/v1/acompanhamento-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
