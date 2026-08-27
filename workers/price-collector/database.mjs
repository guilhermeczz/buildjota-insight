import { query, transaction } from "../../server/db.mjs";
import { allowedConcorrenteNames } from "./config.mjs";

let runtimeSchemaReady = false;

export function createDatabaseClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL nao configurada");
  }
  return { localPostgres: true };
}

export async function ensureRuntimeSchema() {
  if (runtimeSchemaReady) return;

  await query(`
    create extension if not exists "pgcrypto";

    do $$
    begin
      if not exists (select 1 from pg_type where typname = 'status_coleta') then
        create type status_coleta as enum ('sucesso', 'erro', 'pendente');
      end if;
    end $$;

    do $$
    begin
      if not exists (select 1 from pg_type where typname = 'status_execucao') then
        create type status_execucao as enum ('sucesso', 'parcial', 'erro', 'pendente');
      end if;
    end $$;

    do $$
    begin
      if not exists (select 1 from pg_type where typname = 'origem_execucao') then
        create type origem_execucao as enum ('manual', 'edge_function', 'worker', 'agendado');
      end if;
    end $$;
  `);

  await query(`
    alter type status_coleta add value if not exists 'sucesso';
    alter type status_coleta add value if not exists 'erro';
    alter type status_coleta add value if not exists 'pendente';

    alter type status_execucao add value if not exists 'sucesso';
    alter type status_execucao add value if not exists 'parcial';
    alter type status_execucao add value if not exists 'erro';
    alter type status_execucao add value if not exists 'pendente';

    alter type origem_execucao add value if not exists 'manual';
    alter type origem_execucao add value if not exists 'edge_function';
    alter type origem_execucao add value if not exists 'worker';
    alter type origem_execucao add value if not exists 'agendado';
  `);

  await query(`
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
    as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$;

    drop trigger if exists set_agenda_coletas_updated_at on agenda_coletas;
    create trigger set_agenda_coletas_updated_at
      before update on agenda_coletas
      for each row execute function set_updated_at();

    drop trigger if exists set_mapeamentos_construjota_mercos_updated_at on mapeamentos_construjota_mercos;
    create trigger set_mapeamentos_construjota_mercos_updated_at
      before update on mapeamentos_construjota_mercos
      for each row execute function set_updated_at();

    drop trigger if exists set_agenda_construjota_mercos_updated_at on agenda_construjota_mercos;
    create trigger set_agenda_construjota_mercos_updated_at
      before update on agenda_construjota_mercos
      for each row execute function set_updated_at();

    create index if not exists idx_execucoes_robo_iniciado_em
      on execucoes_robo(iniciado_em desc);

    create index if not exists idx_agenda_coletas_ativo_horario
      on agenda_coletas(ativo, horario);

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

    alter table if exists historico_precos alter column preco_concorrente drop not null;
    alter table if exists historico_precos alter column preco_concorrente drop default;
    alter table if exists historico_precos alter column diferenca_valor drop not null;
    alter table if exists historico_precos alter column diferenca_valor drop default;
    alter table if exists historico_precos alter column diferenca_percentual drop not null;
    alter table if exists historico_precos alter column diferenca_percentual drop default;
  `);

  runtimeSchemaReady = true;
}

function normalize(row) {
  return {
    ...row,
    ultimo_preco: row.ultimo_preco == null ? null : Number(row.ultimo_preco),
    produtos: {
      id: row.produto_id,
      nome: row.produto_nome,
      sku_interno: row.sku_interno,
      familia_id: row.familia_id,
      preco_atual: Number(row.preco_atual),
      ativo: row.produto_ativo,
    },
    concorrentes: {
      id: row.concorrente_id,
      nome: row.concorrente_nome,
      site_url: row.site_url,
      login_url: row.login_url,
      tipo_consulta: row.tipo_consulta ?? "URL",
      ativo: row.concorrente_ativo,
    },
  };
}

