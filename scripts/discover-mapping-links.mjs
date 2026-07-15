import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { loadServerEnv } from "../server/env.mjs";
import { query } from "../server/db.mjs";
import { credentialsFor } from "../workers/price-collector/config.mjs";

loadServerEnv();

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const argv = process.argv.slice(2);
const args = new Set(argv);
const headed = args.has("--headed");
const onlyMissing = !args.has("--all");
const outputPath = option("out") ?? "mapping-candidates.json";
const sqlOutputPath = option("sql-out");
const minScore = Number(option("min-score") ?? 14);
const limit = option("limit") ? Number(option("limit")) : null;
const skuFilter = option("sku")
  ?.split(",")
  .map((sku) => sku.trim())
  .filter(Boolean);
const familiaFilter = option("familia")?.trim();
const concorrenteFilter = option("concorrente")
  ?.split(",")
  .map((nome) => nome.trim().toUpperCase())
  .filter(Boolean);

function option(name) {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function sqlString(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function absoluteUrl(value, base) {
  if (!value) return "";
  try {
    return new URL(value).toString();
  } catch {
    return new URL(value, base).toString();
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function significantTokens(name) {
  const stopWords = new Set([
    "DE",
    "DA",
    "DO",
    "DAS",
    "DOS",
    "COM",
    "PARA",
    "P",
    "C",
    "SACHE",
    "FRASCO",
    "POTE",
    "LATA",
    "BALDE",
    "GALAO",
  ]);

  return normalizeText(name)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function quantityTokens(name) {
  const normalized = normalizeText(name);
  const matches = normalized.match(/\b\d+(?:[,.]\d+)?\s*(?:G|KG|ML|L|LTS|LT|CM|M|MM)\b/g) ?? [];
  return matches.map((match) => match.replace(/\s+/g, ""));
}

function searchTermsForProduct(product) {
  const tokens = significantTokens(product.nome);
  const quantities = quantityTokens(product.nome);
  const brandish = tokens.slice(0, 4).join(" ");
  const firstTwo = tokens.slice(0, 2).join(" ");
  const firstThree = tokens.slice(0, 3).join(" ");
  const terms = new Set([product.nome, brandish, firstThree, firstTwo].filter(Boolean));

  for (const quantity of quantities) {
    if (firstTwo) terms.add(`${firstTwo} ${quantity}`);
    if (tokens[0]) terms.add(`${tokens[0]} ${quantity}`);
  }

  return Array.from(terms).slice(0, 5);
}

function scoreCandidate(text, href, product) {
  const haystack = normalizeText(`${text} ${href}`);
  const tokens = significantTokens(product.nome);
  const quantities = quantityTokens(product.nome);
  let score = 0;

  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length >= 5 ? 3 : 2;
  }

  for (const quantity of quantities) {
    const flexible = quantity.replace(",", "[,.]?").replace(".", "[,.]?");
    if (new RegExp(flexible.replace(/([A-Z]+)/, "\\s*$1")).test(haystack)) score += 5;
  }

  if (/PRODUTO|ITEM|DETALHES|\/P\/|\/PRODUTO|\/ITEM|\/C\/PRODUTO/.test(haystack)) score += 2;
  if (/CATEGORIA|LINHA|MARCA|BLOG|LOGIN|CADASTRO/.test(haystack)) score -= 4;
  return score;
}

function extractSkuFromCandidate(candidate) {
  const text = normalizeText(`${candidate.texto} ${candidate.url}`);
  const codePatterns = [
    /\bCOD(?:IGO)?\s*[:.-]?\s*([A-Z0-9._-]{2,30})\b/i,
    /\bSKU\s*[:.-]?\s*([A-Z0-9._-]{2,30})\b/i,
    /\/(?:produto|item|detalhes|p|c\/produto)\/([A-Z0-9._-]{2,30})/i,
    /\/([0-9]{3,12})(?:[-/?#]|$)/,
  ];

  for (const pattern of codePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/[^A-Z0-9._-]/gi, "");
  }

  return candidate.url;
}

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.fill(value, { timeout: 8000 });
    return true;
  }

  return false;
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;

    const clicked = await locator.click({ timeout: 8000 }).then(
      () => true,
      () => false,
    );
    if (clicked) {
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
      return true;
    }
  }

  return false;
}

async function dismissOverlays(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clicked = await clickFirstVisible(page, [
      "button:has-text('Entendi')",
      "button:has-text('Aceitar todos')",
      "button:has-text('Aceitar')",
      "button:has-text('Fechar')",
      "[aria-label='Close']",
      "[aria-label='Fechar']",
      ".modal button.btn-close",
    ]);
    if (!clicked) return;
  }
}

async function login(page, concorrente) {
  const credentials = credentialsFor(concorrente.nome);
  if (!credentials) return false;

  const loginUrl =
    concorrente.nome === "MAREST" ? `${concorrente.site_url}/login` : concorrente.login_url;
  await page.goto(absoluteUrl(loginUrl || concorrente.site_url, concorrente.site_url), {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
  await dismissOverlays(page);
  await clickFirstVisible(page, [
    ".menu-user > a",
    "a[data-toggle='dropdown']:has(svg)",
    "#botao-login",
    "button:has-text('Entre ou cadastre-se')",
    "a:has-text('Entre ou cadastre-se')",
    "button:has-text('Entrar')",
    "a:has-text('Entrar')",
  ]);

  const loginFilled = await fillFirstVisible(
    page,
    [
      "input[type='email']",
      "input[name*='email' i]",
      "input[id*='email' i]",
      "input[name*='login' i]",
      "input[id*='login' i]",
      "input[name*='usuario' i]",
      "input[id*='usuario' i]",
      "input[name*='cnpj' i]",
      "input[id*='cnpj' i]",
      "input[type='text']",
    ],
    credentials.login,
  );

  const passwordFilled = await fillFirstVisible(
    page,
    [
      "input[type='password']",
      "input[name*='senha' i]",
      "input[id*='senha' i]",
      "input[name*='password' i]",
      "input[id*='password' i]",
    ],
    credentials.password,
  );

  if (!loginFilled || !passwordFilled) return false;

  await clickFirstVisible(page, [
    "form button:has-text('Entrar')",
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Entrar')",
    "button:has-text('Acessar')",
    "a:has-text('Entrar')",
  ]);
  await page.keyboard.press("Enter").catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1500);
  return true;
}

function searchUrls(baseUrl, term) {
  const encoded = encodeURIComponent(term);
  return [
    `/busca?busca=${encoded}`,
    `/busca?termo=${encoded}`,
    `/busca?q=${encoded}`,
    `/pesquisa?busca=${encoded}`,
    `/pesquisa?termo=${encoded}`,
    `/pesquisa?q=${encoded}`,
    `/search?term=${encoded}`,
    `/catalogo?busca=${encoded}`,
    `/produto?busca=${encoded}`,
  ].map((path) => absoluteUrl(path, baseUrl));
}

async function searchByInput(page, term) {
  await dismissOverlays(page);
  const filled = await fillFirstVisible(
    page,
    [
      "input[type='search']",
      "input[name*='busca' i]",
      "input[id*='busca' i]",
      "input[placeholder*='busca' i]",
      "input[placeholder*='pesquisa' i]",
      "input[placeholder*='Pesquisar' i]",
      "input[placeholder*='produto' i]",
    ],
    term,
  );

  if (!filled) return false;
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1500);
  return true;
}

async function extractCandidates(page, concorrente, product) {
  const base = concorrente.site_url;
  const anchors = await page
    .locator("a[href]")
    .evaluateAll((items) =>
      items.slice(0, 700).map((anchor) => ({
        href: anchor.getAttribute("href") ?? "",
        text: anchor.textContent ?? "",
      })),
    )
    .catch(() => []);

  return anchors
    .map((anchor) => {
      const url = absoluteUrl(anchor.href, base);
      const texto = anchor.text.replace(/\s+/g, " ").trim();
      const candidate = {
        concorrente: concorrente.nome,
        sku_cj: product.sku_interno,
        produto_cj: product.nome,
        url,
        texto,
        score: scoreCandidate(texto, url, product),
      };
      return { ...candidate, sku_concorrente: extractSkuFromCandidate(candidate) };
    })
    .filter((candidate) => candidate.score >= 7 && /^https?:\/\//.test(candidate.url))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

async function discoverForProduct(page, concorrente, product) {
  const candidates = [];
  for (const term of searchTermsForProduct(product)) {
    await page.goto(concorrente.site_url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);

    if (await searchByInput(page, term)) {
      candidates.push(...(await extractCandidates(page, concorrente, product)));
    }

    for (const url of searchUrls(concorrente.site_url, term)) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => null);
      candidates.push(...(await extractCandidates(page, concorrente, product)));
    }
  }

  const unique = new Map();
  for (const candidate of candidates) {
    const current = unique.get(candidate.url);
    if (!current || candidate.score > current.score) unique.set(candidate.url, candidate);
  }

  return Array.from(unique.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

async function discoverForConcorrente(browser, concorrente, products) {
  const context = await browser.newContext({
    userAgent,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });
  const page = await context.newPage();
  const found = [];

  try {
    await login(page, concorrente).catch(() => false);

    for (const [index, product] of products.entries()) {
      console.log(
        `[${concorrente.nome}] ${index + 1}/${products.length} ${product.sku_interno} - ${product.nome}`,
      );
      const candidates = await discoverForProduct(page, concorrente, product);
      found.push(...candidates);
    }
  } finally {
    await context.close();
  }

  return found;
}

function buildSql(candidates) {
  const bestCandidates = [];
  const grouped = new Map();

  for (const candidate of candidates.filter((item) => item.score >= minScore)) {
    const key = `${candidate.sku_cj}:${candidate.concorrente}`;
    const current = grouped.get(key);
    if (!current || candidate.score > current.score) grouped.set(key, candidate);
  }

  bestCandidates.push(...grouped.values());

  const values = bestCandidates
    .map(
      (item) =>
        `  (${sqlString(item.sku_cj)}, ${sqlString(item.concorrente)}, ${sqlString(
          item.sku_concorrente,
        )}, ${sqlString(item.url)}, '', null, ${sqlString(`Auto-descoberto score ${item.score}`)})`,
    )
    .join(",\n");

  return `begin;

create temporary table tmp_mapeamentos_auto (
  sku_cj text not null,
  concorrente text not null,
  sku_concorrente text not null,
  url_produto text not null,
  unidade_equivalente text not null default '',
  seletor_preco text,
  observacoes text not null default ''
) on commit drop;

insert into tmp_mapeamentos_auto
  (sku_cj, concorrente, sku_concorrente, url_produto, unidade_equivalente, seletor_preco, observacoes)
values
${values || "  -- Nenhum candidato acima do score minimo."};

insert into mapeamentos_sku (
  produto_id,
  concorrente_id,
  sku_concorrente,
  url_produto,
  unidade_equivalente,
  seletor_preco,
  observacoes,
  ativo,
  status_coleta
)
select
  p.id,
  c.id,
  t.sku_concorrente,
  t.url_produto,
  t.unidade_equivalente,
  t.seletor_preco,
  t.observacoes,
  true,
  'pendente'
from tmp_mapeamentos_auto t
join produtos p on p.sku_interno = t.sku_cj
join concorrentes c on upper(c.nome) = upper(t.concorrente)
on conflict (produto_id, concorrente_id, sku_concorrente) do update set
  url_produto = excluded.url_produto,
  unidade_equivalente = excluded.unidade_equivalente,
  seletor_preco = excluded.seletor_preco,
  observacoes = excluded.observacoes,
  ativo = true,
  status_coleta = 'pendente',
  updated_at = now();

commit;
`;
}

async function fetchProducts() {
  const values = [];
  const clauses = ["p.ativo = true"];

  if (skuFilter?.length) {
    values.push(skuFilter);
    clauses.push(`p.sku_interno = any($${values.length})`);
  }

  if (familiaFilter) {
    values.push(familiaFilter);
    clauses.push(`(f.id::text = $${values.length} or lower(f.nome) = lower($${values.length}))`);
  }

  if (onlyMissing) {
    clauses.push(`exists (
      select 1
      from concorrentes c
      where c.ativo = true
        and not exists (
          select 1
          from mapeamentos_sku m
          where m.produto_id = p.id
            and m.concorrente_id = c.id
            and m.ativo = true
        )
    )`);
  }

  let sql = `
    select p.id, p.sku_interno, p.nome, f.nome as familia_nome
    from produtos p
    left join familias f on f.id = p.familia_id
    where ${clauses.join(" and ")}
    order by f.nome nulls last, p.nome
  `;

  if (limit && Number.isFinite(limit)) {
    values.push(limit);
    sql += ` limit $${values.length}`;
  }

  const { rows } = await query(sql, values);
  return rows;
}

async function fetchConcorrentes() {
  const values = [];
  const clauses = ["ativo = true"];

  if (concorrenteFilter?.length) {
    values.push(concorrenteFilter);
    clauses.push(`upper(nome) = any($${values.length})`);
  }

  const { rows } = await query(
    `select nome, site_url, login_url from concorrentes where ${clauses.join(" and ")} order by nome`,
    values,
  );
  return rows;
}

async function main() {
  const [products, concorrentes] = await Promise.all([fetchProducts(), fetchConcorrentes()]);

  console.log(`Produtos: ${products.length}`);
  console.log(`Concorrentes: ${concorrentes.map((item) => item.nome).join(", ")}`);
  console.log(`Modo: ${onlyMissing ? "somente mapeamentos faltantes" : "todos"}`);

  const browser = await chromium.launch({ headless: !headed });
  const all = [];

  try {
    for (const concorrente of concorrentes) {
      const candidates = await discoverForConcorrente(browser, concorrente, products);
      all.push(...candidates);
    }
  } finally {
    await browser.close();
  }

  writeFileSync(outputPath, `${JSON.stringify(all, null, 2)}\n`, "utf8");
  console.log(`Candidatos gerados: ${all.length}`);
  console.log(`Arquivo JSON: ${outputPath}`);

  if (sqlOutputPath) {
    writeFileSync(sqlOutputPath, buildSql(all), "utf8");
    console.log(`Arquivo SQL: ${sqlOutputPath}`);
    console.log(`Score minimo para SQL: ${minScore}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
