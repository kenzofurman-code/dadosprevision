# 🚀 Guia de Deploy na VPS — Dados Prevision

Este guia ensina como subir a aplicação completa (Backend Node.js + Frontend + Banco de Dados PostgreSQL) na sua VPS com **Docker Compose** e **Nginx com SSL grátis**.

---

## 📋 Pré-requisitos na VPS
- Servidor Ubuntu 22.04 / 24.04 ou Debian 12 com acesso root via SSH.
- Docker e Docker Compose instalados.
- Domínio ou subdomínio apontando para o IP da VPS (ex: `prevision.suaempresa.com.br`).

---

## 🛠️ Passo 1: Instalar o Docker na VPS (se ainda não tiver)

Execute no terminal da VPS:
```bash
# Atualizar pacotes
sudo apt update && sudo apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Instalar plugin do Docker Compose
sudo apt install -y docker-compose-plugin

# Testar instalacao
docker --version
docker compose version
```

---

## 📥 Passo 2: Clonar o Repositório e Configurar o `.env`

```bash
# 1. Clonar o projeto
git clone https://github.com/kenzofurman-code/dadosprevision.git /var/www/dadosprevision
cd /var/www/dadosprevision

# 2. Criar o arquivo .env a partir do modelo
cp .env.example .env

# 3. Editar o .env com as suas chaves reais
nano .env
```

> Preencha a `PREVISION_API_KEY` e defina uma senha forte para o `POSTGRES_PASSWORD`. Salve com `Ctrl + O`, `Enter` e saia com `Ctrl + X`.

---

## 🚀 Passo 3: Iniciar a Aplicação com Docker Compose

Com 1 único comando, o Docker vai criar o banco PostgreSQL, compilar o frontend e ligar o servidor com agendador automático:

```bash
docker compose up -d --build
```

Para conferir se os containers estão rodando e os logs:
```bash
docker compose ps
docker compose logs -f app
```

A aplicação já estará respondendo em: `http://IP_DA_SUA_VPS:3000`.

---

## 🔒 Passo 4: Configurar Domínio e HTTPS Grátis (Nginx + Let's Encrypt)

Para rodar com SSL/HTTPS profissional no seu domínio:

```bash
# 1. Instalar Nginx e Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# 2. Criar configuracao do Nginx
sudo nano /etc/nginx/sites-available/dadosprevision
```

Cole o seguinte conteúdo (substituindo pelo seu domínio):
```nginx
server {
    server_name prevision.suaempresa.com.br;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# 3. Ativar o site e recarregar o Nginx
sudo ln -s /etc/nginx/sites-available/dadosprevision /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 4. Gerar certificado SSL Let's Encrypt automatico
sudo certbot --nginx -d prevision.suaempresa.com.br
```

---

## 🔄 Como Atualizar a Aplicação no Futuro

Sempre que fizermos novas alterações no GitHub:
```bash
cd /var/www/dadosprevision
git pull origin main
docker compose up -d --build
```
