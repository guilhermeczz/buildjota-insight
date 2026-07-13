import { loadWorkerEnv } from "./env.mjs";
import { collectPricesByBrowser } from "./browser.mjs";
import { createDatabaseClient, fetchActiveMappings, registerResults } from "./supabase.mjs";

loadWorkerEnv();

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const headed = args.has("--headed");
const failedOnly = args.has("--failed-only");
const scheduled = args.has("--scheduled");
const produtoId = argValue("--produto-id");
const familiaId = argValue("--familia-id");
const mapeamentoId = argValue("--mapeamento-id");
const agendaId = argValue("--agenda-id");
const concurrency = Math.max(1, Math.min(4, Number(argValue("--concurrency") || 1)));

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

async function main() {
  const startedAt = new Date();
  const database = createDatabaseClient();
  const mapeamentos = await fetchActiveMappings(database, {
    produtoId,
    familiaId,
    mapeamentoId,
    failedOnly,
  });

  if (mapeamentos.length === 0) {
    console.log("Nenhum mapeamento ativo encontrado.");
    return;
  }

  const groups = groupByConcorrente(mapeamentos);

  console.log(
    `Iniciando coleta: ${mapeamentos.length} mapeamento(s), ${groups.length} concorrente(s).`,
  );

  const resultados = await collectPricesByBrowser(groups, { headed, concurrency });
  const summary = summarize(resultados);
  const durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

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
    `Worker finalizado: ${summary.totalSucesso} sucesso(s), ${summary.totalErro} erro(s).${
      mapeamentoId
        ? " Filtro: mapeamento."
        : produtoId
          ? " Filtro: produto."
          : familiaId
            ? " Filtro: familia."
            : failedOnly
              ? " Filtro: erros."
              : ""
    }`,
    { origem: scheduled ? "agendado" : "worker", agendaId },
  );

  console.log(`Execucao registrada: ${response.id} (${response.status}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
