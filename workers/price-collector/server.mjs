import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { loadWorkerEnv } from "./env.mjs";
import {
  isConstrujotaMercosScheduleDue,
  isScheduleDue,
  shouldWaitForConstrujotaMercosBeforeCompetitors,
} from "./schedule.mjs";

loadWorkerEnv();

// Both modules create/use the database pool during initialization.
const [{ ensureRuntimeSchema }, { query }] = await Promise.all([
  import("./database.mjs"),
  import("../../server/db.mjs"),
]);

const port = Number(process.env.WORKER_TRIGGER_PORT ?? 8787);
let running = false;
let checkingSchedule = false;
let runtimeSchemaPromise = null;
let currentRun = null;
const workerDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(workerDir, "../..");
const competitorWorkerEntry = resolve(workerDir, "index.mjs");
const construjotaMercosWorkerEntry = resolve(projectRoot, "workers/construjota-mercos/index.mjs");
const scheduleTimezone = process.env.SCHEDULE_TIMEZONE ?? "America/Sao_Paulo";
const construjotaMercosScheduleTimezone = "America/Sao_Paulo";

function ensureSchemaOnce() {
  runtimeSchemaPromise ??= ensureRuntimeSchema().catch((error) => {
    runtimeSchemaPromise = null;
    throw error;
  });

  return runtimeSchemaPromise;
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "access-control-allow-headers": "content-type, authorization",
  });
  res.end(JSON.stringify(body));
}

function createRunInfo(kind, args, message) {
  return {
    id: `${kind}-${Date.now()}`,
    kind,
    args,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message,
  };
}

function updateRunMessage(runInfo, text) {
  if (!runInfo) return;

  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const message = lines.at(-1);
  if (!message) return;

  runInfo.message = message.slice(0, 500);
  runInfo.updatedAt = new Date().toISOString();
}

function runWorkerWithArgs(workerEntry, extraArgs, runInfo = currentRun) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [workerEntry, ...extraArgs], {
      cwd: projectRoot,
      shell: false,
      env: { ...process.env, WORKER_SCHEDULE_DISPATCH: "1" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      updateRunMessage(runInfo, text);
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      updateRunMessage(runInfo, text);
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      reject(new Error(stderr || stdout || `Worker finalizou com codigo ${code}`));
    });
  });
}

function localParts(date, timeZone = scheduleTimezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
    weekday: weekdayMap[value.weekday] ?? 0,
  };
}

async function fetchDueSchedule() {
  await ensureSchemaOnce();

  const now = new Date();
  const competitorCurrent = localParts(now);
  const construjotaMercosCurrent = localParts(now, construjotaMercosScheduleTimezone);
  const [competitorResult, construjotaMercosResult] = await Promise.all([
    query(
      `
      select
        a.id,
        a.familia_id,
        a.horario,
        a.dias_semana,
        a.ultima_execucao,
        a.concorrencia_maxima,
        f.nome as familia_nome
      from agenda_coletas a
      join familias f on f.id = a.familia_id
      where a.ativo = true and a.horario is not null and f.ativo = true
      order by a.horario asc nulls last, f.nome asc
    `,
    ),
    query(
      `
        select
          id,
          horario,
          dias_semana,
          intervalo_produtos_ms,
          ultima_execucao
        from agenda_construjota_mercos
        where ativo = true and horario is not null
        limit 1
      `,
    ),
  ]);

  const construjotaMercosSchedule = construjotaMercosResult.rows.find((row) => {
    const horario = String(row.horario).slice(0, 5);
    const dias = Array.isArray(row.dias_semana) ? row.dias_semana.map(Number) : [];
    const lastRun = row.ultima_execucao
      ? localParts(new Date(row.ultima_execucao), construjotaMercosScheduleTimezone)
      : null;

    return isConstrujotaMercosScheduleDue(
      { scheduledTime: horario, weekdays: dias, lastRun },
      construjotaMercosCurrent,
    );
  });

  // The own-store price refresh wins when both kinds are due, so competitor
  // snapshots use the newest confirmed ConstruJota base price.
  if (construjotaMercosSchedule) {
    return {
      ...construjotaMercosSchedule,
      scheduleKind: "construjota_mercos",
      label: "ConstruJota Mercos",
    };
  }

  const ownPriceSchedule = construjotaMercosResult.rows[0];
  if (ownPriceSchedule) {
    const ownLastRun = ownPriceSchedule.ultima_execucao
      ? localParts(new Date(ownPriceSchedule.ultima_execucao), construjotaMercosScheduleTimezone)
      : null;
    // If the own-price agenda is active today but its configured time has not arrived,
    // competitor agendas remain due and are dispatched only after this refresh attempt.
    if (
      shouldWaitForConstrujotaMercosBeforeCompetitors(
        { weekdays: ownPriceSchedule.dias_semana, lastRun: ownLastRun },
        construjotaMercosCurrent,
      )
    ) {
      return null;
    }
  }

  const competitorSchedule = competitorResult.rows.find((row) => {
    const horario = String(row.horario).slice(0, 5);
    const dias = Array.isArray(row.dias_semana) ? row.dias_semana.map(Number) : [];
    const lastRun = row.ultima_execucao ? localParts(new Date(row.ultima_execucao)) : null;

    return isScheduleDue({ scheduledTime: horario, weekdays: dias, lastRun }, competitorCurrent);
  });

  return competitorSchedule
    ? {
        ...competitorSchedule,
        scheduleKind: "concorrente",
        label: competitorSchedule.familia_nome,
      }
    : null;
}

