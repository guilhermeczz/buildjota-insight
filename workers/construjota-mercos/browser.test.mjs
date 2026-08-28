import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import {
  createConstrujotaMercosBrowser,
  isConstrujotaMercosSessionValid,
  loginConstrujotaMercos,
  sanitizeMercosDiagnosticHtml,
} from "./browser.mjs";

const fixtureBaseUrl = "https://mercos.fixture";

function loginHtml(valid = true, options = {}) {
  const fields = options.unlabelled
    ? `<input id="email" placeholder="E-mail" type="email" name="email">
       <input id="password" placeholder="Senha" type="password" name="password">
       <button type="button">visibility</button>
       <button type="submit">Entrar</button>`
    : `<label>E-mail<input aria-label="E-mail"></label>
       <label>Senha<input aria-label="Senha" type="password"></label>
       <button type="submit">Entrar</button>`;
  return `<!doctype html><html><body>
    <div id="root"></div>
    <script>
      const mountLogin = () => {
        document.querySelector('#root').innerHTML = ${JSON.stringify(`${fields}<div id="error"></div>`)};
        document.querySelector('button[type="submit"]').addEventListener('click', (event) => {
          event.preventDefault();
          if (${JSON.stringify(valid)}) {
            localStorage.setItem('mercos-fixture-auth', 'ok');
            location.href = '/';
          } else {
            document.querySelector('#error').textContent = 'E-mail ou senha inválidos';
          }
        });
      };
      setTimeout(mountLogin, ${Math.max(0, Number(options.delayMs) || 0)});
    </script>
  </body></html>`;
}

function homeHtml(extra = "") {
  return `<!doctype html><html><body>
    <script>
      if (localStorage.getItem('mercos-fixture-auth') !== 'ok') location.replace('/entrar');
    </script>
    <header>ConstruJota São Paulo</header>
    <input placeholder="Pesquisar em todos os produtos">
    ${extra}
  </body></html>`;
}

function productHtml({ sku = "503", price = "R$ 13,69", extra = "" } = {}) {
  return `<!doctype html><html><body>
    <header>ConstruJota São Paulo</header>
    <section class="ProductPage__productDetails__fixture">
      <h1>VEDALIT 900ML SACHE (06)</h1>
      <div class="ProductInfo__productInfo__fixture">Cód. ${sku} • UN</div>
      <h3 class="AddToCartContainer__price__fixture">${price}</h3>
      <button type="button" onclick="fetch('/carrinho', { method: 'POST' })">COMPRAR</button>
    </section>
    ${extra}
  </body></html>`;
}

function config(authStatePath, overrides = {}) {
  return {
    baseUrl: fixtureBaseUrl,
    login: "fixture@example.invalid",
    password: "fixture-password",
    authStatePath,
    diagnosticsDir: join(tmpdir(), "construjota-mercos-test-diagnostics"),
    navigationTimeoutMs: 5_000,
    signalTimeoutMs: 2_000,
    actionTimeoutMs: 2_000,
    navigationAttempts: 1,
    productIntervalMs: 1_000,
    blockHeavyAssets: false,
    ...overrides,
  };
}

async function installFixtureRoutes(context, options = {}) {
  const counters = options.counters ?? {};
  await context.route(`${fixtureBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      counters.purchaseAttempts = (counters.purchaseAttempts ?? 0) + 1;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    if (url.pathname === "/entrar") {
      counters.loginPages = (counters.loginPages ?? 0) + 1;
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: loginHtml(options.validLogin !== false, {
          unlabelled: options.unlabelledLogin === true,
          delayMs: options.loginFormDelayMs,
        }),
      });
      return;
    }
    if (url.pathname.startsWith("/produtos/")) {
      counters.productPages = (counters.productPages ?? 0) + 1;
      if (options.expireFirstProduct && counters.productPages === 1) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: '<script>localStorage.removeItem("mercos-fixture-auth");location.replace("/entrar")</script>',
        });
        return;
      }
      if (options.expireAsyncFirstProduct && counters.productPages === 1) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!doctype html><html><body><script>
            setTimeout(() => {
              localStorage.removeItem("mercos-fixture-auth");
              location.replace("/entrar");
            }, 30);
          </script></body></html>`,
        });
        return;
      }
      if (options.loseFirstProductUrl && counters.productPages === 1) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: productHtml({ extra: '<script>history.replaceState({}, "", "/")</script>' }),
        });
        return;
      }
      const productId = url.pathname.split("/").filter(Boolean).at(-1);
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: productHtml({ sku: options.productSkuById?.[productId] ?? "503" }),
      });
      return;
    }
    if (url.searchParams.get("busca")) {
      const codes = options.searchCodes ?? ["503", "2503", "5030", "5032", "5033", "5034", "5503"];
      const cards = codes
        .map(
          (code) => `<article class="catalog-item-b2b" onclick="location.href='/produtos/${
            code === "503" ? "237153522" : `9${code}`
          }'">
            <div class="catalog-item-b2b-subtitle">Cód. ${code} • UN</div>
          </article>`,
        )
        .join("");
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: homeHtml(cards),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: homeHtml(),
    });
  });
}

