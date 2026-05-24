-- InfraWork — Acompanhamento (Fase B): pg_cron agenda recálculo de alertas
--
-- Safety-net: recalcula alertas pra TODAS obras a cada 1h. O sync principal
-- já encadeia recálculo por obra ao final, mas o cron horário cobre casos
-- onde o baseline mudou no Planejamento sem haver sync de produção.

select cron.unschedule(jobid) from cron.job where jobname = 'acompanhamento-alertas-todos';

select cron.schedule(
  'acompanhamento-alertas-todos',
  '0 * * * *',
  $$
    select net.http_post(
      url := 'https://nuobtckwgfkqmwdzkugc.supabase.co/functions/v1/acompanhamento-alertas-recalcular',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    ) as request_id;
  $$
);
