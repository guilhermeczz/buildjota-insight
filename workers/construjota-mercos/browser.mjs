import { existsSync } from "node:fs";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { chromium } from "playwright";

import { construjotaMercosConfig, construjotaMercosCredentials } from "./config.mjs";
import {
  construjotaMercosSelectors,
  inspectConstrujotaMercosProduct,
  isConfirmedConstrujotaMercosResult,
  mercosProductIdFromUrl,
  normalizeSku,
  subtitleMatchesExactSku,
  waitForMercosProductSignal,
} from "./extract.mjs";

class SessionExpiredError extends Error {
  constructor() {
    super("CONSTRUJOTA_MERCOS: sessao expirada");
    this.name = "SessionExpiredError";
  }
}

function loginPath(value) {
  try {
    return new URL(value).pathname.replace(/\/+$/, "") === "/entrar";
  } catch {
    return false;
  }
}

function canonicalProductUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    if (url.origin !== new URL(baseUrl).origin) return "";
    if (!mercosProductIdFromUrl(url.toString())) return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

async function firstVisible(locator) {
  for (let index = 0; index < (await locator.count()); index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

async function firstVisibleCandidate(candidates) {
  for (const candidate of candidates) {
    const visible = await firstVisible(candidate).catch(() => null);
    if (visible) return visible;
  }
  return null;
}

function loginControlCandidates(page) {
  return {
    email: [
      // Keep the documented semantic selectors as the primary contract. The current
      // Mercos markup does not associate its visible text with the inputs, so the
      // narrowly scoped input fallbacks below are required in production.
      page.getByLabel("E-mail", { exact: true }),
      page.getByLabel(/^e-?mail\s*\*?$/i),
      page.locator('input[type="email"]'),
      page.locator('input[name="email" i]'),
      page.locator('input[id="email" i]'),
      page.getByPlaceholder(/^e-?mail\s*\*?$/i),
    ],
    password: [
      page.getByLabel("Senha", { exact: true }),
      page.getByLabel(/^senha\s*\*?$/i),
      page.locator('input[type="password"]'),
      page.locator('input[name="password" i]'),
      page.locator('input[id="password" i]'),
      page.getByPlaceholder(/^senha\s*\*?$/i),
    ],
    submit: [
      page.getByRole("button", { name: "Entrar", exact: true }),
      page.getByRole("button", { name: /^entrar$/i }),
      page.locator('button[type="submit"]'),
      page.locator('input[type="submit"]'),
    ],
  };
}

async function findVisibleLoginControls(page, timeoutMs) {
  const candidates = loginControlCandidates(page);
  const deadline = Date.now() + Math.max(1_000, Number(timeoutMs) || 0);

  do {
    const [email, password, submit] = await Promise.all([
      firstVisibleCandidate(candidates.email),
      firstVisibleCandidate(candidates.password),
      firstVisibleCandidate(candidates.submit),
    ]);
    if (email && password && submit) return { email, password, submit };

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await page.waitForTimeout(Math.min(250, remainingMs));
  } while (Date.now() < deadline);

  return null;
}

async function openLoginForm(page, config) {
  const formTimeoutMs = Math.max(Number(config.signalTimeoutMs) || 0, 30_000);
  let lastNavigationError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(config.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs,
      });
    } catch (error) {
      lastNavigationError = error;
    }

    // A navigation timeout does not necessarily mean the SPA failed. Its app shell
    // may already be usable while a slow third-party resource is still pending.
    const controls = await findVisibleLoginControls(page, formTimeoutMs);
    if (controls) return controls;

    if (attempt < 2) await page.waitForTimeout(750);
  }

  throw new Error(
    `CONSTRUJOTA_MERCOS: formulario de login nao carregou${
      lastNavigationError ? " apos falha de navegacao" : ""
    }`,
  );
}

async function hasInvalidCredentialMessage(page) {
  return Boolean(
    await firstVisible(
      page.getByText(/credenciais? inv[aá]lid|e-mail ou senha inv[aá]lid|senha incorreta/i),
    ),
  );
}

async function authenticatedHeaderVisible(page) {
  return Boolean(
    await firstVisible(
      page.locator(
        'header, [class*="Header__"], [class*="headerContainer__"], [class*="CompanyHeader__"]',
      ),
    ),
  );
}

