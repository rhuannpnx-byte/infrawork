-- InfraWork — Oráculo: mensagens de SAÍDA (operador → usuário via plataforma)
--
-- Permite que god/adm conversem com o usuário do Oráculo pelo app: a UI enfileira
-- uma mensagem aqui (status 'pendente'); o agente (service_role) envia pelo
-- WhatsApp para o número do usuário (profiles.whatsapp) e marca 'enviado'/'erro'.

create table if not exists public.whatsapp_oraculo_saida (
  id          uuid          primary key default gen_random_uuid(),
  user_id     uuid          not null references public.profiles(id) on delete cascade,
  texto       text          not null,
  status      text          not null default 'pendente',
  criado_por  uuid          references public.profiles(id) on delete set null,
  erro        text,
  criado_em   timestamptz   not null default now(),
  enviado_em  timestamptz
);

do $$ begin
  alter table public.whatsapp_oraculo_saida
    add constraint chk_wa_oraculo_saida_status check (status in ('pendente', 'enviado', 'erro'));
exception when duplicate_object then null; end $$;

create index if not exists idx_wa_oraculo_saida_pendente
  on public.whatsapp_oraculo_saida(criado_em) where status = 'pendente';
create index if not exists idx_wa_oraculo_saida_user
  on public.whatsapp_oraculo_saida(user_id, criado_em);

alter table public.whatsapp_oraculo_saida enable row level security;

-- god gerencia tudo
drop policy if exists wa_oraculo_saida_god_all on public.whatsapp_oraculo_saida;
create policy wa_oraculo_saida_god_all on public.whatsapp_oraculo_saida
  for all to authenticated
  using (public.auth_role() = 'god') with check (public.auth_role() = 'god');

-- adm: só usuários da própria empresa
drop policy if exists wa_oraculo_saida_adm_all on public.whatsapp_oraculo_saida;
create policy wa_oraculo_saida_adm_all on public.whatsapp_oraculo_saida
  for all to authenticated
  using (
    public.auth_role() = 'adm'
    and (select p.empresa_id from public.profiles p where p.id = user_id) = public.auth_empresa_id()
  )
  with check (
    public.auth_role() = 'adm'
    and (select p.empresa_id from public.profiles p where p.id = user_id) = public.auth_empresa_id()
  );
