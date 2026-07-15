import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { credentialsFor } from "./config.mjs";
import { extractPrice } from "./extract-price.mjs";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const authStateDir = join(process.cwd(), ".worker-auth");
const blockHeavyAssets = process.env.WORKER_BLOCK_HEAVY_ASSETS !== "false";
const navigationTimeoutMs = envNumber("WORKER_NAVIGATION_TIMEOUT_MS", 18000, 5000, 60000);
const quickLoadTimeoutMs = envNumber("WORKER_QUICK_LOAD_TIMEOUT_MS", 3500, 1000, 15000);
const actionTimeoutMs = envNumber("WORKER_ACTION_TIMEOUT_MS", 5000, 1000, 15000);
const productSignalTimeoutMs = envNumber("WORKER_PRICE_SIGNAL_TIMEOUT_MS", 4500, 1000, 15000);
const productSettleMs = envNumber("WORKER_PRODUCT_SETTLE_MS", 350, 0, 3000);
const loginSettleMs = envNumber("WORKER_LOGIN_SETTLE_MS", 1200, 0, 5000);

function envNumber(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function storageStatePath(concorrenteNome) {
  const fileName = concorrenteNome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return join(authStateDir, `${fileName}.json`);
}

function absoluteUrl(value, fallbackBase) {
  if (!value) return fallbackBase;
  try {
    return new URL(value).toString();
  } catch {
    return new URL(value, fallbackBase).toString();
  }
}

function productUrlForMapping(mapping, concorrente) {
  if (concorrente.nome === "MEGALESTE" && mapping.sku_concorrente) {
    return absoluteUrl(`/c/produto/${mapping.sku_concorrente}`, concorrente.site_url);
  }

  return absoluteUrl(mapping.url_produto, concorrente.site_url);
}

function loginUrlForConcorrente(concorrente) {
  if (concorrente.nome === "MAREST") {
    return absoluteUrl("/login", concorrente.site_url);
  }

  return absoluteUrl(concorrente.login_url || concorrente.site_url, concorrente.site_url);
}

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;

    await locator.fill(value, { timeout: actionTimeoutMs });
    return true;
  }

  return false;
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;

    const clicked = await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs }).catch(() => null),
      locator.click({ timeout: actionTimeoutMs }).then(
        () => true,
        () => false,
      ),
    ]).then((results) => results[1]);

    if (clicked) return true;
  }

  return false;
}

async function login(page, concorrente) {
  const credentials = credentialsFor(concorrente.nome);
  if (!credentials) {
    throw new Error(`Credenciais nao configuradas para ${concorrente.nome}`);
  }

  const loginUrl = loginUrlForConcorrente(concorrente);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  await page.waitForLoadState("load", { timeout: quickLoadTimeoutMs }).catch(() => null);
  await dismissOverlays(page);
  await openLoginSurface(page);
  await page
    .locator("input[type='password'], input[name*='senha' i], input[id*='senha' i]")
    .first()
    .waitFor({ state: "visible", timeout: actionTimeoutMs })
    .catch(() => null);

  const loginFilled = await fillFirstVisible(
    page,
    [
      "input[type='email']",
      "input[name*='email' i]",
      "input[id*='email' i]",
      "input[name*='login' i]",
      "input[id*='login' i]",
      "input[name='user']",
      "input[placeholder*='login' i]",
      "input[placeholder*='Digite seu' i]",
      "input[placeholder*='usuário' i]",
      "input[placeholder*='usuario' i]",
      "input[name*='usuario' i]",
      "input[id*='usuario' i]",
      "input[name*='cnpj' i]",
      "input[id*='cnpj' i]",
      "input[type='text']",
      "input:not([type])",
    ],
    credentials.login,
  );

  const passwordFilled = await fillFirstVisible(
    page,
    [
      "input[type='password']",
      "input[name='pass']",
      "input[placeholder*='senha' i]",
      "input[name*='senha' i]",
      "input[id*='senha' i]",
      "input[name*='password' i]",
      "input[id*='password' i]",
    ],
    credentials.password,
  );

  if (!loginFilled || !passwordFilled) {
    throw new Error(`Formulario de login nao identificado em ${concorrente.nome}`);
  }

  const clicked = await clickFirstVisible(page, [
    "#btn-entrar",
    "form button:has-text('Entrar')",
    ".modal button:has-text('Entrar')",
    "[role='dialog'] button:has-text('Entrar')",
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Entrar')",
    "button:has-text('Entre')",
    "button:has-text('Login')",
    "button:has-text('Acessar')",
    "a:has-text('Entrar')",
    "a:has-text('Entre')",
    "a:has-text('Login')",
    "a:has-text('Acessar')",
  ]);

  if (!clicked) {
    await page.keyboard.press("Enter");
    await page
      .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
      .catch(() => null);
  }

  await page.waitForTimeout(loginSettleMs);

  if (await hasInvalidCredentialsMessage(page)) {
    throw new Error(`Credenciais invalidas em ${concorrente.nome}`);
  }
}

