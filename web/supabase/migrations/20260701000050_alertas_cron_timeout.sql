-- Recálculo horário dos alertas: o agendador esperava 5 s (padrão do pg_net) e a rodada já leva mais que isso com a
-- leitura completa da produção (a função terminava, mas a chamada ficava registrada como timeout). Espera 60 s.

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
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) as request_id;
  $$
);