export async function fetchActiveMappings(_client, filters = {}) {
  const values = [];
  const clauses = ["m.ativo = true", "p.ativo = true", "c.ativo = true"];
  values.push(allowedConcorrenteNames);
  clauses.push(`
    exists (
      select 1
      from unnest($${values.length}::text[]) as allowed(nome)
      where upper(trim(c.nome)) = allowed.nome
         or upper(trim(c.nome)) like allowed.nome || ' %'
    )
  `);

  if (filters.mapeamentoId) {
    values.push(filters.mapeamentoId);
    clauses.push(`m.id = $${values.length}`);
  }
  if (filters.skuConcorrente) {
    values.push(String(filters.skuConcorrente).trim());
    clauses.push(`trim(m.sku_concorrente) = $${values.length}`);
  }
  if (filters.produtoId) {
    values.push(filters.produtoId);
    clauses.push(`m.produto_id = $${values.length}`);
  }
  if (filters.familiaId) {
    values.push(filters.familiaId);
    clauses.push(`p.familia_id = $${values.length}`);
  }
  if (filters.concorrente) {
    values.push(String(filters.concorrente).trim().toUpperCase());
    clauses.push(`upper(trim(c.nome)) = $${values.length}`);
  }
  if (filters.failedOnly) {
    if (filters.failedSince || filters.failedUntil) {
      const failedClauses = ["h.mapeamento_id = m.id", "h.status = 'erro'"];

      if (filters.failedSince) {
        values.push(filters.failedSince);
        failedClauses.push(`h.coletado_em >= $${values.length}`);
      }

      if (filters.failedUntil) {
        values.push(filters.failedUntil);
        failedClauses.push(`h.coletado_em <= $${values.length}`);
      }

      clauses.push(`
        exists (
          select 1
          from historico_precos h
          where ${failedClauses.join(" and ")}
        )
      `);
    } else {
      clauses.push(`
        (
          m.status_coleta = 'erro'
          or exists (
            select 1
            from historico_precos h
            where h.mapeamento_id = m.id
              and h.status = 'erro'
              and h.coletado_em = (
                select max(h2.coletado_em)
                from historico_precos h2
                where h2.mapeamento_id = m.id
              )
          )
        )
      `);
    }
  }

  const { rows } = await query(
    `
      select
        m.id,
        m.sku_concorrente,
        m.url_produto,
        m.seletor_preco,
        m.produto_id,
        m.concorrente_id,
        m.status_coleta,
        m.ultimo_preco,
        p.nome as produto_nome,
        p.sku_interno,
        p.familia_id,
        p.preco_atual,
        p.ativo as produto_ativo,
        c.nome as concorrente_nome,
        c.site_url,
        c.login_url,
        c.tipo_consulta,
        c.ativo as concorrente_ativo
      from mapeamentos_sku m
      join produtos p on p.id = m.produto_id
      join concorrentes c on c.id = m.concorrente_id
      where ${clauses.join(" and ")}
      order by m.created_at asc
    `,
    values,
  );

  return rows.map(normalize);
}

export async function createExecution(totalProcessados, options = {}) {
  const startedAt = new Date();
  const origem = options.origem ?? "worker";
  const mensagem = options.mensagem ?? "Worker iniciado.";
  const { rows } = await query(
    `insert into execucoes_robo
      (status,origem,iniciado_em,total_processados,total_sucesso,total_erro,mensagem)
     values ('pendente',$1,$2,$3,0,0,$4)
     returning id`,
    [origem, startedAt.toISOString(), totalProcessados, mensagem],
  );

  return { id: rows[0].id, startedAt };
}

export async function updateExecutionPlan(executionId, totalProcessados, message) {
  if (!executionId) return;

  await query(
    `update execucoes_robo
     set total_processados = $1,
         mensagem = $2
     where id = $3 and status = 'pendente'`,
    [
      Number(totalProcessados ?? 0),
      String(message ?? "Coleta iniciada.").slice(0, 500),
      executionId,
    ],
  );
}

export async function markExecutionFailed(execution, error) {
  if (!execution?.id) return;

  const finishedAt = new Date();
  const startedAt = execution.startedAt ? new Date(execution.startedAt) : finishedAt;
  const message = error instanceof Error ? error.message : String(error ?? "Falha na coleta.");

  await query(
    `update execucoes_robo
     set status = 'erro',
         finalizado_em = $1,
         total_erro = greatest(total_erro, 1),
         mensagem = $2,
         tempo_execucao_segundos = $3
     where id = $4`,
    [
      finishedAt.toISOString(),
      message.slice(0, 500),
      Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)),
      execution.id,
    ],
  );
}

