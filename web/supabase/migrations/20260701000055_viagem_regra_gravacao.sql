-- 0055 — A regra de gravação das viagens deixa de entrar na leitura.
--
-- viagem_write era "for all": o Postgres também a aplicava ao SELECT e conferia a permissão de lançar em todas as
-- fichas a cada leitura (produção, CO.081: 170 ms de 173 ms nas viagens de 7 dias). Quem grava uma viagem já a vê
-- pela viagem_select, então separar inclusão, alteração e exclusão não muda o que ninguém vê.

drop policy viagem_write on public.viagem;

create policy viagem_insert on public.viagem for insert to authenticated
  with check (exists (select 1 from public.viagem_ficha f
                       where f.id = viagem.ficha_id
                         and f.obra_id in (select public.obras_permitidas('lancar'))
                         and ((select public.auth_role()) not in ('apoio', 'apontador') or f.criado_por = (select auth.uid()))));

create policy viagem_update on public.viagem for update to authenticated
  using (exists (select 1 from public.viagem_ficha f
                  where f.id = viagem.ficha_id
                    and f.obra_id in (select public.obras_permitidas('lancar'))
                    and ((select public.auth_role()) not in ('apoio', 'apontador') or f.criado_por = (select auth.uid()))))
  with check (exists (select 1 from public.viagem_ficha f
                       where f.id = viagem.ficha_id
                         and f.obra_id in (select public.obras_permitidas('lancar'))
                         and ((select public.auth_role()) not in ('apoio', 'apontador') or f.criado_por = (select auth.uid()))));

create policy viagem_delete on public.viagem for delete to authenticated
  using (exists (select 1 from public.viagem_ficha f
                  where f.id = viagem.ficha_id
                    and f.obra_id in (select public.obras_permitidas('lancar'))
                    and ((select public.auth_role()) not in ('apoio', 'apontador') or f.criado_por = (select auth.uid()))));
