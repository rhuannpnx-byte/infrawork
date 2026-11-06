# MCP do InfraWork

O MCP permite que uma IA (Claude, ChatGPT, Cursor, Gemini, n8n, agentes próprios) opere o InfraWork como o usuário
conectado: orçamento, agrupamento, composições, planejamento e cronograma, locais e quantidades, transporte, viagens,
produção, fotos e análises. Ela sempre age com as permissões de quem entrou (as mesmas regras do banco do web).

- **Endereço:** `https://infrawork-web.vercel.app/mcp` (Streamable HTTP, sem sessão).
- **Código:** `web/mcp/` (servidor, ferramentas, cobertura e e2e). Usa os módulos do próprio web (motor do
  cronograma, parsers de planilha, medição/QDM), sem cópia.

## Como conectar

| Cliente | Como |
|---|---|
| Claude.ai / Claude Desktop | Configurações › Conectores › Adicionar conector personalizado › URL acima. Entra com a conta do InfraWork (OAuth) e autoriza na tela "Conectar IA ao InfraWork". |
| ChatGPT | Configurações › Conectores (modo desenvolvedor) › novo conector MCP com a URL acima › OAuth. |
| Claude Code | `claude mcp add --transport http infrawork https://infrawork-web.vercel.app/mcp --header "Authorization: Bearer iwk_…"` (ou sem o cabeçalho, para entrar por OAuth). |
| Cursor / outros IDEs | `{"mcpServers": {"infrawork": {"url": "https://infrawork-web.vercel.app/mcp", "headers": {"Authorization": "Bearer iwk_…"}}}}` |
| n8n, Gemini, agentes | Cliente MCP HTTP com o cabeçalho `Authorization: Bearer iwk_…`. |
| Local (stdio) | `npm run mcp:build` e `node web/mcp/dist/stdio.mjs` com `INFRAWORK_TOKEN=iwk_…` (ou `INFRAWORK_EMAIL`/`INFRAWORK_SENHA`). |

O token pessoal (`iwk_…`) é gerado no web: menu do usuário › **Conectar IA (MCP)** (aparece uma vez; tem validade e
pode ser revogado). O banco guarda só o hash.

## Como funciona o login

- **OAuth 2.1 (próprio do InfraWork, nada para ligar no Supabase):** o MCP é o servidor de autorização
  (`web/mcp/oauth.ts`).
  - Metadados: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` (e
    `openid-configuration`).
  - Registro dinâmico de clientes: `POST /oauth/registrar` (clientes públicos; redirect https, localhost ou esquema de
    app).
  - Consentimento: a tela `/oauth/autorizar` do web (o usuário entra com a conta do InfraWork e clica em Permitir; a
    RPC `mcp_oauth_autorizar` emite o código, uso único, 5 min).
  - Troca e renovação: `POST /oauth/token` (PKCE S256 obrigatório; acesso `iwk_…` de 1 h; renovação `iwr_…` de 90 dias,
    trocada a cada uso).
  - Os logins aparecem na lista de tokens do usuário (menu › Conectar IA), marcados como "login", e podem ser
    revogados ali.
- **Token pessoal:** o servidor valida o hash em `mcp_token` e abre a sessão do dono (link mágico gerado e verificado
  no servidor, com a service key só no servidor da Vercel). Os tokens de acesso do OAuth usam o mesmo caminho.
- Em todos os casos o MCP fala com o banco como o usuário: o RLS e as regras (travas de LB e aditivo, rateio, produção,
  viagens) valem igual ao web, e as mensagens de erro do banco chegam à IA.

## Ferramentas

32 ferramentas, agrupadas por área com o campo `acao` (cabe no limite de 40 de clientes como o Cursor):

- **Contexto:** `quem_sou`, `consultar` (leitura genérica de tabelas/views permitidas, paginando).
- **Gerencial:** `obras`, `usuarios`, `trechos`.
- **Orçamento:** `orcamento_importar`, `orcamento_itens`, `agrupadores`, `orcamento_resumo`, `indiretos`, `notas_item`,
  `aditivos`, `reajustes`, `taxas`.
- **Composições:** `recursos`, `composicoes`, `servicos_catalogo`.
- **Planejamento:** `planos`, `tarefas`, `dependencias_marcos`, `cronograma`, `quantidades_locais`, `calendarios`,
  `equipes`.
- **Acompanhamento:** `producao`, `parametros_servico`, `transporte`, `viagens`, `frota`, `alertas`, `fotos`,
  `analises`.

Além das ferramentas: o recurso `infrawork://guia` (ordem das operações e regras do domínio, para a IA ler antes) e os
prompts `montar_obra`, `importar_orcamento`, `planejar_quantidades`, `lancar_viagens`, `situacao_obra`.

- **Confirmação:** ações destrutivas ou em massa (excluir, importar, promover LB, aplicar aditivo/reajuste, sincronizar
  FleetHub…) devolvem `precisa_confirmar` com o impacto; só executam numa segunda chamada com `confirmar: true`.
- **Cronograma:** depois de qualquer mudança de planejamento, a ferramenta roda o motor (o mesmo do web) e grava o
  cálculo. Em lote, passe `recalcular: false` e chame `cronograma.calcular` no fim.
- **Arquivos:** planilhas entram em base64 ou URL; modelos e a medição (.xlsx) voltam em base64.
- **Fora do MCP, de propósito:** a credencial da FleetHub (só pela tela do web) e a criação de tokens pessoais.

## Manutenção — toda mudança no sistema adapta o MCP

1. **Mudou migração, RPC, Edge Function ou hook de escrita do web?** Ajuste a ferramenta em `web/mcp/ferramentas/`
   (campos, ações, `cobre`) e o guia (`web/mcp/guia.ts`) se a regra de negócio mudou.
2. **`npm test`** roda `mcp/cobertura.test.ts`: falha se existir tabela, view, RPC ou Edge Function sem ferramenta e sem
   motivo registrado em `mcp/cobertura.ts`, se o manifesto citar algo que não existe mais ou se uma ferramenta chamar
   RPC com parâmetro errado.
3. **E2E do MCP** (stack local): `npm run mcp:build:local` e
   `E2E_EMAIL=… E2E_PASSWORD=… node mcp/e2e-mcp.mjs` — monta uma obra do zero só pelas ferramentas e confere os
   números (custo da composição, rateio, datas do cronograma, LB, produção, viagens, medição/QDM, papéis, exclusão).
   Login OAuth: `node mcp/e2e-oauth.mjs` (com o web em 5174) — registro, consentimento, PKCE, renovação e revogação.
4. **Publicação:** o bundle é gerado no `npm run build` (`node mcp/build.mjs`) e vai junto no deploy do web.

## Publicação (uma vez)

- Migrações `20260701000046_mcp_token.sql` e `20260701000047_mcp_oauth.sql` no Supabase.
- Vercel (projeto infrawork-web): variável secreta `SUPABASE_SERVICE_ROLE_KEY` (só servidor; a chave `service_role`
  — a "secret" nova vem mascarada pela API de chaves).
