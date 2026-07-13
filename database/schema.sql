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

create index if not exists idx_produtos_familia_id on produtos(familia_id);
create index if not exists idx_mapeamentos_sku_produto_id on mapeamentos_sku(produto_id);
create index if not exists idx_mapeamentos_sku_concorrente_id on mapeamentos_sku(concorrente_id);
create index if not exists idx_historico_precos_mapeamento_id on historico_precos(mapeamento_id);
create index if not exists idx_historico_precos_coletado_em on historico_precos(coletado_em desc);
create index if not exists idx_execucoes_robo_iniciado_em on execucoes_robo(iniciado_em desc);
create index if not exists idx_agenda_coletas_ativo_horario on agenda_coletas(ativo, horario);

insert into concorrentes (nome, site_url, login_url, tipo_consulta, observacoes, ativo)
values
  ('COFEMA', 'https://www.cofema.com.br', 'https://www.cofema.com.br', 'SKU', '', true),
  ('CONSTRUJA', 'https://www.construja.com.br', 'https://www.construja.com.br', 'SKU', '', true),
  ('MAREST', 'https://www.marest.com.br', 'https://www.marest.com.br', 'SKU', '', true),
  ('MEGALESTE', 'https://www.megaleste.com.br', 'https://www.megaleste.com.br', 'SKU', '', true)
on conflict (nome) do update set
  site_url = excluded.site_url,
  login_url = excluded.login_url,
  tipo_consulta = excluded.tipo_consulta,
  ativo = excluded.ativo,
  updated_at = now();