export async function isConstrujotaMercosSessionValid(page) {
  if (loginPath(page.url()) || (await hasInvalidCredentialMessage(page))) return false;
  const search = await firstVisible(page.locator(construjotaMercosSelectors.search));
  return Boolean(search && (await authenticatedHeaderVisible(page)));
}

async function waitForAuthenticatedHome(page, timeoutMs) {
  try {
    await page.waitForFunction(
      ({ searchSelector }) => {
        const path = location.pathname.replace(/\/+$/, "");
        if (path === "/entrar") return false;
        const search = document.querySelector(searchSelector);
        const header = document.querySelector(
          'header, [class*="Header__"], [class*="headerContainer__"], [class*="CompanyHeader__"]',
        );
        if (!search || !header) return false;
        const visible = (element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none" && box.width > 0;
        };
        return visible(search) && visible(header);
      },
      { searchSelector: construjotaMercosSelectors.search },
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

export async function loginConstrujotaMercos(page, config = construjotaMercosConfig()) {
  const credentials = construjotaMercosCredentials(config);
  const { email, password, submit } = await openLoginForm(page, config);

  try {
    await email.fill(credentials.login);
    await password.fill(credentials.password);
    await submit.click();
  } catch {
    await email.fill("").catch(() => {});
    await password.fill("").catch(() => {});
    throw new Error("CONSTRUJOTA_MERCOS: nao foi possivel enviar o formulario de login");
  }

  const confirmed = await waitForAuthenticatedHome(page, config.navigationTimeoutMs);
  if (!confirmed || (await hasInvalidCredentialMessage(page))) {
    await email.fill("").catch(() => {});
    await password.fill("").catch(() => {});
    throw new Error("CONSTRUJOTA_MERCOS: login nao confirmado");
  }
  return true;
}

async function gotoWithSignals(page, url, config, productDetail = false) {
  let lastError = null;
  for (let attempt = 1; attempt <= config.navigationAttempts; attempt += 1) {
    try {
      const apiSignal = page
        .waitForResponse(
          (response) =>
            response.request().method() === "GET" &&
            response.url().includes("/api_b2b/v1/produtos") &&
            response.status() < 500,
          { timeout: config.signalTimeoutMs },
        )
        .catch(() => null);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs,
      });
      if (loginPath(page.url())) throw new SessionExpiredError();
      if (productDetail) {
        const signaled = await waitForMercosProductSignal(page, config.signalTimeoutMs);
        if (!signaled) throw new Error("pagina de produto nao terminou de carregar");
      } else {
        await Promise.race([
          apiSignal,
          page
            .locator(construjotaMercosSelectors.catalogCard)
            .first()
            .waitFor({ state: "attached", timeout: config.signalTimeoutMs })
            .catch(() => null),
        ]);
      }
      return;
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      lastError = error;
      if (attempt < config.navigationAttempts) {
        await page.waitForTimeout(Math.min(2_000, 400 * attempt));
      }
    }
  }
  throw new Error(
    `CONSTRUJOTA_MERCOS: falha ao abrir pagina apos ${config.navigationAttempts} tentativa(s): ${lastError instanceof Error ? lastError.message : "erro de navegacao"}`,
  );
}

async function findExactCatalogCard(page, sku, timeoutMs) {
  const cards = page.locator(construjotaMercosSelectors.catalogCard);
  await cards
    .first()
    .waitFor({ state: "attached", timeout: timeoutMs })
    .catch(() => {});
  const matches = [];
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    if (!(await card.isVisible().catch(() => false))) continue;
    const subtitle = await firstVisible(card.locator(construjotaMercosSelectors.catalogSubtitle));
    if (!subtitle) continue;
    const text = await subtitle.innerText().catch(() => "");
    if (subtitleMatchesExactSku(text, sku)) matches.push(card);
  }
  return matches;
}

