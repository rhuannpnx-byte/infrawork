-- InfraWork — Oráculo (RAG do InfraWork via WhatsApp, DM 1:1)
--
-- O mesmo agente 24/7 que sobe fotos passa a atender DMs: um usuário HABILITADO
-- manda mensagem no privado do número do bot e pergunta sobre orçamento,
-- planejamento e acompanhamento de produção das obras a que tem acesso. O agente
-- usa service_role (bypassa RLS), então a regra de acesso a obras é reimplementada
-- no código do agente (oraculo/identidade.ts) — espelhando a RLS de `obras`.
--
-- Três tabelas:
--   whatsapp_oraculo_acesso   — quem pode usar (habilitação por usuário, N users)
--   whatsapp_oraculo_conversa — estado da sessão por usuário (obra escolhida etc.)
--   whatsapp_oraculo_log      — auditoria de perguntas/respostas
--
-- RLS: god vê tudo; adm filtra pela própria empresa. Escrita de conversa/log é
-- só do agente (service_role). acesso é gerenciado pela UI (god/adm).

-- ─────────────────────────────────────────────────────────────────────────
-- whatsapp_oraculo_acesso — habilitação por usuário
--   empresa_id é snapshot do empresa do usuário (facilita RLS do adm)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_oraculo_acesso (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null unique references public.profiles(id) on delete cascade,
  empresa_id  uuid          references public.empresas(id) on delete cascade,
  ativo       boolean       not null default true,
  criado_por  uuid          references public.profiles(id) on delete set null,
  criado_em   timestamptz   not null default now(),
  updated_at  timestamptz   not null default now()
);

create index if not exists idx_wa_oraculo_acesso_empresa
  on public.whatsapp_oraculo_acesso(empresa_id);
create index if not exists idx_wa_oraculo_acesso_ativo
  on public.whatsapp_oraculo_acesso(ativo) where ativo = true;

-- ─────────────────────────────────────────────────────────────────────────
-- whatsapp_oraculo_conversa — estado da sessão (gerenciado pelo agente)
--   estado: triagem (escolhendo obra) | ativa (obra fixada)
--   opcoes_obra: {"1": "<obra_uuid>", "2": "<obra_uuid>", ...} durante a triagem
--   historico: [{role, content}, ...] últimas trocas (limitado pelo agente)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_oraculo_conversa (
  id               uuid          primary key default gen_random_uuid(),
  sessao_id        uuid          not null references public.whatsapp_sessao(id) on delete cascade,
  remetente_jid    text          not null,
  user_id          uuid          references public.profiles(id) on delete set null,
  obra_id          uuid          references public.obras(id) on delete set null,
  estado           text          not null default 'triagem',
  opcoes_obra      jsonb,
  historico        jsonb         not null default '[]'::jsonb,
  ultima_interacao timestamptz   not null default now(),
  criado_em        timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),
  unique (sessao_id, remetente_jid)
);

do $$ begin
  alter table public.whatsapp_oraculo_conversa
    add constraint chk_wa_oraculo_estado check (estado in ('triagem', 'ativa'));
exception when duplicate_object then null; end $$;

create index if not exists idx_wa_oraculo_conversa_jid
  on public.whatsapp_oraculo_conversa(remetente_jid);
create index if not exists idx_wa_oraculo_conversa_user
  on public.whatsapp_oraculo_conversa(user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- whatsapp_oraculo_log — auditoria de Q&A
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_oraculo_log (
  id          uuid          primary key default gen_random_uuid(),
  conversa_id uuid          references public.whatsapp_oraculo_conversa(id) on delete set null,
  user_id     uuid          references public.profiles(id) on delete set null,
  obra_id     uuid          references public.obras(id) on delete set null,
  pergunta    text,
  resposta    text,
  tools       jsonb,
  erro        text,
  criado_em   timestamptz   not null default now()
);

create index if not exists idx_wa_oraculo_log_criado
  on public.whatsapp_oraculo_log(criado_em desc);
create index if not exists idx_wa_oraculo_log_obra
  on public.whatsapp_oraculo_log(obra_id);

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reaproveitam fn_acomp_link_updated_at)
-- ─────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_wa_oraculo_acesso_updated_at on public.whatsapp_oraculo_acesso;
create trigger trg_wa_oraculo_acesso_updated_at
  before update on public.whatsapp_oraculo_acesso
  for each row execute function public.fn_acomp_link_updated_at();

drop trigger if exists trg_wa_oraculo_conversa_updated_at on public.whatsapp_oraculo_conversa;
create trigger trg_wa_oraculo_conversa_updated_at
  before update on public.whatsapp_oraculo_conversa
  for each row execute function public.fn_acomp_link_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────
alter table public.whatsapp_oraculo_acesso   enable row level security;
alter table public.whatsapp_oraculo_conversa enable row level security;
alter table public.whatsapp_oraculo_log      enable row level security;

-- ===== whatsapp_oraculo_acesso (god/adm gerenciam) =====
drop policy if exists wa_oraculo_acesso_god_all on public.whatsapp_oraculo_acesso;
create policy wa_oraculo_acesso_god_all on public.whatsapp_oraculo_acesso
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

-- Adm só habilita/vê usuários da PRÓPRIA empresa. O with check amarra também ao
-- empresa do user_id (impede habilitar alguém de outra empresa).
drop policy if exists wa_oraculo_acesso_adm_all on public.whatsapp_oraculo_acesso;
create policy wa_oraculo_acesso_adm_all on public.whatsapp_oraculo_acesso
  for all to authenticated
  using (public.auth_role() = 'adm' and empresa_id = public.auth_empresa_id())
  with check (
    public.auth_role() = 'adm'
    and empresa_id = public.auth_empresa_id()
    and (select p.empresa_id from public.profiles p where p.id = user_id) = public.auth_empresa_id()
  );

-- ===== whatsapp_oraculo_conversa (SELECT-only; escrita = agente) =====
drop policy if exists wa_oraculo_conversa_god_select on public.whatsapp_oraculo_conversa;
create policy wa_oraculo_conversa_god_select on public.whatsapp_oraculo_conversa
  for select to authenticated
  using (public.auth_role() = 'god');

drop policy if exists wa_oraculo_conversa_adm_select on public.whatsapp_oraculo_conversa;
create policy wa_oraculo_conversa_adm_select on public.whatsapp_oraculo_conversa
  for select to authenticated
  using (public.auth_role() = 'adm' and public.wa_sessao_empresa(sessao_id) = public.auth_empresa_id());

-- ===== whatsapp_oraculo_log (SELECT-only; escrita = agente) =====
drop policy if exists wa_oraculo_log_god_select on public.whatsapp_oraculo_log;
create policy wa_oraculo_log_god_select on public.whatsapp_oraculo_log
  for select to authenticated
  using (public.auth_role() = 'god');

drop policy if exists wa_oraculo_log_adm_select on public.whatsapp_oraculo_log;
create policy wa_oraculo_log_adm_select on public.whatsapp_oraculo_log
  for select to authenticated
  using (
    public.auth_role() = 'adm'
    and obra_id is not null
    and public.obra_empresa(obra_id) = public.auth_empresa_id()
  );
