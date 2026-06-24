-- InfraWork — flag de obra desabilitada.
-- ativa=false: a obra não aparece para seleção no app nem no contexto do agente
-- WhatsApp; continua visível na gestão (Gerencial → Obras) para reabilitar ou
-- excluir. Exclusão de obra é hard delete (cascata) — feita via edge delete-obra.

alter table public.obras
  add column if not exists ativa boolean not null default true;

comment on column public.obras.ativa is
  'false = obra desabilitada: some da seleção (app) e do contexto do agente WhatsApp; '
  'permanece na gestão para reabilitar/excluir.';
