# Scripts para configurar a VM

Use este arquivo como cola operacional depois do `git pull` na VM.

## 1. SQL para rodar no DBeaver

Rode o arquivo abaixo no banco PostgreSQL da VM:

```text
database/migrations/2026-07-13-agenda-coletas-existing-db.sql
```

Ele cria/ajusta a tabela `agenda_coletas` e libera `NULL` nos campos de preço/diferença do histórico, para erro de coleta não virar preço zero nos insights.

Se preferir copiar e colar no DBeaver:

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

## 2. Variaveis recomendadas no `.env` da VM

```env
DATABASE_URL=postgres://usuario:senha@localhost:5432/radar_construjota
APP_JWT_SECRET=coloque-uma-chave-grande-aqui
PORT=8080

DB_POOL_MAX=5
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=5000

WORKER_TRIGGER_PORT=8787
WORKER_BLOCK_HEAVY_ASSETS=true
SCHEDULE_TIMEZONE=America/Sao_Paulo
```

Se o frontend e a API estiverem no mesmo servidor:

```env
VITE_API_URL=
```

Se o painel for acessado de outra maquina, use IP/domínio da VM no trigger:

```env
VITE_WORKER_TRIGGER_URL=http://IP_DA_VM:8787/run
```

Dentro da própria VM, pode ser:

```env
VITE_WORKER_TRIGGER_URL=http://localhost:8787/run
```

## 3. Processos que precisam ficar rodando

App/API:

```bash
npm run build
npm start
```

Worker/agendador:

```bash
npm run worker:server
```

A agenda só dispara automaticamente se `npm run worker:server` estiver ativo.

## 4. Configuracao inicial no painel

Na tela **Agenda de Coleta**:

- configure o horário de cada família manualmente;
- ative somente depois de preencher horário;
- comece com `Paralelo = 1`;
- se a VM ficar leve, teste `Paralelo = 2` depois.

