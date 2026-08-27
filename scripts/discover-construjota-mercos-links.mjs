import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadWorkerEnv } from "../workers/price-collector/env.mjs";

loadWorkerEnv();

const apply = process.argv.includes("--apply");
const headed = process.argv.includes("--headed");
const produtoId = argValue("--produto-id");
const sku = argValue("--sku");
const format = (argValue("--format") || "csv").toLowerCase();

function argValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function sqlLiteral(value) {
  if (value == null || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function renderCsv(rows) {
  const columns = [
    "produto_id",
    "sku_interno",
    "nome",
    "status",
    "mercos_produto_id",
    "url_produto",
    "mensagem",
    "aplicavel",
  ];
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
}

function renderSql(rows) {
  const applicable = rows.filter((row) => row.aplicavel);
  if (applicable.length === 0) {
    return "-- Nenhuma URL foi confirmada para aplicar.";
  }
  return applicable
    .map(
      (row) => `insert into mapeamentos_construjota_mercos
  (produto_id, sku_site, mercos_produto_id, url_produto, ativo)
values
  (${sqlLiteral(row.produto_id)}::uuid, ${sqlLiteral(row.sku_interno)}, ${sqlLiteral(row.mercos_produto_id)}, ${sqlLiteral(row.url_produto)}, true)
on conflict (produto_id) do update set
  sku_site = excluded.sku_site,
  mercos_produto_id = excluded.mercos_produto_id,
  url_produto = excluded.url_produto,
  ativo = true;`,
    )
    .join("\n\n");
}

async function main() {
  if (!new Set(["csv", "sql"]).has(format)) {
    throw new Error("--format deve ser csv ou sql");
  }

  const database = await import("../workers/price-collector/database.mjs");
  const { createConstrujotaMercosBrowser } =
    await import("../workers/construjota-mercos/browser.mjs");
  if (apply) await database.ensureRuntimeSchema();
  const products = await database.fetchActiveProductsForConstrujotaMercosDiscovery({
    produtoId,
    sku,
  });
  if (products.length === 0) {
    console.log("Nenhum produto ativo encontrado para descoberta.");
    return;
  }

  console.log(
    `[CONSTRUJOTA_MERCOS] Descoberta iniciada para ${products.length} produto(s); gravacao=${apply ? "ativada" : "desativada"}.`,
  );
  const collector = await createConstrujotaMercosBrowser({ headed });
  const rows = [];
  try {
    for (let index = 0; index < products.length; index += 1) {
      const product = products[index];
      const current = product.mapeamento_construjota_mercos;
      const result = await collector.discover({
        id: current?.id ?? null,
        produto_id: product.id,
        sku_site: product.sku_interno,
        // Discovery sempre pesquisa o SKU; uma URL antiga nunca e aprovada sem nova confirmacao.
        url_produto: "",
        ultimo_preco: current?.ultimo_preco ?? null,
        produtos: {
          id: product.id,
          sku_interno: product.sku_interno,
          nome: product.nome,
          preco_atual: product.preco_atual,
        },
      });
      const canonicalId = result.mercos_produto_id || "";
      const canonicalUrl = result.url_produto || "";
      const applicable = Boolean(result.produto_confirmado && canonicalId && canonicalUrl);
      const row = {
        produto_id: product.id,
        sku_interno: product.sku_interno,
        nome: product.nome,
        status: result.status,
        mercos_produto_id: canonicalId,
        url_produto: canonicalUrl,
        mensagem: result.mensagem ?? "",
        aplicavel: applicable,
      };
      rows.push(row);

      if (apply && applicable) {
        await database.upsertConstrujotaMercosMapping({
          produto_id: product.id,
          sku_site: product.sku_interno,
          mercos_produto_id: canonicalId,
          url_produto: canonicalUrl,
          ativo: true,
        });
      }
      console.log(
        `[CONSTRUJOTA_MERCOS] ${index + 1}/${products.length} SKU ${product.sku_interno}: ${applicable ? "URL confirmada" : result.status}.`,
      );
      if (index < products.length - 1) await collector.waitBetweenProducts();
    }
  } finally {
    await collector.close();
  }

  const output = format === "sql" ? renderSql(rows) : renderCsv(rows);
  const outputDir = resolve(process.cwd(), ".worker-diagnostics", "construjota-mercos");
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(outputDir, `discovery-${timestamp}.${format}`);
  await writeFile(outputPath, `${output}\n`, "utf8");

  const confirmed = rows.filter((row) => row.aplicavel).length;
  const notFound = rows.filter((row) => row.status === "nao_encontrado").length;
  const ambiguous = rows.filter((row) => row.status === "ambiguo").length;
  console.log(
    `[CONSTRUJOTA_MERCOS] Descoberta finalizada: ${confirmed} confirmada(s), ${notFound} nao encontrada(s), ${ambiguous} ambigua(s).`,
  );
  console.log(`Previa ${format.toUpperCase()} salva em ${outputPath}.`);
  if (!apply) console.log("Preview: nenhum mapeamento foi alterado. Use --apply para gravar.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
