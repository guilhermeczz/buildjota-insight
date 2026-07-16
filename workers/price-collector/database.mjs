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
  if (filters.produtoId) {
    values.push(filters.produtoId);
    clauses.push(`m.produto_id = $${values.length}`);
  }
  if (filters.familiaId) {
    values.push(filters.familiaId);
    clauses.push(`p.familia_id = $${values.length}`);
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
      const precoInformado = Number(item.preco_concorrente);
      const sucesso =
        item.status === "sucesso" && Number.isFinite(precoInformado) && precoInformado > 0;
      const statusItem = sucesso ? "sucesso" : "erro";
      if (sucesso) totalSucesso += 1;
      if (!sucesso) totalErro += 1;

      const precoConcorrente = sucesso ? precoInformado : null;
      const diferencaValor =
        sucesso && precoConcorrente !== null
          ? Number((Number(item.preco_construjota) - Number(item.preco_concorrente)).toFixed(3))
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
          item.mensagem_erro ?? (sucesso ? null : "Preco valido nao encontrado"),
        ],
      );

      await client.query(
        `update mapeamentos_sku
         set ultimo_preco = $1, ultima_atualizacao = now(), status_coleta = $2
         where id = $3`,
        [precoConcorrente, statusItem, item.mapeamento_id],
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
