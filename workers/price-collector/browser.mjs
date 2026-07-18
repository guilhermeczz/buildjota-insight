import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { credentialsFor, resolveConcorrenteKey } from "./config.mjs";
import { extractPrice, extractPriceNearTerms } from "./extract-price.mjs";

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
const cofemaBaseUrl = process.env.COFEMA_BASE_URL ?? "https://novo.cofema.com.br";
const cofemaLoginUrl = process.env.COFEMA_LOGIN_URL ?? "/";
const cofemaUnidade = process.env.COFEMA_UNIDADE ?? "SUMARE";
const marestRegiao = process.env.MAREST_REGIAO ?? "SP";
const megalesteRegiao = process.env.MEGALESTE_REGIAO ?? "SP";

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

function isAuthStateError(error) {
  if (!(error instanceof Error)) return false;

  return /Credenciais invalidas|Credenciais nao configuradas|Formulario de login|Login nao confirmado|Configuracao de unidade|Regiao .* nao selecionada/i.test(
    error.message,
  );
}

function allowsPublicPriceRead(concorrente) {
  return false;
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

function absoluteUrl(value, fallbackBase) {
  if (!value) return fallbackBase;
  try {
    return new URL(value).toString();
  } catch {
    return new URL(value, fallbackBase).toString();
  }
}

function cofemaUrl(value = "/", fallbackBase = cofemaBaseUrl) {
  const url = new URL(value || "/", fallbackBase || cofemaBaseUrl);

  if (/cofema\.com\.br$/i.test(url.hostname)) {
    url.protocol = "https:";
    url.hostname = new URL(cofemaBaseUrl).hostname;
  }

  return url.toString();
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
    if (isCofema(concorrente)) {
      await ensurePreferencesForRead(page, concorrente).catch(() => false);
      console.log(
        "[COFEMA] Formulario de login nao identificado; tentando leitura com sessao/unidade atual.",
      );
      return;
    }

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

  if (await isConstrujaLoggedIn(page)) return;

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
    if (await isConstrujaLoginFormVisible(page)) return true;

    await clickFirstVisible(page, [
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

    const visible = await waitForConstrujaLoginForm(page);
    if (visible) return true;
    await page.waitForTimeout(600);
  }

  return false;
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
  if (await isConstrujaLoginFormVisible(page)) return false;

  const text = await page
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  const normalized = normalizeText(text);
  if (!normalized) return false;

  // The header can render after the rest of the page. Absence of the login button is not
  // proof of authentication; require an explicit customer/session signal instead.
  if (/entre ou cadastre-se|entrar ou cadastrar-se/.test(normalized)) return false;

  const hasCustomerArea = /area do cliente|minha conta|meus pedidos/.test(normalized);
  const hasCustomerData =
    /loja:\s*\S|filial:\s*\S|credito disponivel|limite disponivel/.test(normalized) ||
    /area do cliente.{0,300}centermak|centermak.{0,300}area do cliente/.test(normalized);
  const hasLogout = /\b(deslogar|sair)\b/.test(normalized);
  return hasLogout || (hasCustomerArea && hasCustomerData);
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
  await dismissOverlays(page);

  if (await isCofemaLoggedIn(page)) {
    await ensurePreferencesForRead(page, concorrente);
    return;
  }
  await clearCofemaLocalAuth(page);

  const opened = await openCofemaLoginModal(page);
  if (!opened) {
    throw new Error("Formulario de login da COFEMA nao abriu");
  }

  const loginFilled = await fillFirstVisible(
    page,
    [
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
    throw new Error("Campos de login da COFEMA nao foram identificados");
  }

  const clicked = await clickFirstVisible(page, [
    "[role='dialog'] button:has-text('Entrar')",
    "[role='dialog'] button[type='submit']",
    ".modal button:has-text('Entrar')",
    ".modal button[type='submit']",
    "#dialog-model .btLogin",
    "#dialog-model button[type='submit']",
    "#dialog-model input[type='submit']",
    "#dialog-model button:has-text('Entrar')",
    "#dialog-model button:has-text('Acessar')",
    ".modal.show .btLogin",
  ]);

  if (!clicked) {
    await page.keyboard.press("Enter");
  }

  const logged = await waitForCofemaLogin(page);
  if (await hasInvalidCredentialsMessage(page)) {
    throw new Error("Credenciais invalidas em COFEMA");
  }
  if (!logged) {
    throw new Error("Login nao confirmado em COFEMA");
  }

  await ensurePreferencesForRead(page, concorrente);
}

async function openCofemaLoginModal(page) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
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
      ])) || (await clickCofemaLoginByDom());

    if (clicked) {
      await page.waitForTimeout(350);
      await clickCofemaAreaCliente(page);
    }

    const visible = await waitForCofemaLoginForm(page);

    if (visible) return true;
    await page.waitForTimeout(600);
  }

  return false;
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

  const userValue = await page
    .locator("input[name='user']")
    .first()
    .getAttribute("value", { timeout: 1000 })
    .catch(() => "");

  if (userValue === "true") return true;

  const hasStoredAuth = await page
    .evaluate(() => {
      const hasAuthEntry = (storage) => {
        if (!storage) return false;
        return Object.entries(storage).some(([key, value]) => {
          const name = String(key ?? "");
          const content = String(value ?? "");
          return (
            /token|jwt|auth|cliente|customer|session|usuario|user/i.test(name) &&
            content &&
            !/^(false|null|undefined|\{\}|\[\])$/i.test(content)
          );
        });
      };

      return hasAuthEntry(window.localStorage) || hasAuthEntry(window.sessionStorage);
    })
    .catch(() => false);

  if (hasStoredAuth) return true;

  return pageHasText(page, [
    /minha conta/,
    /meus pedidos/,
    /sair/,
    /ola[, ]/,
    /ol[aá][, ]/,
    /bem vindo/,
  ]);
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

    const modalHasPassword = await isCofemaLoginFormVisible(page);
    if (!modalHasPassword && (await isCofemaLoggedIn(page))) return true;

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
  try {
    return await ensureConcorrentePreferences(page, concorrente);
  } catch (error) {
    if (!allowsPublicPriceRead(concorrente)) throw error;

    console.log(
      `[${concorrente.nome}] Preferencia do site nao confirmou; seguindo leitura publica.`,
    );
    await closeVisibleDialog(page).catch(() => false);
    return false;
  }
}

