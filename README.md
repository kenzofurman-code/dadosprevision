# Dados Prevision

Painel React/Vite com backend Node.js/Express, sincronização da API Prevision e persistência em PostgreSQL. A arquitetura principal é autônoma e executada com Docker Compose em uma VPS.

## Arquitetura principal

- `app`: compila o frontend, serve a SPA e expõe `GET /api/projects`, `GET /api/data` e `POST /api/sync-prevision`.
- `postgres`: mantém projetos, cronograma, medições, restrições e dados analíticos.
- `node-cron`: sincroniza automaticamente conforme `CRON_SYNC_SCHEDULE`.
- volume `pgdata`: preserva o banco entre recriações dos containers.

O schema é aplicado na inicialização e pode ser executado novamente. As entidades filhas usam a chave composta `(projeto_id, id_prevision)`, pois IDs da Prevision podem se repetir entre projetos.
O PostgreSQL fica acessível somente pela rede interna do Compose; nenhuma porta do banco é publicada na VPS.

## Execução com Docker

1. Copie as variáveis de ambiente e substitua senhas e credenciais:

```bash
cp .env.example .env
```

Variáveis obrigatórias:

```env
POSTGRES_DB=dadosprevision
POSTGRES_USER=postgres
POSTGRES_PASSWORD=uma_senha_forte
PREVISION_API_KEY=sua_chave_graphql
PREVISION_REST_TOKEN=seu_jwt_rest_opcional
CRON_SYNC_SCHEDULE=0 6,18 * * *
```

`POSTGRES_PASSWORD` é obrigatória: o Compose recusa a configuração quando ela está vazia ou ausente.

2. Construa e inicie a aplicação:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

O painel fica disponível em `http://localhost:3000`. O endpoint `GET /api/health` permite verificar o servidor.

## Sincronização

O botão **Sincronizar Prevision** chama `POST /api/sync-prevision`. Sem `projectId`, todos os projetos são atualizados; com um ID, apenas o projeto solicitado é atualizado.

```bash
curl -X POST http://localhost:3000/api/sync-prevision \
  -H "Content-Type: application/json" \
  -d '{"projectId":"123"}'
```

`PREVISION_API_KEY` consulta GraphQL. `PREVISION_REST_TOKEN` é opcional e complementa atividades com o relatório REST de cronograma. Falhas por projeto são registradas nos logs e retornadas em `totals.failures` quando outras obras conseguem concluir.

## Desenvolvimento e validação

```bash
npm ci
npm run lint
npm run build
node --check server/index.js
node --check server/sync.js
node --check server/normalizers.js
docker compose config
```

Para executar o servidor Node fora do Docker, disponibilize um PostgreSQL, configure `DATABASE_URL`, rode `npm run build` e depois `npm start`.

## Deploy na VPS

Consulte [deploy.md](deploy.md) para instalação, atualização, proxy Nginx, HTTPS e backup do volume PostgreSQL.

## Firebase e Vercel (legado)

Os arquivos em `api/`, os utilitários Firebase e os scripts `sync:*` permanecem para compatibilidade com a implantação anterior. Eles usam Firestore, `FIREBASE_SERVICE_ACCOUNT_BASE64` e funções da Vercel, mas não fazem parte do caminho principal Docker/PostgreSQL. Novas implantações devem usar a stack da VPS descrita acima.
