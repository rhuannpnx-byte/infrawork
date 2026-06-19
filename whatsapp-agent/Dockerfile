# Imagem do agente WhatsApp do InfraWork.
#
# Uma dependência do Baileys (libsignal) é declarada como `github:...`, que o npm
# resolve via ssh (ssh://git@github.com/...). A imagem não tem ssh nem credencial,
# então o clone falha. O npm roda o git de forma hermética (GIT_CONFIG_GLOBAL e
# GIT_CONFIG_SYSTEM = /dev/null), ignorando `git config`. Por isso injetamos o
# rewrite ssh->https via config por ENV (GIT_CONFIG_COUNT), que o npm não sobrescreve.

FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV GIT_CONFIG_COUNT=1
ENV GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf"
ENV GIT_CONFIG_VALUE_0="ssh://git@github.com/"
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV GIT_CONFIG_COUNT=1
ENV GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf"
ENV GIT_CONFIG_VALUE_0="ssh://git@github.com/"
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# Variáveis de runtime vêm do ambiente do container (docker-compose / orquestrador).
CMD ["node", "dist/main.js"]