async function openLoginSurface(page) {
  await clickFirstVisible(page, [
    ".menu-user > a",
    "a[role='button'][data-toggle='dropdown'][aria-haspopup='true']",
    "a[data-toggle='dropdown']:has(svg)",
    "#botao-login",
    "button:has-text('Entre ou cadastre-se')",
    "button:has-text('Faça login')",
    "button:has-text('Faca login')",
    "a:has-text('Entre ou cadastre-se')",
    "a:has-text('Faça login')",
    "a:has-text('Faca login')",
    "button:has-text('Entrar')",
    "button:has-text('Entre')",
    "a:has-text('Entrar')",
    "a:has-text('Entre')",
  ]);

  await page.waitForTimeout(500);
}

async function dismissOverlays(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clicked = await clickFirstVisible(page, [
      "button:has-text('Entendi')",
      "#botao-aceitar-todos",
      "button:has-text('Aceitar todos')",
      "button:has-text('Aceitar')",
      "button:has-text('Fechar')",
      ".modal button.btn-close",
      "[aria-label='Close']",
      "[aria-label='Fechar']",
    ]);

    if (!clicked) return;
    await page.waitForTimeout(250);
  }
}

export async function collectPricesByBrowser(groups, options = {}) {
  mkdirSync(authStateDir, { recursive: true });
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency ?? 1)));

  const browser = await chromium.launch({
    headless: !options.headed,
  });

  const resultados = [];

  try {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, groups.length) }, async () => {
      while (nextIndex < groups.length) {
        const group = groups[nextIndex];
        nextIndex += 1;
        resultados.push(...(await collectGroup(browser, group, options)));
      }
    });

    await Promise.all(workers);
  } finally {
    await browser.close();
  }

  return resultados;
}

async function collectGroup(browser, group, options = {}) {
  const statePath = storageStatePath(group.concorrente.nome);
  const context = await browser.newContext({
    userAgent,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    storageState: existsSync(statePath) ? statePath : undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(actionTimeoutMs);
  page.setDefaultNavigationTimeout(navigationTimeoutMs);
  const resultados = [];

  try {
    if (blockHeavyAssets) {
      await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (["image", "font", "media"].includes(resourceType)) {
          void route.abort();
          return;
        }
        void route.continue();
      });
    }

    if (!existsSync(statePath)) {
      await login(page, group.concorrente);
      await context.storageState({ path: statePath });
    }

    console.log(`[${group.concorrente.nome}] Iniciando ${group.mapeamentos.length} mapeamento(s).`);

    for (const [index, mapping] of group.mapeamentos.entries()) {
      const itemStartedAt = Date.now();
      const productLabel = `${mapping.produtos.sku_interno ?? "-"} - ${mapping.produtos.nome ?? "Produto"}`;
      const progressLabel = `[${group.concorrente.nome}] ${index + 1}/${group.mapeamentos.length} ${productLabel}`;

      try {
        if (!mapping.url_produto) {
          throw new Error("URL do produto nao cadastrada");
        }

        await reportProgress(options, `Lendo ${progressLabel}`);
        const productUrl = productUrlForMapping(mapping, group.concorrente);
        await page.goto(productUrl, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeoutMs,
        });
        await waitForProductSignal(page);
        if (productSettleMs > 0) await page.waitForTimeout(productSettleMs);

        if (await shouldRetryLogin(page, mapping, group.concorrente)) {
          rmSync(statePath, { force: true });
          await context.clearCookies().catch(() => null);
          await login(page, group.concorrente);
          await context.storageState({ path: statePath });
          await page.goto(productUrl, {
            waitUntil: "domcontentloaded",
            timeout: navigationTimeoutMs,
          });
          await waitForProductSignal(page);
          if (productSettleMs > 0) await page.waitForTimeout(productSettleMs);
        }

        if (await isLoginRequired(page)) {
          throw new Error("Login nao confirmado; pagina ainda solicita autenticacao");
        }

        if (await isProductUnavailable(page)) {
          throw new Error("Produto indisponivel no concorrente");
        }

        const price = await extractPrice(page, mapping.seletor_preco, {
          referencePrice: Number(mapping.produtos.preco_atual ?? 0),
        });

        if (!price) {
          if (await isProductUnavailable(page)) {
            throw new Error("Produto indisponivel no concorrente");
          }
          throw new Error("Preco nao encontrado na pagina");
        }

        resultados.push({
          mapeamento_id: mapping.id,
          preco_construjota: Number(mapping.produtos.preco_atual ?? 0),
          preco_concorrente: price,
          status: "sucesso",
        });
        console.log(
          `${progressLabel}: sucesso em ${Math.round((Date.now() - itemStartedAt) / 1000)}s.`,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          /Credenciais invalidas/i.test(error.message) &&
          existsSync(statePath)
        ) {
          rmSync(statePath, { force: true });
        }

        resultados.push({
          mapeamento_id: mapping.id,
          preco_construjota: Number(mapping.produtos.preco_atual ?? 0),
          preco_concorrente: null,
          status: "erro",
          mensagem_erro: error instanceof Error ? error.message : "Erro desconhecido",
        });
        console.log(
          `${progressLabel}: erro em ${Math.round((Date.now() - itemStartedAt) / 1000)}s - ${
            error instanceof Error ? error.message : "Erro desconhecido"
          }`,
        );
      }
    }
  } catch (error) {
    if (existsSync(statePath)) {
      rmSync(statePath, { force: true });
    }

    for (const mapping of group.mapeamentos) {
      resultados.push({
        mapeamento_id: mapping.id,
        preco_construjota: Number(mapping.produtos.preco_atual ?? 0),
        preco_concorrente: null,
        status: "erro",
        mensagem_erro: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  } finally {
    await context.close();
  }

  return resultados;
}

async function reportProgress(options, message) {
  if (typeof options.onProgress !== "function") return;
  await options.onProgress(message).catch(() => null);
}

async function waitForProductSignal(page) {
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        return /R\$\s*\d|\d{1,3}(?:\.\d{3})*,\d{2,3}|indisponivel|indisponível|sem estoque|esgotado|login|cadastre-se|preco|preço/i.test(
          text,
        );
      },
      { timeout: productSignalTimeoutMs },
    )
    .catch(() => null);
}

