import { loadWorkerEnv } from "./env.mjs";
import { collectPricesByBrowser } from "./browser.mjs";
import {
  createDatabaseClient,
  createExecution,
  ensureRuntimeSchema,
  fetchActiveMappings,
  markExecutionFailed,
  registerResults,
  updateExecutionProgress,
} from "./database.mjs";

loadWorkerEnv();

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const headed = args.has("--headed");
const failedOnly = args.has("--failed-only");
const scheduled = args.has("--scheduled");
const originArg = argValue("--origin");
const produtoId = argValue("--produto-id");
const familiaId = argValue("--familia-id");
const mapeamentoId = argValue("--mapeamento-id");
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
  if (failedOnly) return " Filtro: erros.";
  return "";
}

async function main() {
  const startedAt = new Date();
  const origem = scheduled ? "agendado" : originArg || "worker";
  const database = createDatabaseClient();
  await ensureRuntimeSchema();
  const mapeamentos = await fetchActiveMappings(database, {
    produtoId,
    familiaId,
    mapeamentoId,
    failedOnly,
    failedSince,
    failedUntil,
  });

  if (mapeamentos.length === 0) {
    console.log("Nenhum mapeamento ativo encontrado.");
    if (!dryRun) {
      const response = await registerResults(
        [],
        `Nenhum mapeamento ativo encontrado.${filterLabel()}`,
        { origem, agendaId },
      );
      console.log(`Execucao registrada: ${response.id} (${response.status}).`);
    }
    return;
  }

  const groups = groupByConcorrente(mapeamentos);
  const execution = dryRun
    ? null
    : await createExecution(mapeamentos.length, {
        origem,
        mensagem: `Coleta iniciada: ${mapeamentos.length} mapeamento(s).${filterLabel()}`,
      });
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

  let resultados;
  try {
    resultados = await collectPricesByBrowser(groups, {
      headed,
      concurrency,
      onProgress: reportProgress,
    });
  } catch (error) {
    if (execution) {
      await markExecutionFailed(execution, error);
    }
    throw error;
  }

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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
