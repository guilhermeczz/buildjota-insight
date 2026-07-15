import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const hasSku = args.some((arg) => arg.startsWith("--sku="));
const finalArgs = [
  "scripts/discover-mapping-links.mjs",
  ...(hasSku ? [] : ["--sku=419,389,482"]),
  "--out=bianco-candidatos.json",
  "--sql-out=bianco-mapeamentos-auto.sql",
  "--min-score=14",
  ...args,
];

const child = spawn(process.execPath, finalArgs, {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
