import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

let browser;
let collectGroup;
let directory;
let originalCwd;
let originalEnv;
const settings = {
  COFEMA_LOGIN: "test-client",
  COFEMA_PASSWORD: "test-password",
  COFEMA_BASE_URL: "https://www.cofema.com.br",
  COFEMA_LOGIN_URL: "/",
  COFEMA_UNIDADE: "Sao Paulo",
  WORKER_BLOCK_HEAVY_ASSETS: "false",
  WORKER_QUICK_LOAD_TIMEOUT_MS: "1000",
  WORKER_PRODUCT_SETTLE_MS: "0",
};

test.before(async () => {
  originalCwd = process.cwd();
  originalEnv = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  directory = mkdtempSync(join(tmpdir(), "cofema-session-"));
  process.chdir(directory);
  mkdirSync(join(directory, ".worker-auth"));
  Object.assign(process.env, settings);
  ({ collectGroup } = await import("./browser.mjs"));
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  process.chdir(originalCwd);
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(directory, { recursive: true, force: true });
});

const authenticatedHeader = `<header>
  <button aria-haspopup="menu" title="000 - Cliente"><svg class="lucide-user"></svg>Cliente</button>
  <button aria-haspopup="menu"><svg class="lucide-building-2"></svg>São Paulo</button>
</header>`;
const guestHeader = `<header><button onclick="document.querySelector('#area').hidden=false">Entre ou Cadastre-se</button></header>`;
const loginForm = `${guestHeader}
  <button id="area" hidden onclick="document.querySelector('#dialog').hidden=false">Área do Cliente</button>
  <div id="dialog" hidden role="dialog" aria-label="Login do cliente">
    <input id="codigo" autocomplete="username"><input id="senha" type="password">
    <button onclick="submitLogin()">Entrar</button>
  </div>
  <script>async function submitLogin() {
    const result = await fetch('/api/auth', {method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({action:'loginCliente',codigoOuCnpj:document.querySelector('#codigo').value,pass:document.querySelector('#senha').value})});
    if(result.ok) location.href='/';
  }</script>`;

function fixtureBrowser(options = {}) {
  let authenticated = true;
  const visits = new Map();
  const counters = { logins: 0, cookieClears: 0, homeVisits: 0 };
  return {
    visits,
    counters,
    version: () => browser.version(),
    newContext: async (contextOptions) => {
      // Each test starts with an independently authenticated session.
      const context = await browser.newContext({ ...contextOptions, storageState: undefined });
      const clearCookies = context.clearCookies.bind(context);
      context.clearCookies = async (...args) => {
        counters.cookieClears++;
        return clearCookies(...args);
      };
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/api/auth") {
          counters.logins++;
          authenticated = true;
          return route.fulfill({ json: { success: true } });
        }
        if (url.pathname === "/") {
          counters.homeVisits++;
          return route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: authenticated
              ? authenticatedHeader +
                `<input type="search" onkeydown="if(event.key==='Enter') location.href='/page/busca?q='+encodeURIComponent(this.value)">`
              : loginForm,
          });
        }
        if (url.pathname === "/page/busca") {
          const sku = url.searchParams.get("q");
          return route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: `${authenticatedHeader}
            <article><a href="/page/produto/${sku}-produto">Fita isolante Imperial codigo ${sku}</a><p>R$ 2,95</p></article>`,
          });
        }
        const sku = url.pathname.match(/\/produto\/(\d+)/)?.[1];
        const visit = (visits.get(sku) ?? 0) + 1;
        visits.set(sku, visit);
        if (url.pathname.startsWith("/br/"))
          return route.fulfill({ status: 404, body: "Not found" });
        if (sku === options.expireOn && visit === 1) authenticated = false;
        if (sku === options.httpErrorOn)
          return route.fulfill({ status: 429, body: "Too many requests" });
        const hideHeader =
          sku === options.incompleteOn && (options.alwaysIncomplete || visit === 1);
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `
          ${hideHeader ? "" : authenticated ? authenticatedHeader : guestHeader}
          <main><div class="space-y-2"><h1>Produto ${sku}</h1><p>Código: ${sku}</p>
          ${authenticated ? '<div class="produto-preco"><div class="produto-preco-row">R$ 2,95</div></div>' : "<p>Faça login para ver os preços</p>"}
          </div></main>`,
        });
      });
      return context;
    },
  };
}

function group(skus) {
  return {
    concorrente: { nome: "COFEMA", site_url: "https://www.cofema.com.br", tipo_consulta: "SKU" },
    mapeamentos: skus.map((sku) => ({
      id: sku,
      sku_concorrente: sku,
      url_produto: `https://www.cofema.com.br/page/produto/${sku}-produto`,
      produtos: { sku_interno: sku, nome: `Produto ${sku}`, preco_atual: 2.89 },
    })),
  };
}

test("missing unit header is recovered for a standalone product without logging out", async () => {
  const fixture = fixtureBrowser({ incompleteOn: "112771" });
  const results = await collectGroup(fixture, group(["112771"]));
  assert.equal(results[0].status, "sucesso");
  assert.equal(fixture.visits.get("112771"), 2);
  assert.equal(fixture.counters.logins, 0);
  assert.equal(fixture.counters.cookieClears, 0);
});

test("expired session during unit setup renews and reads the same product, then all remaining products", async () => {
  const skus = [
    ...Array.from({ length: 18 }, (_, i) => String(410400 + i)),
    "112771",
    "112780",
    "112798",
    "53309",
  ];
  const fixture = fixtureBrowser({ expireOn: "112771" });
  const results = await collectGroup(fixture, group(skus));
  assert.equal(results.length, 22);
  assert.ok(results.every((result) => result.status === "sucesso"));
  assert.equal(fixture.counters.logins, 1);
  assert.equal(fixture.visits.get("112771"), 2);
  assert.ok(results.every((result) => result.preco_concorrente === 2.95));
});

test("a persistently broken product header is bounded and does not invalidate the following product", async () => {
  const fixture = fixtureBrowser({ incompleteOn: "112771", alwaysIncomplete: true });
  const results = await collectGroup(fixture, group(["112771", "112780"]));
  assert.match(results[0].mensagem_erro, /cabecalho de sessao nao carregou/);
  assert.equal(results[0].preco_concorrente, null);
  assert.equal(results[1].status, "sucesso");
  assert.equal(fixture.visits.get("112771"), 2);
  assert.equal(fixture.counters.cookieClears, 0);
});

test("HTTP product errors stay distinct from login and preserve the next product session", async () => {
  const fixture = fixtureBrowser({ httpErrorOn: "112771" });
  const results = await collectGroup(fixture, group(["112771", "112780"]));
  assert.equal(results[0].mensagem_erro, "COFEMA: pagina do produto retornou HTTP 429");
  assert.equal(results[1].status, "sucesso");
  assert.equal(fixture.counters.cookieClears, 0);
});

test("an obsolete localized 404 URL searches and confirms the exact product before checking its unit", async () => {
  const fixture = fixtureBrowser();
  const mappings = group(["112771"]);
  mappings.mapeamentos[0].url_produto = "https://www.cofema.com.br/br/page/produto/112771-produto";
  const results = await collectGroup(fixture, mappings);
  assert.equal(results[0].status, "sucesso");
  assert.equal(results[0].preco_concorrente, 2.95);
  assert.equal(fixture.counters.logins, 0);
  assert.equal(fixture.counters.cookieClears, 0);
});
