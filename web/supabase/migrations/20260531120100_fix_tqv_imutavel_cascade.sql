-- Fix: trigger fn_tqv_imutavel bloqueava DELETE em cascata quando o usuário
-- apagava o template inteiro, porque versões com is_atual=false não permitiam
-- DELETE em suas colunas/segmentos/células — mas essas exclusões vêm da
-- cascade FK do template/versão pai e são legítimas.
--
-- Solução: permite DELETE quando pg_trigger_depth() > 1 (estamos dentro de
-- outro trigger, ou seja, em cascade). UPDATE direto e DELETE direto pelo
-- usuário (depth = 1) continuam bloqueados em versões não-atuais.

create or replace function public.fn_tqv_imutavel()
returns trigger language plpgsql as $$
declare v_versao uuid; v_atual boolean;
begin
  -- Permite DELETE em cascata (vindo de delete no pai)
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_table_name = 'trecho_quantidade_coluna' then
    v_versao := coalesce(new.versao_id, old.versao_id);
  elsif tg_table_name = 'trecho_quantidade_segmento' then
    v_versao := coalesce(new.versao_id, old.versao_id);
  elsif tg_table_name = 'trecho_quantidade_celula' then
    select s.versao_id into v_versao from public.trecho_quantidade_segmento s
      where s.id = coalesce(new.segmento_id, old.segmento_id);
  end if;

  select is_atual into v_atual from public.trecho_quantidade_versao where id = v_versao;
  if coalesce(v_atual, false) = true then return coalesce(new, old); end if;

  raise exception 'Versão de quantidade não-atual é imutável. Crie uma nova versão para editar.';
end $$;

alter function public.fn_tqv_imutavel() owner to postgres;
