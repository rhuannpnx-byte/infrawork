-- InfraWork — WhatsApp: só ingere fotos de serviços COM vínculo (sem sintético)
--
-- Regra nova: a foto do WhatsApp só é registrada se o serviço classificado já
-- tiver um vínculo (match) existente na obra. Reutiliza o siga_servico_executado_id
-- real desse vínculo (preferindo id positivo), agrupando junto com as fotos do
-- mobile no mapa. NÃO cria mais id sintético — se o serviço não tem vínculo, a
-- decisão de descartar é feita no agente (a foto nem chega aqui).
--
-- Se, por algum motivo, _servico_id vier sem vínculo, a foto é registrada sem
-- serviço (servico_executado_id = null) em vez de criar id sintético.

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
  _siga_id bigint;
  _foto_id uuid;
  _existente uuid;
begin
  -- dedup: se já processada, devolve a foto associada sem reinserir
  select foto_id into _existente
    from public.whatsapp_mensagem_log where wa_message_id = _wa_message_id;
  if found then
    return _existente;
  end if;

  -- Reutiliza o siga id de um vínculo existente do serviço (prefere id real
  -- positivo). Sem vínculo => _siga_id fica null (foto sem serviço).
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
