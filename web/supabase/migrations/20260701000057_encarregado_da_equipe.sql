-- 0057 — Uma regra só para o encarregado: equipe informada sem encarregado recebe o encarregado da equipe.
-- Antes, só o formulário de lançamento do web preenchia; lote, importação, ficha de viagens, app de campo e MCP
-- gravavam a produção sem encarregado. A escolha explícita nunca é trocada. A produção que vem das viagens recebe
-- equipe e encarregado da ficha (que passa a seguir a mesma regra).

create function public.fn_encarregado_da_equipe()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.encarregado_id is null and new.equipe_id is not null
     and (tg_op = 'INSERT' or new.equipe_id is distinct from old.equipe_id)
     and (tg_table_name <> 'acompanhamento_producao' or new.origem is distinct from 'viagens') then
    select e.encarregado_id into new.encarregado_id from public.equipe e where e.id = new.equipe_id;
  end if;
  return new;
end
$$;

-- "trg_a_" roda antes dos outros gatilhos BEFORE (ordem alfabética), que validam o encarregado
create trigger trg_a_encarregado_da_equipe before insert or update of equipe_id, encarregado_id
  on public.acompanhamento_producao for each row execute function public.fn_encarregado_da_equipe();
create trigger trg_a_encarregado_da_equipe before insert or update of equipe_id, encarregado_id
  on public.viagem_ficha for each row execute function public.fn_encarregado_da_equipe();
