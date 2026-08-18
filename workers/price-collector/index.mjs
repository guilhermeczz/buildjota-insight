import { loadWorkerEnv } from "./env.mjs";
import { assertExecutionAllowed, shouldPrepareRuntimeSchema } from "./execution-policy.mjs";

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
const produtoId = argValue("--produto-id");
const familiaId = argValue("--familia-id");
const mapeamentoId = argValue("--mapeamento-id");
const skuConcorrente = argValue("--sku-concorrente");
const concorrente = argValue("--concorrente");
const agendaId = argValue("--agenda-id");
const failedSince = argValue("--failed-since");
const failedUntil = argValue("--failed-until");
const cofemaFixture = argValue("--cofema-fixture");
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
  if (skuConcorrente) return ` Filtro: SKU concorrente ${skuConcorrente}.`;
  if (produtoId) return " Filtro: produto.";
  if (familiaId) return " Filtro: familia.";
  if (concorrente) return ` Filtro: concorrente ${concorrente}.`;
  if (failedOnly) return " Filtro: erros.";
  return "";
}

async function main() {
  assertExecutionAllowed({
    scheduled,
    dispatchedByScheduler: process.env.WORKER_SCHEDULE_DISPATCH === "1",
    agendaId,
    familiaId,
    dryRun,
  });

  if (cofemaFixture) {
    await runCofemaFixture(cofemaFixture);
    return;
  }

  const startedAt = new Date();
  const origem = "agendado";
  const database = createDatabaseClient();
  if (shouldPrepareRuntimeSchema({ dryRun })) await ensureRuntimeSchema();
  const execution = dryRun
    ? null
    : await createExecution(0, {
        origem,
        mensagem: "Preparando coleta agendada...",
      });

  try {
    const mapeamentos = await fetchActiveMappings(database, {
      produtoId,
      familiaId,
      mapeamentoId,
      skuConcorrente,
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

async function runCofemaFixture(mode) {
  const fixtureUrls = {
    direct:
      "https://novo.cofema.com.br/page/produto/410409-otto-baumgart-bianco-900g-sache-122854-substituto-para-o-codigo-408287",
    localized:
      "https://novo.cofema.com.br/br/page/produto/410409-otto-baumgart-bianco-900g-sache-122854-substituto-para-o-codigo-408287",
    legacy: "https://www.cofema.com.br/produto/410409-otto-baumgart-bianco-900g-sache-122854",
    missing: "",
  };
  if (!Object.hasOwn(fixtureUrls, mode)) {
    throw new Error(
      `Fixture COFEMA desconhecido: ${mode}. Use direct, localized, legacy ou missing.`,
    );
  }

  const mapping = {
    id: mapeamentoId || `cofema-fixture-${mode}`,
    sku_concorrente: "410409",
    url_produto: fixtureUrls[mode],
    unidade_equivalente: "900G",
    seletor_preco: null,
    produtos: {
      sku_interno: "COFEMA-FIXTURE-410409",
      nome: "OTTO BAUMGART BIANCO 900G SACHE 122854",
      preco_atual: 32.33,
    },
  };
  const concorrenteFixture = {
    id: "cofema-fixture",
    nome: "COFEMA",
    site_url: "https://novo.cofema.com.br",
    login_url: "https://novo.cofema.com.br/",
    tipo_consulta: "SKU",
  };
  const resultados = await collectPricesByBrowser(
    [{ concorrente: concorrenteFixture, mapeamentos: [mapping] }],
    { headed, concurrency: 1 },
  );
  console.log(JSON.stringify(resultados, null, 2));
  console.log("Fixture COFEMA: nenhum dado foi gravado no banco.");

  const result = resultados[0];
  if (result?.status !== "sucesso" || Number(result.preco_concorrente) !== 32.33) {
    throw new Error(
      `Fixture COFEMA ${mode} falhou: ${result?.mensagem_erro ?? "resultado inesperado"}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
