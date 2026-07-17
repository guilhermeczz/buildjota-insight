import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadServerEnv } from "./env.mjs";
import { query, transaction } from "./db.mjs";
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
  await ensureRuntimeSchemaOnce();
  const body = await readJson(req);
  const resultados = Array.isArray(body.resultados) ? body.resultados : [];
  const startedAt = new Date();

  const result = await transaction(async (client) => {
    const execucao = await client.query(
      "insert into execucoes_robo (status,origem,iniciado_em,total_processados) values ('pendente',$1,$2,$3) returning id",
      [body.origem ?? "worker", startedAt.toISOString(), resultados.length],
    );

    let totalSucesso = 0;
    let totalErro = 0;

    for (const item of resultados) {
      const precoInformado = Number(item.preco_concorrente);
      const sucesso =
        item.status === "sucesso" && Number.isFinite(precoInformado) && precoInformado > 0;
      const statusItem = sucesso ? "sucesso" : "erro";
      if (sucesso) totalSucesso += 1;
      if (!sucesso) totalErro += 1;

      const precoConcorrente = sucesso ? precoInformado : null;
      const diferencaValor =
        sucesso && precoConcorrente !== null
          ? Number((Number(item.preco_construjota) - Number(item.preco_concorrente)).toFixed(3))
          : null;
      const diferencaPercentual =
        sucesso && precoConcorrente !== null && precoConcorrente > 0
          ? Number(((Number(diferencaValor) / precoConcorrente) * 100).toFixed(4))
          : null;

      await client.query(
        `insert into historico_precos
          (mapeamento_id,preco_construjota,preco_concorrente,diferenca_valor,diferenca_percentual,status,mensagem_erro,coletado_em)
         values ($1,$2,$3,$4,$5,$6,$7,now())`,
        [
          item.mapeamento_id,
          item.preco_construjota ?? 0,
          precoConcorrente,
          diferencaValor,
          diferencaPercentual,
          statusItem,
          item.mensagem_erro ?? (sucesso ? null : "Preco valido nao encontrado"),
        ],
      );

      await client.query(
        `update mapeamentos_sku
         set ultimo_preco = $1, ultima_atualizacao = now(), status_coleta = $2
         where id = $3`,
        [precoConcorrente, statusItem, item.mapeamento_id],
      );
    }

    const finishedAt = new Date();
    const status = totalErro === 0 ? "sucesso" : totalSucesso === 0 ? "erro" : "parcial";
    await client.query(
      `update execucoes_robo
       set status = $1, finalizado_em = $2, total_sucesso = $3, total_erro = $4,
           mensagem = $5, tempo_execucao_segundos = $6
       where id = $7`,
      [
        status,
        finishedAt.toISOString(),
        totalSucesso,
        totalErro,
        body.mensagem ?? "Coleta registrada",
        Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
        execucao.rows[0].id,
      ],
    );

    return { id: execucao.rows[0].id, status, total_sucesso: totalSucesso, total_erro: totalErro };
  });

  return sendJson(res, 200, result);
}

async function handleWorkerProxy(req, res, path) {
  const user = await requireUser(req, res);
  if (!user) return;

  const endpoint = path === "/api/worker/health" ? "/health" : "/run";
  const method = endpoint === "/health" ? "GET" : "POST";

  if (req.method !== method) {
    return sendJson(res, 405, { error: "Metodo nao permitido." });
  }

  try {
    const body = method === "POST" ? await readJson(req) : undefined;
    const response = await fetch(`${workerInternalUrl}${endpoint}`, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body) : undefined,
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
