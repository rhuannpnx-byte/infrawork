-- InfraWork Web — rodada diária da FleetHub espera até 180 s (a leitura da cubagem levou a rodada a ~77 s).

select cron.unschedule(jobid) from cron.job where jobname = 'fleethub-sync-diario';
select cron.schedule(
  'fleethub-sync-diario',
  '0 8 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/fleethub-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{"origem":"cron"}'::jsonb,
      timeout_milliseconds := 180000
    ) as request_id;
  $$
);
