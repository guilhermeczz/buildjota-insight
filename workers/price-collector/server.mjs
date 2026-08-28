import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { loadWorkerEnv } from "./env.mjs";
import {
  earliestScheduleOccurrence,
  isConstrujotaMercosScheduleDue,
  isScheduleDue,
  scheduleLocalParts,
} from "./schedule.mjs";

loadWorkerEnv();

// Both modules create/use the database pool during initialization.
const [{ ensureRuntimeSchema }, { pool, query }] = await Promise.all([
  import("./database.mjs"),
  import("../../server/db.mjs"),
]);

const port = Number(process.env.WORKER_TRIGGER_PORT ?? 8787);
let running = false;
let checkingSchedule = false;
let runtimeSchemaPromise = null;
let currentRun = null;
let scheduleTimer = null;
let nextScheduleCheckAt = null;
let scheduleRefreshQueued = false;
let scheduleNotificationClient = null;
let scheduleNotificationReconnectTimer = null;
let scheduleNotificationsConnected = false;
const workerDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(workerDir, "../..");
const competitorWorkerEntry = resolve(workerDir, "index.mjs");
const construjotaMercosWorkerEntry = resolve(projectRoot, "workers/construjota-mercos/index.mjs");
const scheduleTimezone = process.env.SCHEDULE_TIMEZONE ?? "America/Sao_Paulo";
const construjotaMercosScheduleTimezone = "America/Sao_Paulo";
const scheduleNotificationChannel = "radar_agenda_changed";
let lastScheduleCheck = null;

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
  return scheduleLocalParts(date, timeZone);
}

async function fetchSchedulePlan() {
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

  const nextWakeAt = earliestScheduleOccurrence(
    [
      ...competitorResult.rows.map((row) => ({
        scheduledTime: String(row.horario).slice(0, 5),
        weekdays: row.dias_semana,
        timeZone: scheduleTimezone,
      })),
      ...construjotaMercosResult.rows.map((row) => ({
        scheduledTime: String(row.horario).slice(0, 5),
        weekdays: row.dias_semana,
        timeZone: construjotaMercosScheduleTimezone,
      })),
    ],
    now,
  );

  // The own-store price refresh wins when both kinds are due, so competitor
  // snapshots use the newest confirmed ConstruJota base price.
  if (construjotaMercosSchedule) {
    return {
      schedule: {
        ...construjotaMercosSchedule,
        scheduleKind: "construjota_mercos",
        label: "ConstruJota Mercos",
      },
      nextWakeAt,
    };
  }

  const competitorSchedule = competitorResult.rows.find((row) => {
    const horario = String(row.horario).slice(0, 5);
    const dias = Array.isArray(row.dias_semana) ? row.dias_semana.map(Number) : [];
    const lastRun = row.ultima_execucao ? localParts(new Date(row.ultima_execucao)) : null;

    return isScheduleDue({ scheduledTime: horario, weekdays: dias, lastRun }, competitorCurrent);
  });

  return {
    schedule: competitorSchedule
      ? {
          ...competitorSchedule,
          scheduleKind: "concorrente",
          label: competitorSchedule.familia_nome,
        }
      : null,
    nextWakeAt,
  };
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

function clearScheduleTimer() {
  if (scheduleTimer) clearTimeout(scheduleTimer);
  scheduleTimer = null;
  nextScheduleCheckAt = null;
}

function armScheduleTimer(nextWakeAt) {
  clearScheduleTimer();
  if (!(nextWakeAt instanceof Date) || Number.isNaN(nextWakeAt.getTime())) return;

  // A pequena margem evita acordar alguns milissegundos antes do minuto salvo.
  const delayMs = Math.max(0, nextWakeAt.getTime() - Date.now() + 250);
  nextScheduleCheckAt = nextWakeAt.toISOString();
  scheduleTimer = setTimeout(
    () => {
      scheduleTimer = null;
      nextScheduleCheckAt = null;
      requestScheduleRefresh("timer");
    },
    Math.min(delayMs, 2_147_000_000),
  );
}

function reportSchedulerError(error) {
  console.error(error instanceof Error ? error.message : error);
}

function requestScheduleRefresh(reason = "notificacao") {
  clearScheduleTimer();
  scheduleRefreshQueued = true;
  if (running || checkingSchedule) return;

  queueMicrotask(() => {
    if (!scheduleRefreshQueued || running || checkingSchedule) return;
    runDueSchedule(reason).catch(reportSchedulerError);
  });
}

async function runDueSchedule(reason = "timer") {
  if (running || checkingSchedule) {
    scheduleRefreshQueued = true;
    return;
  }

  scheduleRefreshQueued = false;
  let plan;
  checkingSchedule = true;
  try {
    plan = await fetchSchedulePlan();
    lastScheduleCheck = {
      checkedAt: new Date().toISOString(),
      local: localParts(new Date()),
      reason,
      status: plan.schedule ? "pronta" : "aguardando_horario",
      scheduleKind: plan.schedule?.scheduleKind ?? null,
      scheduledTime: plan.schedule?.horario ? String(plan.schedule.horario).slice(0, 5) : null,
      nextScheduleCheckAt: plan.nextWakeAt?.toISOString() ?? null,
      error: null,
    };
  } catch (error) {
    lastScheduleCheck = {
      checkedAt: new Date().toISOString(),
      local: localParts(new Date()),
      reason,
      status: "erro",
      scheduleKind: null,
      scheduledTime: null,
      nextScheduleCheckAt: null,
      error: error instanceof Error ? error.message.slice(0, 500) : "Falha ao consultar agenda.",
    };
    // Recuperacao excepcional de conexao: nao e polling normal e so e usada
    // quando a consulta ao banco falha.
    armScheduleTimer(new Date(Date.now() + 60_000));
    throw error;
  } finally {
    checkingSchedule = false;
  }

  if (scheduleRefreshQueued) {
    requestScheduleRefresh("notificacao_durante_consulta");
    return;
  }

  const schedule = plan.schedule;
  if (!schedule) {
    armScheduleTimer(plan.nextWakeAt);
    return;
  }

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
    requestScheduleRefresh("apos_execucao");
  }
}

