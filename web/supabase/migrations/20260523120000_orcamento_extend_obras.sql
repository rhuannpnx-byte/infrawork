-- InfraWork — Orçamento (Fase 1.0): estende `obras` com campos do orçamento
-- Mantém o status operacional da obra (`obras.status`) intocado; o status do
-- orçamento dela vive em `obras.status_orcamento` (rascunho → em_revisao →
-- aprovado → homologado → cancelado).
--
-- Os campos abaixo são populados ao longo das próximas fases. O default é
-- mínimo (somente o que faz sentido como valor inicial), pra não invalidar
-- obras já existentes.

alter table public.obras
  add column if not exists regime_tributario     text         not null default 'convencional',
  add column if not exists bdi_padrao_perc       numeric(14,4) not null default 0,
  add column if not exists aliquota_iss_perc     numeric(14,4) not null default 0.05,
  add column if not exists aliquota_pis_perc     numeric(14,4) not null default 0.0065,
  add column if not exists aliquota_cofins_perc  numeric(14,4) not null default 0.03,
  add column if not exists aliquota_outros_perc  numeric(14,4) not null default 0,
  add column if not exists rodovia               text,
  add column if not exists trecho                text,
  add column if not exists extensao_km           numeric(10,3),
  add column if not exists status_orcamento      text         not null default 'rascunho';

-- Constraints separadas em DO block pra serem idempotentes em re-runs.
do $$ begin
  alter table public.obras
    add constraint chk_obras_regime_tributario
    check (regime_tributario in ('rdc', 'convencional', 'preco_unitario', 'preco_global'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.obras
    add constraint chk_obras_status_orcamento
    check (status_orcamento in ('rascunho', 'em_revisao', 'aprovado', 'homologado', 'cancelado'));
exception when duplicate_object then null; end $$;
