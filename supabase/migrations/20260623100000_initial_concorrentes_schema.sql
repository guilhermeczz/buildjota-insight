create extension if not exists "pgcrypto";

do $$ begin
  create type public.user_role as enum ('admin', 'operador', 'visualizador');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.tipo_consulta as enum ('SKU', 'URL', 'BUSCA');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.status_coleta as enum ('sucesso', 'erro', 'pendente');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.status_execucao as enum ('sucesso', 'parcial', 'erro', 'pendente');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.origem_execucao as enum ('manual', 'edge_function', 'worker', 'agendado');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null unique,
  role public.user_role not null default 'operador',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.familias (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text not null default '',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.concorrentes (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  site_url text not null default '',
  login_url text not null default '',
  tipo_consulta public.tipo_consulta not null default 'SKU',
  observacoes text not null default '',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  sku_interno text not null unique,
  nome text not null,
  familia_id uuid references public.familias(id) on delete set null,
  unidade text not null default '',
  preco_atual numeric(12,2) not null default 0 check (preco_atual >= 0),
  observacoes text not null default '',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mapeamentos_sku (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  concorrente_id uuid not null references public.concorrentes(id) on delete cascade,
  sku_concorrente text not null,
  url_produto text not null default '',
  unidade_equivalente text not null default '',
  seletor_preco text,
  observacoes text not null default '',
  ativo boolean not null default true,
  ultimo_preco numeric(12,2) check (ultimo_preco is null or ultimo_preco >= 0),
  ultima_atualizacao timestamptz,
  status_coleta public.status_coleta not null default 'pendente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (produto_id, concorrente_id, sku_concorrente)
);

create table if not exists public.historico_precos (
  id uuid primary key default gen_random_uuid(),
  mapeamento_id uuid not null references public.mapeamentos_sku(id) on delete cascade,
  preco_construjota numeric(12,2) not null default 0,
  preco_concorrente numeric(12,2) not null default 0,
  diferenca_valor numeric(12,2) not null default 0,
  diferenca_percentual numeric(10,4) not null default 0,
  status public.status_coleta not null,
  mensagem_erro text,
  coletado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.execucoes_robo (
  id uuid primary key default gen_random_uuid(),
  status public.status_execucao not null default 'pendente',
  origem public.origem_execucao not null default 'manual',
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  total_processados integer not null default 0 check (total_processados >= 0),
  total_sucesso integer not null default 0 check (total_sucesso >= 0),
  total_erro integer not null default 0 check (total_erro >= 0),
  mensagem text not null default '',
  tempo_execucao_segundos integer not null default 0 check (tempo_execucao_segundos >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.app_config (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_familias_updated_at on public.familias;
create trigger set_familias_updated_at
before update on public.familias
for each row execute function public.set_updated_at();

drop trigger if exists set_concorrentes_updated_at on public.concorrentes;
create trigger set_concorrentes_updated_at
before update on public.concorrentes
for each row execute function public.set_updated_at();

drop trigger if exists set_produtos_updated_at on public.produtos;
create trigger set_produtos_updated_at
before update on public.produtos
for each row execute function public.set_updated_at();

drop trigger if exists set_mapeamentos_sku_updated_at on public.mapeamentos_sku;
create trigger set_mapeamentos_sku_updated_at
before update on public.mapeamentos_sku
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'operador')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.familias enable row level security;
alter table public.concorrentes enable row level security;
alter table public.produtos enable row level security;
alter table public.mapeamentos_sku enable row level security;
alter table public.historico_precos enable row level security;
alter table public.execucoes_robo enable row level security;
alter table public.app_config enable row level security;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and ativo = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and ativo = true and role = 'admin'
  );
$$;

drop policy if exists "profiles_select_active" on public.profiles;
create policy "profiles_select_active" on public.profiles
for select using (public.is_active_user());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin" on public.profiles
for insert with check (public.is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles
for delete using (public.is_admin());

drop policy if exists "familias_all_active" on public.familias;
create policy "familias_all_active" on public.familias
for all using (public.is_active_user()) with check (public.is_active_user());

drop policy if exists "concorrentes_all_active" on public.concorrentes;
create policy "concorrentes_all_active" on public.concorrentes
for all using (public.is_active_user()) with check (public.is_active_user());

drop policy if exists "produtos_all_active" on public.produtos;
create policy "produtos_all_active" on public.produtos
for all using (public.is_active_user()) with check (public.is_active_user());

drop policy if exists "mapeamentos_sku_all_active" on public.mapeamentos_sku;
create policy "mapeamentos_sku_all_active" on public.mapeamentos_sku
for all using (public.is_active_user()) with check (public.is_active_user());

drop policy if exists "historico_precos_select_active" on public.historico_precos;
create policy "historico_precos_select_active" on public.historico_precos
for select using (public.is_active_user());

drop policy if exists "execucoes_robo_select_active" on public.execucoes_robo;
create policy "execucoes_robo_select_active" on public.execucoes_robo
for select using (public.is_active_user());

drop policy if exists "app_config_all_admin" on public.app_config;
create policy "app_config_all_admin" on public.app_config
for all using (public.is_admin()) with check (public.is_admin());

create index if not exists idx_produtos_familia_id on public.produtos(familia_id);
create index if not exists idx_mapeamentos_sku_produto_id on public.mapeamentos_sku(produto_id);
create index if not exists idx_mapeamentos_sku_concorrente_id on public.mapeamentos_sku(concorrente_id);
create index if not exists idx_historico_precos_mapeamento_id on public.historico_precos(mapeamento_id);
create index if not exists idx_historico_precos_coletado_em on public.historico_precos(coletado_em desc);
create index if not exists idx_execucoes_robo_iniciado_em on public.execucoes_robo(iniciado_em desc);
