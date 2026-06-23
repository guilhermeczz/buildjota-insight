import { loadWorkerEnv } from "./env.mjs";
import { collectPricesByBrowser } from "./browser.mjs";
import { createSupabaseAdmin, fetchActiveMappings, registerResults } from "./supabase.mjs";

loadWorkerEnv();

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const headed = args.has("--headed");

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
  const supabase = createSupabaseAdmin();
  const mapeamentos = await fetchActiveMappings(supabase);

  if (mapeamentos.length === 0) {
    console.log("Nenhum mapeamento ativo encontrado.");
    return;
  }

  const groups = groupByConcorrente(mapeamentos);

  console.log(
    `Iniciando coleta: ${mapeamentos.length} mapeamento(s), ${groups.length} concorrente(s).`,
  );

  const resultados = await collectPricesByBrowser(groups, { headed });
  const summary = summarize(resultados);
  const durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

  console.log(
    `Coleta finalizada em ${durationSeconds}s: ${summary.totalSucesso} sucesso(s), ${summary.totalErro} erro(s).`,
  );

  if (dryRun) {
    console.log(JSON.stringify(resultados, null, 2));
    console.log("Dry run: nenhum dado foi gravado no Supabase.");
    return;
  }

  const response = await registerResults(
    resultados,
    `Worker finalizado: ${summary.totalSucesso} sucesso(s), ${summary.totalErro} erro(s).`,
  );

  console.log(`Execucao registrada: ${response.id} (${response.status}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
