-- Documentação Oficial — consórcio como ATRIBUTO da obra
-- ─────────────────────────────────────────────────────────────────────────
-- Se a obra é (ou não) consórcio é uma peculiaridade conhecida ao configurar a
-- obra — não deve ser inferida só após a extração do contrato. Vira flag no
-- perfil, determinística, usada para filtrar os GRUPOS aplicáveis já na
-- classificação (ex.: grupo "Documentos do Consórcio" só aparece se consorcio).
-- ─────────────────────────────────────────────────────────────────────────

alter table public.obra_perfil
  add column if not exists consorcio boolean not null default false;

comment on column public.obra_perfil.consorcio is
  'Obra executada em consórcio (atributo declarado). Filtra grupos do template com aplicavel_se.consorcio.';