export async function updateExecutionProgress(executionId, message) {
  if (!executionId || !message) return;

  await query(
    `update execucoes_robo
     set mensagem = $1
     where id = $2 and status = 'pendente'`,
    [String(message).slice(0, 500), executionId],
  );
}

export function normalizeResultForPersistence(item) {
  const precoInformado = Number(item.preco_concorrente);
  const concorrente = String(item.concorrente ?? "")
    .trim()
    .toUpperCase();
  const concorrentePermitido = allowedConcorrenteNames.includes(concorrente);
  const evidenceConfirmed =
    concorrentePermitido &&
    item.leitura_confirmada === true &&
    item.produto_confirmado === true &&
    item.bloco_preco_confirmado === true &&
    item.elemento_preco_visivel === true &&
    Number(item.quantidade_precos_principais) === 1 &&
    item.formato_preco_reconhecido === true &&
    item.preco_principal_confirmado === true;
  const sucesso =
    item.status === "sucesso" &&
    evidenceConfirmed &&
    Number.isFinite(precoInformado) &&
    precoInformado > 0;

  return {
    sucesso,
    status: sucesso ? "sucesso" : "erro",
    precoConcorrente: sucesso ? precoInformado : null,
    mensagemErro:
      item.mensagem_erro ??
      (sucesso
        ? null
        : `${concorrente || "CONCORRENTE"}: validacao final do produto ou preco principal falhou`),
    preservarUltimoPreco: item.preservar_ultimo_preco === true || !sucesso,
  };
}

export async function registerResults(resultados, mensagem, options = {}) {
  const startedAt = options.startedAt ? new Date(options.startedAt) : new Date();
  const origem = options.origem ?? "worker";

  return transaction(async (client) => {
    const execucaoId =
      options.executionId ??
      (
        await client.query(
          `insert into execucoes_robo
            (status,origem,iniciado_em,total_processados,total_sucesso,total_erro,mensagem)
           values ('pendente',$1,$2,$3,0,0,$4)
           returning id`,
          [origem, startedAt.toISOString(), resultados.length, "Worker iniciado."],
        )
      ).rows[0].id;

    let totalSucesso = 0;
    let totalErro = 0;

    for (const item of resultados) {
      const normalized = normalizeResultForPersistence(item);
      const { sucesso, precoConcorrente } = normalized;
      const statusItem = normalized.status;
      if (sucesso) totalSucesso += 1;
      if (!sucesso) totalErro += 1;

      const diferencaValor =
        sucesso && precoConcorrente !== null
          ? Number((Number(item.preco_construjota) - precoConcorrente).toFixed(3))
          : null;
      const diferencaPercentual =
        sucesso && precoConcorrente !== null && precoConcorrente > 0
          ? Number(((Number(diferencaValor) / precoConcorrente) * 100).toFixed(4))
          : null;

      await client.query(
        `insert into historico_precos
          (mapeamento_id,preco_construjota,preco_concorrente,diferenca_valor,diferenca_percentual,status,mensagem_erro,coletado_em)
         values ($1,$2,$3,$4,$5,$6,$7,now())`,
        [
          item.mapeamento_id,
          item.preco_construjota ?? 0,
          precoConcorrente,
          diferencaValor,
          diferencaPercentual,
          statusItem,
          normalized.mensagemErro,
        ],
      );

      await client.query(
        `update mapeamentos_sku
         set ultimo_preco = case when $4 then ultimo_preco else $1 end,
             ultima_atualizacao = now(), status_coleta = $2
         where id = $3`,
        [precoConcorrente, statusItem, item.mapeamento_id, normalized.preservarUltimoPreco],
      );
    }

    const finishedAt = new Date();
    const status = totalErro === 0 ? "sucesso" : totalSucesso === 0 ? "erro" : "parcial";
    await client.query(
      `update execucoes_robo
       set status = $1, finalizado_em = $2, total_processados = $3, total_sucesso = $4,
           total_erro = $5, mensagem = $6, tempo_execucao_segundos = $7
       where id = $8`,
      [
        status,
        finishedAt.toISOString(),
        resultados.length,
        totalSucesso,
        totalErro,
        mensagem,
        Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
        execucaoId,
      ],
    );

    if (options.agendaId) {
      await client.query(
        `update agenda_coletas
         set ultima_execucao = $1, ultimo_status = $2, ultimo_erro = null
         where id = $3`,
        [finishedAt.toISOString(), status, options.agendaId],
      );
    }

    return { id: execucaoId, status, total_sucesso: totalSucesso, total_erro: totalErro };
  });
}

