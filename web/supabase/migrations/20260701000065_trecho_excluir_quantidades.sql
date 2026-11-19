-- Excluir as quantidades de locais (o template e todas as versões) para importar de novo.
--
-- Antes só dava para gravar uma versão nova por cima: o que foi importado não saía. Vale a mesma trava da gravação
-- (fn_trecho_assert_editavel: permissão de planejar e cadeia sem plano vigente). As tarefas do plano em edição que
-- tiram a quantidade "do trecho" desses locais são recalculadas pelo trecho_sync_tarefas: sem template ficam com zero
-- até a nova importação, que as recalcula de novo.

create or replace function public.trecho_excluir_quantidades(_trecho_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_obra uuid; v_obra_um uuid; n_tpl int := 0; n_ver int := 0; n_loc int := 0;
begin
  if coalesce(array_length(_trecho_ids, 1), 0) = 0 then
    raise exception 'Escolha ao menos um local';
  end if;
  foreach v_id in array _trecho_ids loop
    -- permissão de planejar + sem plano vigente (mesma regra de gravar as quantidades)
    v_obra := public.fn_trecho_assert_editavel(v_id);
    if v_obra_um is null then v_obra_um := v_obra;
    elsif v_obra <> v_obra_um then raise exception 'Os locais precisam ser da mesma obra';
    end if;
  end loop;

  select count(*) into n_loc
    from public.planejamento_tarefa_local l
    join public.planejamento p on p.id = l.planejamento_id
   where l.trecho_id = any(_trecho_ids) and l.qtd_origem = 'trecho' and not p.is_baseline;
  select count(*) into n_ver
    from public.trecho_quantidade_versao v
    join public.trecho_quantidade_template t on t.id = v.template_id
   where t.trecho_id = any(_trecho_ids);
  -- versões, colunas, faixas e células saem em cascata
  delete from public.trecho_quantidade_template where trecho_id = any(_trecho_ids);
  get diagnostics n_tpl = row_count;

  perform public.trecho_sync_tarefas(v_obra_um);
  return jsonb_build_object('locais', n_tpl, 'versoes', n_ver, 'locais_de_tarefa_recalculados', n_loc);
end $function$;

revoke all on function public.trecho_excluir_quantidades(uuid[]) from public, anon;
grant execute on function public.trecho_excluir_quantidades(uuid[]) to authenticated, service_role;
