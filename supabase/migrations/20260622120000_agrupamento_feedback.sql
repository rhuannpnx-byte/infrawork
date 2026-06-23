-- InfraWork — Orçamento: aprendizado do Agente de Agrupamento
--
-- O Agente de Agrupamento propõe automaticamente quais receitas (item_orcamentario
-- tipo 'receita') devem ser penduradas sob qual serviço-de-custo (servico_grupo).
-- Toda vez que o usuário ACEITA, CORRIGE, MOVE ou REJEITA uma sugestão, gravamos
-- aqui. A Edge Function `sugerir-agrupamento` relê esses exemplos confirmados
-- (escopo EMPRESA, não obra) como few-shot — o agente melhora a cada uso e
-- padroniza o critério do time.
--
-- empresa_id é derivado da obra por trigger (não confia no client). RLS espelha
-- a matriz dos catálogos por obra; a leitura cross-obra para few-shot acontece
-- server-side via service_role (bypassa RLS).

create table if not exists public.agrupamento_feedback (
  id                 uuid        primary key default gen_random_uuid(),
  empresa_id         uuid        not null references public.empresas(id) on delete cascade,
  obra_id            uuid        not null references public.obras(id)    on delete cascade,
  -- Receita alvo (snapshot textual — sobrevive à exclusão do item)
  receita_codigo     text,
  receita_descricao  text        not null,
  -- Serviço de custo escolhido
  servico_id         uuid        references public.servico(id) on delete set null,
  servico_codigo     text,
  servico_nome       text,
  -- Ação do usuário sobre a sugestão do agente
  acao               text        not null,
  -- Contexto rico: papel da receita (principal/transporte/material/...),
  -- auxiliares co-agrupadas, modo de qtd, justificativa, etc.
  contexto           jsonb       not null default '{}'::jsonb,
  origem             text        not null default 'agente',
  created_by         uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now()
);

do $$ begin
  alter table public.agrupamento_feedback
    add constraint chk_agrup_feedback_acao
    check (acao in ('aceito', 'rejeitado', 'corrigido', 'movido'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.agrupamento_feedback
    add constraint chk_agrup_feedback_origem
    check (origem in ('agente', 'manual'));
exception when duplicate_object then null; end $$;

create index if not exists idx_agrup_feedback_empresa on public.agrupamento_feedback(empresa_id, created_at desc);
create index if not exists idx_agrup_feedback_obra    on public.agrupamento_feedback(obra_id);
create index if not exists idx_agrup_feedback_servico on public.agrupamento_feedback(servico_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: deriva empresa_id da obra (não confia no client)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.fn_agrupamento_feedback_empresa()
returns trigger
language plpgsql
as $$
begin
  select empresa_id into new.empresa_id from public.obras where id = new.obra_id;
  if new.empresa_id is null then
    raise exception 'obra_id % sem empresa', new.obra_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_agrupamento_feedback_empresa on public.agrupamento_feedback;
create trigger trg_agrupamento_feedback_empresa
  before insert on public.agrupamento_feedback
  for each row execute function public.fn_agrupamento_feedback_empresa();

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — mesma matriz dos catálogos por obra (god / adm-empresa / eng-permissão)
-- ─────────────────────────────────────────────────────────────────────────
alter table public.agrupamento_feedback enable row level security;

drop policy if exists agrup_feedback_god_all on public.agrupamento_feedback;
drop policy if exists agrup_feedback_adm_all on public.agrupamento_feedback;
drop policy if exists agrup_feedback_eng_all on public.agrupamento_feedback;

create policy agrup_feedback_god_all on public.agrupamento_feedback
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

create policy agrup_feedback_adm_all on public.agrupamento_feedback
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy agrup_feedback_eng_all on public.agrupamento_feedback
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

comment on table public.agrupamento_feedback is
  'Feedback do Agente de Agrupamento (aceite/correção/rejeição). Few-shot empresa-wide lido server-side pela Edge Function sugerir-agrupamento.';
