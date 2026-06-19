-- InfraWork — Monitoramento WhatsApp → Fotos da Obra
--
-- Um agente externo (projeto `whatsapp-agent/`, roda 24/7 numa VM) mantém uma
-- sessão WhatsApp via Baileys, monitora grupos vinculados a obras, classifica
-- fotos de serviço por visão (OpenRouter) e sobe as georreferenciadas para
-- `acompanhamento_foto` — reaproveitando todo o pipeline de mapa do mobile.
--
-- O Supabase é o barramento entre o app Electron (UI god/adm) e o agente:
--   - UI escreve config (conectar sessão, marcar grupo, criar job de backfill)
--   - agente (service_role, bypassa RLS) lê config e devolve QR/status/fotos
--
-- Padrão de RLS: god vê tudo; adm filtra pela própria empresa. Eng/apoio/cliente
-- não têm acesso (módulo restrito a god/adm). Escrita das tabelas de cache/log
-- é feita pelo agente via service_role.

-- ─────────────────────────────────────────────────────────────────────────
-- whatsapp_sessao — uma sessão por número de WhatsApp
--   status: desconectado | aguardando_qr | conectado | erro
--   creds:  estado de auth do Baileys (sobrevive a reinícios/troca de host)
--   qr_code: string do QR quando aguardando pareamento (UI exibe)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_sessao (
  id            uuid          primary key default gen_random_uuid(),
  nome          text          not null,
  status        text          not null default 'desconectado',
  qr_code       text,
  phone         text,
  creds         jsonb,
  last_seen     timestamptz,
  ultimo_erro   text,
  empresa_id    uuid          references public.empresas(id) on delete cascade,
  criado_por    uuid          references public.profiles(id) on delete set null,
  criado_em     timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

do $$ begin
  alter table public.whatsapp_sessao
    add constraint chk_wa_sessao_status
    check (status in ('desconectado', 'aguardando_qr', 'conectado', 'erro'));
exception when duplicate_object then null; end $$;

create index if not exists idx_wa_sessao_empresa on public.whatsapp_sessao(empresa_id);

-- ─────────────────────────────────────────────────────────────────────────
-- whatsapp_grupo — grupos descobertos + config de monitoramento
--   monitorar=true + obra_id setado ⇒ agente processa fotos novas do grupo
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_grupo (
  id            uuid          primary key default gen_random_uuid(),
  sessao_id     uuid          not null references public.whatsapp_sessao(id) on delete cascade,
  wa_group_jid  text          not null,
  nome          text,
  monitorar     boolean       not null default false,
  obra_id       uuid          references public.obras(id) on delete set null,
  participantes int,
  visto_em      timestamptz,
  criado_em     timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  unique (sessao_id, wa_group_jid)
);

create index if not exists idx_wa_grupo_sessao on public.whatsapp_grupo(sessao_id);
create index if not exists idx_wa_grupo_monitorar
  on public.whatsapp_grupo(monitorar) where monitorar = true;
create index if not exists idx_wa_grupo_obra on public.whatsapp_grupo(obra_id);

-- ─────────────────────────────────────────────────────────────────────────
-- whatsapp_job — fila de backfill do histórico de um grupo
--   params:    { limite?, desde?, ate? }
--   progresso: { processadas, subidas, ignoradas }
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_job (
  id            uuid          primary key default gen_random_uuid(),
  grupo_id      uuid          not null references public.whatsapp_grupo(id) on delete cascade,
  tipo          text          not null default 'backfill',
  status        text          not null default 'pendente',
  params        jsonb         not null default '{}'::jsonb,
  progresso     jsonb         not null default '{}'::jsonb,
  erro          text,
  criado_por    uuid          references public.profiles(id) on delete set null,
  criado_em     timestamptz   not null default now(),
  iniciado_em   timestamptz,
  concluido_em  timestamptz,
  updated_at    timestamptz   not null default now()
);

do $$ begin
  alter table public.whatsapp_job
    add constraint chk_wa_job_tipo check (tipo in ('backfill'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.whatsapp_job
    add constraint chk_wa_job_status
    check (status in ('pendente', 'rodando', 'concluido', 'erro'));
exception when duplicate_object then null; end $$;

create index if not exists idx_wa_job_grupo on public.whatsapp_job(grupo_id);
create index if not exists idx_wa_job_pendente
  on public.whatsapp_job(criado_em) where status = 'pendente';

-- ─────────────────────────────────────────────────────────────────────────
-- whatsapp_mensagem_log — auditoria + dedup
--   decisao: subida | sem_geo | nao_servico | erro
--   wa_message_id único evita reprocessar (ao vivo e no backfill)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_mensagem_log (
  id            uuid          primary key default gen_random_uuid(),
  grupo_id      uuid          not null references public.whatsapp_grupo(id) on delete cascade,
  wa_message_id text          not null,
  remetente     text,
  decisao       text          not null,
  foto_id       uuid          references public.acompanhamento_foto(id) on delete set null,
  ai_resultado  jsonb,
  erro          text,
  processado_em timestamptz   not null default now(),
  unique (wa_message_id)
);

do $$ begin
  alter table public.whatsapp_mensagem_log
    add constraint chk_wa_log_decisao
    check (decisao in ('subida', 'sem_geo', 'nao_servico', 'erro'));
exception when duplicate_object then null; end $$;

create index if not exists idx_wa_log_grupo on public.whatsapp_mensagem_log(grupo_id, processado_em desc);

-- ─────────────────────────────────────────────────────────────────────────
-- whatsapp_servico_id_map — ponte para o pipeline de enriquecimento do mapa
--   Gera um siga_servico_executado_id sintético (negativo) e estável por
--   serviço da obra. O agente também faz upsert em acompanhamento_servico_match
--   (synthetic_siga_id → servico_id), de modo que a foto do WhatsApp herde a
--   mesma cor/nome de serviço das fotos do mobile em vw_acompanhamento_foto_*.
-- ─────────────────────────────────────────────────────────────────────────
create sequence if not exists public.seq_whatsapp_servico_synthetic_id
  as bigint increment by -1 start with -1 minvalue -9223372036854775808 no maxvalue;

create table if not exists public.whatsapp_servico_id_map (
  obra_id           uuid     not null references public.obras(id) on delete cascade,
  servico_id        uuid     not null references public.servico(id) on delete cascade,
  synthetic_siga_id bigint   not null unique default nextval('public.seq_whatsapp_servico_synthetic_id'),
  criado_em         timestamptz not null default now(),
  primary key (obra_id, servico_id)
);

-- Sequence negativa para acompanhamento_foto.siga_foto_id (NOT NULL UNIQUE).
-- IDs reais do SIGA são positivos; usamos negativos para fotos do WhatsApp.
create sequence if not exists public.seq_whatsapp_foto_id
  as bigint increment by -1 start with -1 minvalue -9223372036854775808 no maxvalue;

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reaproveitam fn_acomp_link_updated_at do acompanhamento)
-- ─────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_wa_sessao_updated_at on public.whatsapp_sessao;
create trigger trg_wa_sessao_updated_at
  before update on public.whatsapp_sessao
  for each row execute function public.fn_acomp_link_updated_at();

drop trigger if exists trg_wa_grupo_updated_at on public.whatsapp_grupo;
create trigger trg_wa_grupo_updated_at
  before update on public.whatsapp_grupo
  for each row execute function public.fn_acomp_link_updated_at();

drop trigger if exists trg_wa_job_updated_at on public.whatsapp_job;
create trigger trg_wa_job_updated_at
  before update on public.whatsapp_job
  for each row execute function public.fn_acomp_link_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Helpers SECURITY DEFINER (resolvem a empresa pela cadeia sessão→grupo)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.wa_sessao_empresa(_sessao_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select empresa_id from public.whatsapp_sessao where id = _sessao_id
$$;

create or replace function public.wa_grupo_empresa(_grupo_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.empresa_id
    from public.whatsapp_grupo g
    join public.whatsapp_sessao s on s.id = g.sessao_id
   where g.id = _grupo_id
$$;

alter function public.wa_sessao_empresa(uuid) owner to postgres;
alter function public.wa_grupo_empresa(uuid)  owner to postgres;
revoke all on function public.wa_sessao_empresa(uuid) from public;
revoke all on function public.wa_grupo_empresa(uuid)  from public;
grant execute on function public.wa_sessao_empresa(uuid) to authenticated;
grant execute on function public.wa_grupo_empresa(uuid)  to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — god vê tudo; adm filtra pela própria empresa. Demais: sem acesso.
-- service_role (agente) bypassa RLS, então não precisa de policy.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.whatsapp_sessao          enable row level security;
alter table public.whatsapp_grupo           enable row level security;
alter table public.whatsapp_job             enable row level security;
alter table public.whatsapp_mensagem_log    enable row level security;
alter table public.whatsapp_servico_id_map  enable row level security;

-- ============== whatsapp_sessao ==============
drop policy if exists wa_sessao_god_all on public.whatsapp_sessao;
create policy wa_sessao_god_all on public.whatsapp_sessao
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists wa_sessao_adm_all on public.whatsapp_sessao;
create policy wa_sessao_adm_all on public.whatsapp_sessao
  for all to authenticated
  using      (public.auth_role() = 'adm' and empresa_id = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and empresa_id = public.auth_empresa_id());

-- ============== whatsapp_grupo ==============
drop policy if exists wa_grupo_god_all on public.whatsapp_grupo;
create policy wa_grupo_god_all on public.whatsapp_grupo
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists wa_grupo_adm_all on public.whatsapp_grupo;
create policy wa_grupo_adm_all on public.whatsapp_grupo
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.wa_sessao_empresa(sessao_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.wa_sessao_empresa(sessao_id) = public.auth_empresa_id());

-- ============== whatsapp_job ==============
drop policy if exists wa_job_god_all on public.whatsapp_job;
create policy wa_job_god_all on public.whatsapp_job
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

drop policy if exists wa_job_adm_all on public.whatsapp_job;
create policy wa_job_adm_all on public.whatsapp_job
  for all to authenticated
  using      (public.auth_role() = 'adm' and public.wa_grupo_empresa(grupo_id) = public.auth_empresa_id())
  with check (public.auth_role() = 'adm' and public.wa_grupo_empresa(grupo_id) = public.auth_empresa_id());

-- ============== whatsapp_mensagem_log (SELECT-only; escrita = agente) ==============
drop policy if exists wa_log_god_select on public.whatsapp_mensagem_log;
create policy wa_log_god_select on public.whatsapp_mensagem_log
  for select to authenticated
  using (public.auth_role() = 'god');

drop policy if exists wa_log_adm_select on public.whatsapp_mensagem_log;
create policy wa_log_adm_select on public.whatsapp_mensagem_log
  for select to authenticated
  using (public.auth_role() = 'adm' and public.wa_grupo_empresa(grupo_id) = public.auth_empresa_id());

-- ============== whatsapp_servico_id_map (SELECT-only; escrita = agente) ==============
drop policy if exists wa_servico_map_god_select on public.whatsapp_servico_id_map;
create policy wa_servico_map_god_select on public.whatsapp_servico_id_map
  for select to authenticated
  using (public.auth_role() = 'god');

drop policy if exists wa_servico_map_adm_select on public.whatsapp_servico_id_map;
create policy wa_servico_map_adm_select on public.whatsapp_servico_id_map
  for select to authenticated
  using (public.auth_role() = 'adm' and public.obra_empresa(obra_id) = public.auth_empresa_id());

-- ─────────────────────────────────────────────────────────────────────────
-- RPC whatsapp_registrar_foto — chamada pelo agente (service_role) para
-- registrar uma foto "subida" de forma atômica:
--   1. resolve/cria o id sintético do serviço (whatsapp_servico_id_map)
--   2. garante o match p/ enriquecimento do mapa (acompanhamento_servico_match)
--   3. insere em acompanhamento_foto (siga_foto_id da sequence negativa)
--   4. registra o log (dedup por wa_message_id)
-- Retorna o id da foto criada (ou da existente, se wa_message_id já visto).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.whatsapp_registrar_foto(
  _grupo_id      uuid,
  _obra_id       uuid,
  _servico_id    uuid,
  _servico_nome  text,
  _lat           numeric,
  _lng           numeric,
  _captured_at   timestamptz,
  _storage_key   text,
  _mime          text,
  _size_bytes    bigint,
  _wa_message_id text,
  _remetente     text,
  _ai            jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _synthetic bigint;
  _foto_id   uuid;
  _existente uuid;
begin
  -- dedup: se já processada, devolve a foto associada sem reinserir
  select foto_id into _existente
    from public.whatsapp_mensagem_log where wa_message_id = _wa_message_id;
  if found then
    return _existente;
  end if;

  if _servico_id is not null then
    insert into public.whatsapp_servico_id_map (obra_id, servico_id)
    values (_obra_id, _servico_id)
    on conflict (obra_id, servico_id) do nothing;

    select synthetic_siga_id into _synthetic
      from public.whatsapp_servico_id_map
     where obra_id = _obra_id and servico_id = _servico_id;

    insert into public.acompanhamento_servico_match
      (obra_id, siga_servico_executado_id, siga_servico_nome, servico_id, origem, confirmado_em)
    values (_obra_id, _synthetic, _servico_nome, _servico_id, 'auto', now())
    on conflict (obra_id, siga_servico_executado_id) do update
      set servico_id = excluded.servico_id,
          siga_servico_nome = excluded.siga_servico_nome;
  end if;

  insert into public.acompanhamento_foto (
    obra_id, siga_foto_id, lat, lng, servico_executado_id, servico_executado_nome,
    captured_at, storage_bucket, storage_key, mime, size_bytes, payload_bruto
  ) values (
    _obra_id, nextval('public.seq_whatsapp_foto_id'), _lat, _lng, _synthetic, _servico_nome,
    _captured_at, 'monito-fotos', _storage_key, _mime, _size_bytes,
    jsonb_build_object('fonte', 'whatsapp', 'wa_message_id', _wa_message_id,
                       'remetente', _remetente, 'ai', _ai)
  ) returning id into _foto_id;

  insert into public.whatsapp_mensagem_log
    (grupo_id, wa_message_id, remetente, decisao, foto_id, ai_resultado)
  values (_grupo_id, _wa_message_id, _remetente, 'subida', _foto_id, _ai)
  on conflict (wa_message_id) do nothing;

  return _foto_id;
end $$;

alter function public.whatsapp_registrar_foto(
  uuid, uuid, uuid, text, numeric, numeric, timestamptz, text, text, bigint, text, text, jsonb
) owner to postgres;
