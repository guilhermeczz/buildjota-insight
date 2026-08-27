import { join, resolve } from "node:path";

const DEFAULT_BASE_URL = "https://construjota2.mercos.com";

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
      overrides.navigationTimeoutMs ??
      envNumber("CONSTRUJOTA_MERCOS_NAVIGATION_TIMEOUT_MS", 30_000, 5_000, 120_000),
    signalTimeoutMs:
      overrides.signalTimeoutMs ??
      envNumber("CONSTRUJOTA_MERCOS_SIGNAL_TIMEOUT_MS", 12_000, 1_000, 60_000),
    actionTimeoutMs:
      overrides.actionTimeoutMs ??
      envNumber("CONSTRUJOTA_MERCOS_ACTION_TIMEOUT_MS", 7_000, 1_000, 30_000),
    productIntervalMs:
      overrides.productIntervalMs ??
      envNumber("CONSTRUJOTA_MERCOS_PRODUCT_INTERVAL_MS", 4_000, 1_000, 60_000),
    navigationAttempts:
      overrides.navigationAttempts ?? envNumber("CONSTRUJOTA_MERCOS_NAVIGATION_ATTEMPTS", 3, 1, 3),
    blockHeavyAssets:
      overrides.blockHeavyAssets ??
      String(process.env.CONSTRUJOTA_MERCOS_BLOCK_HEAVY_ASSETS ?? "true").toLowerCase() !== "false",
  };
}

export function construjotaMercosCredentials(config = construjotaMercosConfig()) {
  if (!config.login || !config.password) {
    throw new Error("Credenciais da CONSTRUJOTA_MERCOS nao configuradas nas variaveis de ambiente");
  }
  return { login: config.login, password: config.password };
}
