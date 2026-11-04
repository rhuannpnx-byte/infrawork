-- ─────────────────────────────────────────────────────────────────────────
-- Relaxa planejamento_tarefa.item_orcamentario_id para nullable + SET NULL
-- ─────────────────────────────────────────────────────────────────────────
-- Antes: NOT NULL + ON DELETE RESTRICT — impedia apagar item do orçamento
-- que já tinha tarefa atrelada (inclusive em linha de base).
--
-- Depois: nullable + ON DELETE SET NULL — apagar o item orfaniza a tarefa,
-- preservando a história. Tarefas órfãs ficam fora de planejamento_completo
-- (que usa INNER JOIN com item_orcamentario).
--
-- Decisão de produto: usuário aceita órfão, vê na revisão da obra que ficou
-- pendente, e decide manualmente (re-vincular ou apagar tarefa).

alter table public.planejamento_tarefa
  drop constraint if exists planejamento_tarefa_item_orcamentario_id_fkey;

alter table public.planejamento_tarefa
  alter column item_orcamentario_id drop not null;

alter table public.planejamento_tarefa
  add constraint planejamento_tarefa_item_orcamentario_id_fkey
  foreign key (item_orcamentario_id) references public.item_orcamentario(id)
  on delete set null;

-- O trigger fn_tarefa_so_aceita_servico_grupo (BEFORE INSERT OR UPDATE OF
-- item_orcamentario_id) erra quando o novo valor é null. Como SET NULL gera
-- exatamente esse cenário, precisa tolerar null silenciosamente.

create or replace function public.fn_tarefa_so_aceita_servico_grupo()
returns trigger
language plpgsql
as $$
declare
  item_tipo text;
  item_obra uuid;
  plan_obra uuid;
begin
  if new.item_orcamentario_id is null then
    return new;
  end if;

  select tipo, obra_id into item_tipo, item_obra
    from public.item_orcamentario where id = new.item_orcamentario_id;
  if item_tipo is null then
    raise exception 'item_orcamentario % inexistente', new.item_orcamentario_id;
  end if;
  if item_tipo <> 'servico_grupo' then
    raise exception 'Apenas itens do tipo servico_grupo podem virar tarefa (tipo=%)', item_tipo;
  end if;

  select obra_id into plan_obra from public.planejamento where id = new.planejamento_id;
  if plan_obra <> item_obra then
    raise exception 'tarefa: planejamento.obra_id (%) difere de item_orcamentario.obra_id (%)',
      plan_obra, item_obra;
  end if;
  return new;
end
$$;
