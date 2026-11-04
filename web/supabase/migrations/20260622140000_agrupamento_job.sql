-- InfraWork — Orçamento: jobs assíncronos do Agente de Agrupamento
--
-- A geração da proposta chama o LLM (Claude via OpenRouter) e pode levar ~1-2min
-- numa obra grande — acima do teto de ~150s do gateway de Edge Functions (504).
-- Em vez de responder síncrono, a função cria um job, processa em background
-- (EdgeRuntime.waitUntil) e grava o resultado aqui; o app faz polling deste
-- registro até status != 'processando'.

create table if not exists public.agrupamento_job (
  id           uuid        primary key default gen_random_uuid(),
  obra_id      uuid        not null references public.obras(id) on delete cascade,
  status       text        not null default 'processando',
  -- Parâmetros da chamada (instrucoes, plano_atual) — útil pra auditoria/refino.
  params       jsonb       not null default '{}'::jsonb,
  -- Resultado no formato AgrupamentoResposta { grupos, nao_agrupados, avisos, _meta }.
  resultado    jsonb,
  erro         text,
  created_by   uuid        references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

do $$ begin
  alter table public.agrupamento_job
    add constraint chk_agrup_job_status
    check (status in ('processando', 'concluido', 'erro'));
exception when duplicate_object then null; end $$;

create index if not exists idx_agrup_job_obra on public.agrupamento_job(obra_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — leitura para quem tem acesso à obra (a função escreve via service_role,
-- que bypassa RLS). Espelha a matriz dos catálogos por obra.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.agrupamento_job enable row level security;

drop policy if exists agrup_job_god_all on public.agrupamento_job;
drop policy if exists agrup_job_adm_all on public.agrupamento_job;
drop policy if exists agrup_job_eng_all on public.agrupamento_job;

create policy agrup_job_god_all on public.agrupamento_job
  for all
  to authenticated
  using      (public.auth_role() = 'god')
  with check (public.auth_role() = 'god');

create policy agrup_job_adm_all on public.agrupamento_job
  for all
  to authenticated
  using      (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm'
              and public.obra_empresa(obra_id) = public.auth_empresa_id());

create policy agrup_job_eng_all on public.agrupamento_job
  for all
  to authenticated
  using      (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()))
  with check (public.auth_role() = 'engenheiro'
              and public.has_obra_permissao(obra_id, auth.uid()));

comment on table public.agrupamento_job is
  'Jobs assíncronos do Agente de Agrupamento. Edge Function processa em background (waitUntil) e grava resultado; o app faz polling.';
