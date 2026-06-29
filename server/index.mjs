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

loadServerEnv();

const port = Number(process.env.PORT ?? 3001);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");

const corsHeaders = {
  "access-control-allow-origin": process.env.CORS_ORIGIN ?? "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

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
      const sucesso = item.status === "sucesso";
      if (sucesso) totalSucesso += 1;
      if (item.status === "erro") totalErro += 1;

      const diferencaValor = sucesso
        ? Number((Number(item.preco_construjota) - Number(item.preco_concorrente)).toFixed(3))
        : 0;
      const diferencaPercentual =
        sucesso && Number(item.preco_concorrente) > 0
          ? Number(((diferencaValor / Number(item.preco_concorrente)) * 100).toFixed(4))
          : 0;

      await client.query(
        `insert into historico_precos
          (mapeamento_id,preco_construjota,preco_concorrente,diferenca_valor,diferenca_percentual,status,mensagem_erro,coletado_em)
         values ($1,$2,$3,$4,$5,$6,$7,now())`,
        [
          item.mapeamento_id,
          item.preco_construjota ?? 0,
          item.preco_concorrente ?? 0,
          diferencaValor,
          diferencaPercentual,
          item.status,
          item.mensagem_erro ?? null,
        ],
      );

      await client.query(
        `update mapeamentos_sku
         set ultimo_preco = $1, ultima_atualizacao = now(), status_coleta = $2
         where id = $3`,
        [sucesso ? item.preco_concorrente : null, item.status, item.mapeamento_id],
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
      const data = await runQuery(await readJson(req));
      return sendJson(res, 200, { data });
    }

    if (path === "/api/functions/admin-users" && req.method === "POST")
      return handleAdminUsers(req, res);
    if (path === "/api/functions/registrar-coleta" && req.method === "POST")
      return handleRegisterCollection(req, res);

    if (path.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
    return serveStatic(req, res, path);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error instanceof Error ? error.message : "Erro interno." });
  }
});

server.listen(port, () => {
  console.log(`API ouvindo em http://localhost:${port}`);
});
