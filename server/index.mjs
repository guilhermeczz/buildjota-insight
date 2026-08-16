import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadServerEnv } from "./env.mjs";
import { query } from "./db.mjs";
import {
  createToken,
  hashPassword,
  publicUser,
  requireAdmin,
  requireUser,
  verifyPassword,
} from "./auth.mjs";
import { runQuery } from "./query-api.mjs";
import { ensureRuntimeSchema } from "../workers/price-collector/database.mjs";

loadServerEnv();

const port = Number(process.env.PORT ?? 3001);
const workerInternalUrl = String(
  process.env.WORKER_INTERNAL_URL ?? "http://127.0.0.1:8787",
).replace(/\/+$/, "");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");

const corsHeaders = {
  "access-control-allow-origin": process.env.CORS_ORIGIN ?? "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

const runtimeSchemaTables = new Set(["agenda_coletas", "execucoes_robo", "historico_precos"]);
let runtimeSchemaPromise = null;

function ensureRuntimeSchemaOnce() {
  runtimeSchemaPromise ??= ensureRuntimeSchema().catch((error) => {
    runtimeSchemaPromise = null;
    throw error;
  });

  return runtimeSchemaPromise;
}

function sendJson(res, status, body) {
  res.writeHead(status, { ...corsHeaders, "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handleAuth(req, res, path) {
  if (path === "/api/auth/login" && req.method === "POST") {
    const body = await readJson(req);
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const senha = String(body.senha ?? body.password ?? "");

    const { rows } = await query("select * from usuarios where lower(email) = $1", [email]);
    const user = rows[0];
    if (!user || !user.ativo || !verifyPassword(senha, user.password_hash)) {
      return sendJson(res, 401, { error: "E-mail ou senha invalidos." });
    }

    return sendJson(res, 200, { token: createToken(user), user: publicUser(user) });
  }

  if (path === "/api/auth/me" && req.method === "GET") {
    const user = await requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { user });
  }

  if (path === "/api/auth/bootstrap-admin" && req.method === "POST") {
    const { rows } = await query("select count(*)::int as count from usuarios");
    if (rows[0].count > 0) {
      return sendJson(res, 409, { error: "Ja existe usuario cadastrado." });
    }

    const body = await readJson(req);
    const nome = String(body.nome ?? "Administrador").trim();
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const password = String(body.password ?? body.senha ?? "");

    if (!email || password.length < 6) {
      return sendJson(res, 400, { error: "Informe e-mail e senha com no minimo 6 caracteres." });
    }

    const result = await query(
      "insert into usuarios (nome,email,password_hash,role,ativo) values ($1,$2,$3,'admin',true) returning *",
      [nome, email, hashPassword(password)],
    );
    const user = result.rows[0];
    return sendJson(res, 201, { token: createToken(user), user: publicUser(user) });
  }

  return false;
}

async function handleAdminUsers(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const body = await readJson(req);
  const action = body.action;

  if (action === "create") {
    if (
      !body.nome?.trim() ||
      !/^\S+@\S+\.\S+$/.test(body.email) ||
      !body.password ||
      body.password.length < 6
    ) {
      return sendJson(res, 400, {
        error: "Informe nome, e-mail valido e senha com no minimo 6 caracteres.",
      });
    }

    const { rows } = await query(
      "insert into usuarios (nome,email,password_hash,role,ativo) values ($1,$2,$3,$4,$5) returning id,nome,email,role,ativo,created_at",
      [
        body.nome.trim(),
        body.email.trim().toLowerCase(),
        hashPassword(body.password),
        body.role,
        body.ativo !== false,
      ],
    );
    return sendJson(res, 200, { user: rows[0] });
  }

  if (action === "update") {
    if (!body.id || !body.nome?.trim() || !/^\S+@\S+\.\S+$/.test(body.email)) {
      return sendJson(res, 400, { error: "Informe nome e e-mail valido." });
    }
    if (body.id === admin.id && body.ativo === false) {
      return sendJson(res, 400, { error: "Voce nao pode desativar o proprio usuario." });
    }

    const updates = ["nome = $1", "email = $2", "role = $3", "ativo = $4"];
    const values = [
      body.nome.trim(),
      body.email.trim().toLowerCase(),
      body.role,
      body.ativo !== false,
    ];
    if (body.password) {
      if (body.password.length < 6)
        return sendJson(res, 400, { error: "A senha deve ter no minimo 6 caracteres." });
      values.push(hashPassword(body.password));
      updates.push(`password_hash = $${values.length}`);
    }
    values.push(body.id);

    const { rows } = await query(
      `update usuarios set ${updates.join(",")} where id = $${values.length} returning id,nome,email,role,ativo,created_at`,
      values,
    );
    return sendJson(res, 200, { user: rows[0] });
  }

  if (action === "delete") {
    if (!body.id) return sendJson(res, 400, { error: "Usuario invalido." });
    if (body.id === admin.id)
      return sendJson(res, 400, { error: "Voce nao pode excluir o proprio usuario." });
    await query("delete from usuarios where id = $1", [body.id]);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 400, { error: "Acao invalida." });
}

async function handleRegisterCollection(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  return sendJson(res, 403, {
    error: "Registro externo desativado. As coletas sao executadas somente pelas agendas.",
  });
}

async function handleWorkerProxy(req, res, path) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (path === "/api/worker/run") {
    return sendJson(res, 403, {
      error: "Coleta manual desativada. Configure a execucao na Agenda de Coleta.",
    });
  }

  const endpoint = "/health";
  const method = "GET";

  if (req.method !== method) {
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  }

  try {
    const response = await fetch(`${workerInternalUrl}${endpoint}`, {
      method,
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({}));
    return sendJson(res, response.status, result);
  } catch (error) {
    return sendJson(res, 503, {
      error:
        error instanceof Error && error.name === "TimeoutError"
          ? "O worker demorou para responder."
          : "Worker indisponivel. Verifique o processo radar-worker no PM2.",
    });
  }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(distDir, requested));
  if (!filePath.startsWith(distDir)) return sendJson(res, 403, { error: "Forbidden" });

  try {
    const content = await readFile(filePath);
    const type =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      }[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(content);
  } catch {
    const content = await readFile(join(distDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(content);
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      return res.end();
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (path === "/api/health") return sendJson(res, 200, { ok: true });

    if (path.startsWith("/api/auth/")) {
      const handled = await handleAuth(req, res, path);
      if (handled !== false) return;
    }

    if (path === "/api/query" && req.method === "POST") {
      const user = await requireUser(req, res);
      if (!user) return;
      const body = await readJson(req);
      if (runtimeSchemaTables.has(String(body.table ?? ""))) {
        await ensureRuntimeSchemaOnce();
      }
      const data = await runQuery(body);
      return sendJson(res, 200, { data });
    }

    if (path === "/api/functions/admin-users" && req.method === "POST")
      return handleAdminUsers(req, res);
    if (path === "/api/functions/registrar-coleta" && req.method === "POST")
      return handleRegisterCollection(req, res);
    if (path === "/api/worker/run" || path === "/api/worker/health")
      return handleWorkerProxy(req, res, path);

    if (path.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
    return serveStatic(req, res, path);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Erro interno." });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`API ouvindo em http://0.0.0.0:${port}`);
});
