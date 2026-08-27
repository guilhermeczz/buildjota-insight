import { join, resolve } from "node:path";

const DEFAULT_BASE_URL = "https://construjota2.mercos.com";

// Limites tecnicos internos. Eles nao fazem parte da configuracao operacional do usuario:
// a agenda expoe somente horario e intervalo entre produtos.
export const CONSTRUJOTA_MERCOS_INTERNAL_LIMITS = Object.freeze({
  navigationTimeoutMs: 60_000,
  signalTimeoutMs: 30_000,
  actionTimeoutMs: 15_000,
  navigationAttempts: 3,
});

function envNumber(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function normalizeMercosBaseUrl(value = process.env.CONSTRUJOTA_MERCOS_BASE_URL) {
  const candidate = String(value || DEFAULT_BASE_URL).trim();
  const url = new URL(candidate);
  if (url.protocol !== "https:") {
    throw new Error("CONSTRUJOTA_MERCOS_BASE_URL deve usar HTTPS");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function construjotaMercosConfig(overrides = {}) {
  const baseUrl = normalizeMercosBaseUrl(overrides.baseUrl);
  return {
    baseUrl,
    loginUrl: `${baseUrl}/entrar`,
    login: overrides.login ?? process.env.CONSTRUJOTA_MERCOS_LOGIN ?? "",
    password: overrides.password ?? process.env.CONSTRUJOTA_MERCOS_PASSWORD ?? "",
    authStatePath:
      overrides.authStatePath ??
      join(resolve(process.cwd(), ".worker-auth"), "construjota-mercos.json"),
    diagnosticsDir: overrides.diagnosticsDir ?? resolve(process.cwd(), ".worker-diagnostics"),
    navigationTimeoutMs:
      overrides.navigationTimeoutMs ?? CONSTRUJOTA_MERCOS_INTERNAL_LIMITS.navigationTimeoutMs,
    signalTimeoutMs:
      overrides.signalTimeoutMs ?? CONSTRUJOTA_MERCOS_INTERNAL_LIMITS.signalTimeoutMs,
    actionTimeoutMs:
      overrides.actionTimeoutMs ?? CONSTRUJOTA_MERCOS_INTERNAL_LIMITS.actionTimeoutMs,
    productIntervalMs:
      overrides.productIntervalMs ??
      envNumber("CONSTRUJOTA_MERCOS_PRODUCT_INTERVAL_MS", 4_000, 1_000, 60_000),
    navigationAttempts:
      overrides.navigationAttempts ?? CONSTRUJOTA_MERCOS_INTERNAL_LIMITS.navigationAttempts,
    blockHeavyAssets: overrides.blockHeavyAssets ?? true,
  };
}

export function construjotaMercosCredentials(config = construjotaMercosConfig()) {
  if (!config.login || !config.password) {
    throw new Error("Credenciais da CONSTRUJOTA_MERCOS nao configuradas nas variaveis de ambiente");
  }
  return { login: config.login, password: config.password };
}
