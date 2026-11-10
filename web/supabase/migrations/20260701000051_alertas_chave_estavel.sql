-- Alertas: identidade estável e sincronização em vez de apagar e reinserir a cada hora.
--
-- `chave` identifica o alerta (tipo + serviço/tarefa/equipe + período/episódio), sem os números que mudam (dias sem
-- lançamento, razão do avanço, dias de atraso). Na rodada, o alerta que continua só tem título/números atualizados e
-- mantém criado_em e o silenciamento; o que deixou de existir vira "resolvido" automaticamente; o novo entra.
-- Silenciado (no prazo) ou resolvido à mão com a mesma chave não reabre.

alter table public.acompanhamento_alerta add column if not exists chave text;

-- os abertos atuais são recalculados na próxima rodada, já com chave
delete from public.acompanhamento_alerta where status = 'aberto';

drop index if exists public.idx_acomp_alerta_dedupe_aberto;
create unique index if not exists idx_acomp_alerta_chave_aberto
  on public.acompanhamento_alerta(obra_id, chave)
  where status = 'aberto';
create index if not exists idx_acomp_alerta_obra_chave
  on public.acompanhamento_alerta(obra_id, chave);

-- a sincronização (service role, sem usuário) atualiza título/contexto dos alertas que continuam
create or replace function public.fn_alerta_eng_whitelist()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.auth_role();
begin
  if auth.uid() is null or v_role in ('god', 'adm') then
    return new;
  end if;
  if new.tipo        <> old.tipo        then raise exception 'eng não pode mudar tipo do alerta';        end if;
  if new.severidade  <> old.severidade  then raise exception 'eng não pode mudar severidade do alerta';  end if;
  if new.contexto    <> old.contexto    then raise exception 'eng não pode mudar contexto do alerta';    end if;
  if new.titulo      <> old.titulo      then raise exception 'eng não pode mudar título do alerta';      end if;
  if new.obra_id     <> old.obra_id     then raise exception 'eng não pode mudar obra do alerta';        end if;
  if new.chave is distinct from old.chave then raise exception 'eng não pode mudar a chave do alerta';   end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.acompanhamento_alertas_sincronizar(p_obra_id uuid, p_alertas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resolvidos int := 0;
  v_atualizados int := 0;
  v_reabertos int := 0;
  v_inseridos int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('acompanhamento_alertas:' || p_obra_id::text));

  if to_regclass('pg_temp._alerta_novo') is null then
    create temp table _alerta_novo (
      chave text primary key,
      tipo text,
      severidade text,
      titulo text,
      descricao text,
      contexto jsonb
    ) on commit drop;
  else
    truncate _alerta_novo;
  end if;

  insert into _alerta_novo
  select distinct on (x.chave) x.chave, x.tipo, x.severidade, x.titulo, x.descricao, coalesce(x.contexto, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_alertas, '[]'::jsonb))
         as x(chave text, tipo text, severidade text, titulo text, descricao text, contexto jsonb)
   where coalesce(x.chave, '') <> ''
   order by x.chave;

  -- deixou de existir: aberto (ou silenciado vencido) vira resolvido automaticamente
  update public.acompanhamento_alerta a
     set status = 'resolvido', resolvido_em = now(), resolvido_automaticamente = true, silenciado_ate = null
   where a.obra_id = p_obra_id
     and (a.status = 'aberto' or (a.status = 'silenciado' and a.silenciado_ate is not null and a.silenciado_ate <= now()))
     and not exists (select 1 from _alerta_novo n where n.chave = a.chave);
  get diagnostics v_resolvidos = row_count;

  -- continua aberto: atualiza os números, mantém criado_em
  update public.acompanhamento_alerta a
     set severidade = n.severidade, titulo = n.titulo, descricao = n.descricao, contexto = n.contexto, updated_at = now()
    from _alerta_novo n
   where a.obra_id = p_obra_id and a.status = 'aberto' and a.chave = n.chave
     and (a.severidade, a.titulo, a.descricao, a.contexto) is distinct from (n.severidade, n.titulo, n.descricao, n.contexto);
  get diagnostics v_atualizados = row_count;

  -- silenciamento venceu e a condição continua: reabre o mesmo alerta
  update public.acompanhamento_alerta a
     set status = 'aberto', silenciado_ate = null, silenciado_por = null,
         severidade = n.severidade, titulo = n.titulo, descricao = n.descricao, contexto = n.contexto, updated_at = now()
    from _alerta_novo n
   where a.id in (
           select distinct on (s.chave) s.id
             from public.acompanhamento_alerta s
            where s.obra_id = p_obra_id and s.status = 'silenciado'
              and s.silenciado_ate is not null and s.silenciado_ate <= now()
            order by s.chave, s.silenciado_ate desc
         )
     and a.chave = n.chave
     and not exists (
           select 1 from public.acompanhamento_alerta o
            where o.obra_id = p_obra_id and o.chave = a.chave and o.status = 'aberto'
         );
  get diagnostics v_reabertos = row_count;

  -- novo: só se não houver aberto, silenciado ou resolvido à mão com a mesma chave
  insert into public.acompanhamento_alerta (obra_id, chave, tipo, severidade, titulo, descricao, contexto)
  select p_obra_id, n.chave, n.tipo, n.severidade, n.titulo, n.descricao, n.contexto
    from _alerta_novo n
   where not exists (
           select 1 from public.acompanhamento_alerta a
            where a.obra_id = p_obra_id and a.chave = n.chave
              and (a.status in ('aberto', 'silenciado')
                   or (a.status = 'resolvido' and a.resolvido_automaticamente = false))
         );
  get diagnostics v_inseridos = row_count;

  return jsonb_build_object(
    'inseridos', v_inseridos,
    'atualizados', v_atualizados,
    'reabertos', v_reabertos,
    'resolvidos', v_resolvidos,
    'abertos', (select count(*) from public.acompanhamento_alerta where obra_id = p_obra_id and status = 'aberto')
  );
end $$;

alter function public.acompanhamento_alertas_sincronizar(uuid, jsonb) owner to postgres;
revoke all on function public.acompanhamento_alertas_sincronizar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.acompanhamento_alertas_sincronizar(uuid, jsonb) to service_role;