const construjotaMercosFailureStatuses = new Set([
  "indisponivel",
  "indisponivel_sem_historico",
  "nao_encontrado",
  "ambiguo",
  "erro",
]);

function normalizeConstrujotaMercosMapping(row) {
  return {
    id: row.id,
    produto_id: row.produto_id,
    sku_site: row.sku_site,
    mercos_produto_id: row.mercos_produto_id,
    url_produto: row.url_produto,
    ativo: row.ativo,
    ultimo_preco: row.ultimo_preco == null ? null : Number(row.ultimo_preco),
    ultimo_sucesso_em: row.ultimo_sucesso_em,
    ultima_tentativa_em: row.ultima_tentativa_em,
    ultimo_status: row.ultimo_status,
    ultimo_erro: row.ultimo_erro,
    created_at: row.created_at,
    updated_at: row.updated_at,
    produtos: {
      id: row.produto_id,
      nome: row.produto_nome,
      sku_interno: row.sku_interno,
      familia_id: row.familia_id,
      unidade: row.produto_unidade,
      preco_atual: row.preco_atual == null ? null : Number(row.preco_atual),
      ativo: row.produto_ativo,
    },
  };
}

/**
 * Carrega somente os mapeamentos do portal proprio. Esta consulta nunca passa
 * por concorrentes/mapeamentos_sku, mantendo os dois fluxos independentes.
 */
export async function fetchActiveConstrujotaMercosMappings(clientOrFilters = {}, maybeFilters) {
  const filters = maybeFilters ?? (clientOrFilters?.localPostgres ? {} : (clientOrFilters ?? {}));
  const values = [];
  const clauses = ["m.ativo = true", "p.ativo = true"];

  if (filters.mapeamentoId) {
    values.push(filters.mapeamentoId);
    clauses.push(`m.id = $${values.length}`);
  }
  if (filters.produtoId) {
    values.push(filters.produtoId);
    clauses.push(`m.produto_id = $${values.length}`);
  }
  if (filters.sku || filters.skuSite) {
    values.push(String(filters.sku ?? filters.skuSite).trim());
    clauses.push(`trim(m.sku_site) = $${values.length}`);
  }

  const { rows } = await query(
    `select
       m.*,
       p.nome as produto_nome,
       p.sku_interno,
       p.familia_id,
       p.unidade as produto_unidade,
       p.preco_atual,
       p.ativo as produto_ativo
     from mapeamentos_construjota_mercos m
     join produtos p on p.id = m.produto_id
     where ${clauses.join(" and ")}
     order by m.created_at asc`,
    values,
  );

  return rows.map(normalizeConstrujotaMercosMapping);
}

/**
 * Fonte do modo discovery: inclui produtos ativos que ainda nao possuem URL ou
 * sequer possuem mapeamento Mercos.
 */
export async function fetchActiveProductsForConstrujotaMercosDiscovery(filters = {}) {
  const values = [];
  const clauses = ["p.ativo = true"];

  if (filters.produtoId) {
    values.push(filters.produtoId);
    clauses.push(`p.id = $${values.length}`);
  }
  if (filters.sku) {
    values.push(String(filters.sku).trim());
    clauses.push(`trim(p.sku_interno) = $${values.length}`);
  }

  const { rows } = await query(
    `select
       p.id,
       p.sku_interno,
       p.nome,
       p.familia_id,
       p.unidade,
       p.preco_atual,
       p.ativo,
       case when m.id is null then null else json_build_object(
         'id', m.id,
         'produto_id', m.produto_id,
         'sku_site', m.sku_site,
         'mercos_produto_id', m.mercos_produto_id,
         'url_produto', m.url_produto,
         'ativo', m.ativo,
         'ultimo_preco', m.ultimo_preco,
         'ultimo_sucesso_em', m.ultimo_sucesso_em,
         'ultima_tentativa_em', m.ultima_tentativa_em,
         'ultimo_status', m.ultimo_status,
         'ultimo_erro', m.ultimo_erro
       ) end as mapeamento_construjota_mercos
     from produtos p
     left join mapeamentos_construjota_mercos m on m.produto_id = p.id
     where ${clauses.join(" and ")}
     order by p.sku_interno asc`,
    values,
  );

  return rows.map((row) => ({
    ...row,
    preco_atual: row.preco_atual == null ? null : Number(row.preco_atual),
    mapeamento_construjota_mercos: row.mapeamento_construjota_mercos
      ? {
          ...row.mapeamento_construjota_mercos,
          ultimo_preco:
            row.mapeamento_construjota_mercos.ultimo_preco == null
              ? null
              : Number(row.mapeamento_construjota_mercos.ultimo_preco),
        }
      : null,
  }));
}