async function configureCofema(page) {
  if (!(await isCofemaPromptVisible(page))) return false;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const selected = await selectVisibleOption(page, cofemaUnidade);
    await page.waitForTimeout(350);
    if (!selected) {
      console.log(
        `[COFEMA] Unidade ${cofemaUnidade} nao encontrada no seletor; tentativa ${attempt}.`,
      );
    }

    const clicked = await confirmCofemaSettings(page);
    if (!clicked) {
      throw new Error("Configuracao de unidade da COFEMA nao confirmada");
    }

    await page
      .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
      .catch(() => null);
    await page.waitForTimeout(1200);

    if (!(await isCofemaPromptVisible(page))) {
      console.log(`[COFEMA] Configuracoes confirmadas (${cofemaUnidade}).`);
      return true;
    }

    if (await pageHasText(page, [new RegExp(`unidade:?\\s*${escapeRegex(cofemaUnidade)}`, "i")])) {
      const closed = await closeVisibleDialog(page);
      if (closed && !(await isCofemaPromptVisible(page))) {
        console.log(`[COFEMA] Unidade ${cofemaUnidade} ja estava ativa; modal fechada.`);
        return true;
      }
    }
  }

  throw new Error("Configuracao de unidade da COFEMA permaneceu aberta");
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
  if (usesSearchFlow(concorrente)) {
    await openProductBySearch(page, context, statePath, mapping, concorrente);
    return;
  }

  const productUrl = productUrlForMapping(mapping, concorrente);

  if (isConstruja(concorrente)) {
    console.log(`[CONSTRUJA] Abrindo produto na mesma sessao: ${productUrl}`);
  }

  await page.goto(productUrl, {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  });
  await dismissOverlays(page);

  if (await ensurePreferencesForRead(page, concorrente)) {
    await context.storageState({ path: statePath });
    await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    });
    await dismissOverlays(page);
    if (await ensurePreferencesForRead(page, concorrente)) {
      await context.storageState({ path: statePath });
    }
  }

  await waitForProductSignal(page);
  await dismissOverlays(page);
  if (await ensurePreferencesForRead(page, concorrente)) {
    await context.storageState({ path: statePath });
    await waitForProductSignal(page);
  }
  if (productSettleMs > 0) await page.waitForTimeout(productSettleMs);
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
    await login(page, concorrente);
    await ensurePreferencesForRead(page, concorrente);
    await context.storageState({ path: statePath });
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
      await page.goto(searchStartUrl, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeoutMs,
      });
      await dismissOverlays(page);

      if (await ensurePreferencesForRead(page, concorrente)) {
        await context.storageState({ path: statePath });
        await page.goto(searchStartUrl, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeoutMs,
        });
        await dismissOverlays(page);
      }

      const searched = await submitSiteSearch(page, query);
      const searchHasResults = searched && (await hasSearchResultContent(page, query, mapping));
      const openedSearchPage =
        searchHasResults || (await openSearchFallback(page, query, concorrente, mapping));
      if (!openedSearchPage) {
        lastError = new Error(`Busca nao retornou resultado para "${query}"`);
        continue;
      }

      await waitForProductSignal(page);

      if (!(await isExpectedProductPage(page, mapping))) {
        await clickBestSearchResult(page, mapping);
        await waitForProductSignal(page);
      }

      if (await ensurePreferencesForRead(page, concorrente)) {
        await context.storageState({ path: statePath });
        await waitForProductSignal(page);
      }

      if (productSettleMs > 0) await page.waitForTimeout(productSettleMs);

      if (await isExpectedProductPage(page, mapping)) return;

      lastError = new Error(`Produto nao confirmado na busca por "${query}"`);
    } catch (error) {
      lastError = error;
    }
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
      if (await hasSearchResultContent(page, query, mapping)) return true;
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

  const descriptionQueries = [productName, ...productVariants].filter(Boolean);
  const rawQueries = supplierSku
    ? [
        supplierSku,
        ...(productName ? [`${supplierSku} ${productName}`] : []),
        ...descriptionQueries.map((description) => `${supplierSku} ${description}`),
        ...(internalSku && internalSku !== supplierSku ? [`${supplierSku} ${internalSku}`] : []),
      ]
    : [productName, ...productVariants, internalSku];

  return [...new Set(rawQueries.map(cleanSearchQuery).filter((query) => query.length >= 2))];
}

