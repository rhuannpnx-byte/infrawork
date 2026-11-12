# InfraWork — instruções para agentes

## MCP do InfraWork Web — sempre adaptado ao sistema

O `web/` tem um servidor MCP (`web/mcp/`, publicado em `https://infrawork-web.vercel.app/mcp`) que deixa qualquer
LLM operar o sistema como o usuário. **Toda mudança no web ou no banco precisa vir com o MCP adaptado no mesmo
trabalho** — não é tarefa opcional nem para depois.

Ao mexer em qualquer um destes pontos:

- migração (`web/supabase/migrations/`): tabela, view, coluna, RPC, regra de gatilho;
- Edge Function (`web/supabase/functions/`);
- hook ou lib que grava dados no web (`web/src/features/**/hooks/`, `web/src/lib/`), parsers de planilha, motor do
  cronograma, cálculos de medição;

faça também:

1. Ajuste ou crie a ferramenta em `web/mcp/ferramentas/` (campos, ações, descrição e o `cobre` com as tabelas/RPCs/
   Edge Functions que ela usa). Mantenha no máximo 40 ferramentas: prefira nova `acao` numa ferramenta existente.
2. Se a regra de negócio mudou, atualize o guia (`web/mcp/guia.ts`) e, se for o caso, os prompts (`web/mcp/prompts.ts`).
3. O que não deve passar pela IA vai para `web/mcp/cobertura.ts` com o motivo.
4. Rode `npm test` no `web/` — `mcp/cobertura.test.ts` falha se algo do banco ficou sem ferramenta ou sem motivo, ou
   se uma ferramenta chama RPC com parâmetro que não existe.
5. Para mudanças de fluxo, rode o e2e do MCP no stack local: `npm run mcp:build:local` e
   `E2E_EMAIL=… E2E_PASSWORD=… node mcp/e2e-mcp.mjs` (e acrescente o caso novo nele).
6. O bundle do MCP é gerado no `npm run build` e vai junto no deploy do web.

Detalhes (conexão dos clientes, login OAuth/token, ferramentas): `web/docs/MCP.md`.

## Funções do banco: quem pode chamar

Desde a migração 0053 o papel `anon` não tem acesso a nada do esquema `public`, e função nova nasce executável só por
`authenticated` e `service_role`. Toda função `security definer` nova precisa de uma destas três coisas:

- **o usuário chama** (web, campo ou MCP): confira a permissão na obra no começo — `pode_*`, ou
  `chamada_autorizada(obra, 'ver' | 'orcamento' | 'planejar')` quando a mesma função também roda por gatilho ou pelo
  serviço;
- **só outra função `security definer` chama**: `revoke execute … from authenticated`;
- **só o serviço chama** (Edge Function com a service key, pg_cron): `revoke execute … from authenticated`.

Política nova usa `to authenticated`. O `scripts/e2e-local.mjs` (seção 11) confere que sem login a API não expõe nada
e que as funções sensíveis recusam quem não é da obra — acrescente lá a função nova.

## Publicação na Vercel

Os projetos `infrawork-web` (raiz `web/`) e `infrawork-campo` (raiz `campo/`) estão ligados ao GitHub
(`rhuannpnx-byte/infrawork`): **push na `main` publica em produção**; outras branches geram preview. Cada projeto só
reconstrói quando a própria pasta mudou desde o último deploy (`ignoreCommand` no `vercel.json`). Não use mais
`vercel deploy` de dentro de `web/` ou `campo/` — com a raiz configurada, o deploy manual sai da raiz do repositório.
As migrações anteriores à 0052 estão consolidadas em `web/supabase/migrations/20260701000052_base.sql` (as originais
ficam na tag `pre-consolidacao-migracoes`); as novas seguem a numeração `20260701000053_…`.
Migrações e Edge Functions do Supabase continuam manuais e pedem autorização: migração por
`npx -y supabase@3.0.0 db query --remote --yes --workdir . -f arquivo.sql`; Edge Functions, dentro de `web/`, com a CLI
2.x do projeto (a 3.x recusa o `config.toml`):
`npx supabase functions deploy <nomes> --project-ref ysvcyfmcdlwfjeqzocpa --use-api`.
