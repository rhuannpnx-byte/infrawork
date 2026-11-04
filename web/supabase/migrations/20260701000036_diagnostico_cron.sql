-- Diagnóstico do agendamento (só god): o job horário de alertas, as últimas execuções e se os segredos do vault que
-- ele usa existem (só os nomes, nunca os valores). Sem isso, um job quebrado falha em silêncio.
create or replace function public.diagnostico_cron()
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare r jsonb;
begin
  if public.auth_role() is distinct from 'god' then raise exception 'Só o god consulta o diagnóstico'; end if;
  select jsonb_build_object(
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('nome', jobname, 'agenda', schedule, 'ativo', active))
                        from cron.job), '[]'::jsonb),
    'ultimas', coalesce((select jsonb_agg(x) from (
                 select jsonb_build_object('status', d.status, 'inicio', d.start_time, 'fim', d.end_time,
                                           'mensagem', left(d.return_message, 300)) as x
                   from cron.job_run_details d order by d.start_time desc limit 10) t), '[]'::jsonb),
    'segredos', coalesce((select jsonb_agg(name order by name) from vault.secrets
                           where name in ('project_url', 'service_role_key')), '[]'::jsonb),
    'respostas_http', coalesce((select jsonb_agg(x) from (
                 select jsonb_build_object('status', status_code, 'criado', created, 'erro', left(error_msg, 200),
                                           'corpo', left(content::text, 200)) as x
                   from net._http_response order by created desc limit 5) t), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.diagnostico_cron() from public, anon;
grant execute on function public.diagnostico_cron() to authenticated;