function cleanSearchQuery(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function searchStartUrlForMapping(mapping, concorrente) {
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

async function hasSearchResultContent(page, query, mapping) {
  if (await isExpectedProductPage(page, mapping)) return true;

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

async function clickBestSearchResult(page, mapping) {
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

async function isExpectedProductPage(page, mapping) {
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

async function isCofemaPromptVisible(page) {
  return (
    (await pageHasText(page, [/definir configuracoes/])) ||
    (await page
      .locator("button:has-text('Definir configura'), .modal:has-text('Definir configura')")
      .first()
      .isVisible()
      .catch(() => false))
  );
}

async function confirmCofemaSettings(page) {
  const selectors = [
    ".modal.show button:has-text('Definir configura')",
    ".modal button:has-text('Definir configura')",
    "[role='dialog'] button:has-text('Definir configura')",
    "button:has-text('Definir configura')",
    "input[type='submit'][value*='Definir']",
    ".modal.show button.btn-primary",
    ".modal button.btn-primary",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;

    const clicked = await locator.click({ timeout: actionTimeoutMs, force: true }).then(
      () => true,
      () => false,
    );
    if (clicked) return true;
  }

  if (await clickCofemaDefineButton(page)) return true;

  const focused = await page
    .locator(
      ".modal.show button:has-text('Definir configura'), button:has-text('Definir configura')",
    )
    .first()
    .focus({ timeout: actionTimeoutMs })
    .then(
      () => true,
      () => false,
    );
  if (focused) {
    await page.keyboard.press("Enter");
    return true;
  }

  return false;
}

async function clickCofemaDefineButton(page) {
  const clicked = await page
    .evaluate(() => {
      const normalize = (value) =>
        String(value ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const candidates = [...document.querySelectorAll("button, input[type='submit'], a")];
      const target = candidates.find((node) => {
        const element = node instanceof HTMLElement ? node : null;
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getBoundingClientRect().width > 0 &&
          element.getBoundingClientRect().height > 0;
        const label =
          element instanceof HTMLInputElement
            ? element.value
            : element.innerText || element.textContent;
        return visible && normalize(label).includes("definir configuracoes");
      });

      if (!target) return false;
      target.click();
      return true;
    })
    .catch(() => false);

  if (!clicked) return false;

  await page
    .waitForLoadState("domcontentloaded", { timeout: quickLoadTimeoutMs })
    .catch(() => null);
  return true;
}

async function closeVisibleDialog(page) {
  return clickFirstVisible(page, [
    ".modal.show button.close",
    ".modal.show [data-dismiss='modal']",
    ".modal.show [aria-label='Close']",
    ".modal.show [aria-label='Fechar']",
    ".modal button.close",
    ".modal [data-dismiss='modal']",
    ".modal [aria-label='Close']",
    ".modal [aria-label='Fechar']",
  ]);
}

async function selectVisibleOption(page, optionText) {
  const target = normalizeText(optionText);
  const selects = page.locator("select");
  const count = await selects.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const select = selects.nth(index);
    const visible = await select.isVisible().catch(() => false);
    if (!visible) continue;

    const option = await select
      .locator("option")
      .evaluateAll((nodes, targetText) => {
        const normalize = (value) =>
          String(value ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        return nodes
          .map((node) => ({ value: node.value, text: node.textContent ?? "" }))
          .find(
            (item) =>
              normalize(item.value).includes(targetText) ||
              normalize(item.text).includes(targetText),
          );
      }, target)
      .catch(() => null);

    if (!option?.value) continue;

    await select.selectOption(option.value, { timeout: actionTimeoutMs });
    await select.dispatchEvent("input").catch(() => null);
    await select.dispatchEvent("change").catch(() => null);
    return true;
  }

  return false;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

    // Construja sessions may expire while their storage-state file remains present.
    // Always visit the login page and positively validate that session before collecting.
    if (!existsSync(statePath) || isConstruja(group.concorrente)) {
      await login(page, group.concorrente);
      await ensurePreferencesForRead(page, group.concorrente);
      await context.storageState({ path: statePath });
    }

    console.log(`[${group.concorrente.nome}] Iniciando ${group.mapeamentos.length} mapeamento(s).`);

    for (const [index, mapping] of group.mapeamentos.entries()) {
      const itemStartedAt = Date.now();
      const productLabel = `${mapping.produtos.sku_interno ?? "-"} - ${mapping.produtos.nome ?? "Produto"}`;
      const progressLabel = `[${group.concorrente.nome}] ${index + 1}/${group.mapeamentos.length} ${productLabel}`;

      try {
        if (!usesSearchFlow(group.concorrente) && !mapping.url_produto) {
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
          throw new Error("Login nao confirmado; pagina ainda solicita autenticacao");
        }

        if (await isProductUnavailableForMapping(page, mapping, group.concorrente)) {
          throw new Error("Produto indisponível no concorrente");
        }

        const priceOptions = {
          referencePrice: Number(mapping.produtos.preco_atual ?? 0),
        };
        const price = usesSearchFlow(group.concorrente)
          ? await extractPriceNearTerms(page, priceSearchTerms(mapping), priceOptions)
          : ((await extractPriceNearTerms(page, priceSearchTerms(mapping), priceOptions)) ??
            (await extractPrice(page, mapping.seletor_preco, priceOptions)));

        if (await isProductUnavailableForMapping(page, mapping, group.concorrente)) {
          throw new Error("Produto indisponível no concorrente");
        }

        if (!price) {
          if (await isProductUnavailableForMapping(page, mapping, group.concorrente)) {
            throw new Error("Produto indisponível no concorrente");
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

function priceSearchTerms(mapping) {
  const supplierSku = String(mapping.sku_concorrente ?? "").trim();
  if (supplierSku) return [...new Set([supplierSku, ...codeCandidates(supplierSku)])];

  const terms = [
    mapping.produtos?.sku_interno,
    mapping.produtos?.nome,
    ...productNameVariants(mapping.produtos?.nome),
  ];

  return [...new Set(terms.map((term) => String(term ?? "").trim()).filter(Boolean))];
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
  if (concorrente && isConstruja(concorrente)) {
    return !(await isConstrujaLoggedIn(page));
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

async function isProductUnavailable(page) {
  const text = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  const normalized = normalizeText(text);

  if (
    /fora\s+(?:de|do)\s+estoque|produto\s+indisponivel|item\s+indisponivel|nao\s+disponivel|indisponivel\s+no\s+momento|temporariamente\s+indisponivel|sem\s+(?:estoque|saldo)|produto\s+esgotado|esgotado|avise-?me\s+quando\s+(?:chegar|disponivel)|aviseme\s+quando\s+(?:chegar|disponivel)|produto\s+sob\s+consulta|consulte\s+(?:a\s+)?disponibilidade|aguardando\s+estoque/.test(
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
        "button:has-text('Fora de Estoque')",
        "button:has-text('Fora do Estoque')",
        "button:has-text('Indisponível')",
        "button:has-text('Indisponivel')",
        "button:has-text('Esgotado')",
        "[aria-disabled='true']:has-text('Comprar')",
        "[aria-disabled='true']:has-text('Adicionar')",
        "[aria-disabled='true']:has-text('Fora de Estoque')",
        "[class*='indisponivel' i]",
        "[class*='fora-estoque' i]",
        "[class*='fora_de_estoque' i]",
        "[class*='sem-estoque' i]",
        "[class*='sem_estoque' i]",
        "[class*='unavailable' i]",
        "[class*='out-of-stock' i]",
      ].join(", "),
    )
    .count()
    .catch(() => 0);

  return unavailableControls > 0;
}

async function isProductUnavailableForMapping(page, mapping, concorrente) {
  const availability = await expectedProductAvailability(page, mapping);
  if (availability.unavailable) return true;
  if (availability.found) return false;

  return usesSearchFlow(concorrente) ? false : isProductUnavailable(page);
}

async function expectedProductAvailability(page, mapping) {
  const identity = productIdentity(mapping);
  if (identity.codes.length === 0 && identity.terms.length === 0) {
    return { found: false, unavailable: await isProductUnavailable(page) };
  }

  return page
    .evaluate(({ codes, terms }) => {
      const unavailableSignalPattern =
        /fora\s+(?:de|do)\s+estoque|sem\s+(?:estoque|saldo)|nao\s+disponivel|indisponivel|temporariamente\s+indisponivel|esgotado|avise-?me\s+quando\s+(?:chegar|disponivel)|aviseme\s+quando\s+(?:chegar|disponivel)|produto\s+sob\s+consulta|consulte\s+(?:a\s+)?disponibilidade|aguardando\s+estoque/;
      const pricePattern = /R\$\s*\d|\d{1,3}(?:\.\d{3})*,\d{2,3}/;
      const buyActionPattern = /\b(adic\.?|adicionar|comprar|carrinho)\b/;
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
      const isExpectedBlock = (text) => {
        if (codes.length > 0) return hasCode(text);
        const matches = matchedTerms(text);
        const numericTerms = terms.filter((term) => /^\d+(?:[,.]\d+)?[a-z]*$/.test(term));
        const hasMeasure =
          numericTerms.length === 0 || numericTerms.some((term) => text.includes(term));
        return hasMeasure && matches.length >= Math.min(2, terms.length);
      };

      const nodes = [
        ...document.querySelectorAll(
          [
            "article",
            "li",
            "tr",
            "[class*='produto' i]",
            "[class*='product' i]",
            "[class*='item' i]",
            "[class*='card' i]",
            "[class*='col-' i]",
            "section",
            "main",
            "div",
          ].join(", "),
        ),
      ];

      const candidates = nodes
        .filter((node) => node instanceof HTMLElement && visible(node))
        .map((node) => {
          const rawText = node.innerText || node.textContent || "";
          const text = normalize(rawText);
          return {
            text,
            length: text.length,
            hasPrice: pricePattern.test(rawText),
            hasBuyAction: buyActionPattern.test(text),
            unavailable: unavailableSignalPattern.test(text),
          };
        })
        .filter((item) => item.length > 0 && item.length <= 2500 && isExpectedBlock(item.text))
        .sort((a, b) => a.length - b.length)
        .slice(0, 12);

      const availableCandidate = candidates.find(
        (item) => !item.unavailable && (item.hasPrice || item.hasBuyAction),
      );
      if (availableCandidate) return { found: true, unavailable: false };

      const unavailableCandidate = candidates.find(
        (item) => item.unavailable && !item.hasPrice && !item.hasBuyAction,
      );
      if (unavailableCandidate) return { found: true, unavailable: true };

      return {
        found: candidates.length > 0,
        unavailable:
          candidates.length > 0 && candidates.every((item) => !item.hasPrice && !item.hasBuyAction),
      };
    }, identity)
    .catch(() => ({ found: false, unavailable: false }));
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
  if (isCofema(concorrente)) return isLoginRequired(page);
  if (isConstruja(concorrente)) return !(await isConstrujaLoggedIn(page));
  if (isMarest(concorrente)) return !(await isMarestLoggedIn(page));
  if (await isLoginRequired(page)) return true;

  if (isMegaleste(concorrente)) {
    const path = new URL(page.url()).pathname.replace(/\/+$/, "");
    if (path === "/sp" || path === "") return true;
  }

  return false;
}
