import { query, transaction } from "../../server/db.mjs";
import { allowedConcorrenteNames } from "./config.mjs";

export function createDatabaseClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL nao configurada");
  }
  return { localPostgres: true };
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
      ativo: row.concorrente_ativo,
    },
  };
}

export async function fetchActiveMappings(_client, filters = {}) {
  const values = [];
  const clauses = ["m.ativo = true", "p.ativo = true", "c.ativo = true"];
  values.push(allowedConcorrenteNames);
  clauses.push(`upper(trim(c.nome)) = any($${values.length}::text[])`);

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