async function markScheduleResult(schedule, status, error = "") {
  await ensureSchemaOnce();

  if (schedule.scheduleKind === "construjota_mercos") {
    await query(
      `update agenda_construjota_mercos
       set ultima_execucao = now(), ultimo_status = $1, ultimo_erro = $2
       where id = $3`,
      [status, error ? String(error).slice(0, 500) : null, schedule.id],
    );
    return;
  }

  await query(
    `update agenda_coletas
     set ultima_execucao = now(), ultimo_status = $1, ultimo_erro = $2
     where id = $3`,
    [status, error ? String(error).slice(0, 500) : null, schedule.id],
  );
}

async function markScheduleStarted(schedule) {
  await markScheduleResult(schedule, "pendente");
}

async function runDueSchedule() {
  if (running || checkingSchedule) return;

  let schedule;
  checkingSchedule = true;
  try {
    schedule = await fetchDueSchedule();
  } finally {
    checkingSchedule = false;
  }
  if (!schedule || running) return;

  running = true;
  const isConstrujotaMercos = schedule.scheduleKind === "construjota_mercos";
  const workerEntry = isConstrujotaMercos ? construjotaMercosWorkerEntry : competitorWorkerEntry;
  const args = isConstrujotaMercos
    ? ["--scheduled", `--agenda-id=${schedule.id}`]
    : [
        `--familia-id=${schedule.familia_id}`,
        `--agenda-id=${schedule.id}`,
        `--concurrency=${Math.max(1, Math.min(4, Number(schedule.concorrencia_maxima || 1)))}`,
        "--scheduled",
      ];
  currentRun = createRunInfo(
    isConstrujotaMercos ? "construjota_mercos_agendado" : "agendado",
    args,
    `Coleta agendada iniciada: ${schedule.label}.`,
  );

  console.log(
    `Coleta agendada iniciada: ${schedule.label} (${String(schedule.horario).slice(0, 5)}).`,
  );

  try {
    await markScheduleStarted(schedule);
    const result = await runWorkerWithArgs(workerEntry, args, currentRun);
    if (
      schedule.scheduleKind === "concorrente" &&
      /Nenhum mapeamento ativo encontrado/i.test(result.stdout)
    ) {
      await markScheduleResult(schedule, "sucesso");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na coleta agendada.";
    await markScheduleResult(schedule, "erro", message);
    console.error(message);
  } finally {
    running = false;
    currentRun = null;
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      running,
      currentRun,
      scheduleTimezone,
      construjotaMercosScheduleTimezone,
      local: localParts(new Date()),
      construjotaMercosLocal: localParts(new Date(), construjotaMercosScheduleTimezone),
    });
    return;
  }

  if (req.url === "/run") {
    sendJson(res, 403, {
      error: "Coleta manual desativada. Configure a execucao na Agenda de Coleta.",
    });
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Worker trigger ouvindo em http://0.0.0.0:${port}`);
  console.log(`Agenda de coleta ativa no fuso ${scheduleTimezone}.`);
  console.log(`Agenda ConstruJota Mercos ativa no fuso ${construjotaMercosScheduleTimezone}.`);
  console.log(`Horario local da agenda: ${JSON.stringify(localParts(new Date()))}.`);
  setInterval(() => {
    runDueSchedule().catch((error) => {
      console.error(error instanceof Error ? error.message : error);
    });
  }, 60000);
  runDueSchedule().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
  });
});
