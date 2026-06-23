import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { loadWorkerEnv } from "./env.mjs";

loadWorkerEnv();

const port = Number(process.env.WORKER_TRIGGER_PORT ?? 8787);
let running = false;
const workerDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(workerDir, "../..");
const workerEntry = resolve(workerDir, "index.mjs");

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "access-control-allow-headers": "content-type, authorization",
  });
  res.end(JSON.stringify(body));
}

function runWorker() {
  return runWorkerWithArgs([]);
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
    sendJson(res, 200, { ok: true, running });
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

  running = true;

  try {
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

server.listen(port, () => {
  console.log(`Worker trigger ouvindo em http://localhost:${port}`);
});
