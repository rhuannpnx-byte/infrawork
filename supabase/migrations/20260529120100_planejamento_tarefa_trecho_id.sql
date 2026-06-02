-- InfraWork — planejamento_tarefa.trecho_id (FK opcional ate o backfill)
--
-- Adiciona coluna nullable + FK ON DELETE RESTRICT. Backfill em migration sibling
-- preenche; depois outra migration faz SET NOT NULL + adiciona ao trigger de
-- imutabilidade da baseline.

alter table public.planejamento_tarefa
  add column if not exists trecho_id uuid;

do $$ begin
  alter table public.planejamento_tarefa add constraint fk_plan_tarefa_trecho
    foreign key (trecho_id) references public.obra_trecho(id) on delete restrict;
exception when duplicate_object then null; end $$;

create index if not exists idx_plan_tarefa_trecho on public.planejamento_tarefa(trecho_id);

-- ─── Validacao cross-obra: trecho_id pertence a obra do planejamento ───
-- Tarefa = planejamento.obra_id; trecho = obra_trecho.obra_id. Tem que casar.
create or replace function public.fn_tarefa_trecho_mesma_obra()
returns trigger
language plpgsql
as $$
declare
  plan_obra   uuid;
  trecho_obra uuid;
begin
  if new.trecho_id is null then return new; end if;
  select obra_id into plan_obra   from public.planejamento where id = new.planejamento_id;
  select obra_id into trecho_obra from public.obra_trecho  where id = new.trecho_id;
  if trecho_obra is null then
    raise exception 'trecho_id % inexistente', new.trecho_id;
  end if;
  if plan_obra <> trecho_obra then
    raise exception 'tarefa.trecho_id (%) pertence a outra obra (% vs %)',
      new.trecho_id, trecho_obra, plan_obra;
  end if;
  return new;
end
$$;

drop trigger if exists trg_tarefa_trecho_mesma_obra on public.planejamento_tarefa;
create trigger trg_tarefa_trecho_mesma_obra
  before insert or update of trecho_id, planejamento_id on public.planejamento_tarefa
  for each row execute function public.fn_tarefa_trecho_mesma_obra();
