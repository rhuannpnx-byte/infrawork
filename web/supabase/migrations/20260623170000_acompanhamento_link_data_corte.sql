-- InfraWork — data de corte por obra para o sync do SIGA.
-- Produções com data anterior a esta são ignoradas na sincronização
-- (e removidas do cache). Útil para obras antigas/enormes onde só se
-- quer planejar a partir de determinada data.

alter table public.obra_acompanhamento_link
  add column if not exists data_corte date;

comment on column public.obra_acompanhamento_link.data_corte is
  'Quando preenchida, o sync só puxa produções do SIGA com data >= data_corte; '
  'produções anteriores são removidas do cache acompanhamento_producao.';
