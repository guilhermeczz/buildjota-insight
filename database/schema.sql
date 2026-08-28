create extension if not exists "pgcrypto";

do $$ begin
  create type user_role as enum ('admin', 'operador', 'visualizador');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type tipo_consulta as enum ('SKU', 'URL', 'BUSCA');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type status_coleta as enum ('sucesso', 'erro', 'pendente');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type status_execucao as enum ('sucesso', 'parcial', 'erro', 'pendente');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type origem_execucao as enum ('manual', 'edge_function', 'worker', 'agendado');
exception when duplicate_object then null;
end $$;

create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null unique,
  password_hash text not null,
  role user_role not null default 'operador',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists familias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text not null default '',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists concorrentes (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  site_url text not null default '',
  login_url text not null default '',
  tipo_consulta tipo_consulta not null default 'SKU',
  observacoes text not null default '',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  sku_interno text not null unique,
  nome text not null,
  familia_id uuid references familias(id) on delete set null,
  unidade text not null default '',
  preco_atual numeric(12,3) not null default 0 check (preco_atual >= 0),
  observacoes text not null default '',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mapeamentos_sku (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id) on delete cascade,
  concorrente_id uuid not null references concorrentes(id) on delete cascade,
  sku_concorrente text not null,
  url_produto text not null default '',
  unidade_equivalente text not null default '',
  seletor_preco text,
  observacoes text not null default '',
  ativo boolean not null default true,
  ultimo_preco numeric(12,3) check (ultimo_preco is null or ultimo_preco >= 0),
  ultima_atualizacao timestamptz,
  status_coleta status_coleta not null default 'pendente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (produto_id, concorrente_id, sku_concorrente)
);