test("logs in with semantic controls, saves state and reuses the authenticated session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mercos-auth-test-"));
  const authStatePath = join(dir, "construjota-mercos.json");
  const counters = { loginAttempts: 0 };

  const first = await createConstrujotaMercosBrowser({
    config: config(authStatePath),
    setupContext: (context) => installFixtureRoutes(context, { counters }),
    onLogin: () => {
      counters.loginAttempts += 1;
    },
  });
  await first.close();
  assert.equal(counters.loginAttempts, 1);
  const savedState = JSON.parse(await readFile(authStatePath, "utf8"));
  assert.ok(savedState.origins.some((origin) => origin.origin === fixtureBaseUrl));

  const second = await createConstrujotaMercosBrowser({
    config: config(authStatePath),
    setupContext: (context) => installFixtureRoutes(context, { counters }),
    onLogin: () => {
      counters.loginAttempts += 1;
    },
  });
  await second.close();
  assert.equal(counters.loginAttempts, 1, "a sessao salva deve evitar um segundo login");
});

test("logs in with current Mercos input markup after asynchronous form rendering", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mercos-current-login-test-"));
  const counters = { loginAttempts: 0 };
  const collector = await createConstrujotaMercosBrowser({
    config: config(join(dir, "state.json"), { signalTimeoutMs: 50 }),
    setupContext: (context) =>
      installFixtureRoutes(context, {
        counters,
        unlabelledLogin: true,
        loginFormDelayMs: 350,
      }),
    onLogin: () => {
      counters.loginAttempts += 1;
    },
  });
  try {
    assert.equal(counters.loginAttempts, 1);
  } finally {
    await collector.close();
  }
});

test("renews an expired session only once and retries the same product safely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mercos-expired-test-"));
  const counters = { purchaseAttempts: 0, loginAttempts: 0 };
  const collector = await createConstrujotaMercosBrowser({
    config: config(join(dir, "state.json")),
    setupContext: (context) =>
      installFixtureRoutes(context, { counters, expireFirstProduct: true }),
    onLogin: () => {
      counters.loginAttempts += 1;
    },
  });
  try {
    const result = await collector.collect({
      id: "fixture-mapping",
      produto_id: "fixture-product",
      sku_site: "503",
      url_produto: `${fixtureBaseUrl}/produtos/237153522`,
      produtos: { sku_interno: "503", preco_atual: 10 },
    });
    assert.equal(result.status, "sucesso");
    assert.equal(result.preco, 13.69);
    assert.equal(counters.loginAttempts, 2, "login inicial mais uma unica renovacao");
    assert.equal(counters.productPages, 2);
    assert.equal(counters.purchaseAttempts, 0, "o coletor jamais aciona COMPRAR/carrinho");
  } finally {
    await collector.close();
  }
});

test("classifies an asynchronous redirect to login as expired session and reauthenticates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mercos-async-expired-test-"));
  const counters = { purchaseAttempts: 0, loginAttempts: 0 };
  const collector = await createConstrujotaMercosBrowser({
    config: config(join(dir, "state.json")),
    setupContext: (context) =>
      installFixtureRoutes(context, { counters, expireAsyncFirstProduct: true }),
    onLogin: () => {
      counters.loginAttempts += 1;
    },
  });
  try {
    const result = await collector.collect({
      id: "fixture-mapping",
      produto_id: "fixture-product",
      sku_site: "503",
      url_produto: `${fixtureBaseUrl}/produtos/237153522`,
      produtos: { sku_interno: "503", preco_atual: 10 },
    });
    assert.equal(result.status, "sucesso");
    assert.equal(result.preco, 13.69);
    assert.equal(counters.loginAttempts, 2);
    assert.equal(counters.purchaseAttempts, 0);
  } finally {
    await collector.close();
  }
});

