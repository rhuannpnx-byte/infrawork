-- 0062 — Acompanhamento 4D (beta): o modelo 3D da obra e o vínculo com o plano.
--   modelo4d          o arquivo (contrato infrawork-4d, no bucket modelos-4d) e o resumo das classes; um ativo por obra
--   modelo4d_eixo     eixo do modelo → local da obra (as estacas do modelo viram metros do local)
--   modelo4d_vinculo  classe do modelo → serviço; a estaca de cada peça decide quando é prevista e quando foi feita
-- Gravação só pelas funções (cabeçalho e vínculos numa transação). Serviço vinculado passa a exigir o local com
-- estacas no lançamento (servico_parametro.exige_local): produção sem estaca não aparece no 3D.
-- Leitura: equipe da obra (o cliente não vê enquanto for beta). Gravação: quem planeja a obra.

create table public.modelo4d (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obras(id) on delete cascade,
  nome text not null,
  origem text not null check (origem in ('html', 'iw4d')),
  storage_path text not null,
  tamanho_bytes bigint,
  resumo jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  criado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index uq_modelo4d_ativo on public.modelo4d (obra_id) where ativo;
create index idx_modelo4d_obra on public.modelo4d (obra_id);

create table public.modelo4d_eixo (
  modelo_id uuid not null references public.modelo4d(id) on delete cascade,
  eixo text not null,
  trecho_id uuid not null references public.obra_trecho(id) on delete cascade,
  primary key (modelo_id, eixo)
);

create table public.modelo4d_vinculo (
  modelo_id uuid not null references public.modelo4d(id) on delete cascade,
  classe text not null,
  item_orcamentario_id uuid not null references public.item_orcamentario(id) on delete cascade,
  primary key (modelo_id, classe)
);
create index idx_modelo4d_vinculo_item on public.modelo4d_vinculo (item_orcamentario_id);

alter table public.modelo4d enable row level security;
alter table public.modelo4d_eixo enable row level security;
alter table public.modelo4d_vinculo enable row level security;

create policy modelo4d_select on public.modelo4d for select to authenticated
  using (obra_id in (select public.obras_permitidas('equipe')));
create policy modelo4d_eixo_select on public.modelo4d_eixo for select to authenticated
  using (modelo_id in (select id from public.modelo4d));
create policy modelo4d_vinculo_select on public.modelo4d_vinculo for select to authenticated
  using (modelo_id in (select id from public.modelo4d));

revoke insert, update, delete on public.modelo4d, public.modelo4d_eixo, public.modelo4d_vinculo from authenticated;

-- ── Vínculos: troca os do modelo pelos informados e liga o local obrigatório nos serviços vinculados ──────────
create function public.modelo4d_gravar_vinculos(_modelo_id uuid, _obra_id uuid, _eixos jsonb, _vinculos jsonb)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare n int;
begin
  select count(*) into n from jsonb_array_elements(coalesce(_eixos, '[]'::jsonb)) e
   where not exists (select 1 from obra_trecho t
                      where t.id = (e->>'trecho_id')::uuid and t.obra_id = _obra_id and t.tipo = 'eixo');
  if n > 0 then raise exception 'Eixo do modelo ligado a um local que não é um eixo desta obra'; end if;
  select count(*) into n from jsonb_array_elements(coalesce(_vinculos, '[]'::jsonb)) v
   where not exists (select 1 from item_orcamentario i
                      where i.id = (v->>'item_orcamentario_id')::uuid and i.obra_id = _obra_id
                        and i.tipo = 'servico_grupo' and i.indireto_id is null);
  if n > 0 then raise exception 'Classe do modelo ligada a algo que não é um serviço direto desta obra'; end if;

  delete from modelo4d_eixo where modelo_id = _modelo_id;
  insert into modelo4d_eixo (modelo_id, eixo, trecho_id)
  select _modelo_id, e->>'eixo', (e->>'trecho_id')::uuid
    from jsonb_array_elements(coalesce(_eixos, '[]'::jsonb)) e
   where nullif(e->>'eixo', '') is not null;

  delete from modelo4d_vinculo where modelo_id = _modelo_id;
  insert into modelo4d_vinculo (modelo_id, classe, item_orcamentario_id)
  select _modelo_id, v->>'classe', (v->>'item_orcamentario_id')::uuid
    from jsonb_array_elements(coalesce(_vinculos, '[]'::jsonb)) v
   where nullif(v->>'classe', '') is not null;

  -- estaca obrigatória no lançamento dos serviços que aparecem no 4D
  insert into servico_parametro (item_orcamentario_id, obra_id, exige_local)
  select distinct item_orcamentario_id, _obra_id, true from modelo4d_vinculo where modelo_id = _modelo_id
  on conflict (item_orcamentario_id) do update set exige_local = true
   where not servico_parametro.exige_local;
end $$;
revoke execute on function public.modelo4d_gravar_vinculos(uuid, uuid, jsonb, jsonb) from authenticated;

-- ── Registra o modelo já enviado ao bucket (caminho <obra>/<id>.iw4d.json.gz) e o torna o ativo da obra ───────
create function public.modelo4d_registrar(
  _obra_id uuid, _id uuid, _nome text, _origem text, _tamanho_bytes bigint, _resumo jsonb,
  _eixos jsonb default '[]'::jsonb, _vinculos jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.chamada_autorizada(_obra_id, 'planejar') then
    raise exception 'Sem permissão para planejar esta obra' using errcode = '42501';
  end if;
  if nullif(trim(_nome), '') is null then raise exception 'Dê um nome ao modelo'; end if;
  update modelo4d set ativo = false where obra_id = _obra_id and ativo;
  insert into modelo4d (id, obra_id, nome, origem, storage_path, tamanho_bytes, resumo, criado_por)
  values (_id, _obra_id, trim(_nome), _origem, _obra_id || '/' || _id || '.iw4d.json.gz', _tamanho_bytes,
          coalesce(_resumo, '{}'::jsonb), auth.uid());
  perform public.modelo4d_gravar_vinculos(_id, _obra_id, _eixos, _vinculos);
  return _id;
end $$;

create function public.modelo4d_vincular(_modelo_id uuid, _eixos jsonb, _vinculos jsonb)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare v_obra uuid;
begin
  select obra_id into v_obra from modelo4d where id = _modelo_id;
  if v_obra is null then raise exception 'Modelo não encontrado'; end if;
  if not public.chamada_autorizada(v_obra, 'planejar') then
    raise exception 'Sem permissão para planejar esta obra' using errcode = '42501';
  end if;
  perform public.modelo4d_gravar_vinculos(_modelo_id, v_obra, _eixos, _vinculos);
end $$;

create function public.modelo4d_ativar(_modelo_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare v_obra uuid;
begin
  select obra_id into v_obra from modelo4d where id = _modelo_id;
  if v_obra is null then raise exception 'Modelo não encontrado'; end if;
  if not public.chamada_autorizada(v_obra, 'planejar') then
    raise exception 'Sem permissão para planejar esta obra' using errcode = '42501';
  end if;
  update modelo4d set ativo = false where obra_id = v_obra and ativo and id <> _modelo_id;
  update modelo4d set ativo = true where id = _modelo_id;
end $$;

-- Apaga o registro e devolve o caminho do arquivo, que quem chama remove do bucket. O local obrigatório dos
-- serviços fica como está: desligar é decisão de quem parametriza.
create function public.modelo4d_excluir(_modelo_id uuid)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare v_obra uuid; v_path text;
begin
  select obra_id, storage_path into v_obra, v_path from modelo4d where id = _modelo_id;
  if v_obra is null then raise exception 'Modelo não encontrado'; end if;
  if not public.chamada_autorizada(v_obra, 'planejar') then
    raise exception 'Sem permissão para planejar esta obra' using errcode = '42501';
  end if;
  delete from modelo4d where id = _modelo_id;
  update modelo4d set ativo = true
   where id = (select id from modelo4d where obra_id = v_obra order by created_at desc limit 1)
     and not exists (select 1 from modelo4d where obra_id = v_obra and ativo);
  return v_path;
end $$;

-- ── Bucket do arquivo do modelo ────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('modelos-4d', 'modelos-4d', false, 52428800, null)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "modelos4d_storage_select" on storage.objects;
create policy "modelos4d_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'modelos-4d' and public.pode_ver_obra((split_part(name, '/', 1))::uuid)
         and public.auth_role() <> 'cliente');

drop policy if exists "modelos4d_storage_insert" on storage.objects;
create policy "modelos4d_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'modelos-4d' and public.pode_planejar_obra((split_part(name, '/', 1))::uuid));

drop policy if exists "modelos4d_storage_delete" on storage.objects;
create policy "modelos4d_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'modelos-4d' and public.pode_planejar_obra((split_part(name, '/', 1))::uuid));
