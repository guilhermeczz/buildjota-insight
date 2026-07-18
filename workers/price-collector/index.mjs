import { loadWorkerEnv } from "./env.mjs";

loadWorkerEnv();

// These modules initialize runtime settings and the database pool on import.
// Load them only after all worker environment files have been applied.
const [{ collectPricesByBrowser }, databaseModule] = await Promise.all([
  import("./browser.mjs"),
  import("./database.mjs"),
]);
const {
  createDatabaseClient,
  createExecution,
  ensureRuntimeSchema,
  fetchActiveMappings,
  markExecutionFailed,
  registerResults,
  updateExecutionPlan,
  updateExecutionProgress,
} = databaseModule;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const headed = args.has("--headed");
const failedOnly = args.has("--failed-only");
const scheduled = args.has("--scheduled");
const originArg = argValue("--origin");
const produtoId = argValue("--produto-id");
const familiaId = argValue("--familia-id");
const mapeamentoId = argValue("--mapeamento-id");
const concorrente = argValue("--concorrente");
const agendaId = argValue("--agenda-id");
const failedSince = argValue("--failed-since");
const failedUntil = argValue("--failed-until");
const concurrency = Math.max(
  1,
  Math.min(4, Number(argValue("--concurrency") || process.env.WORKER_CONCURRENCY || 2)),
);

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

function groupByConcorrente(mapeamentos) {
  const groups = new Map();

  for (const mapeamento of mapeamentos) {
    const concorrente = mapeamento.concorrentes;
    if (!groups.has(concorrente.id)) {
      groups.set(concorrente.id, {
        concorrente,
        mapeamentos: [],
      });
    }

    groups.get(concorrente.id).mapeamentos.push(mapeamento);
  }

  return [...groups.values()];
}

function summarize(resultados) {
  const totalSucesso = resultados.filter((item) => item.status === "sucesso").length;
  const totalErro = resultados.filter((item) => item.status === "erro").length;

  return {
    total: resultados.length,
    totalSucesso,
    totalErro,
  };
}

function filterLabel() {
  if (mapeamentoId) return " Filtro: mapeamento.";
  if (produtoId) return " Filtro: produto.";
  if (familiaId) return " Filtro: familia.";
  if (concorrente) return ` Filtro: concorrente ${concorrente}.`;
  if (failedOnly) return " Filtro: erros.";
  return "";
}

async function main() {
  const startedAt = new Date();
  const origem = scheduled ? "agendado" : originArg || "worker";
  const database = createDatabaseClient();
  await ensureRuntimeSchema();
  const execution = dryRun
    ? null
    : await createExecution(0, {
        origem,
        mensagem: failedOnly
          ? "Preparando reprocessamento dos erros..."
          : "Preparando coleta manual...",
      });

  try {
    const mapeamentos = await fetchActiveMappings(database, {
      produtoId,
      familiaId,
      mapeamentoId,
      concorrente,
      failedOnly,
      failedSince,
      failedUntil,
    });
    await updateExecutionPlan(
      execution?.id,
      mapeamentos.length,
      `Coleta iniciada: ${mapeamentos.length} mapeamento(s).${filterLabel()}`,
    );

    if (mapeamentos.length === 0) {
      console.log("Nenhum mapeamento ativo encontrado.");
      if (!dryRun) {
        const response = await registerResults(
          [],
          `Nenhum mapeamento ativo encontrado.${filterLabel()}`,
          {
            origem,
            agendaId,
            executionId: execution?.id,
            startedAt: execution?.startedAt,
          },
        );
        console.log(`Execucao registrada: ${response.id} (${response.status}).`);
      }
      return;
    }

    const groups = groupByConcorrente(mapeamentos);
    let lastProgressAt = 0;
    const reportProgress = async (message) => {
      if (!execution) return;
      const now = Date.now();
      if (now - lastProgressAt < 5000) return;
      lastProgressAt = now;
      await updateExecutionProgress(execution.id, message);
    };

    console.log(
      `Iniciando coleta: ${mapeamentos.length} mapeamento(s), ${groups.length} concorrente(s).`,
    );

    const resultados = await collectPricesByBrowser(groups, {
      headed,
      concurrency,
      onProgress: reportProgress,
    });

    const summary = summarize(resultados);
    const durationStart = execution?.startedAt ?? startedAt;
    const durationSeconds = Math.round((Date.now() - durationStart.getTime()) / 1000);

    console.log(
      `Coleta finalizada em ${durationSeconds}s: ${summary.totalSucesso} sucesso(s), ${summary.totalErro} erro(s).`,
    );

    if (dryRun) {
      console.log(JSON.stringify(resultados, null, 2));
      console.log("Dry run: nenhum dado foi gravado no banco.");
      return;
    }

    const response = await registerResults(
      resultados,
      `Worker finalizado: ${summary.totalSucesso} sucesso(s), ${summary.totalErro} erro(s).${filterLabel()}`,
      {
        origem,
        agendaId,
        executionId: execution?.id,
        startedAt: execution?.startedAt,
      },
    );

    console.log(`Execucao registrada: ${response.id} (${response.status}).`);
  } catch (error) {
    if (execution) {
      await markExecutionFailed(execution, error);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
