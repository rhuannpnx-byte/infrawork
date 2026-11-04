-- InfraWork — planejamento_tarefa.trecho_id: SET NOT NULL + entra na whitelist
-- de imutabilidade da baseline.
--
-- Pre-requisito: backfill (migration 120200) ja preencheu todas as tarefas.
-- Se alguma ainda for NULL, esta migration falha (proposital — sinaliza dado
-- inconsistente que precisa investigacao).

-- Guard explicito antes do SET NOT NULL pra dar erro legivel.
do $$
declare v_orfas integer;
begin
  select count(*) into v_orfas
    from public.planejamento_tarefa
   where trecho_id is null;
  if v_orfas > 0 then
    raise exception 'Backfill de trecho_id incompleto: % tarefa(s) sem trecho. Rode migration 120200 antes.', v_orfas;
  end if;
end $$;

alter table public.planejamento_tarefa
  alter column trecho_id set not null;

-- Recria trigger de imutabilidade com trecho_id na whitelist.
-- Semantica: trecho_id de tarefa baseline e congelado junto com item_orcamentario_id,
-- posicao_*, perfil_default etc. Trocar trecho de uma tarefa baseline exige nova revisao.
drop trigger if exists trg_baseline_imutavel_tarefa on public.planejamento_tarefa;
create trigger trg_baseline_imutavel_tarefa
  before delete or update of
    item_orcamentario_id, data_inicio_manual, notas, ordem,
    posicao_inicio_m, posicao_fim_m, unidade_espaco_display,
    perfil_default, usa_perfil_customizado,
    trecho_id
  on public.planejamento_tarefa
  for each row execute function public.fn_planejamento_baseline_imutavel();
