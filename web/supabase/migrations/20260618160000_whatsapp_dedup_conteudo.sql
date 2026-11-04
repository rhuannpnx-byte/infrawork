-- InfraWork — WhatsApp: dedup robusto de fotos (jamais duplicar)
--
-- Backfills sobrepostos já não duplicavam (dedup por wa_message_id). Mas a MESMA
-- imagem reenviada ganha outro wa_message_id e o WhatsApp recomprime (bytes
-- diferentes), então hash de bytes não resolve. O sinal estável é o trio
-- (obra, captured_at, lat, lng) — lido do overlay, idêntico para a mesma foto.
--
-- Esta migration:
--   1) permite a decisão 'duplicada' no log;
--   2) cria índice para a checagem de duplicidade;
--   3) recria whatsapp_registrar_foto com dedup por wa_message_id E por conteúdo.

alter table public.whatsapp_mensagem_log drop constraint if exists chk_wa_log_decisao;
alter table public.whatsapp_mensagem_log
  add constraint chk_wa_log_decisao
  check (decisao in ('subida', 'sem_geo', 'nao_servico', 'erro', 'duplicada'));

create index if not exists idx_acomp_foto_dedup_conteudo
  on public.acompanhamento_foto (obra_id, captured_at, lat, lng)
  where lat is not null and lng is not null;

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
  _siga_id   bigint;
  _foto_id   uuid;
  _existente uuid;
begin
  -- dedup 1: mesma mensagem já processada (cobre backfill sobreposto)
  select foto_id into _existente
    from public.whatsapp_mensagem_log where wa_message_id = _wa_message_id;
  if found then
    return _existente;
  end if;

  -- dedup 2: mesma foto (obra + captura + coordenadas) já está na base —
  -- pega reenvios da mesma imagem (wa_message_id diferente).
  select id into _existente
    from public.acompanhamento_foto
   where obra_id = _obra_id
     and captured_at = _captured_at
     and lat = _lat and lng = _lng
     and excluida_em is null
   limit 1;
  if found then
    insert into public.whatsapp_mensagem_log
      (grupo_id, wa_message_id, remetente, decisao, foto_id, ai_resultado)
    values (_grupo_id, _wa_message_id, _remetente, 'duplicada', _existente, _ai)
    on conflict (wa_message_id) do nothing;
    return _existente;
  end if;

  -- Reutiliza o siga id de um vínculo existente do serviço (prefere id real
  -- positivo). Sem vínculo => _siga_id null.
  if _servico_id is not null then
    select siga_servico_executado_id into _siga_id
      from public.acompanhamento_servico_match
     where obra_id = _obra_id
       and servico_id = _servico_id
       and origem <> 'rejeitado'
     order by case when siga_servico_executado_id >= 0 then 0 else 1 end,
              siga_servico_executado_id
     limit 1;
  end if;

  insert into public.acompanhamento_foto (
    obra_id, siga_foto_id, lat, lng, servico_executado_id, servico_executado_nome,
    captured_at, storage_bucket, storage_key, mime, size_bytes, payload_bruto
  ) values (
    _obra_id, nextval('public.seq_whatsapp_foto_id'), _lat, _lng, _siga_id, _servico_nome,
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
