# Implantacao na VM de teste

Guia para hospedar o Radar Construjota sem Supabase, usando front-end React, API Node.js, PostgreSQL e worker Node/Playwright.

## Configuracao da VM

```text
RAM: 8 GB
Disco: 80 GB SSD
CPU: 2 vCPU minimo, 4 vCPU recomendado
Sistema: Ubuntu Server LTS
```

Essa configuracao atende a versao de teste. O worker usa Chromium via Playwright, entao evite rodar varias coletas ao mesmo tempo.

## O que sera hospedado

- Front-end React/Vite.
- API Node.js em `server/index.mjs`.
- PostgreSQL local na VM.
- Tabela `usuarios` com senha hash para login.
- Worker Node.js + Playwright para coleta de precos.
- Nginx como proxy/servidor web.
- PM2 para manter API e worker ativos.

## Portas

Publicas:

```text
80   HTTP
443  HTTPS
```

Internas:

```text
3001  API Node.js
8787  worker trigger
5432  PostgreSQL, somente local
```

Nao exponha o PostgreSQL diretamente para a internet.

## Instalacoes base

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl ca-certificates nginx postgresql postgresql-contrib
```

Instalar Node.js LTS e PM2:

```bash
node -v
npm -v
sudo npm install -g pm2
```

Instalar dependencias do Playwright depois do `npm install` do projeto:

```bash
npm exec playwright install --with-deps chromium
```

## Banco PostgreSQL

Criar usuario e banco:

```bash
sudo -u postgres psql
```

Dentro do `psql`:

```sql
create user radar with encrypted password 'TROCAR_SENHA_FORTE';
create database radar_construjota owner radar;
\q
```

Aplicar o schema:

```bash
psql "postgres://radar:TROCAR_SENHA_FORTE@localhost:5432/radar_construjota" -f database/schema.sql
```

Criar o primeiro usuario admin pela API depois que ela estiver rodando:

```bash
curl -X POST http://127.0.0.1:3001/api/auth/bootstrap-admin \
  -H "content-type: application/json" \
  -d '{"nome":"Administrador","email":"admin@construjota.com.br","password":"TROCAR_SENHA"}'
```

Esse endpoint so funciona enquanto nao existir nenhum usuario.

## Variaveis de ambiente

Criar `.env.local` no servidor:

```env
VITE_API_URL=
# O worker e acessado internamente pela API; nao configure VITE_WORKER_TRIGGER_URL.
WORKER_INTERNAL_URL=http://127.0.0.1:8787

DATABASE_URL=postgres://radar:TROCAR_SENHA_FORTE@localhost:5432/radar_construjota
APP_JWT_SECRET=TROCAR_POR_UMA_CHAVE_GRANDE_ALEATORIA
PORT=3001
CORS_ORIGIN=https://seudominio.com
```

Criar `.env.worker.local`:

```env
DATABASE_URL=postgres://radar:TROCAR_SENHA_FORTE@localhost:5432/radar_construjota

COFEMA_LOGIN=
COFEMA_PASSWORD=
CONSTRUJA_LOGIN=
CONSTRUJA_PASSWORD=
MAREST_LOGIN=
MAREST_PASSWORD=
MEGALESTE_LOGIN=
MEGALESTE_PASSWORD=
```

## Deploy do projeto

```bash
git clone URL_DO_REPOSITORIO
cd buildjota-insight
npm install
npm run build
```

## Rodar API e worker

API:

```bash
pm2 start npm --name radar-api -- run api
```

Worker trigger:

```bash
pm2 start npm --name radar-worker -- run worker:server
```

Salvar PM2:

```bash
pm2 save
pm2 startup
```

Validar:

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:8787/health
```

## Nginx

Exemplo conceitual:

```nginx
server {
    listen 80;
    server_name seudominio.com;

    root /caminho/do/projeto/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /worker/ {
        proxy_pass http://127.0.0.1:8787/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Depois:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## HTTPS

Com dominio apontando para a VM:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com
```

## Backup

Configurar backup do PostgreSQL:

```bash
pg_dump "postgres://radar:TROCAR_SENHA_FORTE@localhost:5432/radar_construjota" > backup-$(date +%F).sql
```

Guarde backups fora da VM sempre que possivel.

## Checklist

- PostgreSQL instalado.
- `database/schema.sql` aplicado.
- `.env.local` e `.env.worker.local` configurados.
- `npm install` executado.
- `npm run build` executado.
- API rodando via PM2.
- Worker trigger rodando via PM2.
- Primeiro admin criado via `/api/auth/bootstrap-admin`.
- Nginx apontando `/api/` para `3001` e `/worker/` para `8787`.
- HTTPS ativo.
- Backup configurado.
