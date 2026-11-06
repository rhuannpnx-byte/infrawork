-- Visão estratégica no app: mapa de calor da produção diária (como a Performance do web), filtrável por serviço,
-- encarregado e equipe. O retrato passa a levar a produção dos últimos 90 dias somada por
-- (dia, serviço, equipe, encarregado), com os nomes de cada um.

alter function public.campo_painel(uuid) rename to campo_painel_base;
revoke all on function public.campo_painel_base(uuid) from public, anon, authenticated;

create or replace function public.campo_painel(_obra_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  desde date := hoje - 89;
  v jsonb;
begin
  v := public.campo_painel_base(_obra_id) - 'versao' - 'gerado_em';

  with
  prod as (
    select p.data, p.item_orcamentario_id as s, p.equipe_id as e, p.encarregado_id as n,
           sum(p.quantidade * p.fator_conversao) as q
      from public.acompanhamento_producao p
     where p.obra_id = _obra_id and p.data between desde and hoje and p.item_orcamentario_id is not null
     group by 1, 2, 3, 4
    having sum(p.quantidade * p.fator_conversao) > 0
  )
  select v || jsonb_build_object('producao', jsonb_build_object(
    'desde', desde,
    'dias', coalesce((select jsonb_agg(jsonb_build_object('d', data, 's', s, 'e', e, 'n', n, 'q', round(q, 4))
                                       order by data, s) from prod), '[]'::jsonb),
    'servicos', coalesce((select jsonb_object_agg(i.id, jsonb_build_object(
                                   'codigo', i.codigo, 'descricao', i.descricao, 'unidade', i.unidade_referencia))
                            from public.item_orcamentario i
                           where i.id in (select s from prod)), '{}'::jsonb),
    'equipes', coalesce((select jsonb_object_agg(eq.id, eq.nome)
                           from public.equipe eq where eq.id in (select e from prod)), '{}'::jsonb),
    'encarregados', coalesce((select jsonb_object_agg(enc.id, coalesce(enc.apelido, enc.nome))
                                from public.encarregado enc where enc.id in (select n from prod)), '{}'::jsonb)
  )) into v;

  return v || jsonb_build_object('versao', md5(v::text), 'gerado_em', now());
end $$;

alter function public.campo_painel(uuid) owner to postgres;
revoke all on function public.campo_painel(uuid) from public, anon;
grant execute on function public.campo_painel(uuid) to authenticated;
