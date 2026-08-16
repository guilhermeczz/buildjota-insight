import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { credentialsFor, resolveConcorrenteKey } from "./config.mjs";
import {
  inspectCofemaPrice,
  inspectConstrujaPrice,
  inspectMarestPrice,
  inspectMegalestePrice,
  isConfirmedPriceEvidence,
  persistenceFieldsForPriceEvidence,
} from "./extract-price.mjs";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const authStateDir = join(process.cwd(), ".worker-auth");
const diagnosticsDir = join(process.cwd(), ".worker-diagnostics");
const blockHeavyAssets = process.env.WORKER_BLOCK_HEAVY_ASSETS !== "false";
const navigationTimeoutMs = envNumber("WORKER_NAVIGATION_TIMEOUT_MS", 18000, 5000, 60000);
const construjaNavigationTimeoutMs = envNumber(
  "WORKER_CONSTRUJA_NAVIGATION_TIMEOUT_MS",
  45000,
  15000,
  90000,
);
const construjaNavigationAttempts = envNumber("WORKER_CONSTRUJA_NAVIGATION_ATTEMPTS", 3, 1, 5);
const construjaPriceSignalTimeoutMs = envNumber(
  "WORKER_CONSTRUJA_PRICE_SIGNAL_TIMEOUT_MS",
  12000,
  3000,
  30000,
);
const quickLoadTimeoutMs = envNumber("WORKER_QUICK_LOAD_TIMEOUT_MS", 3500, 1000, 15000);
const actionTimeoutMs = envNumber("WORKER_ACTION_TIMEOUT_MS", 5000, 1000, 15000);
const productSignalTimeoutMs = envNumber("WORKER_PRICE_SIGNAL_TIMEOUT_MS", 4500, 1000, 15000);
const productSettleMs = envNumber("WORKER_PRODUCT_SETTLE_MS", 350, 0, 3000);
const loginSettleMs = envNumber("WORKER_LOGIN_SETTLE_MS", 1200, 0, 5000);
const cofemaBaseUrl = process.env.COFEMA_BASE_URL ?? "https://novo.cofema.com.br";
const cofemaLoginUrl = process.env.COFEMA_LOGIN_URL ?? "/";
const cofemaUnidade = String(process.env.COFEMA_UNIDADE ?? "").trim();
const marestRegiao = process.env.MAREST_REGIAO ?? "SP";
const megalesteRegiao = process.env.MEGALESTE_REGIAO ?? "SP";

