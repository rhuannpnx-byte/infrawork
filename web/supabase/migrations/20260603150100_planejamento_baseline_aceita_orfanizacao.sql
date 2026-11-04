-- ─────────────────────────────────────────────────────────────────────────
-- Permite orfanização de tarefa via FK SET NULL mesmo em baseline.
-- ─────────────────────────────────────────────────────────────────────────
-- Contexto: o item_orcamentario_id de planejamento_tarefa passou a ser
-- nullable + ON DELETE SET NULL na migração anterior, para permitir excluir
-- itens do orçamento que já têm tarefas — as tarefas ficam órfãs como
-- histórico.
--
-- Porém, o trigger fn_planejamento_baseline_imutavel bloqueava o UPDATE
-- (item_orcamentario_id) gerado pelo FK SET NULL. Esse cenário específico
-- (NEW.item_orcamentario_id IS NULL, OLD.item_orcamentario_id IS NOT NULL)
-- é semanticamente "desvincular tarefa do item" e é exatamente o caso de uso
-- aprovado: a baseline preserva todos os outros campos (datas, duração,
-- ordem), só perde o ponteiro pro item — que de qualquer forma virou null
-- porque o item foi removido do orçamento.

create or replace function public.fn_planejamento_baseline_imutavel()
returns trigger
language plpgsql
as $$
declare
  plan_id    uuid;
  is_base    boolean;
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'planejamento_tarefa' then
      plan_id := old.planejamento_id;
    elsif tg_table_name = 'planejamento_dependencia' then
      plan_id := old.planejamento_id;
    elsif tg_table_name = 'planejamento_tarefa_equipe' then
      select planejamento_id into plan_id
        from public.planejamento_tarefa where id = old.tarefa_id;
    end if;
  else
    if tg_table_name = 'planejamento_tarefa' then
      plan_id := new.planejamento_id;
      -- Exceção: orfanização (item_orcamentario_id NOT NULL → NULL).
      -- Ocorre via FK ON DELETE SET NULL quando item do orçamento é apagado.
      -- Esse cenário foi explicitamente aprovado mesmo em baseline.
      if old.item_orcamentario_id is not null
         and new.item_orcamentario_id is null then
        return new;
      end if;
    elsif tg_table_name = 'planejamento_dependencia' then
      plan_id := new.planejamento_id;
    elsif tg_table_name = 'planejamento_tarefa_equipe' then
      select planejamento_id into plan_id
        from public.planejamento_tarefa where id = new.tarefa_id;
    end if;
  end if;

  select is_baseline into is_base from public.planejamento where id = plan_id;
  if coalesce(is_base, false) = false then
    return coalesce(new, old);
  end if;
  raise exception 'Planejamento marcado como baseline é imutável. Crie uma nova revisão para editar.';
end
$$;
