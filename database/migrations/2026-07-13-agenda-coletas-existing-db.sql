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