async function isLoginRequired(page) {
  if (await hasVisiblePasswordField(page)) return true;

  const text = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  const normalized = normalizeText(text);

  if (!normalized) return false;
  if (hasPriceLikeText(text)) return false;

  if (
    [
      /faca login/,
      /entre ou cadastre-se/,
      /cadastre-se para ver os precos/,
      /login para ver os precos/,
      /entre para ver os precos/,
      /acesse sua conta para ver os precos/,
      /preco disponivel apenas para clientes/,
      /para visualizar os precos/,
      /voce precisa estar logado/,
    ].some((pattern) => pattern.test(normalized))
  ) {
    return true;
  }

  return /fa[cç]a login|cadastre-se para ver os pre[cç]os/i.test(text);
}

async function isProductUnavailable(page) {
  const text = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  const normalized = normalizeText(text);

  if (
    /produto\s+indisponivel|item\s+indisponivel|indisponivel\s+no\s+momento|sem\s+estoque|produto\s+esgotado|avise-?me\s+quando\s+chegar/.test(
      normalized,
    )
  ) {
    return true;
  }

  const unavailableControls = await page
    .locator(
      [
        "button:disabled:has-text('Comprar')",
        "button:disabled:has-text('Adicionar')",
        "button:disabled:has-text('Carrinho')",
        "[aria-disabled='true']:has-text('Comprar')",
        "[aria-disabled='true']:has-text('Adicionar')",
        "[class*='indisponivel' i]",
        "[class*='unavailable' i]",
        "[class*='out-of-stock' i]",
      ].join(", "),
    )
    .count()
    .catch(() => 0);

  return unavailableControls > 0;
}

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasPriceLikeText(value) {
  return /R\$\s*\d|\d{1,3}(?:\.\d{3})*,\d{2,3}/.test(value);
}

async function hasVisiblePasswordField(page) {
  const fields = page.locator(
    "input[type='password'], input[name*='senha' i], input[id*='senha' i], input[name*='password' i], input[id*='password' i]",
  );
  const count = await fields.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    const visible = await field.isVisible().catch(() => false);
    if (visible) return true;
  }

  return false;
}

async function hasInvalidCredentialsMessage(page) {
  const text = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");

  return /n[aã]o foi poss[ií]vel localizar seu cadastro|login e\/ou senha|senha inv[aá]lida|login inv[aá]lido/i.test(
    text,
  );
}

async function shouldRetryLogin(page, mapping, concorrente) {
  if (await isLoginRequired(page)) return true;

  if (concorrente.nome === "MEGALESTE") {
    const path = new URL(page.url()).pathname.replace(/\/+$/, "");
    if (path === "/sp" || path === "") return true;

    const text = await page
      .locator("body")
      .innerText({ timeout: 5000 })
      .catch(() => "");
    if (mapping.sku_concorrente && !text.includes(mapping.sku_concorrente)) return true;
  }

  return false;
}
