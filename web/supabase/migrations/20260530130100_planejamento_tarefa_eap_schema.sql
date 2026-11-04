-- InfraWork — Planejamento (Refator EAP/Marcos/Multi-tarefa, M2):
-- Adiciona colunas para hierarquia EAP (3 níveis), marcos, e alocação parcial.
-- Aditiva e segura — defaults imediatos, sem rewrite de tabela. Nenhuma
-- validação de regra de negócio nesta migration (vem em M4/M5/M6).
--
-- Novas colunas em planejamento_tarefa:
--   tipo_no            — 'tarefa' (default) | 'grupo' | 'marco'
--   parent_id          — FK autoref pra hierarquia EAP (RESTRICT)
--   nivel              — 1..3 (default 1; 1=raiz, 2=sub-grupo, 3=tarefa-folha)
--   quantidade_alocada — qtd alocada nesta tarefa (folha); NULL pra grupo/marco
--   codigo_eap         — código hierárquico ('1', '1.2', '1.2.3'); derivado UI,
--                        persistido pra auditoria/snapshot
--   nome_custom        — override de servico_grupo_descricao (tarefa) /
--                        nome livre (grupo, marco)

alter table public.planejamento_tarefa
  add column if not exists tipo_no            text          not null default 'tarefa',
  add column if not exists parent_id          uuid          null,
  add column if not exists nivel              smallint      not null default 1,
  add column if not exists quantidade_alocada numeric(18,6) null,
  add column if not exists codigo_eap         text          null,
  add column if not exists nome_custom        text          null;

-- FK autoref. ON DELETE RESTRICT: não deixa apagar grupo com filhos.
do $$ begin
  alter table public.planejamento_tarefa
    add constraint fk_plan_tarefa_parent
    foreign key (parent_id) references public.planejamento_tarefa(id)
    on delete restrict;
exception when duplicate_object then null; end $$;

-- CHECKs estáticos
do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_tipo_no
    check (tipo_no in ('tarefa', 'grupo', 'marco'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_nivel
    check (nivel between 1 and 3);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_qtd_alocada_pos
    check (quantidade_alocada is null or quantidade_alocada > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.planejamento_tarefa
    add constraint chk_plan_tar_self_parent
    check (parent_id is null or parent_id <> id);
exception when duplicate_object then null; end $$;

create index if not exists idx_plan_tarefa_parent
  on public.planejamento_tarefa(parent_id);
create index if not exists idx_plan_tarefa_tipo_no
  on public.planejamento_tarefa(tipo_no);

comment on column public.planejamento_tarefa.tipo_no            is
  'tarefa = folha-CPM (default); grupo = nó organizacional EAP sem cálculo; marco = evento sem duração';
comment on column public.planejamento_tarefa.quantidade_alocada is
  'Quantidade alocada nesta tarefa (folha). NULL para grupo/marco. Soma por (planejamento_id, item_orcamentario_id) ≤ item.quantidade_referencia';
