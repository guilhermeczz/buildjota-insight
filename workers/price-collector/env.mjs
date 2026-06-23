import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadWorkerEnv() {
  for (const envPath of [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env.worker"),
    resolve(process.cwd(), ".env.worker.local"),
  ]) {
    loadEnvFile(envPath);
  }

  process.env.SUPABASE_URL ??= process.env.VITE_SUPABASE_URL;
  process.env.SUPABASE_FUNCTION_JWT ??= process.env.VITE_SUPABASE_ANON_KEY;
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
