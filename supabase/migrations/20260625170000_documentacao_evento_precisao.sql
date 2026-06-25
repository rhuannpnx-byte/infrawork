-- Documentação Oficial — precisão de data dos eventos (timeline)
-- ─────────────────────────────────────────────────────────────────────────
-- Datas parciais (AAAA, AAAA-MM) eram perdidas (dateOnly exigia AAAA-MM-DD).
-- Agora normalizamos preservando a precisão; a timeline mostra ano-só como
-- faixa, não como um ponto exato.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.evento
  add column if not exists data_precisao text;

comment on column public.evento.data_precisao is
  'Precisão da data normalizada: dia|mes|ano (null = sem data). data_norm completa com 01 o que faltar.';