function scheduleNotificationReconnect(error) {
  scheduleNotificationsConnected = false;
  if (error) reportSchedulerError(error);
  if (scheduleNotificationReconnectTimer) return;
  scheduleNotificationReconnectTimer = setTimeout(() => {
    scheduleNotificationReconnectTimer = null;
    connectScheduleNotifications().catch(() => {});
  }, 5_000);
}

async function connectScheduleNotifications() {
  if (scheduleNotificationClient) return;
  await ensureSchemaOnce();

  let client;
  try {
    client = await pool.connect();
    scheduleNotificationClient = client;
    client.on("notification", (message) => {
      if (message.channel !== scheduleNotificationChannel) return;
      requestScheduleRefresh("postgres_notify");
    });
    client.on("error", (error) => {
      if (scheduleNotificationClient !== client) return;
      scheduleNotificationClient = null;
      try {
        client.release(true);
      } catch {
        // A conexao ja pode ter sido removida pelo pool.
      }
      scheduleNotificationReconnect(error);
    });
    await client.query(`listen ${scheduleNotificationChannel}`);
    scheduleNotificationsConnected = true;
    console.log(`Agenda aguardando notificacoes PostgreSQL em ${scheduleNotificationChannel}.`);
    requestScheduleRefresh("listener_conectado");
  } catch (error) {
    if (scheduleNotificationClient === client) scheduleNotificationClient = null;
    if (client) {
      try {
        client.release(true);
      } catch {
        // Ignora liberacao duplicada durante reconexao.
      }
    }
    scheduleNotificationReconnect(error);
    throw error;
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
      schedulerMode: "postgres_notify_timer",
      scheduleNotificationChannel,
      scheduleNotificationsConnected,
      checkingSchedule,
      nextScheduleCheckAt,
      lastScheduleCheck,
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
  requestScheduleRefresh("startup");
  connectScheduleNotifications().catch(() => {});
});
