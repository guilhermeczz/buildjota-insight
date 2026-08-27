-- Fonte de preco proprio da ConstruJota hospedada temporariamente na Mercos.
-- Nao cadastra CONSTRUJOTA_MERCOS como concorrente e nao altera coletores existentes.

create extension if not exists "pgcrypto";

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

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_mapeamentos_construjota_mercos_updated_at on mapeamentos_construjota_mercos;
create trigger set_mapeamentos_construjota_mercos_updated_at
  before update on mapeamentos_construjota_mercos
  for each row execute function set_updated_at();

drop trigger if exists set_agenda_construjota_mercos_updated_at on agenda_construjota_mercos;
create trigger set_agenda_construjota_mercos_updated_at
  before update on agenda_construjota_mercos
  for each row execute function set_updated_at();

create index if not exists idx_mapeamentos_construjota_mercos_ativo
  on mapeamentos_construjota_mercos(ativo, created_at);
create index if not exists idx_historico_construjota_mercos_mapeamento
  on historico_precos_construjota_mercos(mapeamento_id, coletado_em desc);
create index if not exists idx_historico_construjota_mercos_execucao
  on historico_precos_construjota_mercos(execucao_id);
create index if not exists idx_execucoes_construjota_mercos_inicio
  on execucoes_construjota_mercos(iniciado_em desc);
create index if not exists idx_agenda_construjota_mercos_ativo_horario
  on agenda_construjota_mercos(ativo, horario);
