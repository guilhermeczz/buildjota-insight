# Runbook da VM - Radar ConstruJota

Use este arquivo depois de um `git pull` na VM.

Contexto atual:

- Dominio externo: `radarjj.sytes.net`
- Porta externa liberada pela operadora: `8010`
- URL publica do sistema: `http://radarjj.sytes.net:8010`
- IP fixo da VM: `192.168.100.33`
- App/API Node: porta interna `8080`
- Worker/agendador: porta interna `8787`
- Redirecionamento no roteador: `8010 -> 192.168.100.33:8080`
- Sem HTTPS direto, porque a operadora bloqueia `80` e `443`.

## 1. Depois do git pull

Na VM:

```bash
cd ~/Projeto-Gui/buildjota-insight
git pull
npm install
```

## 2. Configurar `.env.local`

Arquivo:

```bash
nano .env.local
```

Conteudo esperado:

```env
VITE_API_URL=
VITE_WORKER_TRIGGER_URL=http://radarjj.sytes.net:8010/worker/run

DATABASE_URL=postgres://radar:radar_dev_password@localhost:5432/radar_construjota
APP_JWT_SECRET=coloque-a-chave-gerada-aqui
PORT=8080
CORS_ORIGIN=http://radarjj.sytes.net:8010

DB_POOL_MAX=5
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=5000

WORKER_TRIGGER_PORT=8787
WORKER_BLOCK_HEAVY_ASSETS=true
SCHEDULE_TIMEZONE=America/Sao_Paulo
```

Para gerar uma chave nova, se precisar:

```bash
openssl rand -hex 32
```

## 3. Configurar `.env.worker.local`

Arquivo:

```bash
nano .env.worker.local
```

Manter as credenciais dos concorrentes e garantir estas linhas:

```env
DATABASE_URL=postgres://radar:radar_dev_password@localhost:5432/radar_construjota
WORKER_TRIGGER_PORT=8787
WORKER_BLOCK_HEAVY_ASSETS=true
SCHEDULE_TIMEZONE=America/Sao_Paulo
```

## 4. Rodar SQL no DBeaver

Rode este arquivo no banco PostgreSQL da VM:

```text
database/migrations/2026-07-13-agenda-coletas-existing-db.sql
```

Ele faz duas coisas:

- cria/ajusta `agenda_coletas`;
- permite `NULL` em `historico_precos.preco_concorrente`, `diferenca_valor` e `diferenca_percentual`.

Isto e importante para produto sem preco nao virar preco `0` nos insights.

SQL completo, caso precise copiar:

```sql
create table if not exists agenda_coletas (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null unique references familias(id) on delete cascade,
  ativo boolean not null default false,
  horario time,
  dias_semana smallint[] not null default array[1,2,3,4,5,6],
  concorrencia_maxima integer not null default 1 check (concorrencia_maxima between 1 and 4),
  observacoes text not null default '',
  ultima_execucao timestamptz,
  ultimo_status status_execucao,
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table agenda_coletas alter column horario drop not null;
alter table agenda_coletas alter column horario drop default;

drop trigger if exists set_agenda_coletas_updated_at on agenda_coletas;
create trigger set_agenda_coletas_updated_at before update on agenda_coletas for each row execute function set_updated_at();

create index if not exists idx_agenda_coletas_ativo_horario on agenda_coletas(ativo, horario);

alter table historico_precos alter column preco_concorrente drop not null;
alter table historico_precos alter column preco_concorrente drop default;
alter table historico_precos alter column diferenca_valor drop not null;
alter table historico_precos alter column diferenca_valor drop default;
alter table historico_precos alter column diferenca_percentual drop not null;
alter table historico_precos alter column diferenca_percentual drop default;
```

Verificacao no DBeaver:

```sql
select id, familia_id, ativo, horario, dias_semana, concorrencia_maxima
from agenda_coletas
order by created_at desc;
```

Se a consulta rodar sem erro, a tabela existe.

## 5. Build do front

Sempre rode build depois de mudar `.env.local` ou depois de `git pull` com alteracao de frontend:

```bash
npm run build
```

Como o app roda pelo Node na porta `8080`, nao precisa copiar `dist` para `/var/www/radar` para o acesso principal em `8010`.

## 6. Reiniciar processos PM2

```bash
pm2 restart radar-api --update-env
pm2 restart radar-worker --update-env
pm2 save
```

Verificar:

```bash
pm2 status
```

Esperado:

- `radar-api` online;
- `radar-worker` online.

## 7. Testes na VM

```bash
curl -I http://127.0.0.1:8080
curl -I http://192.168.100.33:8080
curl http://127.0.0.1:8787/health
```

Resultados esperados:

- os dois primeiros retornam `HTTP/1.1 200 OK`;
- o worker retorna JSON com `ok`.

## 8. Teste externo

No navegador:

```text
http://radarjj.sytes.net:8010
```

No testador de portas:

```text
Host: radarjj.sytes.net
Port: 8010
```

Deve aparecer aberto.

## 9. Se a Agenda de Coleta nao aparecer no menu

Provavel causa: front antigo ainda rodando.

Rodar:

```bash
git pull
npm install
npm run build
pm2 restart radar-api --update-env
```

Depois abrir:

```text
http://radarjj.sytes.net:8010/agenda-coletas
```

Se abrir pela URL direta mas nao aparecer no menu, limpar cache do navegador com `Ctrl + F5`.

## 10. Se a tela abre, mas nao salva agenda

Provavel causa: SQL da migration nao rodou.

No DBeaver, testar:

```sql
select count(*) from agenda_coletas;
```

Se der erro de tabela inexistente, rodar:

```text
database/migrations/2026-07-13-agenda-coletas-existing-db.sql
```

## 11. Se agenda salva, mas nao executa no horario

Conferir worker:

```bash
pm2 status
pm2 logs radar-worker --lines 80
```

Conferir `.env.worker.local`:

```bash
grep -E "DATABASE_URL|WORKER_TRIGGER_PORT|SCHEDULE_TIMEZONE|WORKER_BLOCK" .env.worker.local
```

Conferir agenda no banco:

```sql
select
  a.ativo,
  a.horario,
  a.dias_semana,
  a.ultima_execucao,
  a.ultimo_status,
  f.nome as familia
from agenda_coletas a
join familias f on f.id = a.familia_id
order by a.horario nulls last, f.nome;
```

Regras da agenda:

- precisa estar `ativo = true`;
- precisa ter `horario` preenchido;
- o dia atual precisa estar em `dias_semana`;
- `radar-worker` precisa estar online;
- se uma coleta estiver rodando, a proxima espera a vez.

## 12. Configuracao recomendada da agenda

No painel **Agenda de Coleta**:

- configurar horario manualmente por familia;
- ativar somente depois de preencher horario;
- comecar com `Paralelo = 1`;
- nao colocar todas as familias no mesmo horario;
- escalonar por hora, por exemplo `06:00`, `07:00`, `08:00`.

## 13. Comportamento de preco ausente

Quando o robo nao encontra preco ou o produto esta indisponivel:

- `preco_concorrente = NULL`;
- `diferenca_valor = NULL`;
- `diferenca_percentual = NULL`;
- status da coleta fica `erro`.

Isto evita preco `0` baguncando os insights.
