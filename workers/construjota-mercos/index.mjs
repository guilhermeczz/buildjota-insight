import { loadWorkerEnv } from "../price-collector/env.mjs";
import {
  isConstrujotaMercosBusinessDay,
  parseSimulationDate,
  saoPauloDateParts,
} from "./schedule.mjs";

loadWorkerEnv();

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const headed = args.has("--headed");
const scheduled = args.has("--scheduled");
const produtoId = argValue("--produto-id");
const mapeamentoId = argValue("--mapeamento-id");
const sku = argValue("--sku");
const fixtureUrl = argValue("--url");
const agendaId = argValue("--agenda-id");
const simulatedDate = parseSimulationDate(argValue("--simulate-date"));

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

function assertExecutionAllowed() {
  if (fixtureUrl && !dryRun) {
    throw new Error("--url e permitido somente com --dry-run");
  }
  if (simulatedDate && !dryRun) {
    throw new Error("--simulate-date e permitido somente com --dry-run");
  }
  if (!dryRun && (!scheduled || process.env.WORKER_SCHEDULE_DISPATCH !== "1" || !agendaId)) {
    throw new Error(
      "Gravacao CONSTRUJOTA_MERCOS permitida somente pela agenda; use --dry-run para validar",
    );
  }
}

function summarize(results) {
  return {
    total: results.length,
    sucesso: results.filter((item) => item.status === "sucesso").length,
    indisponivel: results.filter((item) =>
      ["indisponivel", "indisponivel_sem_historico"].includes(item.status),
    ).length,
    erro: results.filter(
      (item) =>
        item.status !== "sucesso" &&
        !["indisponivel", "indisponivel_sem_historico"].includes(item.status),
    ).length,
  };
}

async function main() {
  assertExecutionAllowed();
  const effectiveDate = simulatedDate ?? new Date();
  const localDate = saoPauloDateParts(effectiveDate);
  if (!isConstrujotaMercosBusinessDay(effectiveDate)) {
    console.log(
      `[CONSTRUJOTA_MERCOS] ${localDate.date} nao e dia util em America/Sao_Paulo; coleta nao executada.`,
    );
    return;
  }

  const database = await import("../price-collector/database.mjs");
  const { collectConstrujotaMercosMappings } = await import("./browser.mjs");
  const startedAt = new Date();
  let execution = null;

  try {
    if (!dryRun) await database.ensureRuntimeSchema();
    let mappings;
    if (fixtureUrl) {
      if (!sku) throw new Error("Informe --sku junto com --url");
      mappings = [
        {
          id: `dry-run-${sku}`,
          produto_id: null,
          sku_site: sku,
          url_produto: fixtureUrl,
          ultimo_preco: null,
          produtos: { id: null, sku_interno: sku, preco_atual: null, ativo: true },
        },
      ];
    } else {
      mappings = await database.fetchActiveConstrujotaMercosMappings({
        produtoId,
        mapeamentoId,
        sku,
      });
    }

    if (!dryRun) {
      execution = await database.createConstrujotaMercosExecution(mappings.length, {
        origem: scheduled ? "agendado" : "worker",
        startedAt,
        mensagem: `ConstruJota Mercos: preparando ${mappings.length} produto(s).`,
      });
    }

    if (mappings.length === 0) {
      console.log("[CONSTRUJOTA_MERCOS] Nenhum produto ativo com mapeamento encontrado.");
      if (!dryRun) {
        await database.registerConstrujotaMercosResults(
          [],
          "ConstruJota Mercos: nenhum produto ativo com mapeamento encontrado.",
          {
            executionId: execution?.id,
            startedAt: execution?.startedAt,
            origem: "agendado",
            agendaId,
            scheduled,
          },
        );
      }
      return;
    }

    const schedule = fixtureUrl ? null : await database.getConstrujotaMercosSchedule();
    const productIntervalMs = Number(
      schedule?.intervalo_produtos_ms ??
        process.env.CONSTRUJOTA_MERCOS_PRODUCT_INTERVAL_MS ??
        4_000,
    );
    console.log(
      `[CONSTRUJOTA_MERCOS] Iniciando ${mappings.length} produto(s), concorrencia 1, fuso America/Sao_Paulo.`,
    );
    const results = await collectConstrujotaMercosMappings(mappings, {
      headed,
      productIntervalMs,
    });
    const summary = summarize(results);
    const message = `ConstruJota Mercos: ${summary.sucesso} sucesso(s), ${summary.indisponivel} indisponivel(is), ${summary.erro} erro(s).`;
    console.log(`[CONSTRUJOTA_MERCOS] ${message}`);

    if (dryRun) {
      console.log(JSON.stringify(results, null, 2));
      console.log("Dry run: nenhum dado foi gravado no banco.");
      return;
    }

    const persisted = await database.registerConstrujotaMercosResults(results, message, {
      executionId: execution?.id,
      startedAt: execution?.startedAt,
      origem: "agendado",
      agendaId,
      scheduled,
    });
    console.log(`[CONSTRUJOTA_MERCOS] Execucao registrada: ${persisted.id} (${persisted.status}).`);
  } catch (error) {
    if (execution) {
      await database
        .markConstrujotaMercosExecutionFailed(execution, error, { agendaId, scheduled })
        .catch(() => {});
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
