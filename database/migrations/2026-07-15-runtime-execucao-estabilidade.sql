-- Estabiliza execucoes, agenda e historico para a VM.
-- Pode ser rodado mais de uma vez com seguranca.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_coleta') then
    create type status_coleta as enum ('sucesso', 'erro', 'pendente');
  end if;
end $$;

alter type status_coleta add value if not exists 'sucesso';
alter type status_coleta add value if not exists 'erro';
alter type status_coleta add value if not exists 'pendente';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_execucao') then
    create type status_execucao as enum ('sucesso', 'parcial', 'erro', 'pendente');
  end if;
end $$;

alter type status_execucao add value if not exists 'sucesso';
alter type status_execucao add value if not exists 'parcial';
alter type status_execucao add value if not exists 'erro';
alter type status_execucao add value if not exists 'pendente';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'origem_execucao') then
    create type origem_execucao as enum ('manual', 'edge_function', 'worker', 'agendado');
  end if;
end $$;

alter type origem_execucao add value if not exists 'manual';
alter type origem_execucao add value if not exists 'edge_function';
alter type origem_execucao add value if not exists 'worker';
alter type origem_execucao add value if not exists 'agendado';

create table if not exists execucoes_robo (
  id uuid primary key default gen_random_uuid(),
  status status_execucao not null default 'pendente',
  origem origem_execucao not null default 'manual',
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  total_processados integer not null default 0,
  total_sucesso integer not null default 0,
  total_erro integer not null default 0,
  mensagem text not null default '',
  tempo_execucao_segundos integer not null default 0,
  created_at timestamptz not null default now()
);

alter table execucoes_robo add column if not exists status status_execucao not null default 'pendente';
alter table execucoes_robo add column if not exists origem origem_execucao not null default 'manual';
alter table execucoes_robo add column if not exists iniciado_em timestamptz not null default now();
alter table execucoes_robo add column if not exists finalizado_em timestamptz;
alter table execucoes_robo add column if not exists total_processados integer not null default 0;
alter table execucoes_robo add column if not exists total_sucesso integer not null default 0;
alter table execucoes_robo add column if not exists total_erro integer not null default 0;
alter table execucoes_robo add column if not exists mensagem text not null default '';
alter table execucoes_robo add column if not exists tempo_execucao_segundos integer not null default 0;
alter table execucoes_robo add column if not exists created_at timestamptz not null default now();

create table if not exists agenda_coletas (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null references familias(id) on delete cascade,
  ativo boolean not null default false,
  horario time,
  dias_semana smallint[] not null default array[1,2,3,4,5,6],
  concorrencia_maxima integer not null default 1,
  observacoes text,
  ultima_execucao timestamptz,
  ultimo_status status_execucao,
  ultimo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (familia_id)
);

alter table agenda_coletas add column if not exists ativo boolean not null default false;
alter table agenda_coletas add column if not exists horario time;
alter table agenda_coletas add column if not exists dias_semana smallint[] not null default array[1,2,3,4,5,6];
alter table agenda_coletas add column if not exists concorrencia_maxima integer not null default 1;
alter table agenda_coletas add column if not exists observacoes text;
alter table agenda_coletas add column if not exists ultima_execucao timestamptz;
alter table agenda_coletas add column if not exists ultimo_status status_execucao;
alter table agenda_coletas add column if not exists ultimo_erro text;
alter table agenda_coletas add column if not exists created_at timestamptz not null default now();
alter table agenda_coletas add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agenda_coletas'
      and column_name = 'ultimo_status'
      and udt_name <> 'status_execucao'
  ) then
    alter table agenda_coletas
      alter column ultimo_status type status_execucao
      using ultimo_status::text::status_execucao;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agenda_coletas'
      and column_name = 'dias_semana'
      and udt_name <> '_int2'
  ) then
    alter table agenda_coletas
      alter column dias_semana type smallint[]
      using dias_semana::smallint[];
  end if;
end $$;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_agenda_coletas_updated_at on agenda_coletas;
create trigger set_agenda_coletas_updated_at
  before update on agenda_coletas
  for each row execute function set_updated_at();

create index if not exists idx_execucoes_robo_iniciado_em
  on execucoes_robo(iniciado_em desc);

create index if not exists idx_agenda_coletas_ativo_horario
  on agenda_coletas(ativo, horario);

alter table if exists historico_precos alter column preco_concorrente drop not null;
alter table if exists historico_precos alter column preco_concorrente drop default;
alter table if exists historico_precos alter column diferenca_valor drop not null;
alter table if exists historico_precos alter column diferenca_valor drop default;
alter table if exists historico_precos alter column diferenca_percentual drop not null;
alter table if exists historico_precos alter column diferenca_percentual drop default;
