# Deploy na VPS — Dados Prevision

Este é o procedimento principal de produção: frontend e API no container Node.js, PostgreSQL em container próprio e sincronização periódica no servidor.

## Pré-requisitos

- Ubuntu 22.04/24.04 ou Debian 12 com acesso SSH.
- Docker Engine e plugin Docker Compose.
- Domínio apontado para a VPS, se houver acesso público.

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo apt install -y docker-compose-plugin
docker --version
docker compose version
```

## Instalação

```bash
sudo mkdir -p /var/www
sudo git clone https://github.com/kenzofurman-code/dadosprevision.git /var/www/dadosprevision
cd /var/www/dadosprevision
sudo cp .env.example .env
sudo nano .env
```

Defina pelo menos uma senha PostgreSQL forte e a chave GraphQL da Prevision:

```env
POSTGRES_DB=dadosprevision
POSTGRES_USER=postgres
POSTGRES_PASSWORD=troque_por_uma_senha_forte
PREVISION_API_KEY=sua_chave_graphql
PREVISION_REST_TOKEN=seu_jwt_rest_opcional
CRON_SYNC_SCHEDULE=0 6,18 * * *
```

Não publique `.env` nem credenciais no Git. O container `app` recebe a conexão por `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` e `PGPASSWORD`, evitando problemas com caracteres especiais da senha em URLs.
`POSTGRES_PASSWORD` é obrigatória, e a porta 5432 não é publicada no host; o banco aceita conexões apenas da rede interna do Compose.

## Subir e verificar

```bash
sudo docker compose config
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 app
curl http://127.0.0.1:3000/api/health
```

Na primeira inicialização, o backend aplica `server/schema.sql`. O script também migra o schema inicial da stack VPS e pode ser reexecutado sem apagar dados. O volume `pgdata` mantém o PostgreSQL após rebuilds.

Para iniciar a primeira sincronização manualmente:

```bash
curl -X POST http://127.0.0.1:3000/api/sync-prevision \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Nginx e HTTPS

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/dadosprevision
```

Exemplo, substituindo o domínio:

```nginx
server {
    listen 80;
    server_name prevision.suaempresa.com.br;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/dadosprevision /etc/nginx/sites-enabled/dadosprevision
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d prevision.suaempresa.com.br
```

## Atualização

```bash
cd /var/www/dadosprevision
sudo git pull --ff-only origin main
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 app
```

Não use `docker compose down -v` durante uma atualização: `-v` remove o volume do banco.

## Backup e restauração do PostgreSQL

```bash
sudo docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > dadosprevision.dump
```

Restaure em uma instância vazia e compatível:

```bash
sudo docker compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < dadosprevision.dump
```

## Implantação legada

Vercel, Firebase/Firestore e as rotas em `api/` são mantidos somente para compatibilidade com a implantação anterior. Eles exigem credenciais e operação próprias e não são necessários para a stack Docker/PostgreSQL. Para uma instalação nova, use exclusivamente o fluxo VPS acima.
