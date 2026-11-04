-- InfraWork Web — excluir obra (delete-obra) com composições, orçamento, planos e linhas de base.
--
-- A função apaga a obra e deixa as cascatas levarem o resto. Algumas chaves estrangeiras DENTRO da obra eram
-- ON DELETE RESTRICT, que o Postgres confere na hora (no meio da cascata, conforme a ordem em que as linhas somem):
-- "update or delete on table recurso violates foreign key constraint cpu_item_recurso_id_fkey". Com NO ACTION a
-- conferência fica para o fim do comando: apagar a obra inteira passa (pai e filhos somem juntos) e apagar só o pai
-- continua recusado do mesmo jeito (o filho ainda existe no fim do comando).
do $$
declare
  r record;
  def text;
begin
  for r in
    select c.conrelid::regclass as tabela, c.conname
      from pg_constraint c
     where c.contype = 'f'
       and c.connamespace = 'public'::regnamespace
       and (c.conrelid::regclass::text, c.conname) in (
         ('servico', 'servico_parent_id_fkey'),
         ('cpu_item', 'cpu_item_recurso_id_fkey'),
         ('item_orcamentario', 'item_orcamentario_servico_id_fkey'),
         ('item_orcamentario', 'item_orcamentario_parent_id_fkey'),
         ('indireto_item', 'indireto_item_parent_id_fkey'),
         ('planejamento_tarefa', 'fk_plan_tarefa_parent'),
         ('planejamento_tarefa_equipe', 'planejamento_tarefa_equipe_equipe_id_fkey'),
         ('planejamento_baseline_snapshot', 'planejamento_baseline_snapshot_planejamento_id_fkey'))
       and pg_get_constraintdef(c.oid) like '%ON DELETE RESTRICT%'
  loop
    select replace(pg_get_constraintdef(c.oid), ' ON DELETE RESTRICT', '') into def
      from pg_constraint c where c.conrelid = r.tabela and c.conname = r.conname;
    execute format('alter table %s drop constraint %I', r.tabela, r.conname);
    execute format('alter table %s add constraint %I %s', r.tabela, r.conname, def);
  end loop;
end $$;

-- ─── Exclusão da obra inteira (delete-obra) ─────────────────────────────────────────────────────────────────────────
-- As travas de exclusão (aditivo/reajuste aplicado, receita alocada, linha de base imutável, cadeia travada, CPU
-- congelada, calendário padrão) protegem a obra em uso; apagar a obra inteira passa por cima delas, só dentro de
-- `excluir_obra` (flag local da transação `infrawork.excluindo_obra`).
create or replace function public.excluindo_obra()
returns boolean
language sql stable
as $$ select coalesce(current_setting('infrawork.excluindo_obra', true), '') = '1' $$;

-- cada função de trava ganha, logo no início do corpo, a saída quando a obra inteira está sendo apagada (uma
-- migração futura que redefinir uma delas precisa repetir a linha `if public.excluindo_obra() then ...`)
do $$
declare
  f record;
  def text;
  novo text;
begin
  for f in
    select p.oid, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('fn_aditivo_before', 'fn_aditivo_item_before', 'fn_cadeia_trava', 'fn_calendario_padrao',
                         'fn_cpu_snapshot_imutavel', 'fn_item_orc_bloqueia_exclusao_alocada', 'fn_lb_imutavel_generica',
                         'fn_planejamento_baseline_imutavel', 'fn_planejamento_estado', 'fn_ptps_baseline_imutavel',
                         'fn_reajuste_before', 'fn_reajuste_filho_before')
  loop
    def := pg_get_functiondef(f.oid);
    if position('excluindo_obra' in def) > 0 then continue; end if;
    novo := regexp_replace(def, '\mbegin\M', E'begin\n  if public.excluindo_obra() then return coalesce(new, old); end if;', 'i');
    if novo = def then raise exception 'excluir_obra: corpo de % sem BEGIN', f.proname; end if;
    execute novo;
  end loop;
end $$;

create or replace function public.excluir_obra(_obra_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform set_config('infrawork.excluindo_obra', '1', true);
  -- ordem: as chaves NO ACTION entre ramos da cascata (tarefa → equipe, item de CPU → recurso, item do orçamento →
  -- serviço, foto da linha de base → plano) são conferidas no fim de cada comando aninhado da cascata
  delete from public.planejamento_baseline_snapshot where obra_id = _obra_id;
  delete from public.planejamento where obra_id = _obra_id;
  delete from public.cpu where obra_id = _obra_id;
  delete from public.item_orcamentario where obra_id = _obra_id;
  delete from public.obras where id = _obra_id;
  perform set_config('infrawork.excluindo_obra', '', true);
end $$;
revoke all on function public.excluir_obra(uuid) from public, anon, authenticated;
grant execute on function public.excluir_obra(uuid) to service_role;