test("recovers a stale URL or wrong product by searching and confirming the exact SKU", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mercos-stale-url-test-"));
  const counters = { purchaseAttempts: 0 };
  const collector = await createConstrujotaMercosBrowser({
    config: config(join(dir, "state.json")),
    setupContext: (context) =>
      installFixtureRoutes(context, {
        counters,
        productSkuById: { 111111111: "316", 237153522: "503" },
      }),
  });
  try {
    const result = await collector.collect({
      id: "fixture-mapping",
      produto_id: "fixture-product",
      sku_site: "503",
      url_produto: `${fixtureBaseUrl}/produtos/111111111`,
      produtos: { sku_interno: "503", preco_atual: 10 },
    });
    assert.equal(result.status, "sucesso");
    assert.equal(result.sku_observado, "503");
    assert.equal(result.mercos_produto_id, "237153522");
    assert.equal(result.url_descoberta, `${fixtureBaseUrl}/produtos/237153522`);
    assert.equal(counters.productPages, 2);
    assert.equal(counters.purchaseAttempts, 0);
  } finally {
    await collector.close();
  }
});

test("recovers through exact search when the SPA loses the configured detail URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mercos-lost-url-test-"));
  const counters = { purchaseAttempts: 0 };
  const collector = await createConstrujotaMercosBrowser({
    config: config(join(dir, "state.json")),
    setupContext: (context) =>
      installFixtureRoutes(context, { counters, loseFirstProductUrl: true }),
  });
  try {
    const result = await collector.collect({
      id: "fixture-mapping",
      produto_id: "fixture-product",
      sku_site: "503",
      url_produto: `${fixtureBaseUrl}/produtos/111111111`,
      produtos: { sku_interno: "503", preco_atual: 10 },
    });
    assert.equal(result.status, "sucesso");
    assert.equal(result.sku_observado, "503");
    assert.equal(result.mercos_produto_id, "237153522");
    assert.equal(result.url_descoberta, `${fixtureBaseUrl}/produtos/237153522`);
    assert.equal(counters.productPages, 2);
    assert.equal(counters.purchaseAttempts, 0);
  } finally {
    await collector.close();
  }
});

test("discovers the exact 503 card among partial matches and confirms it again in detail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mercos-discovery-test-"));
  const collector = await createConstrujotaMercosBrowser({
    config: config(join(dir, "state.json")),
    setupContext: (context) => installFixtureRoutes(context),
  });
  try {
    const result = await collector.discover({
      id: "fixture-mapping",
      produto_id: "fixture-product",
      sku_site: "503",
      url_produto: "",
      produtos: { sku_interno: "503", preco_atual: 10 },
    });
    assert.equal(result.status, "sucesso");
    assert.equal(result.mercos_produto_id, "237153522");
    assert.equal(result.url_descoberta, `${fixtureBaseUrl}/produtos/237153522`);
  } finally {
    await collector.close();
  }
});

test("fails closed for a missing or duplicated exact SKU search result", async () => {
  for (const [searchCodes, expectedStatus] of [
    [["2503", "5030", "5503"], "nao_encontrado"],
    [["503", "503"], "ambiguo"],
  ]) {
    const dir = await mkdtemp(join(tmpdir(), `mercos-${expectedStatus}-test-`));
    const collector = await createConstrujotaMercosBrowser({
      config: config(join(dir, "state.json")),
      setupContext: (context) => installFixtureRoutes(context, { searchCodes }),
    });
    try {
      const result = await collector.discover({
        id: "fixture-mapping",
        produto_id: "fixture-product",
        sku_site: "503",
        url_produto: "",
        produtos: { sku_interno: "503", preco_atual: 10 },
      });
      assert.equal(result.status, expectedStatus);
      assert.equal(result.preco, null);
    } finally {
      await collector.close();
    }
  }
});

test("rejects invalid credentials without exposing field values", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await installFixtureRoutes(context, { validLogin: false });
  const page = await context.newPage();
  try {
    await assert.rejects(
      loginConstrujotaMercos(page, {
        ...config(join(tmpdir(), "unused-state.json")),
        loginUrl: `${fixtureBaseUrl}/entrar`,
      }),
      /login nao confirmado/,
    );
    assert.equal(await page.getByLabel("E-mail", { exact: true }).inputValue(), "");
    assert.equal(await page.getByLabel("Senha", { exact: true }).inputValue(), "");
    assert.equal(await isConstrujotaMercosSessionValid(page), false);
  } finally {
    await context.close();
    await browser.close();
  }
});

test("sanitizes credentials, tokens and personal data from diagnostic HTML", () => {
  const sanitized = sanitizeMercosDiagnosticHtml(`
    <input value="secret-value">
    <div data-token="private-token">fixture@example.com</div>
    <script>localStorage.setItem('token', 'private')</script>
    password=plain-text
  `);
  assert.doesNotMatch(sanitized, /secret-value|private-token|fixture@example\.com|plain-text/);
  assert.doesNotMatch(sanitized, /localStorage/);
});
