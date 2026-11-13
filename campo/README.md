# InfraWork Campo (PWA)

App de campo do InfraWork Web — cópia do Monito Mobile (mesmas telas, offline-first, câmera com marca d'água), mas
gravando **direto no banco do InfraWork Web** (Supabase: RLS + RPCs `campo_*`), sem backend intermediário nem SIGA.

Módulos:

- **Produção** — sessão do dia (obra, data, encarregado, equipe) com um apontamento por serviço. Os campos seguem a
  parametrização do serviço (Planejamento › Parametrização no web): quantidade; material controlado (fixo, só a
  quantidade); local e estacas (obrigatórios quando o serviço exige); observação quando habilitada.
- **Viagens** — ficha do caminhão no dia (frota da empresa, motorista, km) com as viagens: serviço lançado por viagens,
  origem, destino, estaca na pista (descarga ou corte), horários, quantidade (padrão = capacidade do caminhão),
  material, DMT (padrão = rota cadastrada) e NF/ticket. A produção do dia do serviço é a soma das viagens (calculada no
  banco).
- **Fotos** — câmera ou galeria, GPS no EXIF e marca d'água (data, serviço, encarregado, equipe, coordenadas).

Quem usa: o papel **apontador** (criado em Gerencial › Usuários e liberado nas obras), além de engenheiro, apoio, adm e
god. O apontador não entra no sistema web.

## Offline

- Catálogo da obra (serviços parametrizados, equipes, encarregados, locais, frota, origens/destinos, rotas) baixado
  para o IndexedDB (Dexie) e renovado a cada ciclo quando muda.
- Lançamentos, fichas e fotos vão para filas locais e sobem sozinhos (ao voltar a rede, ao abrir o app, a cada 60 s).
  Todo envio é idempotente pelo UUID gerado no aparelho — reenviar não duplica.
- Recusa do servidor (ex.: estaca fora do eixo, material obrigatório) vira "recusado" com o motivo; o operador abre,
  corrige e grava de novo.
- Sessão: o Supabase renova o token sozinho com rede; sem rede o app segue lançando e pede novo login só para enviar.

## Rodar

```bash
cd campo
npm install
cp .env.example .env.development.local   # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev                               # http://localhost:5175
```

Local: o stack do `web/` (`supabase start`, API em `http://127.0.0.1:55321`). Para dados de teste, depois do
`web/scripts/seed-cronograma.mjs`, rode `web/scripts/seed-campo.mjs` — cria o apontador
`apontador@infrawork.local` / `Campo-local-2026`, frota, origens/destinos, parâmetros e fichas de exemplo.

Testar no celular pela rede local: `CAMPO_HTTPS=1 npm run dev` (câmera, GPS e service worker exigem HTTPS fora de
localhost; com `dev-cert.pem`/`dev-key.pem` do mkcert o certificado é confiável).

| Comando | Faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento (porta 5175; o web usa a 5174) |
| `npm run build` | `tsc` + build com service worker (`dist/`) |
| `npm run lint` | ESLint (sem avisos) |
| `npm run typecheck` | só o TypeScript |

## Deploy

Vercel, projeto `infrawork-campo` → https://infrawork-campo.vercel.app. O push na `main` publica quando a pasta
`campo/` mudou.

A identidade visual é a mesma do site ("Prancheta técnica", `web/DESIGN.md`): tema claro por padrão, cores por
variável em `src/styles/theme.css`, Archivo servida junto com o app e alvos de toque de 44 px.
`vercel.json` traz o fallback da SPA, o service worker sem cache e a CSP (o `connect-src` libera o Supabase do
InfraWork Web — trocar se o projeto Supabase mudar). Variáveis do projeto: `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY`. No Supabase, Auth › URL Configuration: incluir a URL do app em *Redirect URLs*. No web,
`VITE_CAMPO_URL` faz a tela do apontador mostrar o link do app.

## Estrutura

- `src/core/api` — chamadas ao Supabase (`campo_obras`, `campo_catalogo`, `campo_sync_producao`, `campo_sync_ficha`,
  upload ao bucket `acompanhamento-fotos` + `campo_registrar_foto`).
- `src/core/db` — Dexie (`infrawork_campo`): catálogo por obra e filas `out_producao`, `out_ficha`, `out_foto`.
- `src/core/sync` — motor de envio (`foregroundSync`) e cada fila.
- `src/features`, `src/routes` — Produção, Viagens (`carreteiro`), Fotos.
- `src/lib/posicao.ts` — estacas (a mesma regra do web).