export async function upsertConstrujotaMercosMapping(mapping, options = {}) {
  const produtoId = String(mapping?.produtoId ?? mapping?.produto_id ?? "").trim();
  const skuSite = String(mapping?.skuSite ?? mapping?.sku_site ?? "").trim();
  if (!produtoId || !skuSite) {
    throw new Error("produto_id e sku_site sao obrigatorios no mapeamento CONSTRUJOTA_MERCOS");
  }

  const mercosProdutoId = String(
    mapping?.mercosProdutoId ?? mapping?.mercos_produto_id ?? "",
  ).trim();
  const urlProdutoValue = mapping?.urlProduto ?? mapping?.url_produto;
  const urlProduto = urlProdutoValue == null ? null : String(urlProdutoValue).trim();
  const ativo = mapping?.ativo !== false;

  if (options.dryRun) {
    return {
      produto_id: produtoId,
      sku_site: skuSite,
      mercos_produto_id: mercosProdutoId || null,
      url_produto: urlProduto,
      ativo,
      dry_run: true,
    };
  }

  const { rows } = await query(
    `insert into mapeamentos_construjota_mercos
       (produto_id, sku_site, mercos_produto_id, url_produto, ativo)
     values ($1, $2, $3, coalesce($4, ''), $5)
     on conflict (produto_id) do update set
       sku_site = excluded.sku_site,
       mercos_produto_id = coalesce(excluded.mercos_produto_id, mapeamentos_construjota_mercos.mercos_produto_id),
       url_produto = coalesce($4, mapeamentos_construjota_mercos.url_produto),
       ativo = excluded.ativo
     returning *`,
    [produtoId, skuSite, mercosProdutoId || null, urlProduto, ativo],
  );

  return rows[0];
}

export function normalizeConstrujotaMercosResultForPersistence(item) {
  const requestedStatus = String(item?.status ?? "erro")
    .trim()
    .toLowerCase();
  const precoInformado = Number(item?.preco ?? item?.preco_construjota ?? item?.preco_atual);
  const evidenceConfirmed =
    item?.leitura_confirmada === true &&
    item?.produto_confirmado === true &&
    item?.bloco_preco_confirmado === true &&
    item?.elemento_preco_visivel === true &&
    Number(item?.quantidade_precos_principais) === 1 &&
    item?.formato_preco_reconhecido === true &&
    item?.preco_principal_confirmado === true &&
    item?.produto_indisponivel !== true;
  const sucesso =
    requestedStatus === "sucesso" &&
    evidenceConfirmed &&
    Number.isFinite(precoInformado) &&
    precoInformado > 0;
  const status = sucesso
    ? "sucesso"
    : construjotaMercosFailureStatuses.has(requestedStatus)
      ? requestedStatus
      : "erro";
  const defaultMessage =
    status === "indisponivel" || status === "indisponivel_sem_historico"
      ? "CONSTRUJOTA_MERCOS: produto indisponível; último preço confirmado preservado"
      : status === "nao_encontrado"
        ? "CONSTRUJOTA_MERCOS: produto não encontrado; último preço confirmado preservado"
        : status === "ambiguo"
          ? "CONSTRUJOTA_MERCOS: resultado ambíguo; último preço confirmado preservado"
          : sucesso
            ? null
            : "CONSTRUJOTA_MERCOS: validação final do produto ou preço principal falhou";

  return {
    sucesso,
    status,
    preco: sucesso ? precoInformado : null,
    mensagem: item?.mensagem ?? item?.mensagem_erro ?? defaultMessage,
    preservarUltimoPreco: !sucesso,
    mercosProdutoId: sucesso
      ? String(item?.mercos_produto_id ?? item?.mercosProdutoId ?? "").trim() || null
      : null,
    urlProduto: sucesso
      ? String(item?.url_produto ?? item?.urlProduto ?? item?.url_canonica ?? "").trim() || null
      : null,
  };
}

