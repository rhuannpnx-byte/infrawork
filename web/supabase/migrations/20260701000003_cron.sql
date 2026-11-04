-- InfraWork Web — pg_cron: recálculo horário dos alertas de acompanhamento.
--
-- A URL do projeto e a service_role key vêm do Vault (não ficam no SQL):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key>', 'service_role_key');
-- Rodar uma vez por ambiente (local e remoto) ANTES de esperar o job funcionar.
-- O job é idempotente (desagenda e reagenda).

select cron.unschedule(jobid) from cron.job where jobname = 'acompanhamento-alertas-todos';

select cron.schedule(
  'acompanhamento-alertas-todos',
  '0 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/acompanhamento-alertas-recalcular',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
