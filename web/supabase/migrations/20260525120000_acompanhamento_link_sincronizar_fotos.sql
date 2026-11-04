-- InfraWork — flag por obra para desabilitar sync de fotos do SIGA.
-- Util quando as fotos SIGA sao testes / lixo e nao queremos puxar.

alter table public.obra_acompanhamento_link
  add column if not exists sincronizar_fotos boolean not null default true;

comment on column public.obra_acompanhamento_link.sincronizar_fotos is
  'Quando false, o sync ignora pnj_foto e nao popula acompanhamento_foto/bucket.';
