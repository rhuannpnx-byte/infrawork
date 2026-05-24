# Como instalar o InfraWork

## Requisitos

- Windows 10 ou 11 (64 bits)
- Conexão com internet (o app conversa com o backend Supabase)
- Credenciais de acesso fornecidas pelo administrador da TecPav

## Baixar a última versão

1. Acesse a página de releases: <https://github.com/rhuannpnx-byte/infrawork/releases/latest>
2. Na seção **Assets**, baixe o arquivo **`InfraWork-Setup-X.Y.Z.exe`** (o que termina em `.exe`).

## Instalar

1. Dê duplo clique no `InfraWork-Setup-X.Y.Z.exe`.
2. Na **1ª instalação**, o Windows pode mostrar a tela azul **"O Windows protegeu o computador"** (SmartScreen). Isso acontece porque ainda não usamos certificado de assinatura. Faça:
   - Clique em **Mais informações**
   - Clique em **Executar mesmo assim**
3. Siga o assistente: **Avançar → Avançar → Instalar**.
4. O app abre sozinho ao final. Faça login com o email e senha que receberam da TecPav.

## Atualizar

**Não precisa fazer nada manualmente.** O app verifica atualizações:

- No momento em que você abre o InfraWork
- A cada 4 horas se o app ficar aberto

Quando uma nova versão estiver disponível:

1. Aparece um aviso no canto da tela: **"Atualização disponível, baixando…"**
2. Quando o download termina: **"Atualização vX.Y.Z pronta — Reiniciar agora?"**
3. Clicar em **Reiniciar agora**: o app fecha, instala e reabre automaticamente.

Se preferir adiar, o update é aplicado na próxima vez que você fechar e abrir o app.

## Onde estão meus dados?

- **Documentos do app:** todos os dados (obras, orçamentos, fotos) ficam no servidor Supabase. Nada é salvo localmente, exceto preferências de interface (sidebar aberta, tema, etc.).
- **Preferências locais:** `%APPDATA%\infrawork\config.json`.
- **Logs (se houver bug):** abrir o app pressionando `Ctrl+Shift+I` mostra o console com mensagens detalhadas.

## Desinstalar

**Painel de Controle** → **Programas e Recursos** → **InfraWork** → **Desinstalar**.

Ou via PowerShell:

```powershell
winget uninstall InfraWork
```

## Reportar bug ou pedir feature

Use o GitHub Issues do projeto:
- <https://github.com/rhuannpnx-byte/infrawork/issues/new>

Ou envie email para **egp@tecpav.com.br** descrevendo:

- O que você estava fazendo
- O que aconteceu vs o que esperava
- Print da tela (se for visual)
- Versão do app (canto inferior do menu: "v0.1.0 · TECPAV")

## Suporte rápido

| Sintoma | Solução |
|---|---|
| App não abre depois de instalar | Reinicie o PC, abra de novo. Se persistir, mande print do erro. |
| "Sessão expirada" no login | Feche e abra de novo. Se persistir, peça reset de senha pra TecPav. |
| App não atualiza sozinho | Force o restart: feche **completamente** (clique direito no ícone na barra de tarefas → Fechar) e abra de novo. |
| Tela branca após login | `Ctrl+Shift+I` → aba Console → print do erro + mande pro suporte. |
