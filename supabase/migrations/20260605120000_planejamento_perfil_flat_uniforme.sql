-- InfraWork - Planejamento: achata todas as tarefas pra perfil uniforme.
--
-- Motivacao: a UX da escolha de shape (uniforme/sino/rampa/...) confundia.
-- Tarefas com shape nao-uniforme tinham duracao maior do que qtd/prod sugeria,
-- porque o cap rigido em semanas de pico fazia spillover. Forca uniforme.
--
-- O que MANTEMOS:
--   * Tabela planejamento_tarefa_perfil_semana (alimenta Curva-S).
--   * Edge function continua gerando perfil semanal (so que sempre uniforme).
--   * Coluna fator_mes em obra (sazonalidade: chuva, ferias coletivas, etc).
--
-- O que MUDAMOS:
--   * UPDATE em massa: perfil_default = 'uniforme', usa_perfil_customizado = false.
--   * DELETE em planejamento_tarefa_perfil_semana — proximo recalc regenera
--     tudo uniforme. Sem constraint trigger validando soma (dropado em 2026-05-30),
--     podemos esvaziar a tabela sem risco.
--   * CHECK constraint enforcando os 2 invariantes (uniforme + customizado=false).
--
-- Reversibilidade: pra trazer shapes de volta, drop esse CHECK.
-- Comportamento pos-deploy: ate o usuario rodar Recalcular, a Curva-S fica
-- vazia (sem rows na tabela perfil_semana). Apos recalc, edge function
-- repopula com shape uniforme.

-- 1) Backfill nas tarefas existentes (somente planejamentos NAO-baseline;
--    baselines sao imutaveis — o snapshot deles preserva o estado original).
update public.planejamento_tarefa t
   set perfil_default = 'uniforme',
       usa_perfil_customizado = false
  from public.planejamento p
 where t.planejamento_id = p.id
   and p.is_baseline = false
   and (t.perfil_default <> 'uniforme' or t.usa_perfil_customizado = true);

-- 2) Limpa perfil_semana — proximo calcular-cronograma regenera uniforme.
--    Filtra por planejamento NAO-baseline pra nao bater no trigger
--    fn_ptps_baseline_imutavel. Baselines mantem seu perfil intacto.
delete from public.planejamento_tarefa_perfil_semana ps
 using public.planejamento_tarefa t
 inner join public.planejamento p on p.id = t.planejamento_id
 where ps.tarefa_id = t.id
   and p.is_baseline = false;

-- 3) CHECK constraint reforcando o invariante. NOT VALID pra nao falhar com
--    rows legadas em baselines (que so podem ser alteradas via nova revisao).
do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_perfil_flat_uniforme
    check (perfil_default = 'uniforme' and usa_perfil_customizado = false)
    not valid;
exception when duplicate_object then null; end $$;
