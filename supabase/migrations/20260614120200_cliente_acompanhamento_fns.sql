-- InfraWork — funções de acesso de dados do CLIENTE (SECURITY DEFINER).
--
-- Por que funções e não SELECT direto nas views:
--   As views vw_acompanhamento_* são security_invoker = true, então dependem do
--   RLS das tabelas-base. Conceder ao cliente SELECT nessas tabelas (sobretudo
--   item_orcamentario) exporia venda_unitaria/custo/lucratividade — o "valor
--   agregado" que o cliente NÃO pode ver. As funções abaixo rodam como o OWNER
--   (postgres) — bypassam o RLS das bases — porém:
--     1) só retornam as colunas das views (que não têm preço/custo); e
--     2) filtram explicitamente por has_obra_permissao(_obra_id, auth.uid()),
--        garantindo que o cliente só vê obras concedidas a ele.
--
-- O front (hooks) chama estas funções via PostgREST RPC quando role = 'cliente'
-- e continua aplicando filtros/ordenação sobre o resultado (setof).
--
-- returns setof <view> reaproveita o tipo composto da view → mesma forma de
-- dados que o SELECT direto, sem duplicar a lógica das views.

-- ─── Curva-S (calendário planejado × executado + comparativo) ─────────────
create or replace function public.cliente_curva_s(_obra_id uuid)
returns setof public.vw_acompanhamento_curva_s
language sql
stable
security definer
set search_path = public
as $$
  select v.*
    from public.vw_acompanhamento_curva_s v
   where v.obra_id = _obra_id
     and public.has_obra_permissao(_obra_id, auth.uid())
$$;

-- ─── Previsto × Realizado (comparativo, sem projeções no front) ───────────
create or replace function public.cliente_previsto_realizado(_obra_id uuid)
returns setof public.vw_acompanhamento_previsto_x_realizado
language sql
stable
security definer
set search_path = public
as $$
  select v.*
    from public.vw_acompanhamento_previsto_x_realizado v
   where v.obra_id = _obra_id
     and public.has_obra_permissao(_obra_id, auth.uid())
$$;

-- ─── Produção (tabela de produção + sequência de ataque do mapa) ──────────
create or replace function public.cliente_producao(_obra_id uuid)
returns setof public.vw_acompanhamento_producao_enriquecida
language sql
stable
security definer
set search_path = public
as $$
  select v.*
    from public.vw_acompanhamento_producao_enriquecida v
   where v.obra_id = _obra_id
     and public.has_obra_permissao(_obra_id, auth.uid())
$$;

-- Owner = postgres (bypassa RLS das tabelas-base) e execução só p/ logados.
alter function public.cliente_curva_s(uuid)            owner to postgres;
alter function public.cliente_previsto_realizado(uuid) owner to postgres;
alter function public.cliente_producao(uuid)           owner to postgres;

revoke all on function public.cliente_curva_s(uuid)            from public;
revoke all on function public.cliente_previsto_realizado(uuid) from public;
revoke all on function public.cliente_producao(uuid)           from public;

grant execute on function public.cliente_curva_s(uuid)            to authenticated;
grant execute on function public.cliente_previsto_realizado(uuid) to authenticated;
grant execute on function public.cliente_producao(uuid)           to authenticated;
