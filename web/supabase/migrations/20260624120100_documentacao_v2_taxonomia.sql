-- Documentação Oficial v2 — (2/7) Taxonomia canônica (referência fixa)
-- ─────────────────────────────────────────────────────────────────────────
-- 20 categorias canônicas + flag `vence` (categorias cujos documentos têm
-- validade e entram no gap engine de vencimento ≤90 dias).
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.tipo_documento (
  codigo          text    primary key,            -- '01'..'20'
  nome            text    not null,
  obrigatoriedade text    not null,               -- essencial|recomendado|condicional|operacional|final|apoio
  ordem           int     not null,
  vence           boolean not null default false  -- tem validade → gap de vencimento
);

insert into public.tipo_documento (codigo, nome, obrigatoriedade, ordem, vence) values
  ('01', 'Edital e Anexos',                              'essencial',   1, false),
  ('02', 'Proposta (Téc./Comercial)',                    'recomendado', 2, false),
  ('03', 'Contrato',                                     'essencial',   3, false),
  ('04', 'Ordem de Serviço (e NPO)',                     'essencial',   4, false),
  ('05', 'ART / CAT',                                    'essencial',   5, true),
  ('06', 'Segurança do Trabalho (PGR/PCMSO)',            'essencial',   6, true),
  ('07', 'Aditivos',                                     'condicional', 7, false),
  ('08', 'Reprogramação',                                'condicional', 8, false),
  ('09', 'Reajuste / Apostilamento',                     'condicional', 9, false),
  ('10', 'Licenças Ambientais (LP/LI/LO, ASV, Outorga)', 'essencial',  10, true),
  ('11', 'CNO / CEI',                                    'essencial',  11, false),
  ('12', 'Seguro Garantia',                              'condicional',12, true),
  ('13', 'Doc. Consórcio / Contratada',                  'recomendado',13, false),
  ('14', 'Cartas e Ofícios',                             'operacional',14, false),
  ('15', 'Tribunal de Contas (TCM/TCE)',                 'condicional',15, false),
  ('16', 'Certidões / Matrícula / Desapropriação',       'condicional',16, false),
  ('17', 'Qualidade (SGQ/PGQ/PVEGQ)',                    'recomendado',17, false),
  ('18', 'Termo de Entrega/Recebimento (TRP/TRD)',       'final',      18, false),
  ('19', 'Portarias / Designação de Fiscal',             'operacional',19, false),
  ('20', 'Outros / Diversos',                            'apoio',      20, false)
on conflict (codigo) do update
  set nome = excluded.nome,
      obrigatoriedade = excluded.obrigatoriedade,
      ordem = excluded.ordem,
      vence = excluded.vence;

alter table public.tipo_documento enable row level security;
drop policy if exists tipo_documento_read on public.tipo_documento;
create policy tipo_documento_read on public.tipo_documento
  for select to authenticated using (true);

comment on table public.tipo_documento is
  'Documentação Oficial v2 — taxonomia canônica de 20 categorias. `vence` marca categorias com validade (gap engine).';