async function discoverProductPage(page, sku, config) {
  const searchUrl = `${config.baseUrl}/?busca=${encodeURIComponent(sku)}`;
  await gotoWithSignals(page, searchUrl, config, false);
  if (loginPath(page.url())) throw new SessionExpiredError();

  const matches = await findExactCatalogCard(page, sku, config.signalTimeoutMs);
  if (matches.length === 0) {
    return {
      status: "nao_encontrado",
      preco: null,
      mensagem: `CONSTRUJOTA_MERCOS: produto nao encontrado para o SKU exato ${sku}`,
      sku,
      url_produto: null,
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguo",
      preco: null,
      mensagem: `CONSTRUJOTA_MERCOS: mais de um cartao corresponde ao SKU exato ${sku}`,
      sku,
      url_produto: null,
    };
  }

  await matches[0].evaluate((element) => element.click());
  try {
    await page.waitForURL(/\/produtos\/\d+\/?(?:[?#].*)?$/, {
      timeout: config.navigationTimeoutMs,
    });
  } catch {
    if (loginPath(page.url())) throw new SessionExpiredError();
    return {
      status: "erro",
      preco: null,
      mensagem: "CONSTRUJOTA_MERCOS: cartao exato nao abriu a pagina de detalhe",
      sku,
      url_produto: page.url(),
    };
  }
  if (loginPath(page.url())) throw new SessionExpiredError();
  const signaled = await waitForMercosProductSignal(page, config.signalTimeoutMs);
  if (!signaled) {
    await gotoWithSignals(page, page.url(), config, true);
  }
  return { status: "detalhe", sku, url_produto: page.url() };
}

async function sanitizePageForDiagnostics(page) {
  await page
    .evaluate(() => {
      for (const input of document.querySelectorAll("input, textarea")) {
        input.value = "";
        input.textContent = "";
        input.removeAttribute("value");
        input.setAttribute("data-sanitized", "true");
      }
      for (const element of document.querySelectorAll(
        'header, nav, [class*="Customer"], [class*="customer"], [class*="User"], [class*="user"]',
      )) {
        element.style.visibility = "hidden";
      }
    })
    .catch(() => {});
}

export function sanitizeMercosDiagnosticHtml(html) {
  return String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\b(value|data-token|authorization|cookie)=(['"])[\s\S]*?\2/gi, '$1="[REMOVIDO]"')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[EMAIL REMOVIDO]")
    .replace(/(senha|password)(\s*[:=]\s*)[^<\s"']+/gi, "$1$2[REMOVIDO]");
}

async function saveFailureDiagnostic(page, mapping, config, status) {
  if (loginPath(page.url())) return null;
  const diagnosticDir = join(config.diagnosticsDir, "construjota-mercos");
  await mkdir(diagnosticDir, { recursive: true });
  await sanitizePageForDiagnostics(page);
  const safeSku = normalizeSku(mapping?.sku_site || mapping?.produtos?.sku_interno || "produto")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `${timestamp}-${safeSku}-${String(status || "erro").replace(/[^a-z0-9_-]/gi, "_")}`;
  const htmlPath = join(diagnosticDir, `${prefix}.html`);
  const screenshotPath = join(diagnosticDir, `${prefix}.png`);
  const html = sanitizeMercosDiagnosticHtml(await page.content().catch(() => ""));
  await writeFile(htmlPath, html, "utf8");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  return { html: basename(htmlPath), screenshot: basename(screenshotPath) };
}

async function newAuthenticatedContext(browser, config) {
  const options = {
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1440, height: 1000 },
  };
  if (existsSync(config.authStatePath)) options.storageState = config.authStatePath;
  let context;
  try {
    context = await browser.newContext(options);
  } catch {
    await unlink(config.authStatePath).catch(() => {});
    delete options.storageState;
    context = await browser.newContext(options);
  }
  if (config.blockHeavyAssets) {
    await context.route(/\.(?:png|jpe?g|gif|webp|svg|woff2?|ttf)(?:\?.*)?$/i, (route) =>
      route.abort(),
    );
  }
  return context;
}

export async function createConstrujotaMercosBrowser(options = {}) {
  const config = construjotaMercosConfig(options.config);
  await mkdir(dirname(config.authStatePath), { recursive: true });
  const browser = await chromium.launch({ headless: options.headed !== true });
  const context = await newAuthenticatedContext(browser, config);
  if (typeof options.setupContext === "function") await options.setupContext(context);
  const page = await context.newPage();
  page.setDefaultTimeout(config.actionTimeoutMs);
  let reauthenticationUsed = false;

  async function authenticate(force = false) {
    if (force) {
      await context.clearCookies();
      await page
        .goto(config.baseUrl, {
          waitUntil: "domcontentloaded",
          timeout: config.navigationTimeoutMs,
        })
        .catch(() => {});
      await page.evaluate(() => localStorage.clear()).catch(() => {});
    } else {
      await page.goto(config.baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs,
      });
      if (!loginPath(page.url())) {
        await waitForAuthenticatedHome(page, config.signalTimeoutMs).catch(() => false);
      }
      if (await isConstrujotaMercosSessionValid(page)) return;
    }
    options.onLogin?.({ reauthentication: force });
    await loginConstrujotaMercos(page, config);
    await context.storageState({ path: config.authStatePath, indexedDB: true });
    await chmod(config.authStatePath, 0o600).catch(() => {});
    if (!(await isConstrujotaMercosSessionValid(page))) {
      throw new Error("CONSTRUJOTA_MERCOS: sessao autenticada nao foi validada");
    }
  }

  await authenticate(false);

  async function openAndInspect(mapping) {
    const sku = normalizeSku(mapping.sku_site || mapping.produtos?.sku_interno);
    const directUrl = canonicalProductUrl(mapping.url_produto, config.baseUrl);
    let discovery = null;
    if (directUrl) {
      await gotoWithSignals(page, directUrl, config, true);
    } else {
      discovery = await discoverProductPage(page, sku, config);
      if (discovery.status !== "detalhe") return discovery;
    }
    const result = await inspectConstrujotaMercosProduct(page, sku, {
      waitTimeoutMs: config.signalTimeoutMs,
      hasPreviousPrice: Number(mapping.ultimo_preco) > 0 && Boolean(mapping.ultimo_sucesso_em),
    });
    if (result.status === "sessao_expirada") throw new SessionExpiredError();
    return {
      ...result,
      url_descoberta: !directUrl && result.url_produto ? result.url_produto : null,
    };
  }

  async function collect(mapping) {
    let result;
    try {
      result = await openAndInspect(mapping);
    } catch (error) {
      if (error instanceof SessionExpiredError && !reauthenticationUsed) {
        reauthenticationUsed = true;
        try {
          await authenticate(true);
          result = await openAndInspect(mapping);
        } catch (retryError) {
          result = {
            status: "erro",
            preco: null,
            mensagem:
              retryError instanceof Error
                ? retryError.message
                : "CONSTRUJOTA_MERCOS: falha apos renovar a sessao",
            sku: normalizeSku(mapping.sku_site || mapping.produtos?.sku_interno),
            url_produto: page.url(),
          };
        }
      } else {
        result = {
          status: "erro",
          preco: null,
          mensagem: error instanceof Error ? error.message : "CONSTRUJOTA_MERCOS: falha inesperada",
          sku: normalizeSku(mapping.sku_site || mapping.produtos?.sku_interno),
          url_produto: page.url(),
        };
      }
    }
    if (
      !isConfirmedConstrujotaMercosResult(result) &&
      result.status !== "indisponivel" &&
      result.status !== "indisponivel_sem_historico"
    ) {
      result.diagnostico = await saveFailureDiagnostic(page, mapping, config, result.status).catch(
        () => null,
      );
    }
    return {
      ...result,
      mapeamento_id: mapping.id ?? null,
      produto_id: mapping.produto_id ?? mapping.produtos?.id ?? null,
    };
  }

  return {
    config,
    collect,
    discover: collect,
    async waitBetweenProducts(intervalMs = config.productIntervalMs) {
      await page.waitForTimeout(Math.max(1_000, Number(intervalMs) || config.productIntervalMs));
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

export async function collectConstrujotaMercosMappings(mappings, options = {}) {
  const collector = await createConstrujotaMercosBrowser(options);
  const results = [];
  try {
    for (let index = 0; index < mappings.length; index += 1) {
      const mapping = mappings[index];
      const sku = normalizeSku(mapping.sku_site || mapping.produtos?.sku_interno);
      options.onProgress?.(
        `CONSTRUJOTA_MERCOS ${index + 1}/${mappings.length}: consultando SKU ${sku}.`,
      );
      const result = await collector.collect(mapping);
      results.push(result);
      const priceLabel = result.status === "sucesso" ? `; preco=${result.preco}` : "";
      console.log(
        `[CONSTRUJOTA_MERCOS] ${index + 1}/${mappings.length} SKU ${sku}: ${result.status}${priceLabel}.`,
      );
      if (index < mappings.length - 1) {
        await collector.waitBetweenProducts(options.productIntervalMs);
      }
    }
  } finally {
    await collector.close();
  }
  return results;
}