export function summarizeConstrujotaMercosPersistedResults(persistedResults = []) {
  const persisted = Array.isArray(persistedResults) ? persistedResults : [];
  const totalSucesso = persisted.filter((item) => item.status === "sucesso").length;
  const totalIndisponivel = persisted.filter((item) =>
    ["indisponivel", "indisponivel_sem_historico"].includes(item.status),
  ).length;
  const totalErro = persisted.length - totalSucesso - totalIndisponivel;

  // Indisponibilidade e um resultado esperado: a tentativa foi concluida e o
  // ultimo preco confirmado foi preservado. Ela fica visivel no historico e na
  // contagem, mas somente falhas reais acionam status parcial/erro na agenda.
  const status = totalErro === 0 ? "sucesso" : totalErro === persisted.length ? "erro" : "parcial";

  return {
    totalProcessados: persisted.length,
    totalSucesso,
    totalIndisponivel,
    totalErro,
    status,
  };
}

async function persistConstrujotaMercosResult(client, item, executionId, collectedAt) {
  const mapeamentoId = String(item?.mapeamento_id ?? item?.mapeamentoId ?? "").trim();
  if (!mapeamentoId) throw new Error("mapeamento_id CONSTRUJOTA_MERCOS nao informado");

  const mappingResult = await client.query(
    `select m.*, p.preco_atual
     from mapeamentos_construjota_mercos m
     join produtos p on p.id = m.produto_id
     where m.id = $1
     for update of m, p`,
    [mapeamentoId],
  );
  const mapping = mappingResult.rows[0];
  if (!mapping) throw new Error(`Mapeamento CONSTRUJOTA_MERCOS nao encontrado: ${mapeamentoId}`);

  const normalized = normalizeConstrujotaMercosResultForPersistence(item);
  const possuiHistoricoConfirmado =
    mapping.ultimo_preco != null && mapping.ultimo_sucesso_em != null;
  if (normalized.status === "indisponivel" && !possuiHistoricoConfirmado) {
    normalized.status = "indisponivel_sem_historico";
  } else if (normalized.status === "indisponivel_sem_historico" && possuiHistoricoConfirmado) {
    normalized.status = "indisponivel";
  }
  if (normalized.status === "indisponivel_sem_historico") {
    normalized.mensagem =
      item?.mensagem ??
      item?.mensagem_erro ??
      "CONSTRUJOTA_MERCOS: produto indisponível e sem preço confirmado anterior";
  }

  if (normalized.sucesso) {
    await client.query(
      `update produtos
       set preco_atual = $1
       where id = $2`,
      [normalized.preco, mapping.produto_id],
    );
    await client.query(
      `update mapeamentos_construjota_mercos
       set ultimo_preco = $1,
           ultimo_sucesso_em = $2,
           ultima_tentativa_em = $2,
           ultimo_status = 'sucesso',
           ultimo_erro = null,
           mercos_produto_id = coalesce($3, mercos_produto_id),
           url_produto = coalesce($4, url_produto)
       where id = $5`,
      [
        normalized.preco,
        collectedAt,
        normalized.mercosProdutoId,
        normalized.urlProduto,
        mapeamentoId,
      ],
    );
  } else {
    const indisponivel = ["indisponivel", "indisponivel_sem_historico"].includes(normalized.status);
    await client.query(
      `update mapeamentos_construjota_mercos
       set ultima_tentativa_em = $1,
           ultimo_status = $2,
           ultimo_erro = $3
       where id = $4`,
      [
        collectedAt,
        normalized.status,
        indisponivel ? null : String(normalized.mensagem ?? "").slice(0, 1000),
        mapeamentoId,
      ],
    );
  }

  await client.query(
    `insert into historico_precos_construjota_mercos
       (mapeamento_id, execucao_id, preco, status, mensagem, coletado_em)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      mapeamentoId,
      executionId,
      normalized.sucesso ? normalized.preco : null,
      normalized.status,
      normalized.mensagem ? String(normalized.mensagem).slice(0, 1000) : null,
      collectedAt,
    ],
  );

  return {
    mapeamento_id: mapeamentoId,
    produto_id: mapping.produto_id,
    status: normalized.status,
    preco: normalized.preco,
    preco_anterior: mapping.preco_atual == null ? null : Number(mapping.preco_atual),
    ultimo_preco_preservado: !normalized.sucesso,
  };
}

// Exportado para testes de barreira transacional; o fluxo de producao usa apenas
// registerConstrujotaMercosResults, que envolve todas as chamadas em uma transacao.
export const persistConstrujotaMercosResultForTest = persistConstrujotaMercosResult;

export async function createConstrujotaMercosExecution(totalProcessados, options = {}) {
  const startedAt = options.startedAt ? new Date(options.startedAt) : new Date();
  const { rows } = await query(
    `insert into execucoes_construjota_mercos
       (status, origem, iniciado_em, total_processados, mensagem)
     values ('pendente', $1, $2, $3, $4)
     returning id`,
    [
      options.origem ?? "worker",
      startedAt.toISOString(),
      Math.max(0, Number(totalProcessados ?? 0)),
      String(options.mensagem ?? "Coleta ConstruJota Mercos iniciada.").slice(0, 500),
    ],
  );
  return { id: rows[0].id, startedAt };
}

export async function markConstrujotaMercosExecutionFailed(execution, error, options = {}) {
  if (!execution?.id) return;
  const finishedAt = new Date();
  const startedAt = execution.startedAt ? new Date(execution.startedAt) : finishedAt;
  const message = error instanceof Error ? error.message : String(error ?? "Falha na coleta.");

  await transaction(async (client) => {
    await client.query(
      `update execucoes_construjota_mercos
       set status = 'erro', finalizado_em = $1, total_erro = greatest(total_erro, 1),
           mensagem = $2, tempo_execucao_segundos = $3
       where id = $4`,
      [
        finishedAt.toISOString(),
        message.slice(0, 500),
        Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)),
        execution.id,
      ],
    );
    if (options.agendaId || options.scheduled) {
      await client.query(
        `update agenda_construjota_mercos
         set ultima_execucao = $1, ultimo_status = 'erro', ultimo_erro = $2
         where id = 1`,
        [finishedAt.toISOString(), message.slice(0, 500)],
      );
    }
  });
}

export async function registerConstrujotaMercosResults(resultados, mensagem, options = {}) {
  const items = Array.isArray(resultados) ? resultados : [];
  const startedAt = options.startedAt ? new Date(options.startedAt) : new Date();

  if (options.dryRun) {
    const normalized = items.map(normalizeConstrujotaMercosResultForPersistence);
    return {
      dry_run: true,
      status: normalized.every((item) => item.sucesso) ? "sucesso" : "parcial",
      total_processados: normalized.length,
      total_sucesso: normalized.filter((item) => item.sucesso).length,
      resultados: normalized,
    };
  }

  return transaction(async (client) => {
    const executionId =
      options.executionId ??
      (
        await client.query(
          `insert into execucoes_construjota_mercos
             (status, origem, iniciado_em, total_processados, mensagem)
           values ('pendente', $1, $2, $3, $4)
           returning id`,
          [
            options.origem ?? "worker",
            startedAt.toISOString(),
            items.length,
            "Coleta ConstruJota Mercos iniciada.",
          ],
        )
      ).rows[0].id;

    const persisted = [];
    for (const item of items) {
      const collectedDate = item?.coletado_em ? new Date(item.coletado_em) : new Date();
      const collectedAt = Number.isNaN(collectedDate.getTime())
        ? new Date().toISOString()
        : collectedDate.toISOString();
      persisted.push(await persistConstrujotaMercosResult(client, item, executionId, collectedAt));
    }

    const { totalProcessados, totalSucesso, totalIndisponivel, totalErro, status } =
      summarizeConstrujotaMercosPersistedResults(persisted);
    const finishedAt = new Date();
    const finalMessage = String(
      mensagem ??
        `ConstruJota Mercos: ${totalSucesso} sucesso(s), ${totalIndisponivel} indisponível(is), ${totalErro} erro(s).`,
    ).slice(0, 500);

    await client.query(
      `update execucoes_construjota_mercos
       set status = $1, finalizado_em = $2, total_processados = $3,
           total_sucesso = $4, total_indisponivel = $5, total_erro = $6,
           mensagem = $7, tempo_execucao_segundos = $8
       where id = $9`,
      [
        status,
        finishedAt.toISOString(),
        totalProcessados,
        totalSucesso,
        totalIndisponivel,
        totalErro,
        finalMessage,
        Math.max(0, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)),
        executionId,
      ],
    );

    if (options.agendaId || options.scheduled) {
      await client.query(
        `update agenda_construjota_mercos
         set ultima_execucao = $1, ultimo_status = $2, ultimo_erro = $3
         where id = 1`,
        [finishedAt.toISOString(), status, totalErro === 0 ? null : finalMessage],
      );
    }

    return {
      id: executionId,
      status,
      total_processados: totalProcessados,
      total_sucesso: totalSucesso,
      total_indisponivel: totalIndisponivel,
      total_erro: totalErro,
      resultados: persisted,
    };
  });
}

export async function registerConstrujotaMercosResult(item, options = {}) {
  const result = await registerConstrujotaMercosResults([item], options.mensagem, options);
  return { ...result, resultado: result.resultados?.[0] ?? null };
}

export async function getConstrujotaMercosSchedule() {
  const { rows } = await query(`select * from agenda_construjota_mercos where id = 1`);
  return rows[0] ?? null;
}

export async function updateConstrujotaMercosSchedule(config = {}) {
  const ativo = config.ativo == null ? null : config.ativo === true;
  const horario = config.horario == null ? null : String(config.horario).slice(0, 5);
  const intervalo = config.intervaloProdutosMs ?? config.intervalo_produtos_ms ?? null;
  const { rows } = await query(
    `update agenda_construjota_mercos
     set ativo = coalesce($1, ativo),
         horario = case when $2::text is null then horario else $2::time end,
         intervalo_produtos_ms = coalesce($3, intervalo_produtos_ms),
         dias_semana = array[1,2,3,4,5]::smallint[],
         fuso_horario = 'America/Sao_Paulo',
         concorrencia_maxima = 1
     where id = 1
     returning *`,
    [ativo, horario, intervalo == null ? null : Number(intervalo)],
  );
  return rows[0];
}

export async function markConstrujotaMercosScheduleResult(status, error = null, at = new Date()) {
  const normalizedStatus = ["sucesso", "parcial", "erro", "pendente"].includes(status)
    ? status
    : "erro";
  await query(
    `update agenda_construjota_mercos
     set ultima_execucao = $1, ultimo_status = $2, ultimo_erro = $3
     where id = 1`,
    [
      new Date(at).toISOString(),
      normalizedStatus,
      error == null ? null : String(error).slice(0, 500),
    ],
  );
}

export async function fetchConstrujotaMercosReport(filters = {}) {
  const values = [];
  const clauses = [];
  if (filters.status) {
    values.push(String(filters.status));
    clauses.push(`h.status = $${values.length}`);
  }
  if (filters.produtoId) {
    values.push(filters.produtoId);
    clauses.push(`m.produto_id = $${values.length}`);
  }
  if (filters.mapeamentoId) {
    values.push(filters.mapeamentoId);
    clauses.push(`h.mapeamento_id = $${values.length}`);
  }
  if (filters.since) {
    values.push(filters.since);
    clauses.push(`h.coletado_em >= $${values.length}`);
  }
  if (filters.until) {
    values.push(filters.until);
    clauses.push(`h.coletado_em <= $${values.length}`);
  }
  values.push(Math.max(1, Math.min(5000, Number(filters.limit ?? 500))));

  const { rows } = await query(
    `select
       h.*,
       m.produto_id,
       m.sku_site,
       m.mercos_produto_id,
       m.url_produto,
       m.ultimo_preco,
       m.ultimo_sucesso_em,
       m.ultima_tentativa_em,
       p.sku_interno,
       p.nome as produto_nome,
       p.preco_atual
     from historico_precos_construjota_mercos h
     join mapeamentos_construjota_mercos m on m.id = h.mapeamento_id
     join produtos p on p.id = m.produto_id
     ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
     order by h.coletado_em desc
     limit $${values.length}`,
    values,
  );

  return rows.map((row) => ({
    ...row,
    preco: row.preco == null ? null : Number(row.preco),
    ultimo_preco: row.ultimo_preco == null ? null : Number(row.ultimo_preco),
    preco_atual: row.preco_atual == null ? null : Number(row.preco_atual),
  }));
}
