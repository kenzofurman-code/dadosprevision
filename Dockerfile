# Estagio 1: Build do Frontend React / Vite
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Estagio 2: Runtime do Servidor Node.js
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY lib ./lib

EXPOSE 3000
CMD ["node", "server/index.js"]
