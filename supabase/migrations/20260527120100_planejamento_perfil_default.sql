-- InfraWork — Planejamento: perfil_default + usa_perfil_customizado em planejamento_tarefa
--
-- perfil_default: shape escolhida pelo usuario ao criar/editar a tarefa.
--   6 valores: uniforme, rampa-subida, rampa-descida, sino, front-loaded, back-loaded.
--   Default 'uniforme'. Edge function calcular-cronograma usa esse valor pra
--   gerar perfil_semana quando usa_perfil_customizado = false.
--
-- usa_perfil_customizado: flag setada explicitamente pela camada de aplicacao:
--   - calcular-cronograma (edge fn, service_role) faz UPDATE = false ao regenerar.
--   - salvar-perfil-semana-customizado RPC (futuro commit 6) faz UPDATE = true
--     apos persistir o perfil editado manualmente pelo usuario.
--
-- Semantica do trigger de imutabilidade pra essas 2 colunas: bloqueia MUDANCA
-- em planejamento baseline, nao o VALOR ser true. Baseline pode ter
-- usa_perfil_customizado = true legitimamente (significa "tinha perfil
-- customizado quando virou baseline"). O que nao pode e mudar o estado depois
-- da baseline existir — o estado e frozen junto com o resto da baseline.

alter table public.planejamento_tarefa
  add column if not exists perfil_default text not null default 'uniforme';

do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_perfil_default
    check (perfil_default in (
      'uniforme', 'rampa-subida', 'rampa-descida',
      'sino', 'front-loaded', 'back-loaded'
    ));
exception when duplicate_object then null; end $$;

alter table public.planejamento_tarefa
  add column if not exists usa_perfil_customizado boolean not null default false;

-- Backfill conservador: perfil_semana ainda nao existe nas tarefas atuais.
-- Default 'uniforme' + false e seguro como inicial.

-- Estender trigger de imutabilidade com as 2 colunas novas.
drop trigger if exists trg_baseline_imutavel_tarefa on public.planejamento_tarefa;
create trigger trg_baseline_imutavel_tarefa
  before delete or update of
    item_orcamentario_id,
    data_inicio_manual,
    notas,
    ordem,
    posicao_inicio_m,
    posicao_fim_m,
    unidade_espaco_display,
    perfil_default,
    usa_perfil_customizado
  on public.planejamento_tarefa
  for each row execute function public.fn_planejamento_baseline_imutavel();
