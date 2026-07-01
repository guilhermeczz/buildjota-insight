import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadServerEnv() {
  for (const envPath of [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env.worker.local"),
  ]) {
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, "utf8");

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;

      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      const value = rawValue.replace(/^["']|["']$/g, "");

      if (key) {
        process.env[key] = value;
      }
    }
  }

  process.env.DATABASE_URL ??= process.env.POSTGRES_URL;
}