function envNumber(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function cofemaUserAgentForBrowser(browser) {
  const major = String(browser.version()).match(/^\d+/)?.[0] ?? "149";
  return (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    `(KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
  );
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

async function clearBrowserAuthState(context, page) {
  await context.clearCookies().catch(() => null);
  await page
    .evaluate(() => {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    })
    .catch(() => null);
}

async function resetAuthState(context, page, statePath, concorrente, reason) {
  rmSync(statePath, { force: true });
  await clearBrowserAuthState(context, page);
  console.log(`[${concorrente.nome}] Sessao local limpa (${reason}).`);
}

async function prepareAuthenticatedSession(context, page, statePath, concorrente) {
  const maximumAttempts = isConstruja(concorrente) ? 3 : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await login(page, concorrente);
      await ensurePreferencesForRead(page, concorrente);
      await context.storageState({ path: statePath });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maximumAttempts || hasInvalidCredentialsError(error)) throw error;

      console.log(
        `[${concorrente.nome}] Preparacao da sessao falhou; ` +
          `nova tentativa automatica (${attempt + 1}/${maximumAttempts}).`,
      );
      await page.waitForTimeout(attempt * 1500);
    }
  }

  throw lastError ?? new Error(`Sessao nao preparada em ${concorrente.nome}`);
}

function hasInvalidCredentialsError(error) {
  return (
    error instanceof Error && /Credenciais invalidas|credenciais recusadas/i.test(error.message)
  );
}

function isAuthStateError(error) {
  if (!(error instanceof Error)) return false;

  return /Credenciais invalidas|credenciais recusadas|Credenciais nao configuradas|formulario de login|Login nao confirmado|menu Area do Cliente|unidade configurada|Configuracao de unidade|Regiao .* nao selecionada/i.test(
    error.message,
  );
}

function isCofema(concorrente) {
  return resolveConcorrenteKey(concorrente.nome) === "COFEMA";
}

function isConstruja(concorrente) {
  return resolveConcorrenteKey(concorrente.nome) === "CONSTRUJA";
}

function isMarest(concorrente) {
  return resolveConcorrenteKey(concorrente.nome) === "MAREST";
}

function isMegaleste(concorrente) {
  return resolveConcorrenteKey(concorrente.nome) === "MEGALESTE";
}

function consultaTipo(concorrente) {
  return String(concorrente.tipo_consulta ?? "URL")
    .trim()
    .toUpperCase();
}

function usesSearchFlow(concorrente) {
  return ["BUSCA", "SKU"].includes(consultaTipo(concorrente));
}

function hasUsableProductUrl(mapping) {
  const value = String(mapping.url_produto ?? "").trim();
  return Boolean(value) && !/^TODO(?:_|\b)/i.test(value);
}

function shouldOpenDirectProductUrl(mapping, concorrente) {
  if (isCofema(concorrente)) return isNewCofemaProductUrl(mapping.url_produto);
  if (isMegaleste(concorrente)) return false;
  if (!hasUsableProductUrl(mapping)) return false;
  return isConstruja(concorrente) || !usesSearchFlow(concorrente);
}

function absoluteUrl(value, fallbackBase) {
  if (!value) return fallbackBase;
  try {
    return new URL(value).toString();
  } catch {
    return new URL(value, fallbackBase).toString();
  }
}

function cofemaUrl(value = "/") {
  const base = new URL(cofemaBaseUrl);

  try {
    const url = new URL(value || "/", base);
    return url.origin === base.origin ? url.toString() : new URL("/", base).toString();
  } catch {
    return new URL("/", base).toString();
  }
}

function isNewCofemaProductUrl(value) {
  if (!value || /^TODO(?:_|\b)/i.test(String(value).trim())) return false;

  try {
    const url = new URL(value, cofemaBaseUrl);
    const base = new URL(cofemaBaseUrl);
    return (
      url.origin === base.origin && /^\/(?:[a-z]{2}\/)?page\/produto\/[^/]+/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function construjaUrl(value, concorrente) {
  const canonicalBase = concorrente.site_url || concorrente.login_url;
  const url = new URL(value || canonicalBase, canonicalBase);

  // Cookies and web storage are origin-scoped. Keep login, search and product pages on the
  // exact same Construja origin even when a saved URL uses a different www/protocol variant.
  if (/^(?:www\.)?construja\.com\.br$/i.test(url.hostname) && canonicalBase) {
    const canonical = new URL(canonicalBase);
    url.protocol = canonical.protocol;
    url.hostname = canonical.hostname;
    url.port = canonical.port;
  }

  return url.toString();
}

function productUrlForMapping(mapping, concorrente) {
  if (isCofema(concorrente)) {
    return cofemaUrl(mapping.url_produto || concorrente.site_url);
  }

  if (isConstruja(concorrente)) {
    return construjaUrl(mapping.url_produto || concorrente.site_url, concorrente);
  }

  if (isMegaleste(concorrente) && mapping.sku_concorrente) {
    return absoluteUrl(`/c/produto/${mapping.sku_concorrente}`, concorrente.site_url);
  }

  return absoluteUrl(mapping.url_produto, concorrente.site_url);
}

function loginUrlForConcorrente(concorrente) {
  if (isCofema(concorrente)) {
    return cofemaUrl(cofemaLoginUrl);
  }

  if (isMarest(concorrente)) {
    return absoluteUrl("/login", concorrente.site_url);
  }

  if (isMegaleste(concorrente)) {
    return absoluteUrl("/sp", concorrente.site_url);
  }

  if (isConstruja(concorrente)) {
    return construjaUrl(concorrente.login_url || concorrente.site_url, concorrente);
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

  if (isCofema(concorrente)) {
    await loginCofema(page, concorrente, credentials);
    return;
  }

  if (isConstruja(concorrente)) {
    await loginConstruja(page, concorrente, credentials);
    return;
  }

  if (isMarest(concorrente)) {
    await loginMarest(page, concorrente, credentials);
    return;
  }

  if (isMegaleste(concorrente)) {
    await loginMegaleste(page, concorrente, credentials);
    return;
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

async function loginConstruja(page, concorrente, credentials) {
  const loginUrl = loginUrlForConcorrente(concorrente);

  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  await page.waitForLoadState("load", { timeout: quickLoadTimeoutMs }).catch(() => null);
  await dismissOverlays(page);
  await page.waitForTimeout(800);

  if (await isConstrujaLoggedIn(page)) {
    console.log("[CONSTRUJA] Sessao existente reutilizada.");
    return;
  }

  const opened = await openConstrujaLoginModal(page);
  if (!opened) {
    throw new Error("Formulario de login da CONSTRUJA nao abriu");
  }

  const loginFilled = await fillFirstVisible(
    page,
    [
      "[role='dialog'] input[placeholder*='CNPJ' i]",
      "[role='dialog'] input[placeholder*='CPF' i]",
      "[role='dialog'] input[placeholder*='e-mail' i]",
      "[role='dialog'] input[placeholder*='email' i]",
      ".modal input[placeholder*='CNPJ' i]",
      ".modal input[placeholder*='CPF' i]",
      ".modal input[placeholder*='e-mail' i]",
      ".modal input[placeholder*='email' i]",
      "input[placeholder*='CNPJ' i]",
      "input[placeholder*='CPF' i]",
      "input[placeholder*='e-mail' i]",
      "input[placeholder*='email' i]",
      "input[type='email']",
      "input[name*='email' i]",
      "input[id*='email' i]",
      "input[name*='login' i]",
      "input[id*='login' i]",
      "input[name*='cnpj' i]",
      "input[id*='cnpj' i]",
      "input[type='text']",
    ],
    credentials.login,
  );

  const passwordFilled = await fillFirstVisible(
    page,
    [
      "[role='dialog'] input[type='password']",
      ".modal input[type='password']",
      "input[type='password']",
      "input[placeholder*='senha' i]",
      "input[name*='senha' i]",
      "input[id*='senha' i]",
      "input[name*='password' i]",
      "input[id*='password' i]",
    ],
    credentials.password,
  );

  if (!loginFilled || !passwordFilled) {
    throw new Error("Campos de login da CONSTRUJA nao foram identificados");
  }

  const clicked = await clickFirstVisible(page, [
    "[role='dialog'] button:has-text('Entrar')",
    ".modal button:has-text('Entrar')",
    "form button:has-text('Entrar')",
    "button[type='submit']:has-text('Entrar')",
    "button:has-text('Entrar')",
    "input[type='submit']",
  ]);

  if (!clicked) {
    await page.keyboard.press("Enter");
  }

  const logged = await waitForConstrujaLogin(page);
  if (await hasInvalidCredentialsMessage(page)) {
    throw new Error("Credenciais invalidas em CONSTRUJA");
  }
  if (!logged) {
    throw new Error("Login nao confirmado em CONSTRUJA");
  }

  await page.waitForLoadState("networkidle", { timeout: quickLoadTimeoutMs }).catch(() => null);
  await page.waitForTimeout(750);
  await dismissOverlays(page);
  console.log(`[CONSTRUJA] Sessao autenticada em ${new URL(page.url()).origin}.`);
}

async function openConstrujaLoginModal(page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await dismissOverlays(page);
    if (await isConstrujaLoginFormVisible(page)) return true;

    const clicked = await clickFirstVisible(page, [
      "button:has-text('Entre ou cadastre')",
      "a:has-text('Entre ou cadastre')",
      "[role='button']:has-text('Entre ou cadastre')",
      "button:has-text('Entre ou cadastre-se')",
      "button:has-text('Entre ou Cadastre-se')",
      "a:has-text('Entre ou cadastre-se')",
      "a:has-text('Entre ou Cadastre-se')",
      "[role='button']:has-text('Entre ou cadastre-se')",
      "[role='button']:has-text('Entre ou Cadastre-se')",
      "button:has-text('Área do cliente')",
      "button:has-text('Area do cliente')",
      "a:has-text('Área do cliente')",
      "a:has-text('Area do cliente')",
    ]);

    if (!clicked) await clickConstrujaLoginByDom(page);

    const visible = await waitForConstrujaLoginForm(page);
    if (visible) return true;
    if (!clicked && attempt === 2) {
      await page
        .reload({ waitUntil: "domcontentloaded", timeout: navigationTimeoutMs })
        .catch(() => null);
    }
    await page.waitForTimeout(800);
  }

  return false;
}

async function clickConstrujaLoginByDom(page) {
  return page
    .evaluate(() => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const target = [...document.querySelectorAll("button, a, [role='button']")].find(
        (node) =>
          node instanceof HTMLElement &&
          visible(node) &&
          /entre ou cadastre|area do cliente|entrar/.test(
            normalize(node.innerText || node.textContent),
          ),
      );
      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    })
    .catch(() => false);
}

async function isConstrujaLoginFormVisible(page) {
  const passwordVisible = await page
    .locator(
      [
        "[role='dialog'] input[type='password']",
        ".modal input[type='password']",
        "input[type='password']",
      ].join(", "),
    )
    .first()
    .isVisible()
    .catch(() => false);

  if (!passwordVisible) return false;

  return (
    (await pageHasText(page, [
      /cnpj\/cpf ou e-mail/,
      /cnpj\/cpf ou email/,
      /sou cliente mas ainda nao tenho acesso/,
      /ainda nao sou cliente/,
    ])) || passwordVisible
  );
}

async function waitForConstrujaLoginForm(page) {
  return page
    .locator(
      [
        "[role='dialog'] input[type='password']",
        ".modal input[type='password']",
        "input[type='password']",
      ].join(", "),
    )
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
}

async function waitForConstrujaLogin(page) {
  let closedFormChecks = 0;

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await page
      .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
      .catch(() => null);

    if (await isConstrujaLoggedIn(page)) return true;

    if (await hasInvalidCredentialsMessage(page)) return false;

    const formVisible = await isConstrujaLoginFormVisible(page);
    const text = await page
      .locator("body")
      .innerText({ timeout: 2500 })
      .catch(() => "");
    const stillLoggedOut = /entre ou cadastre-se|entrar ou cadastrar-se/.test(normalizeText(text));

    // This check runs only after the credentials were submitted. Some Construja pages do not
    // expose account labels, but a successful login consistently closes the modal and removes
    // the logged-out action. Require two stable checks to avoid racing the header render.
    if (!formVisible && !stillLoggedOut) {
      closedFormChecks += 1;
      if (closedFormChecks >= 2) return true;
    } else {
      closedFormChecks = 0;
    }

    await page.waitForTimeout(750);
  }

  return false;
}

async function isConstrujaLoggedIn(page) {
  const text = await page
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return !(await isConstrujaLoggedOut(page));
}

async function isConstrujaLoggedOut(page) {
  if (await isConstrujaLoginFormVisible(page)) return true;

  const triggers = page.locator(
    [
      "button:has-text('Entre ou cadastre')",
      "a:has-text('Entre ou cadastre')",
      "[role='button']:has-text('Entre ou cadastre')",
      "button:has-text('Cadastre-se para ver')",
      "a:has-text('Cadastre-se para ver')",
      "[role='button']:has-text('Cadastre-se para ver')",
    ].join(", "),
  );
  const count = await triggers.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    if (
      await triggers
        .nth(index)
        .isVisible()
        .catch(() => false)
    )
      return true;
  }

  const text = await page
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  return /entre ou cadastre(?:-se)?|cadastre-se para ver (?:o )?preco|entre para ver (?:o )?preco/.test(
    normalizeText(text),
  );
}

async function loginMarest(page, concorrente, credentials) {
  const loginUrl = loginUrlForConcorrente(concorrente);

  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  await page.waitForLoadState("load", { timeout: quickLoadTimeoutMs }).catch(() => null);
  await dismissOverlays(page);

  if (await isMarestLoggedIn(page)) {
    await goToMarestHome(page, concorrente);
    return;
  }

  const formVisible = await waitForMarestLoginForm(page);
  if (!formVisible) {
    throw new Error("Formulario de login da MAREST nao abriu");
  }

  const loginFilled = await fillFirstVisible(
    page,
    [
      "input[placeholder*='usuario' i]",
      "input[placeholder*='usuário' i]",
      "input[name*='usuario' i]",
      "input[id*='usuario' i]",
      "input[name*='email' i]",
      "input[id*='email' i]",
      "input[type='email']",
      "input[type='text']",
      "input:not([type])",
    ],
    credentials.login,
  );
  const passwordFilled = await fillFirstVisible(
    page,
    [
      "input[type='password']",
      "input[placeholder*='senha' i]",
      "input[name*='senha' i]",
      "input[id*='senha' i]",
      "input[name*='password' i]",
      "input[id*='password' i]",
    ],
    credentials.password,
  );

  if (!loginFilled || !passwordFilled) {
    throw new Error("Campos de login da MAREST nao foram identificados");
  }

  const clicked = await clickFirstVisible(page, [
    "form button:has-text('LOGIN')",
    "form button:has-text('Login')",
    "button[type='submit']",
    "button:has-text('LOGIN')",
    "button:has-text('Login')",
    "button:has-text('Entrar')",
    "input[type='submit']",
  ]);

  if (!clicked) {
    await page.keyboard.press("Enter");
  }

  const logged = await waitForMarestLogin(page);
  if (await hasInvalidCredentialsMessage(page)) {
    throw new Error("Credenciais invalidas em MAREST");
  }
  if (!logged) {
    throw new Error("Login nao confirmado em MAREST");
  }

  await goToMarestHome(page, concorrente);
}

async function waitForMarestLoginForm(page) {
  return page
    .locator("input[type='password'], input[placeholder*='senha' i]")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
}

async function isMarestLoginFormVisible(page) {
  return page
    .locator("input[type='password'], input[placeholder*='senha' i]")
    .first()
    .isVisible()
    .catch(() => false);
}

async function waitForMarestLogin(page) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await page
      .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
      .catch(() => null);

    if (await isMarestLoggedIn(page)) return true;
    await page.waitForTimeout(750);
  }

  return false;
}

async function isMarestLoggedIn(page) {
  if (await isMarestLoginFormVisible(page)) return false;

  const path = new URL(page.url()).pathname.replace(/\/+$/, "");
  if (path === "/login" || (await isLoginRequired(page))) return false;
  if (path === "/home" || path.startsWith("/product")) return true;

  return pageHasText(page, [/ola,?\s+[^\s]/, /ver minha conta/, /sair/, /meus pedidos/]);
}

async function goToMarestHome(page, concorrente) {
  const currentPath = new URL(page.url()).pathname.replace(/\/+$/, "");
  if (currentPath === "/home") return;

  await page.goto(absoluteUrl("/home", concorrente.site_url), {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  });
  await dismissOverlays(page);
}

async function loginMegaleste(page, concorrente, credentials) {
  const loginUrl = loginUrlForConcorrente(concorrente);

  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  await page.waitForLoadState("load", { timeout: quickLoadTimeoutMs }).catch(() => null);
  await dismissOverlays(page);

  if (await isMegalesteLoggedIn(page)) {
    await goToMegalesteCustomerHome(page, concorrente);
    return;
  }

  const opened = await openMegalesteLoginPanel(page);
  if (!opened) {
    throw new Error("Formulario de login da MEGALESTE nao abriu");
  }

  const filled = await fillMegalesteLoginForm(page, credentials);
  if (!filled) {
    throw new Error("Campos de login da MEGALESTE nao foram identificados");
  }

  const clicked = await clickMegalesteSubmit(page);
  if (!clicked) {
    await page.keyboard.press("Enter");
  }

  const logged = await waitForMegalesteLogin(page);
  if (await hasInvalidCredentialsMessage(page)) {
    throw new Error("Credenciais invalidas em MEGALESTE");
  }
  if (!logged) {
    throw new Error("Login nao confirmado em MEGALESTE");
  }

  await goToMegalesteCustomerHome(page, concorrente);
}

async function openMegalesteLoginPanel(page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (await isMegalesteLoginFormVisible(page)) return true;

    await clickFirstVisible(page, [
      "[class*='login' i] button",
      "[class*='login' i] a",
      "[class*='user' i] button",
      "[class*='user' i] a",
      "[class*='usuario' i] button",
      "[class*='usuario' i] a",
      "button:has-text('Entrar')",
      "a:has-text('Entrar')",
      "[role='button']:has-text('Entrar')",
    ]);

    if (!(await isMegalesteLoginFormVisible(page))) {
      await clickMegalesteUserMenuByDom(page);
    }

    const visible = await waitForMegalesteLoginForm(page);
    if (visible) return true;
    await page.waitForTimeout(500);
  }

  return false;
}

async function isMegalesteLoginFormVisible(page) {
  return page
    .locator("input[type='password'], input[placeholder*='senha' i]")
    .first()
    .isVisible()
    .catch(() => false);
}

async function waitForMegalesteLoginForm(page) {
  return page
    .locator("input[type='password'], input[placeholder*='senha' i]")
    .first()
    .waitFor({ state: "visible", timeout: 7000 })
    .then(
      () => true,
      () => false,
    );
}

async function fillMegalesteLoginForm(page, credentials) {
  return page
    .evaluate(({ login, password }) => {
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const setValue = (input, value) => {
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const passwordInput = [...document.querySelectorAll("input")]
        .filter((input) => input instanceof HTMLInputElement && visible(input))
        .find((input) => {
          const label = `${input.type} ${input.name} ${input.id} ${input.placeholder}`;
          return /password|senha/i.test(label);
        });
      if (!(passwordInput instanceof HTMLInputElement)) return false;

      const root =
        passwordInput.closest("form") ??
        passwordInput.closest("[class*='login' i]") ??
        passwordInput.closest("[class*='user' i]") ??
        passwordInput.parentElement?.parentElement ??
        document.body;
      const inputs = [...root.querySelectorAll("input")].filter(
        (input) => input instanceof HTMLInputElement && visible(input),
      );
      const loginInput = inputs.find((input) => {
        if (input === passwordInput) return false;
        const label = `${input.type} ${input.name} ${input.id} ${input.placeholder}`;
        return !/search|busca|pesquisa|hidden|password|senha/i.test(label);
      });
      if (!(loginInput instanceof HTMLInputElement)) return false;

      setValue(loginInput, login);
      setValue(passwordInput, password);
      return true;
    }, credentials)
    .catch(() => false);
}

async function clickMegalesteSubmit(page) {
  return (
    (await clickFirstVisible(page, [
      "button:has-text('entrar')",
      "button:has-text('Entrar')",
      "input[type='submit'][value*='entrar' i]",
      "input[type='submit'][value*='Entrar' i]",
      "[role='button']:has-text('entrar')",
      "[role='button']:has-text('Entrar')",
    ])) || (await clickMegalesteSubmitByDom(page))
  );
}

async function clickMegalesteSubmitByDom(page) {
  return page
    .evaluate(() => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const passwordInput = [...document.querySelectorAll("input")]
        .filter((input) => input instanceof HTMLInputElement && visible(input))
        .find((input) => /password|senha/i.test(`${input.type} ${input.name} ${input.id}`));
      const root =
        passwordInput?.closest("form") ??
        passwordInput?.closest("[class*='login' i]") ??
        passwordInput?.parentElement?.parentElement ??
        document.body;
      const candidates = [
        ...root.querySelectorAll("button, input[type='submit'], a, [role='button']"),
      ];
      const target = candidates.find((node) => {
        if (!(node instanceof HTMLElement) || !visible(node)) return false;
        const label = node instanceof HTMLInputElement ? node.value : node.innerText;
        return /^(entrar|login|acessar)$/.test(normalize(label));
      });

      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    })
    .catch(() => false);
}

async function clickMegalesteUserMenuByDom(page) {
  return page
    .evaluate(() => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const candidates = [
        ...document.querySelectorAll(
          "button, a, [role='button'], [class*='user' i], [class*='login' i]",
        ),
      ]
        .filter((node) => node instanceof HTMLElement && visible(node))
        .filter((node) => !node.closest("form") && !node.querySelector("input"))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const text = normalize(
            node.innerText || node.textContent || node.getAttribute("aria-label"),
          );
          const className = String(node.className ?? "");
          const rightHeader = rect.x > window.innerWidth * 0.65 && rect.y < 190;
          const labelScore = /entrar|login|usuario|cliente|user/.test(`${text} ${className}`)
            ? 40
            : 0;
          const iconScore = node.querySelector("svg, i") ? 20 : 0;
          const positionScore = rightHeader ? 30 : 0;
          return { node, score: labelScore + iconScore + positionScore, x: rect.x };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.x - a.x);

      const target = candidates[0]?.node;
      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    })
    .catch(() => false);
}

async function waitForMegalesteLogin(page) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await page
      .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
      .catch(() => null);

    if (await isMegalesteLoggedIn(page)) return true;
    await page.waitForTimeout(700);
  }

  return false;
}

async function isMegalesteLoggedIn(page) {
  if (await isMegalesteLoginFormVisible(page)) return false;

  const path = new URL(page.url()).pathname.replace(/\/+$/, "");
  if (path === "/c" || path.startsWith("/c/")) return true;

  return pageHasText(page, [/centermak/, /seus pedidos/, /todos os produtos/]);
}

async function goToMegalesteCustomerHome(page, concorrente) {
  const currentPath = new URL(page.url()).pathname.replace(/\/+$/, "");
  if (currentPath === "/c" || currentPath.startsWith("/c/")) return;

  await page.goto(absoluteUrl("/c", concorrente.site_url), {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  });
  await dismissOverlays(page);
}

async function loginCofema(page, concorrente, credentials) {
  const loginUrl = loginUrlForConcorrente(concorrente);

  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  await page.waitForLoadState("load", { timeout: quickLoadTimeoutMs }).catch(() => null);
  await dismissCofemaNotice(page, { waitForAppearance: true });
  await dismissOverlays(page);

  if (await isCofemaLoggedIn(page)) {
    await ensurePreferencesForRead(page, concorrente);
    console.log("[COFEMA] Sessao existente validada pelo cabecalho autenticado.");
    return;
  }

  await page
    .context()
    .clearCookies()
    .catch(() => null);
  await clearCofemaLocalAuth(page);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  await dismissCofemaNotice(page, { waitForAppearance: true });

  await openCofemaLoginModal(page);

  const loginFilled = await fillFirstVisible(
    page,
    [
      "[role='dialog'][aria-labelledby] #codigo",
      "[role='dialog'] input[autocomplete='username']",
      "[role='dialog'] input[placeholder*='código' i]",
      "[role='dialog'] input[placeholder*='codigo' i]",
      "[role='dialog'] input[placeholder*='CPF' i]",
      "[role='dialog'] input[placeholder*='CNPJ' i]",
      "[role='dialog'] input[name*='codigo' i]",
      "[role='dialog'] input[name*='cpf' i]",
      "[role='dialog'] input[name*='cnpj' i]",
      "[role='dialog'] input[type='text']",
      "[role='dialog'] input:not([type])",
      ".modal input[placeholder*='código' i]",
      ".modal input[placeholder*='codigo' i]",
      ".modal input[placeholder*='CPF' i]",
      ".modal input[placeholder*='CNPJ' i]",
      ".modal input[type='text']",
      "#dialog-model input[name='login']",
      "#dialog-model input[id*='login' i]",
      "#dialog-model input[name*='usuario' i]",
      "#dialog-model input[id*='usuario' i]",
      "#dialog-model input[name*='cnpj' i]",
      "#dialog-model input[type='text']",
      "#dialog-model input:not([type])",
    ],
    credentials.login,
  );

  const passwordFilled = await fillFirstVisible(
    page,
    [
      "[role='dialog'][aria-labelledby] #senha",
      "[role='dialog'] input[autocomplete='current-password']",
      "[role='dialog'] input[type='password']",
      "[role='dialog'] input[placeholder*='senha' i]",
      ".modal input[type='password']",
      ".modal input[placeholder*='senha' i]",
      "#dialog-model input[name='senha']",
      "#dialog-model input[type='password']",
      "#dialog-model input[id*='senha' i]",
      "#dialog-model input[name*='password' i]",
      "#dialog-model input[id*='password' i]",
    ],
    credentials.password,
  );

  if (!loginFilled || !passwordFilled) {
    throw new Error("COFEMA: formulario de login nao encontrado");
  }

  const submit = page
    .getByRole("dialog", { name: /login do cliente/i })
    .getByRole("button", { name: /^entrar$/i });
  const authResponsePromise = page
    .waitForResponse(
      (response) =>
        /\/api\/auth(?:$|\?)/i.test(response.url()) && response.request().method() === "POST",
      { timeout: actionTimeoutMs * 2 },
    )
    .catch(() => null);

  if (!(await submit.isVisible().catch(() => false))) {
    throw new Error("COFEMA: formulario de login nao encontrado");
  }
  await submit.click({ timeout: actionTimeoutMs });
  const authResponse = await authResponsePromise;
  if (authResponse) {
    console.log(`[COFEMA] Resposta da autenticacao: HTTP ${authResponse.status()}.`);
  }
  if (authResponse && [400, 401, 403].includes(authResponse.status())) {
    throw new Error("COFEMA: credenciais recusadas");
  }

  const logged = await waitForCofemaLogin(page);
  if (await hasInvalidCredentialsMessage(page)) {
    throw new Error("COFEMA: credenciais recusadas");
  }
  if (!logged) {
    throw new Error("COFEMA: login nao confirmado");
  }

  await ensurePreferencesForRead(page, concorrente);
  console.log("[COFEMA] Login confirmado pelo cabecalho autenticado.");
}

async function openCofemaLoginModal(page) {
  let menuOpened = false;
  let areaClicked = false;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await dismissCofemaNotice(page);
    if (await isCofemaLoginFormVisible(page)) return true;

    const clicked =
      (await clickFirstVisible(page, [
        "button:has-text('Entre ou Cadastre-se')",
        "a:has-text('Entre ou Cadastre-se')",
        "[role='button']:has-text('Entre ou Cadastre-se')",
        "button:has-text('Entre ou Cadastre')",
        "a:has-text('Entre ou Cadastre')",
        "[role='button']:has-text('Entre ou Cadastre')",
        "button:has-text('Cadastre-se')",
        "#containerLogon a[data-logon='1']:has-text('Entre')",
        ".ContainerLogonAjax a[data-logon='1']:has-text('Entre')",
        "a[data-logon='1']:has-text('Entrar')",
        "button[data-logon='1']:has-text('Entrar')",
        "#containerLogon a[data-logon='1']",
        ".ContainerLogonAjax a[data-logon='1']",
        "a[data-logon='1']",
        "button[data-logon='1']",
      ])) || (await clickCofemaLoginByDom(page));

    if (clicked) {
      menuOpened = true;
      await page.waitForTimeout(350);
      areaClicked = (await clickCofemaAreaCliente(page)) || areaClicked;
    }

    const visible = await waitForCofemaLoginForm(page);

    if (visible) return true;
    await page.waitForTimeout(600);
  }

  if (!menuOpened || !areaClicked) {
    throw new Error("COFEMA: menu Area do Cliente nao abriu");
  }
  throw new Error("COFEMA: formulario de login nao encontrado");
}

async function isCofemaLoginFormVisible(page) {
  const passwordVisible = await page
    .locator(
      [
        "[role='dialog'] input[type='password']",
        ".modal input[type='password']",
        "#dialog-model input[name='senha']",
        "#dialog-model input[type='password']",
        "input[placeholder*='senha' i]",
      ].join(", "),
    )
    .first()
    .isVisible()
    .catch(() => false);

  if (!passwordVisible) return false;

  return (
    (await pageHasText(page, [
      /login do cliente/,
      /digite seu codigo/,
      /digite seu cod/,
      /cpf ou cnpj/,
      /digite sua senha/,
    ])) || passwordVisible
  );
}

async function waitForCofemaLoginForm(page) {
  return page
    .locator(
      [
        "[role='dialog'] input[type='password']",
        ".modal input[type='password']",
        "#dialog-model input[name='senha']",
        "#dialog-model input[type='password']",
        "input[placeholder*='senha' i]",
      ].join(", "),
    )
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(
      () => true,
      () => false,
    );
}

async function clickCofemaAreaCliente(page) {
  return (
    (await clickExactText(page, /^(area|área)\s+do\s+cliente$/i).catch(() => false)) ||
    (await clickFirstVisible(page, [
      "[role='menuitem']:has-text('Área do Cliente')",
      "[role='menuitem']:has-text('Area do Cliente')",
      "button:has-text('Área do Cliente')",
      "button:has-text('Area do Cliente')",
      "a:has-text('Área do Cliente')",
      "a:has-text('Area do Cliente')",
      "li:has-text('Área do Cliente')",
      "li:has-text('Area do Cliente')",
    ])) ||
    (await clickCofemaAreaClienteByDom(page))
  );
}

async function clickCofemaAreaClienteByDom(page) {
  return page
    .evaluate(() => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const candidates = [
        ...document.querySelectorAll("button, a, [role='menuitem'], li, div, span"),
      ];
      const label = "area do cliente";
      const target = candidates.find((node) => normalize(node.textContent) === label);
      const clickable = target?.closest("button, a, [role='menuitem'], li, div");

      if (!(clickable instanceof HTMLElement)) return false;
      clickable.click();
      return true;
    })
    .catch(() => false);
}

async function clickCofemaLoginByDom(page) {
  return page
    .evaluate(() => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const candidates = [
        ...document.querySelectorAll(
          "a[data-logon='1'], button[data-logon='1'], button, a, [role='button']",
        ),
      ];
      const target =
        candidates.find((node) => normalize(node.textContent).includes("entre ou cadastre")) ??
        candidates.find((node) => normalize(node.textContent).includes("entre")) ??
        candidates.find((node) => normalize(node.textContent).includes("entrar")) ??
        candidates[0];

      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    })
    .catch(() => false);
}

async function isCofemaLoggedIn(page) {
  if (await isCofemaLoginFormVisible(page)) return false;

  const loggedOutControl = page.getByRole("button", { name: /entre ou cadastre-se/i });
  if (await loggedOutControl.isVisible().catch(() => false)) return false;

  const accountControl = page
    .locator(
      "header button[aria-haspopup='menu']:has(svg.lucide-user):visible, " +
        "header button[aria-haspopup='menu'][title*=' - ']:visible",
    )
    .first();
  const locationControl = cofemaLocationControl(page);
  const accountVisible = await accountControl.isVisible().catch(() => false);
  const locationVisible = await locationControl.isVisible().catch(() => false);
  return accountVisible && locationVisible;
}

async function clearCofemaLocalAuth(page) {
  await page
    .evaluate(() => {
      const clearKnownAuthKeys = (storage) => {
        if (!storage) return;
        for (const key of Object.keys(storage)) {
          if (/token|jwt|auth|login|usuario|user|cliente|session/i.test(key)) {
            storage.removeItem(key);
          }
        }
      };

      clearKnownAuthKeys(window.localStorage);
      clearKnownAuthKeys(window.sessionStorage);
    })
    .catch(() => null);
}

async function waitForCofemaLogin(page) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await page
      .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
      .catch(() => null);
    if (await isCofemaLoggedIn(page)) return true;
    if (await hasInvalidCredentialsMessage(page)) return false;

    await page.waitForTimeout(750);
  }

  return false;
}

async function openLoginSurface(page) {
  await clickFirstVisible(page, [
    ".menu-user > a",
    "a[role='button'][data-toggle='dropdown'][aria-haspopup='true']",
    "a[data-toggle='dropdown']:has(svg)",
    "#botao-login",
    "button:has-text('Cliente')",
    "a:has-text('Cliente')",
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

async function dismissCofemaNotice(page, options = {}) {
  if (options.waitForAppearance) {
    await page.waitForTimeout(900);
  }

  const notice = page
    .getByRole("dialog")
    .filter({ hasText: /NOVIDADE SITE/i })
    .first();
  if (!(await notice.isVisible().catch(() => false))) return false;

  const closeControls = [
    notice.getByRole("button", { name: /^fechar$/i }).first(),
    notice.locator("button[aria-label='Fechar' i], button[aria-label='Close' i]").first(),
    notice
      .locator("button")
      .filter({ hasText: /^[x×]$/i })
      .first(),
  ];

  for (const control of closeControls) {
    if (!(await control.isVisible().catch(() => false))) continue;
    const clicked = await control.click({ timeout: actionTimeoutMs }).then(
      () => true,
      () => false,
    );
    if (!clicked) continue;
    await notice.waitFor({ state: "hidden", timeout: actionTimeoutMs }).catch(() => null);
    if (!(await notice.isVisible().catch(() => false))) return true;
  }

  throw new Error("COFEMA: modal de comunicado nao pode ser fechado");
}

async function dismissOverlays(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clicked =
      (await clickFirstVisible(page, [
        "button:has-text('Entendi')",
        "a:has-text('Entendi')",
        "[role='button']:has-text('Entendi')",
        "input[type='button'][value*='Entendi' i]",
        "input[type='submit'][value*='Entendi' i]",
        "#botao-aceitar-todos",
        "button:has-text('Aceitar todos')",
        "button:has-text('Aceitar')",
        "button:has-text('Recusar')",
        "button:has-text('Fechar')",
        "button:has-text('Não exibir mais hoje')",
        "button:has-text('Nao exibir mais hoje')",
        ".modal button.btn-close",
        ".modal [class*='close' i]",
        "[role='dialog'] [class*='close' i]",
        "[aria-label='Close']",
        "[aria-label='Fechar']",
      ])) ||
      (await clickEntendiInFrames(page)) ||
      (await clickOverlayCloseByDom(page));

    if (!clicked) return;
    await page.waitForTimeout(250);
  }
}

async function clickEntendiInFrames(page) {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;

    const clicked = await clickFirstVisible(frame, [
      "button:has-text('Entendi')",
      "a:has-text('Entendi')",
      "[role='button']:has-text('Entendi')",
      "input[value*='Entendi' i]",
    ]);
    if (clicked) return true;
  }

  return false;
}

async function clickOverlayCloseByDom(page) {
  return page
    .evaluate(() => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const overlays = [
        ...document.querySelectorAll(
          ".modal, [role='dialog'], [class*='modal' i], [class*='popup' i], [class*='cookie' i], [class*='overlay' i]",
        ),
      ].filter((node) => node instanceof HTMLElement && visible(node));

      for (const overlay of overlays) {
        const candidates = [
          ...overlay.querySelectorAll("button, a, [role='button'], [class*='close' i]"),
        ].filter((node) => node instanceof HTMLElement && visible(node));
        const target = candidates.find((node) => {
          const label = normalize(
            node.innerText || node.textContent || node.getAttribute("aria-label"),
          );
          const className = String(node.className ?? "");
          return (
            ["x", "×", "fechar", "close", "aceitar", "recusar", "nao exibir mais hoje"].includes(
              label,
            ) || /close|fechar/i.test(className)
          );
        });

        if (target instanceof HTMLElement) {
          target.click();
          return true;
        }
      }

      return false;
    })
    .catch(() => false);
}

async function ensureConcorrentePreferences(page, concorrente) {
  const nome = resolveConcorrenteKey(concorrente.nome);

  if (nome === "COFEMA") return configureCofema(page);
  if (nome === "MAREST") {
    if (await isMarestLoggedIn(page)) return false;
    return configureRegionSelector(page, "MAREST", marestRegiao);
  }
  if (nome === "MEGALESTE") return configureRegionSelector(page, "MEGALESTE", megalesteRegiao);

  return false;
}

async function ensurePreferencesForRead(page, concorrente) {
  return ensureConcorrentePreferences(page, concorrente);
}

async function configureCofema(page) {
  const current = await cofemaLocationText(page);
  if (!current) throw new Error("COFEMA: login nao confirmado");

  if (!cofemaUnidade) {
    console.log(`[COFEMA] Unidade ativa mantida (${current}).`);
    return false;
  }

  if (normalizeText(current) === normalizeText(cofemaUnidade)) {
    console.log(`[COFEMA] Unidade configurada ja esta ativa (${current}).`);
    return false;
  }

  const control = cofemaLocationControl(page);
  if (!(await control.isVisible().catch(() => false))) {
    throw new Error("COFEMA: unidade configurada nao encontrada");
  }
  await control.click({ timeout: actionTimeoutMs });
  await page.waitForTimeout(250);

  const selected = await page
    .evaluate((expected) => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const target = [...document.querySelectorAll("[role='menuitem']")].find((item) => {
        const style = window.getComputedStyle(item);
        const rect = item.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          normalize(item.textContent) === normalize(expected)
        );
      });
      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    }, cofemaUnidade)
    .catch(() => false);

  if (!selected) throw new Error("COFEMA: unidade configurada nao encontrada");

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(300);
    const active = await cofemaLocationText(page);
    if (active && normalizeText(active) === normalizeText(cofemaUnidade)) {
      console.log(`[COFEMA] Unidade ativa confirmada (${active}).`);
      return true;
    }
  }

  throw new Error("COFEMA: unidade configurada nao encontrada");
}

function cofemaLocationControl(page) {
  return page
    .locator(
      "header button[aria-haspopup='menu']:has(svg.lucide-building-2):visible, " +
        "header button[aria-haspopup='menu']:has(svg.lucide-building2):visible",
    )
    .first();
}

async function cofemaLocationText(page) {
  const control = cofemaLocationControl(page);
  await control.waitFor({ state: "visible", timeout: quickLoadTimeoutMs }).catch(() => null);
  if (!(await control.isVisible().catch(() => false))) return "";
  return String(await control.innerText().catch(() => ""))
    .replace(/\s+/g, " ")
    .trim();
}

async function configureRegionSelector(page, providerName, region) {
  const hasPrompt = await pageHasText(page, [/escolha uma regiao/, /seja bem vindo/]);
  if (!hasPrompt) return false;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let clicked = await clickExactText(page, new RegExp(`^${escapeRegex(region)}$`, "i"));

    if (!clicked) {
      await clickFirstVisible(page, [
        "button:has-text('Escolha uma')",
        "a:has-text('Escolha uma')",
        "[role='button']:has-text('Escolha uma')",
        ".dropdown-toggle",
      ]);
      clicked = await clickExactText(page, new RegExp(`^${escapeRegex(region)}$`, "i"));
    }

    if (clicked) {
      await page
        .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
        .catch(() => null);
      await page.waitForTimeout(1000);
      if (!(await pageHasText(page, [/escolha uma regiao/]))) {
        console.log(`[${providerName}] Regiao ${region} selecionada.`);
        return true;
      }
    }
  }

  throw new Error(`Regiao ${region} da ${providerName} nao selecionada`);
}

async function openProductPage(page, context, statePath, mapping, concorrente) {
  if (isCofema(concorrente) && !shouldOpenDirectProductUrl(mapping, concorrente)) {
    await openProductBySearch(page, context, statePath, mapping, concorrente);
    return;
  }

  if (!shouldOpenDirectProductUrl(mapping, concorrente) && usesSearchFlow(concorrente)) {
    await openProductBySearch(page, context, statePath, mapping, concorrente);
    return;
  }

  const productUrl = productUrlForMapping(mapping, concorrente);

  if (isConstruja(concorrente)) {
    console.log(`[CONSTRUJA] Abrindo produto na mesma sessao: ${productUrl}`);
  }

  await gotoProductPage(page, productUrl, concorrente);
  await dismissOverlays(page);

  if (await ensurePreferencesForRead(page, concorrente)) {
    await context.storageState({ path: statePath });
    await gotoProductPage(page, productUrl, concorrente);
    await dismissOverlays(page);
    if (await ensurePreferencesForRead(page, concorrente)) {
      await context.storageState({ path: statePath });
    }
  }

  await waitForProductSignal(page);
  if (isConstruja(concorrente)) await waitForConstrujaPriceSignal(page);
  await dismissOverlays(page);
  if (await ensurePreferencesForRead(page, concorrente)) {
    await context.storageState({ path: statePath });
    await waitForProductSignal(page);
  }
  if (productSettleMs > 0) await page.waitForTimeout(productSettleMs);

  if (isCofema(concorrente) && !(await isExpectedProductPage(page, mapping, concorrente))) {
    console.log("[COFEMA] URL direta nao confirmou o produto; iniciando busca por identidade.");
    await openProductBySearch(page, context, statePath, mapping, concorrente);
  }
}

async function gotoProductPage(page, productUrl, concorrente) {
  if (!isConstruja(concorrente)) {
    await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    });
    return;
  }

  // Construja occasionally leaves a navigation without even committing a response. Give this
  // origin more time than the other catalogs and recover the page before retrying, otherwise
  // the next product inherits the stalled request and a whole batch fails in sequence.
  let lastError = null;
  for (let attempt = 1; attempt <= construjaNavigationAttempts; attempt += 1) {
    try {
      await page.goto(productUrl, {
        waitUntil: "commit",
        timeout: construjaNavigationTimeoutMs,
      });
      await page
        .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
        .catch(() => null);
      return;
    } catch (error) {
      lastError = error;

      // The timeout can race with a usable committed document. Keep it when content exists.
      const usableDocument =
        sameUrlIgnoringQuery(page.url(), productUrl) &&
        (await page
          .locator("body")
          .evaluate((body) => (body.innerText || body.textContent || "").trim().length > 40)
          .catch(() => false));
      if (usableDocument) return;
      if (attempt === construjaNavigationAttempts) break;

      console.log(
        `[CONSTRUJA] Produto nao respondeu; nova tentativa ` +
          `(${attempt + 1}/${construjaNavigationAttempts}).`,
      );
      await page
        .goto("about:blank", { waitUntil: "commit", timeout: quickLoadTimeoutMs })
        .catch(() => null);
      await page.waitForTimeout(attempt * 1000);
    }
  }

  throw lastError ?? new Error("Pagina da CONSTRUJA nao respondeu");
}

function sameUrlIgnoringQuery(currentUrl, expectedUrl) {
  try {
    const current = new URL(currentUrl);
    const expected = new URL(expectedUrl);
    return (
      current.origin === expected.origin &&
      current.pathname.replace(/\/+$/, "") === expected.pathname.replace(/\/+$/, "")
    );
  } catch {
    return false;
  }
}

async function openProductWithAuthenticatedSession(page, context, statePath, mapping, concorrente) {
  const maximumAttempts = isConstruja(concorrente) ? 3 : 2;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    await openProductPage(page, context, statePath, mapping, concorrente);

    if (!(await shouldRetryLogin(page, mapping, concorrente))) return;
    if (attempt === maximumAttempts) return;

    console.log(
      `[${concorrente.nome}] Sessao nao permaneceu ativa no produto; ` +
        `reautenticando (${attempt + 1}/${maximumAttempts}).`,
    );
    await resetAuthState(context, page, statePath, concorrente, "login vencido no produto");
    await page.waitForTimeout(attempt * 1000);
    await prepareAuthenticatedSession(context, page, statePath, concorrente);
  }
}

async function gotoAllowingSameDestinationRedirect(page, url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeoutMs,
      });
      return;
    } catch (error) {
      const interrupted =
        error instanceof Error && /interrupted by another navigation/i.test(error.message);
      if (!interrupted) throw error;

      await page
        .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
        .catch(() => null);
      if (page.url().replace(/\/+$/, "") === url.replace(/\/+$/, "")) return;
      if (attempt === 3) throw error;
      await page.waitForTimeout(attempt * 400);
    }
  }
}

async function openProductBySearch(page, context, statePath, mapping, concorrente) {
  const queries = searchQueriesForMapping(mapping, concorrente);
  if (queries.length === 0) {
    throw new Error("Termo de busca do produto nao cadastrado");
  }

  const searchStartUrl = searchStartUrlForMapping(mapping, concorrente);
  let lastError = null;

  for (const query of queries) {
    try {
      await gotoAllowingSameDestinationRedirect(page, searchStartUrl);
      await dismissOverlays(page);

      if (await ensurePreferencesForRead(page, concorrente)) {
        await context.storageState({ path: statePath });
        await gotoAllowingSameDestinationRedirect(page, searchStartUrl);
        await dismissOverlays(page);
      }

      const searched = await submitSiteSearch(page, query);
      // MEGALESTE may navigate to a valid result without rendering the searched SKU in the
      // intermediate page. Requiring the query text here rejects searches that worked before;
      // the product identity is confirmed below after opening the result.
      const searchHasResults =
        searched &&
        (isMegaleste(concorrente) ||
          (await hasSearchResultContent(page, query, mapping, concorrente)));
      const openedSearchPage =
        searchHasResults || (await openSearchFallback(page, query, concorrente, mapping));
      if (!openedSearchPage) {
        lastError = new Error(`Busca nao retornou resultado para "${query}"`);
        continue;
      }

      await waitForProductSignal(page);

      if (isMarest(concorrente)) {
        const clicked = await clickBestSearchResult(page, mapping, concorrente);
        if (!clicked) throw new Error(`Produto exato nao encontrado na busca por "${query}"`);
        await waitForProductSignal(page);
      } else if (!(await isExpectedProductPage(page, mapping, concorrente))) {
        await clickBestSearchResult(page, mapping, concorrente);
        await waitForProductSignal(page);
      }

      if (await ensurePreferencesForRead(page, concorrente)) {
        await context.storageState({ path: statePath });
        await waitForProductSignal(page);
      }

      if (productSettleMs > 0) await page.waitForTimeout(productSettleMs);

      const productConfirmed = await isExpectedProductPage(page, mapping, concorrente);
      if (isMarest(concorrente)) {
        console.log(
          `[MAREST] Pagina apos abertura do resultado: ${page.url()} (produto confirmado=${productConfirmed}).`,
        );
      }
      if (productConfirmed) return;

      lastError = new Error(`Produto nao confirmado na busca por "${query}"`);
    } catch (error) {
      lastError = error;
      if (isMarest(concorrente)) {
        console.log(
          `[MAREST] Tentativa de busca por ${JSON.stringify(query)} falhou: ${
            error instanceof Error ? error.message : "erro desconhecido"
          }`,
        );
      }
    }
  }

  if (isCofema(concorrente)) {
    throw new Error(
      lastError instanceof Error
        ? `COFEMA: produto nao corresponde ao mapeamento (${lastError.message})`
        : "COFEMA: produto nao corresponde ao mapeamento",
    );
  }

  throw new Error(
    lastError instanceof Error
      ? `Produto nao encontrado na busca do concorrente: ${lastError.message}`
      : "Produto nao encontrado na busca do concorrente",
  );
}

async function openSearchFallback(page, query, concorrente, mapping) {
  let lastError = null;

  for (const url of searchUrlFallbacks(query, concorrente)) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeoutMs,
      });
      await dismissOverlays(page);

      if (shouldSearchAfterFallback(url)) {
        await submitSiteSearch(page, query);
      }

      await waitForProductSignal(page);
      if (await hasSearchResultContent(page, query, mapping, concorrente)) return true;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return false;
}

function shouldSearchAfterFallback(url) {
  const pathname = new URL(url).pathname.replace(/\/+$/, "");
  return ["/products", "/c", "/c/busca"].includes(pathname);
}

function searchQueriesForMapping(mapping, concorrente) {
  const supplierSku = cleanSearchQuery(mapping.sku_concorrente);
  const productName = cleanSearchQuery(mapping.produtos?.nome);
  const productVariants = productNameVariants(mapping.produtos?.nome).map(cleanSearchQuery);
  const internalSku = cleanSearchQuery(mapping.produtos?.sku_interno);

  if (isCofema(concorrente)) {
    const urlCode = cofemaProductCodeFromUrl(mapping.url_produto);
    const nameCodes = [...String(mapping.produtos?.nome ?? "").matchAll(/\b\d{5,14}\b/g)].map(
      (match) => match[0],
    );
    return [supplierSku, urlCode, ...nameCodes, productName, ...productVariants]
      .map(cleanSearchQuery)
      .filter((query, index, queries) => query.length >= 2 && queries.indexOf(query) === index);
  }

  const descriptionQueries = [productName, ...productVariants].filter(Boolean);
  const rawQueries = supplierSku
    ? [
        supplierSku,
        ...(productName ? [`${supplierSku} ${productName}`] : []),
        ...descriptionQueries.map((description) => `${supplierSku} ${description}`),
      ]
    : [productName, ...productVariants, internalSku];

  return [...new Set(rawQueries.map(cleanSearchQuery).filter((query) => query.length >= 2))];
}

function cleanSearchQuery(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cofemaProductCodeFromUrl(value) {
  try {
    const pathname = new URL(value, cofemaBaseUrl).pathname;
    return (
      pathname.match(/\/(?:page\/)?produto\/(\d{3,})/i)?.[1] ??
      pathname.match(/\/(\d{3,})(?:[-/]|$)/)?.[1] ??
      ""
    );
  } catch {
    return "";
  }
}

function searchStartUrlForMapping(mapping, concorrente) {
  if (isCofema(concorrente)) return cofemaUrl("/");

  const fallback = isCofema(concorrente)
    ? cofemaUrl(concorrente.site_url || "/")
    : isConstruja(concorrente)
      ? construjaUrl(concorrente.site_url || concorrente.login_url || "/", concorrente)
      : absoluteUrl(concorrente.site_url || concorrente.login_url || "/", concorrente.site_url);

  if (usesSearchFlow(concorrente) && isMegaleste(concorrente)) {
    return absoluteUrl("/c/busca", fallback);
  }

  if (usesSearchFlow(concorrente)) return fallback;
  if (!mapping.url_produto) return fallback;

  return isCofema(concorrente)
    ? cofemaUrl(mapping.url_produto, fallback)
    : isConstruja(concorrente)
      ? construjaUrl(mapping.url_produto, concorrente)
      : absoluteUrl(mapping.url_produto, fallback);
}

function searchUrlFallbacks(query, concorrente) {
  const encoded = encodeURIComponent(query);
  const base = isCofema(concorrente)
    ? cofemaUrl("/")
    : absoluteUrl(concorrente.site_url || concorrente.login_url || "/", concorrente.site_url);

  const host = new URL(base).hostname;
  if (/marest/i.test(host)) {
    return [absoluteUrl("/products", base)];
  }

  if (/megaleste/i.test(host)) {
    return [absoluteUrl("/c/busca", base), absoluteUrl("/c", base)];
  }

  return [
    ...(isCofema(concorrente) ? [absoluteUrl(`/page/busca?q=${encoded}`, base)] : []),
    absoluteUrl(`/busca?q=${encoded}`, base),
    absoluteUrl(`/search?q=${encoded}`, base),
    absoluteUrl(`/?q=${encoded}`, base),
  ];
}

async function submitSiteSearch(page, query) {
  const selectors = [
    "input[type='search']",
    "input[placeholder*='buscar' i]",
    "input[placeholder*='pesquise' i]",
    "input[placeholder*='pesquisar' i]",
    "input[placeholder*='procura' i]",
    "input[placeholder*='Cod' i]",
    "input[placeholder*='Nome' i]",
    "input[placeholder*='Marca' i]",
    "input[name*='search' i]",
    "input[name*='busca' i]",
    "input[id*='search' i]",
    "input[id*='busca' i]",
    "header input[type='text']",
    "input[type='text']",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;

    const beforeUrl = page.url();
    await locator.fill(query, { timeout: actionTimeoutMs });
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs }).catch(() => null),
      locator.press("Enter").catch(() => null),
    ]);
    await page.waitForTimeout(700);

    if (await hasSearchChanged(page, beforeUrl, query)) return true;

    if ((await clickSearchSubmitNearInput(locator)) || (await clickSearchSubmit(page))) {
      await page.waitForTimeout(900);
      if (await hasSearchChanged(page, beforeUrl, query)) return true;
    }
  }

  return false;
}

async function clickSearchSubmitNearInput(locator) {
  return locator
    .evaluate((input) => {
      if (!(input instanceof HTMLInputElement)) return false;

      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const buttonScore = (node) => {
        if (!(node instanceof HTMLElement) || !visible(node)) return -1;
        const inputRect = input.getBoundingClientRect();
        const rect = node.getBoundingClientRect();
        const label = normalize(
          node.innerText ||
            node.textContent ||
            node.getAttribute("aria-label") ||
            node.getAttribute("title"),
        );
        const className = normalize(String(node.className ?? ""));
        const idName = normalize(node.id);
        const typeName = normalize(node.getAttribute("type"));
        const href = normalize(node.getAttribute("href"));
        const horizontalDistance = Math.abs(rect.left - inputRect.right);
        const verticalOverlap =
          rect.top <= inputRect.bottom + 12 && rect.bottom >= inputRect.top - 12;
        const isToRight = rect.left >= inputRect.left - 8;
        const explicitSearch =
          /buscar|busca|pesquisar|search|procura|lupa/.test(
            `${label} ${className} ${idName} ${typeName} ${href}`,
          ) || typeName === "submit";

        if (!explicitSearch) return -1;
        if (!verticalOverlap || !isToRight) return -1;

        const labelScore = /buscar|busca|pesquisar|search|procura|lupa/.test(label) ? 40 : 0;
        const metaScore = /buscar|busca|pesquisar|search|procura|lupa/.test(
          `${className} ${idName} ${href}`,
        )
          ? 35
          : 0;
        const submitScore = typeName === "submit" ? 20 : 0;
        const distanceScore = Math.max(0, 30 - horizontalDistance / 10);
        return labelScore + metaScore + submitScore + distanceScore;
      };
      const root =
        input.closest("form") ??
        input.closest("[role='search']") ??
        input.closest("[class*='search' i]") ??
        input.closest("[class*='busca' i]") ??
        input.parentElement?.parentElement ??
        input.parentElement;
      if (!(root instanceof HTMLElement)) return false;

      const buttons = [...root.querySelectorAll("button, [role='button'], input[type='submit']")];
      const scored = buttons
        .map((node) => ({ node, score: buttonScore(node) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      const target = scored[0]?.node;
      if (!(target instanceof HTMLElement)) return false;

      target.click();
      return true;
    })
    .catch(() => false);
}

async function hasSearchChanged(page, beforeUrl, query) {
  if (page.url() !== beforeUrl) return true;

  const normalizedQuery = normalizeText(query);
  const queryParts = normalizedQuery
    .split(/[^a-z0-9,]+/)
    .filter((part) => part.length >= 3 || /^\d+(?:[,.]\d+)?$/.test(part));
  if (queryParts.length === 0) return true;

  const text = await page
    .locator("body")
    .innerText({ timeout: 1500 })
    .catch(() => "");
  const normalizedText = normalizeText(text);
  const matches = queryParts.filter((part) => normalizedText.includes(part)).length;

  return matches >= Math.min(2, queryParts.length);
}

async function hasSearchResultContent(page, query, mapping, concorrente = null) {
  if (await isExpectedProductPage(page, mapping, concorrente)) return true;

  const text = await page
    .locator("body")
    .innerText({ timeout: 1500 })
    .catch(() => "");
  const normalizedText = normalizeText(text);
  if (!/produto|resultado|r\$|preco|fora de estoque|indisponivel/.test(normalizedText)) {
    return false;
  }

  const queryParts = normalizeText(query)
    .split(/[^a-z0-9,]+/)
    .filter((part) => part.length >= 3 || /^\d+(?:[,.]\d+)?$/.test(part));
  if (queryParts.length === 0) return true;

  const matches = queryParts.filter((part) => normalizedText.includes(part)).length;
  return matches >= Math.min(2, queryParts.length);
}

async function clickSearchSubmit(page) {
  return clickFirstVisible(page, [
    "button[type='submit']:has-text('Buscar')",
    "button[type='submit']:has-text('Pesquisar')",
    "button[aria-label*='buscar' i]",
    "button[aria-label*='pesquisar' i]",
    "[role='button'][aria-label*='buscar' i]",
    "[role='button'][aria-label*='pesquisar' i]",
    "button:has-text('Buscar')",
    "button:has-text('Pesquisar')",
    "button[type='submit']",
  ]);
}

async function clickConfirmedCofemaSearchResult(page, mapping) {
  const identity = productIdentity(mapping);
  const candidates = await page
    .locator("a[href]")
    .evaluateAll((links, { codes, terms }) => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const byHref = new Map();

      for (const link of links) {
        const href = link.getAttribute("href") ?? "";
        if (!/\/(?:[a-z]{2}\/)?page\/produto\//i.test(href)) continue;

        let root = link.parentElement;
        while (root?.parentElement) {
          const text = normalize(root.innerText || root.textContent);
          if (text.length >= 40 && text.length <= 1600) break;
          root = root.parentElement;
        }
        const text = normalize(
          `${link.getAttribute("aria-label") ?? ""} ${href} ${root?.innerText ?? ""}`,
        );
        const codeMatch = codes.some((code) => text.includes(code));
        const matchedTerms = terms.filter((term) => text.includes(term));
        const measureTerms = terms.filter((term) => /\d/.test(term));
        const hasMeasure =
          measureTerms.length === 0 || measureTerms.some((term) => text.includes(term));
        const strongNameMatch =
          terms.length >= 2 &&
          hasMeasure &&
          matchedTerms.length >= Math.min(3, Math.ceil(terms.length * 0.6));

        if (codeMatch || strongNameMatch) {
          byHref.set(href, { href, score: (codeMatch ? 100 : 0) + matchedTerms.length });
        }
      }

      return [...byHref.values()].sort((a, b) => b.score - a.score);
    }, identity)
    .catch(() => []);

  if (candidates.length === 0) return false;
  if (candidates.length > 1) {
    throw new Error("COFEMA: produto ambiguo ou nao confirmado");
  }

  const href = candidates[0].href;
  const clicked = await page
    .locator("a[href]")
    .evaluateAll((links, expectedHref) => {
      const target = links.find((link) => link.getAttribute("href") === expectedHref);
      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    }, href)
    .catch(() => false);
  if (!clicked) return false;

  await page
    .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
    .catch(() => null);
  await page.waitForTimeout(500);
  return true;
}

async function clickConfirmedMarestSearchResult(page, mapping) {
  const expectedSku = String(mapping?.sku_concorrente ?? "").trim();
  if (!expectedSku) return false;

  await page
    .waitForFunction(
      (sku) =>
        [...document.querySelectorAll("a[href]")].some((link) => {
          try {
            const url = new URL(link.getAttribute("href") ?? "", location.href);
            return (
              url.pathname.replace(/\/+$/, "") === "/product" &&
              String(url.searchParams.get("sku") ?? "").trim() === sku
            );
          } catch {
            return false;
          }
        }),
      expectedSku,
      { timeout: productSignalTimeoutMs },
    )
    .catch(() => null);

  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((links, sku) => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const matches = [];
      for (const link of links) {
        if (!visible(link)) continue;
        try {
          const url = new URL(link.getAttribute("href") ?? "", location.href);
          if (url.pathname.replace(/\/+$/, "") !== "/product") continue;
          if (String(url.searchParams.get("sku") ?? "").trim() !== sku) continue;
          matches.push(url.toString());
        } catch {
          // Ignore malformed links from unrelated widgets.
        }
      }
      return [...new Set(matches)];
    }, expectedSku)
    .catch(() => []);

  if (hrefs.length === 0) {
    console.log(`[MAREST] Link exato do SKU ${expectedSku} ainda nao apareceu em ${page.url()}.`);
    return false;
  }
  if (hrefs.length !== 1) throw new Error("MAREST: produto ambiguo ou nao confirmado");

  const navigation = page
    .waitForURL(
      (url) =>
        url.pathname.replace(/\/+$/, "") === "/product" &&
        String(url.searchParams.get("sku") ?? "").trim() === expectedSku,
      { timeout: navigationTimeoutMs },
    )
    .catch(() => null);
  const clicked = await page
    .locator("a[href]")
    .evaluateAll((links, expectedHref) => {
      const target = links.find((link) => {
        try {
          return (
            new URL(link.getAttribute("href") ?? "", location.href).toString() === expectedHref
          );
        } catch {
          return false;
        }
      });
      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    }, hrefs[0])
    .catch(() => false);
  if (!clicked) return false;

  await navigation;
  await page
    .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
    .catch(() => null);
  await page.waitForTimeout(500);
  return true;
}

async function clickBestSearchResult(page, mapping, concorrente = null) {
  if (concorrente && isCofema(concorrente)) {
    return clickConfirmedCofemaSearchResult(page, mapping);
  }
  if (concorrente && isMarest(concorrente)) {
    return clickConfirmedMarestSearchResult(page, mapping);
  }

  const identity = productIdentity(mapping);
  if (identity.codes.length === 0 && identity.terms.length === 0) return false;

  const clicked = await page
    .evaluate(({ codes, terms }) => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const hasCode = (text) => codes.some((code) => text.includes(code));
      const matchedTerms = (text) => terms.filter((term) => text.includes(term));
      const isGoodMatch = (text, matches) => {
        if (codes.length > 0) return hasCode(text);
        return matches.length >= Math.min(2, terms.length);
      };

      const nodes = [
        ...document.querySelectorAll(
          [
            "a[href]",
            "article",
            "li",
            "[class*='produto' i]",
            "[class*='product' i]",
            "[class*='item' i]",
            "[class*='card' i]",
          ].join(", "),
        ),
      ];

      const scored = nodes
        .filter((node) => node instanceof HTMLElement && visible(node))
        .map((node) => {
          const text = node.innerText || node.textContent || "";
          const normalized = normalize(text);
          const matches = matchedTerms(normalized);
          const exactCodeScore = hasCode(normalized) ? 100 : 0;
          const score = exactCodeScore + matches.reduce((sum, term) => sum + term.length, 0);
          return { node, score, length: normalized.length, good: isGoodMatch(normalized, matches) };
        })
        .filter((item) => item.good && item.score > 0 && item.length <= 2500)
        .sort((a, b) => b.score - a.score || a.length - b.length);

      const target = scored[0]?.node;
      if (!target) return false;

      const clickable =
        (target.matches("a[href]") ? target : null) ??
        target.querySelector("a[href]") ??
        target.closest("a[href]");
      if (!(clickable instanceof HTMLElement)) return false;

      clickable.click();
      return true;
    }, identity)
    .catch(() => false);

  if (!clicked) return false;

  await page
    .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
    .catch(() => null);
  await page.waitForTimeout(500);
  return true;
}

async function isExpectedProductPage(page, mapping, concorrente = null) {
  if (concorrente && isCofema(concorrente)) {
    return isExpectedCofemaProductPage(page, mapping);
  }

  const identity = productIdentity(mapping);
  if (identity.codes.length === 0 && identity.terms.length === 0) return true;

  const text = await page
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  const normalizedText = normalizeText(text);

  if (identity.codes.some((code) => normalizedText.includes(code))) return true;
  if (identity.terms.length === 0) return false;

  const matchedTerms = identity.terms.filter((term) => normalizedText.includes(term));
  const numericTerms = identity.terms.filter((term) => /^\d+(?:[,.]\d+)?[a-z]*$/.test(term));
  const hasExpectedMeasure =
    numericTerms.length === 0 || numericTerms.some((term) => normalizedText.includes(term));

  return hasExpectedMeasure && matchedTerms.length >= Math.min(2, identity.terms.length);
}

async function isExpectedCofemaProductPage(page, mapping) {
  const pathname = new URL(page.url()).pathname;
  if (!/^\/(?:[a-z]{2}\/)?page\/produto\//i.test(pathname)) return false;

  const observed = await page
    .locator("main")
    .evaluate((main) => {
      const text = String(main.innerText || main.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const normalized = text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      return {
        name: main.querySelector("h1")?.textContent?.trim() ?? "",
        mainCode: normalized.match(/codigo:\s*([a-z0-9._/-]+)/i)?.[1] ?? "",
        supplierReference:
          normalized.match(/referencia do fornecedor:\s*([a-z0-9._/-]+)/i)?.[1] ?? "",
        barcode: normalized.match(/codigo barras:\s*([a-z0-9._/-]+)/i)?.[1] ?? "",
      };
    })
    .catch(() => null);
  if (!observed?.name || !observed.mainCode) return false;

  const urlCode = cofemaProductCodeFromUrl(page.url());
  if (urlCode && normalizeText(urlCode) !== normalizeText(observed.mainCode)) return false;

  const identity = productIdentity(mapping);
  const observedCodes = [observed.mainCode, observed.supplierReference, observed.barcode].map(
    normalizeText,
  );
  const codeMatch = identity.codes.some((code) => observedCodes.includes(normalizeText(code)));

  const normalizedName = normalizeText(observed.name);
  const matchedTerms = identity.terms.filter((term) => normalizedName.includes(term));
  const measureTerms = identity.terms.filter((term) => /\d/.test(term));
  const hasMeasure =
    measureTerms.length === 0 || measureTerms.some((term) => normalizedName.includes(term));
  const strongNameMatch =
    identity.terms.length >= 2 &&
    hasMeasure &&
    matchedTerms.length >= Math.min(3, Math.ceil(identity.terms.length * 0.6));

  return codeMatch || strongNameMatch;
}

async function pageHasText(page, patterns) {
  const text = await page
    .locator("body")
    .innerText({ timeout: 1500 })
    .catch(() => "");
  const normalized = normalizeText(text);

  return patterns.some((pattern) => pattern.test(normalized));
}

async function clickExactText(page, pattern) {
  const locator = page.getByText(pattern).first();
  const count = await locator.count().catch(() => 0);
  if (count === 0) return false;

  const visible = await locator.isVisible().catch(() => false);
  if (!visible) return false;

  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs }).catch(() => null),
    locator.click({ timeout: actionTimeoutMs }),
  ]);
  return true;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function captureCompetitorFailureDiagnostics(page, mapping, competitorName) {
  const competitor = resolveConcorrenteKey(competitorName) ?? "CONCORRENTE";
  const competitorSlug = competitor.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  mkdirSync(diagnosticsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mappingLabel = String(mapping?.id ?? "session").replace(/[^a-z0-9-]+/gi, "-");
  const prefix = join(diagnosticsDir, `${competitorSlug}-${mappingLabel}-${timestamp}`);
  const credentials = credentialsFor(competitor);
  const secrets = [credentials?.login, credentials?.password].filter(Boolean);

  const pageSanitized = await page
    .evaluate(
      ({ values }) => {
        const redact = (value) => {
          let result = String(value ?? "");
          for (const secret of values) result = result.replaceAll(secret, "[REDACTED]");
          return result;
        };

        document.querySelectorAll("input, textarea").forEach((field) => {
          if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
            field.value = "";
            field.setAttribute("value", "[REDACTED]");
          }
        });

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          node.textContent = redact(node.textContent);
        }

        document.querySelectorAll("*").forEach((element) => {
          for (const attribute of [...element.attributes]) {
            if (/(?:token|authorization|password|senha|cookie)/i.test(attribute.name)) {
              element.setAttribute(attribute.name, "[REDACTED]");
            } else {
              element.setAttribute(attribute.name, redact(attribute.value));
            }
          }
        });
        return true;
      },
      { values: secrets },
    )
    .catch(() => false);

  if (!pageSanitized) {
    console.error(`[${competitor}] Diagnostico descartado porque a sanitizacao da pagina falhou.`);
    return;
  }

  await page.screenshot({ path: `${prefix}.png`, fullPage: true }).catch(() => null);
  let html = await page
    .evaluate(() => {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll("script, noscript").forEach((element) => element.remove());
      clone.querySelectorAll("input, textarea").forEach((field) => {
        field.setAttribute("value", "[REDACTED]");
        field.textContent = "";
      });
      clone.querySelectorAll("*").forEach((element) => {
        for (const attribute of [...element.attributes]) {
          if (/(?:token|authorization|password|senha|cookie)/i.test(attribute.name)) {
            element.setAttribute(attribute.name, "[REDACTED]");
          }
        }
      });
      return `<!doctype html>\n${clone.outerHTML}`;
    })
    .catch(() => "");

  for (const secret of secrets) html = html.replaceAll(secret, "[REDACTED]");
  html = html.replace(
    /((?:access|refresh|auth|csrf)[_-]?token|authorization|cookie)(\s*[=:]\s*)["']?[^"'\s<]+/gi,
    "$1$2[REDACTED]",
  );
  writeFileSync(`${prefix}.html`, html, "utf8");
  console.log(`[${competitor}] Diagnostico sanitizado de falha salvo em ${diagnosticsDir}.`);
}

async function inspectCompetitorPrice(page, mapping, concorrente) {
  if (isCofema(concorrente)) return inspectCofemaPrice(page, mapping);
  if (isConstruja(concorrente)) return inspectConstrujaPrice(page, mapping);
  if (isMarest(concorrente)) return inspectMarestPrice(page, mapping);
  if (isMegaleste(concorrente)) return inspectMegalestePrice(page, mapping);

  throw new Error(
    `${resolveConcorrenteKey(concorrente?.nome)}: extrator seguro de preco nao configurado`,
  );
}

function logConfirmedPriceEvidence(result) {
  const competitor = String(result?.competitor ?? "CONCORRENTE").toUpperCase();
  console.log(`[${competitor}] URL confirmada: ${result.url}`);
  console.log(`[${competitor}] SKU confirmado: ${result.observedSku}`);
  console.log(
    `[${competitor}] Preco principal: seletor=${result.selector}; ` +
      `regra=${result.priceRule}; texto bruto=${JSON.stringify(result.rawText)}; ` +
      `valor=${result.price}.`,
  );
}

export async function collectPricesByBrowser(groups, options = {}) {
  mkdirSync(authStateDir, { recursive: true });
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency ?? 1)));
  const includesCofema = groups.some((group) => isCofema(group.concorrente));

  const browser = await chromium.launch({
    headless: !options.headed,
    ...(includesCofema ? { args: ["--disable-blink-features=AutomationControlled"] } : {}),
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
    userAgent: isCofema(group.concorrente) ? cofemaUserAgentForBrowser(browser) : userAgent,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    storageState: existsSync(statePath) ? statePath : undefined,
  });
  if (isCofema(group.concorrente)) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  }
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

    // Construja sessions may expire while their storage-state file remains present.
    // Always visit the login page and positively validate that session before collecting.
    if (!existsSync(statePath) || isConstruja(group.concorrente) || isCofema(group.concorrente)) {
      await prepareAuthenticatedSession(context, page, statePath, group.concorrente);
    }

    console.log(`[${group.concorrente.nome}] Iniciando ${group.mapeamentos.length} mapeamento(s).`);

    for (const [index, mapping] of group.mapeamentos.entries()) {
      const itemStartedAt = Date.now();
      const productLabel = `${mapping.produtos.sku_interno ?? "-"} - ${mapping.produtos.nome ?? "Produto"}`;
      const progressLabel = `[${group.concorrente.nome}] ${index + 1}/${group.mapeamentos.length} ${productLabel}`;

      try {
        if (
          !isCofema(group.concorrente) &&
          !usesSearchFlow(group.concorrente) &&
          !hasUsableProductUrl(mapping)
        ) {
          throw new Error("URL do produto nao cadastrada");
        }

        await reportProgress(options, `Lendo ${progressLabel}`);
        await openProductWithAuthenticatedSession(
          page,
          context,
          statePath,
          mapping,
          group.concorrente,
        );

        if (await isLoginRequired(page, group.concorrente)) {
          throw new Error(
            isCofema(group.concorrente)
              ? "COFEMA: login nao confirmado"
              : "Login nao confirmado; pagina ainda solicita autenticacao",
          );
        }

        if (
          isCofema(group.concorrente) &&
          !(await isExpectedProductPage(page, mapping, group.concorrente))
        ) {
          throw new Error("COFEMA: produto nao corresponde ao mapeamento");
        }

        const priceResult = await inspectCompetitorPrice(page, mapping, group.concorrente);
        if (!isConfirmedPriceEvidence(priceResult)) {
          throw new Error(
            priceResult?.error ||
              `${resolveConcorrenteKey(group.concorrente.nome)}: leitura de preco nao confirmada`,
          );
        }
        const price = Number(priceResult.price);

        logConfirmedPriceEvidence(priceResult);

        resultados.push({
          mapeamento_id: mapping.id,
          preco_construjota: Number(mapping.produtos.preco_atual ?? 0),
          preco_concorrente: price,
          status: "sucesso",
          ...persistenceFieldsForPriceEvidence(priceResult),
        });
        console.log(
          `${progressLabel}: sucesso em ${Math.round((Date.now() - itemStartedAt) / 1000)}s.`,
        );
      } catch (error) {
        await captureCompetitorFailureDiagnostics(page, mapping, group.concorrente.nome).catch(
          () => null,
        );
        if (isAuthStateError(error) && existsSync(statePath)) {
          await resetAuthState(
            context,
            page,
            statePath,
            group.concorrente,
            "falha de autenticacao",
          );
        }

        resultados.push({
          mapeamento_id: mapping.id,
          preco_construjota: Number(mapping.produtos.preco_atual ?? 0),
          preco_concorrente: null,
          status: "erro",
          mensagem_erro: error instanceof Error ? error.message : "Erro desconhecido",
          concorrente: resolveConcorrenteKey(group.concorrente.nome),
          preservar_ultimo_preco: true,
        });
        console.log(
          `${progressLabel}: erro em ${Math.round((Date.now() - itemStartedAt) / 1000)}s - ${
            error instanceof Error ? error.message : "Erro desconhecido"
          }`,
        );
      }
    }
  } catch (error) {
    console.error(
      `[${group.concorrente.nome}] Falha geral antes/durante a coleta: ${
        error instanceof Error ? error.message : "Erro desconhecido"
      }`,
    );
    await captureCompetitorFailureDiagnostics(page, null, group.concorrente.nome).catch(() => null);
    if (existsSync(statePath)) {
      await resetAuthState(context, page, statePath, group.concorrente, "falha geral");
    }

    for (const mapping of group.mapeamentos) {
      resultados.push({
        mapeamento_id: mapping.id,
        preco_construjota: Number(mapping.produtos.preco_atual ?? 0),
        preco_concorrente: null,
        status: "erro",
        mensagem_erro: error instanceof Error ? error.message : "Erro desconhecido",
        concorrente: resolveConcorrenteKey(group.concorrente.nome),
        preservar_ultimo_preco: true,
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

function productIdentity(mapping) {
  const supplierSku = String(mapping.sku_concorrente ?? "").trim();
  const fallbackSku = String(mapping.produtos?.sku_interno ?? "").trim();
  const codes = codeCandidates(supplierSku || fallbackSku);
  const productName = normalizeText(String(mapping.produtos?.nome ?? ""));
  const nameTerms = productName
    .split(/[^a-z0-9,]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 || /^\d+(?:[,.]\d+)?$/.test(term))
    .filter((term) => !/^(otto|baumgart|produto)$/.test(term));
  const variantTerms = productNameVariants(mapping.produtos?.nome)
    .flatMap((variant) => normalizeText(variant).split(/[^a-z0-9,]+/))
    .filter((term) => term.length >= 3 || /^\d+(?:[,.]\d+)?$/.test(term));

  return {
    codes: [...new Set(codes)],
    terms: [...new Set([...nameTerms, ...variantTerms])],
  };
}

function codeCandidates(value) {
  const normalized = normalizeText(String(value ?? ""));
  if (!normalized) return [];

  const exact = normalized.length >= 3 ? [normalized] : [];
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  const extracted = [...normalized.matchAll(/\d{3,}/g)].map((match) => match[0]);

  return [...new Set([...exact, ...(compact.length >= 3 ? [compact] : []), ...extracted])];
}

function productNameVariants(name) {
  const normalized = normalizeText(String(name ?? ""));
  if (!normalized) return [];

  const withoutGenericUnits = normalized
    .replace(/\b(lts?|litros?|un|und|unidade|balde|sache|gal[aã]o|galao)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const brandAndMeasure = normalized.match(/\bbianco\b.*?\b\d+(?:[,.]\d+)?\b/)?.[0];

  return [withoutGenericUnits, brandAndMeasure].filter((term) => term && term.length >= 6);
}

async function waitForProductSignal(page) {
  await waitForActionableProductSignal(page);
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        return /R\$\s*\d|\d{1,3}(?:\.\d{3})*,\d{2,3}|indisponivel|indisponível|fora de estoque|sem estoque|esgotado|login|cadastre-se|preco|preço/i.test(
          text,
        );
      },
      { timeout: productSignalTimeoutMs },
    )
    .catch(() => null);
}

async function waitForConstrujaPriceSignal(page) {
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        return /R\$\s*\d|indisponivel|indisponível|fora de estoque|sem estoque|esgotado|entre ou cadastre|cadastre-se para ver/i.test(
          text,
        );
      },
      { timeout: construjaPriceSignalTimeoutMs },
    )
    .catch(() => null);
}

async function waitForActionableProductSignal(page) {
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        const normalized = text
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        return /R\$\s*\d|\d{1,3}(?:\.\d{3})*,\d{2,3}|indisponivel|fora de estoque|sem estoque|esgotado|definir configuracoes|escolha uma regiao/.test(
          normalized,
        );
      },
      { timeout: productSignalTimeoutMs },
    )
    .catch(() => null);
}

async function isLoginRequired(page, concorrente = null) {
  if (concorrente && isCofema(concorrente)) {
    return !(await isCofemaLoggedIn(page));
  }

  if (concorrente && isConstruja(concorrente)) {
    return isConstrujaLoggedOut(page);
  }

  const text = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  const normalized = normalizeText(text);

  if (!normalized) return false;
  if (await hasVisiblePasswordField(page)) return true;

  if (
    [
      /necessario login/,
      /necess[aá]rio login/,
      /fazer login\/criar conta/,
      /faca login ou registre-se/,
      /fa[cç]a login ou registre-se/,
      /voce precisa de uma conta para ver os precos/,
      /voc[eê] precisa de uma conta para ver os pre[cç]os/,
      /faca login/,
      /entre ou cadastre-se/,
      /cadastre-se para ver os precos/,
      /login para ver os precos/,
      /entre para ver os precos/,
      /acesse sua conta para ver os precos/,
      /preco disponivel apenas para clientes/,
      /para visualizar os precos/,
      /voce precisa estar logado/,
      /login do cliente/,
      /digite seu codigo/,
      /cpf ou cnpj/,
      /digite sua senha/,
    ].some((pattern) => pattern.test(normalized))
  ) {
    return true;
  }

  return /fa[cç]a login|cadastre-se para ver os pre[cç]os/i.test(text);
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

  return /n[aã]o foi poss[ií]vel localizar seu cadastro|login e\/ou senha|senha inv[aá]lida|login inv[aá]lido|usu[aá]rio ou senha|usuario ou senha|c[oó]digo.*inv[aá]lido|cpf.*inv[aá]lido|cnpj.*inv[aá]lido|credenciais inv[aá]lidas/i.test(
    text,
  );
}

async function shouldRetryLogin(page, mapping, concorrente) {
  if (isCofema(concorrente)) return !(await isCofemaLoggedIn(page));
  if (isConstruja(concorrente)) return isConstrujaLoggedOut(page);
  if (isMarest(concorrente)) return !(await isMarestLoggedIn(page));
  if (await isLoginRequired(page)) return true;

  if (isMegaleste(concorrente)) {
    const path = new URL(page.url()).pathname.replace(/\/+$/, "");
    if (path === "/sp" || path === "") return true;
  }

  return false;
}
