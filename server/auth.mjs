import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { query } from "./db.mjs";

const secret = process.env.APP_JWT_SECRET;

if (!secret) {
  console.warn("APP_JWT_SECRET nao configurado. Configure antes de usar em producao.");
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload) {
  return createHmac("sha256", secret || "dev-secret")
    .update(payload)
    .digest("base64url");
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored ?? "").split(":");
  if (!salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createToken(user) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
    }),
  );
  const signature = signPayload(`${header}.${payload}`);
  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token) {
  const [header, payload, signature] = String(token ?? "").split(".");
  if (!header || !payload || !signature) return null;

  const expected = signPayload(`${header}.${payload}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
  return data;
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    role: row.role,
    ativo: row.ativo,
    created_at: row.created_at,
  };
}

export async function getUserFromRequest(req) {
  const authorization = req.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload?.sub) return null;

  const { rows } = await query(
    "select id,nome,email,role,ativo,created_at from usuarios where id = $1 and ativo = true",
    [payload.sub],
  );
  return publicUser(rows[0]);
}

export async function requireUser(req, res) {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Nao autenticado." }));
    return null;
  }
  return user;
}

export async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: "Acesso restrito a administradores." }));
    return null;
  }
  return user;
}
