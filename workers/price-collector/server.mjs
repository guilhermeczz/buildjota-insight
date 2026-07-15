import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { loadWorkerEnv } from "./env.mjs";
import { ensureRuntimeSchema } from "./database.mjs";
import { query } from "../../server/db.mjs";

loadWorkerEnv();

const port = Number(process.env.WORKER_TRIGGER_PORT ?? 8787);
let running = false;
let runtimeSchemaPromise = null;
const workerDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(workerDir, "../..");
const workerEntry = resolve(workerDir, "index.mjs");
const scheduleTimezone = process.env.SCHEDULE_TIMEZONE ?? "America/Sao_Paulo";

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

function runWorkerWithArgs(extraArgs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [workerEntry, ...extraArgs], {
      cwd: projectRoot,
      shell: false,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
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

function localParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: scheduleTimezone,
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

function hasRunForScheduledTime(row, current, horario) {
  if (!row.ultima_execucao) return false;

  const lastRun = localParts(new Date(row.ultima_execucao));
  if (lastRun.date !== current.date) return false;

  return lastRun.time >= horario;
}

async function fetchDueSchedule() {
  await ensureSchemaOnce();

  const now = new Date();
  const current = localParts(now);
  const { rows } = await query(
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
  );

  return rows.find((row) => {
    const horario = String(row.horario).slice(0, 5);
    const dias = Array.isArray(row.dias_semana) ? row.dias_semana.map(Number) : [];
    if (!dias.includes(current.weekday)) return false;
    if (horario > current.time) return false;
    return !hasRunForScheduledTime(row, current, horario);
  });
}

async function markScheduleResult(agendaId, status, error = "") {
  await ensureSchemaOnce();

  await query(
    `update agenda_coletas
     set ultima_execucao = now(), ultimo_status = $1, ultimo_erro = $2
     where id = $3`,
    [status, error ? String(error).slice(0, 500) : null, agendaId],
  );
}

async function markScheduleStarted(agendaId) {
  await markScheduleResult(agendaId, "pendente");
}

async function runDueSchedule() {
  if (running) return;

  const schedule = await fetchDueSchedule();
  if (!schedule) return;

  running = true;
  const args = [
    `--familia-id=${schedule.familia_id}`,
    `--agenda-id=${schedule.id}`,
    `--concurrency=${Math.max(1, Math.min(4, Number(schedule.concorrencia_maxima || 1)))}`,
    "--scheduled",
  ];

  console.log(
    `Coleta agendada iniciada: ${schedule.familia_nome} (${String(schedule.horario).slice(0, 5)}).`,
  );

  try {
    await markScheduleStarted(schedule.id);
    const result = await runWorkerWithArgs(args);
    if (/Nenhum mapeamento ativo encontrado/i.test(result.stdout)) {
      await markScheduleResult(schedule.id, "sucesso");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na coleta agendada.";
    await markScheduleResult(schedule.id, "erro", message);
    console.error(message);
  } finally {
    running = false;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, running, scheduleTimezone, local: localParts(new Date()) });
    return;
  }

  if (req.method !== "POST" || req.url !== "/run") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (running) {
    sendJson(res, 409, { error: "Uma coleta ja esta em andamento." });
    return;
  }

  try {
    await ensureSchemaOnce();
    if (running) {
      sendJson(res, 409, { error: "Uma coleta ja esta em andamento." });
      return;
    }

    running = true;
    const body = await readJsonBody(req);
    const args = [];

    if (typeof body.produtoId === "string" && body.produtoId) {
      args.push(`--produto-id=${body.produtoId}`);
    }

    if (typeof body.familiaId === "string" && body.familiaId) {
      args.push(`--familia-id=${body.familiaId}`);
    }

    if (typeof body.mapeamentoId === "string" && body.mapeamentoId) {
      args.push(`--mapeamento-id=${body.mapeamentoId}`);
    }

    if (body.failedOnly === true) {
      args.push("--failed-only");
    }

    args.push("--origin=manual");

    sendJson(res, 202, { ok: true, status: "buscando" });

    runWorkerWithArgs(args)
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
      })
      .finally(() => {
        running = false;
      });
  } catch (error) {
    running = false;
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Falha ao executar o worker.",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Worker trigger ouvindo em http://0.0.0.0:${port}`);
  console.log(`Agenda de coleta ativa no fuso ${scheduleTimezone}.`);
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
