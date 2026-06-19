# InfraWork — Agente WhatsApp

Serviço Node.js que roda **24/7** mantendo uma sessão WhatsApp (via [Baileys](https://github.com/WhiskeySockets/Baileys)), monitora grupos vinculados a obras, classifica as fotos de serviço por visão (OpenRouter) e sobe as **georreferenciadas** para o `acompanhamento_foto` do InfraWork — fazendo-as aparecer no mapa como as fotos do app mobile.

A administração (conectar número, escolher grupos→obra, backfill) é feita pelo **app Electron**, módulo _WhatsApp_ (god/adm). A comunicação entre app e agente é toda via Supabase.

## Como funciona

```
App Electron ──(escreve config / lê QR+status)──► Supabase ◄──(lê config / grava fotos+status)── Agente (este projeto)
                                                                                   │
                                                                Baileys ⇄ WhatsApp │ visão ⇄ OpenRouter
```

- O agente acompanha a linha mais recente de `whatsapp_sessao`.
- `status = aguardando_qr | conectado | erro` ⇒ o agente garante a sessão ligada; grava o `qr_code` quando precisa parear.
- `status = desconectado` ⇒ o agente faz logout e encerra a sessão.
- Grupos com `monitorar = true` + `obra_id` definido têm as fotos novas processadas ao vivo.
- Jobs em `whatsapp_job` disparam o backfill do histórico.

**Regra de ingestão:** só sobe a foto se a visão indicar que é **foto de serviço** _e_ houver **geolocalização** (lat/lng lidos do overlay da imagem).

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Var | Descrição |
|-----|-----------|
| `SUPABASE_URL` | URL do projeto Supabase do InfraWork |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key (bypassa RLS) |
| `OPENROUTER_API_KEY` | Chave da API OpenRouter |
| `OPENROUTER_MODEL` | Modelo de visão (default `google/gemini-2.0-flash-001`) |
| `SUPABASE_BUCKET_FOTOS` | Bucket de fotos (default `monito-fotos`) |
| `CONFIANCA_MINIMA` | Confiança mínima p/ aceitar o serviço sugerido (0..1) |

## Rodando local (dev)

```bash
npm install
cp .env.example .env   # preencha
npm run dev
```

No app Electron, módulo WhatsApp → **Conectar** (gera o QR) → escaneie com o número dedicado.

## Deploy 24/7 gratuito (Oracle Cloud Always Free)

1. Crie uma VM **Always Free** (ex.: Ampere ARM, Ubuntu) no [Oracle Cloud](https://www.oracle.com/cloud/free/).
2. Instale Docker: `curl -fsSL https://get.docker.com | sh`.
3. Copie este diretório para a VM (`scp`/git) e crie o `.env`.
4. Suba: `docker compose up -d --build`.
5. Acompanhe: `docker compose logs -f`.

O `restart: unless-stopped` reergue o container após reboots/falhas. O estado da sessão (creds do Baileys) fica em `whatsapp_sessao.creds` no Supabase, então a sessão **sobrevive a reinícios e troca de host** — sem volume local.

## ⚠️ Avisos

- **Termos do WhatsApp:** Baileys é não-oficial. Use um **número dedicado** (não o pessoal) — há risco de banimento.
- **Backfill é best-effort:** o WhatsApp só sincroniza histórico limitado e a mídia de mensagens antigas pode já ter expirado (não baixável). O job sobe o que conseguir.
- **Custo OpenRouter:** cada imagem é uma chamada de visão; use um modelo barato e ajuste `CONFIANCA_MINIMA`.
