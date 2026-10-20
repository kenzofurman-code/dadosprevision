# Estagio 1: Build do Frontend React / Vite
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
# O npm ignora em silêncio falhas ao baixar dependências opcionais, como o binário nativo do
# rolldown (Vite). Sem esta checagem no mesmo RUN, um node_modules incompleto fica no cache e
# todo build seguinte quebra no `vite build` com "Cannot find native binding".
RUN npm ci && node -e 'const p="@rolldown/binding-"+process.platform+"-"+process.arch+"-musl";try{require.resolve(p)}catch{console.error("ERRO: "+p+" nao foi instalado pelo npm ci (dependencia opcional). O build foi interrompido para nao guardar este node_modules em cache; rode o deploy de novo.");process.exit(1)}'
COPY . .
RUN npm run build

# Estagio 2: Runtime do Servidor Node.js
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY lib ./lib
COPY scripts/sync-diario-local.mjs ./scripts/sync-diario-local.mjs

EXPOSE 3000
CMD ["node", "server/index.js"]