create table if not exists historico_precos (
  id uuid primary key default gen_random_uuid(),
  mapeamento_id uuid not null references mapeamentos_sku(id) on delete cascade,
  preco_construjota numeric(12,3) not null default 0,
  preco_concorrente numeric(12,3),
  diferenca_valor numeric(12,3),
  diferenca_percentual numeric(10,4),
  status status_coleta not null,
  mensagem_erro text,
  coletado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists execucoes_robo (
  id uuid primary key default gen_random_uuid(),
  status status_execucao not null default 'pendente',
  origem origem_execucao not null default 'manual',
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  total_processados integer not null default 0 check (total_processados >= 0),
  total_sucesso integer not null default 0 check (total_sucesso >= 0),
  total_erro integer not null default 0 check (total_erro >= 0),
  mensagem text not null default '',
  tempo_execucao_segundos integer not null default 0 check (tempo_execucao_segundos >= 0),
  created_at timestamptz not null default now()
);

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

-- O portal proprio da ConstruJota na Mercos alimenta produtos.preco_atual.
-- Ele nao e um concorrente e, por isso, possui mapeamento, historico,
-- execucoes e agenda completamente separados das tabelas de concorrentes.
create table if not exists mapeamentos_construjota_mercos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null unique references produtos(id) on delete cascade,
  sku_site text not null unique,
  mercos_produto_id text,
  url_produto text not null default '',
  ativo boolean not null default true,
  ultimo_preco numeric(12,3) check (ultimo_preco is null or ultimo_preco > 0),
  ultimo_sucesso_em timestamptz,
  ultima_tentativa_em timestamptz,
  ultimo_status text not null default 'pendente'
    check (ultimo_status in ('pendente', 'sucesso', 'indisponivel', 'indisponivel_sem_historico', 'nao_encontrado', 'ambiguo', 'erro')),
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists execucoes_construjota_mercos (
  id uuid primary key default gen_random_uuid(),
  status status_execucao not null default 'pendente',
  origem origem_execucao not null default 'worker',
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  total_processados integer not null default 0 check (total_processados >= 0),
  total_sucesso integer not null default 0 check (total_sucesso >= 0),
  total_indisponivel integer not null default 0 check (total_indisponivel >= 0),
  total_erro integer not null default 0 check (total_erro >= 0),
  mensagem text not null default '',
  tempo_execucao_segundos integer not null default 0 check (tempo_execucao_segundos >= 0),
  created_at timestamptz not null default now()
);

create table if not exists historico_precos_construjota_mercos (
  id uuid primary key default gen_random_uuid(),
  mapeamento_id uuid not null references mapeamentos_construjota_mercos(id) on delete cascade,
  execucao_id uuid references execucoes_construjota_mercos(id) on delete set null,
  preco numeric(12,3) check (preco is null or preco > 0),
  status text not null
    check (status in ('sucesso', 'indisponivel', 'indisponivel_sem_historico', 'nao_encontrado', 'ambiguo', 'erro')),
  mensagem text,
  coletado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists agenda_construjota_mercos (
  id smallint primary key default 1 check (id = 1),
  ativo boolean not null default false,
  horario time,
  dias_semana smallint[] not null default array[1,2,3,4,5]::smallint[]
    check (dias_semana = array[1,2,3,4,5]::smallint[]),
  fuso_horario text not null default 'America/Sao_Paulo'
    check (fuso_horario = 'America/Sao_Paulo'),
  concorrencia_maxima smallint not null default 1 check (concorrencia_maxima = 1),
  intervalo_produtos_ms integer not null default 4000 check (intervalo_produtos_ms between 1000 and 60000),
  ultima_execucao timestamptz,
  ultimo_status status_execucao,
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into agenda_construjota_mercos (id)
values (1)
on conflict (id) do nothing;

create table if not exists app_config (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_usuarios_updated_at on usuarios;
create trigger set_usuarios_updated_at before update on usuarios for each row execute function set_updated_at();

drop trigger if exists set_familias_updated_at on familias;
create trigger set_familias_updated_at before update on familias for each row execute function set_updated_at();

drop trigger if exists set_concorrentes_updated_at on concorrentes;
create trigger set_concorrentes_updated_at before update on concorrentes for each row execute function set_updated_at();

drop trigger if exists set_produtos_updated_at on produtos;
create trigger set_produtos_updated_at before update on produtos for each row execute function set_updated_at();

drop trigger if exists set_mapeamentos_sku_updated_at on mapeamentos_sku;
create trigger set_mapeamentos_sku_updated_at before update on mapeamentos_sku for each row execute function set_updated_at();

drop trigger if exists set_agenda_coletas_updated_at on agenda_coletas;
create trigger set_agenda_coletas_updated_at before update on agenda_coletas for each row execute function set_updated_at();

drop trigger if exists set_mapeamentos_construjota_mercos_updated_at on mapeamentos_construjota_mercos;
create trigger set_mapeamentos_construjota_mercos_updated_at before update on mapeamentos_construjota_mercos for each row execute function set_updated_at();

drop trigger if exists set_agenda_construjota_mercos_updated_at on agenda_construjota_mercos;
create trigger set_agenda_construjota_mercos_updated_at before update on agenda_construjota_mercos for each row execute function set_updated_at();

create or replace function notify_radar_agenda_changed()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify(
    'radar_agenda_changed',
    json_build_object('table', tg_table_name, 'operation', tg_op)::text
  );
  return null;
end;
$$;

drop trigger if exists notify_radar_agenda_coletas_changed on agenda_coletas;
create trigger notify_radar_agenda_coletas_changed
  after insert or update or delete on agenda_coletas
  for each statement execute function notify_radar_agenda_changed();

drop trigger if exists notify_radar_agenda_construjota_changed on agenda_construjota_mercos;
create trigger notify_radar_agenda_construjota_changed
  after insert or update or delete on agenda_construjota_mercos
  for each statement execute function notify_radar_agenda_changed();

create index if not exists idx_produtos_familia_id on produtos(familia_id);
create index if not exists idx_mapeamentos_sku_produto_id on mapeamentos_sku(produto_id);
create index if not exists idx_mapeamentos_sku_concorrente_id on mapeamentos_sku(concorrente_id);
create index if not exists idx_historico_precos_mapeamento_id on historico_precos(mapeamento_id);
create index if not exists idx_historico_precos_coletado_em on historico_precos(coletado_em desc);
create index if not exists idx_execucoes_robo_iniciado_em on execucoes_robo(iniciado_em desc);
create index if not exists idx_agenda_coletas_ativo_horario on agenda_coletas(ativo, horario);
create index if not exists idx_mapeamentos_construjota_mercos_ativo on mapeamentos_construjota_mercos(ativo, created_at);
create index if not exists idx_historico_construjota_mercos_mapeamento on historico_precos_construjota_mercos(mapeamento_id, coletado_em desc);
create index if not exists idx_historico_construjota_mercos_execucao on historico_precos_construjota_mercos(execucao_id);
create index if not exists idx_execucoes_construjota_mercos_inicio on execucoes_construjota_mercos(iniciado_em desc);
create index if not exists idx_agenda_construjota_mercos_ativo_horario on agenda_construjota_mercos(ativo, horario);

insert into concorrentes (nome, site_url, login_url, tipo_consulta, observacoes, ativo)
values
  ('COFEMA', 'https://www.cofema.com.br', 'https://www.cofema.com.br/', 'SKU', '', true),
  ('CONSTRUJA', 'https://www.construja.com.br', 'https://www.construja.com.br', 'SKU', '', true),
  ('MAREST', 'https://www.marest.com.br', 'https://www.marest.com.br', 'SKU', '', true),
  ('MEGALESTE', 'https://www.megaleste.com.br', 'https://www.megaleste.com.br', 'SKU', '', true)
on conflict (nome) do update set
  site_url = excluded.site_url,
  login_url = excluded.login_url,
  tipo_consulta = excluded.tipo_consulta,
  ativo = excluded.ativo,
  updated_at = now();
