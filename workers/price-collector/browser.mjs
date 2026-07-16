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

function consultaTipo(concorrente) {
  return String(concorrente.tipo_consulta ?? "URL")
    .trim()
    .toUpperCase();
}

function usesSearchFlow(concorrente) {
  return consultaTipo(concorrente) === "BUSCA";
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

function productUrlForMapping(mapping, concorrente) {
  if (isCofema(concorrente)) {
    return cofemaUrl(mapping.url_produto || concorrente.site_url);
  }

  if (resolveConcorrenteKey(concorrente.nome) === "MEGALESTE" && mapping.sku_concorrente) {
    return absoluteUrl(`/c/produto/${mapping.sku_concorrente}`, concorrente.site_url);
  }

  return absoluteUrl(mapping.url_produto, concorrente.site_url);
}

function loginUrlForConcorrente(concorrente) {
  if (isCofema(concorrente)) {
    return cofemaUrl(cofemaLoginUrl);
  }

  if (resolveConcorrenteKey(concorrente.nome) === "MAREST") {
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

  if (isCofema(concorrente)) {
    await loginCofema(page, concorrente, credentials);
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

async function ensureConcorrentePreferences(page, concorrente) {
  const nome = resolveConcorrenteKey(concorrente.nome);

  if (nome === "COFEMA") return configureCofema(page);
  if (nome === "MAREST") return configureRegionSelector(page, "MAREST", marestRegiao);
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

  await page.goto(productUrl, {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  });

  if (await ensurePreferencesForRead(page, concorrente)) {
    await context.storageState({ path: statePath });
    await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    });
    if (await ensurePreferencesForRead(page, concorrente)) {
      await context.storageState({ path: statePath });
    }
  }

  await waitForProductSignal(page);
  if (await ensurePreferencesForRead(page, concorrente)) {
    await context.storageState({ path: statePath });
    await waitForProductSignal(page);
  }
  if (productSettleMs > 0) await page.waitForTimeout(productSettleMs);
}

async function openProductBySearch(page, context, statePath, mapping, concorrente) {
  const queries = searchQueriesForMapping(mapping);
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

      if (await ensurePreferencesForRead(page, concorrente)) {
        await context.storageState({ path: statePath });
        await page.goto(searchStartUrl, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeoutMs,
        });
      }

      const searched = await submitSiteSearch(page, query);
      const openedSearchPage =
        searched || (await openSearchFallback(page, query, concorrente, mapping));
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

      await waitForProductSignal(page);
      if (await hasSearchResultContent(page, query, mapping)) return true;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return false;
}

function searchQueriesForMapping(mapping) {
  const supplierSku = cleanSearchQuery(mapping.sku_concorrente);
  const productName = cleanSearchQuery(mapping.produtos?.nome);
  const productVariants = productNameVariants(mapping.produtos?.nome).map(cleanSearchQuery);
  const internalSku = cleanSearchQuery(mapping.produtos?.sku_interno);

  const descriptionQueries = [productName, ...productVariants].filter(Boolean);
  const rawQueries = supplierSku
    ? [
        ...(productName
          ? [
              `${supplierSku} ${productName}`,
              `Codigo ${supplierSku} ${productName}`,
              `Cod ${supplierSku} ${productName}`,
            ]
          : []),
        ...descriptionQueries.map((description) => `${supplierSku} ${description}`),
        `Codigo ${supplierSku}`,
        `Codigo: ${supplierSku}`,
        `Código ${supplierSku}`,
        `Cod ${supplierSku}`,
        `Cod: ${supplierSku}`,
        supplierSku,
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
    : absoluteUrl(concorrente.site_url || concorrente.login_url || "/", concorrente.site_url);

  if (usesSearchFlow(concorrente)) return fallback;
  if (!mapping.url_produto) return fallback;

  return isCofema(concorrente)
    ? cofemaUrl(mapping.url_produto, fallback)
    : absoluteUrl(mapping.url_produto, fallback);
}

function searchUrlFallbacks(query, concorrente) {
  const encoded = encodeURIComponent(query);
  const base = isCofema(concorrente)
    ? cofemaUrl("/")
    : absoluteUrl(concorrente.site_url || concorrente.login_url || "/", concorrente.site_url);

  const host = new URL(base).hostname;
  if (/marest/i.test(host)) {
    return [
      absoluteUrl(`/product?search=${encoded}`, base),
      absoluteUrl(`/busca?search=${encoded}`, base),
      absoluteUrl(`/busca?q=${encoded}`, base),
    ];
  }

  if (/megaleste/i.test(host)) {
    const urls = [
      absoluteUrl(`/sp?q=${encoded}`, base),
      absoluteUrl(`/sp?search=${encoded}`, base),
      absoluteUrl(`/busca?q=${encoded}`, base),
    ];
    if (/^\d+$/.test(query)) urls.push(absoluteUrl(`/c/produto/${encoded}`, base));
    return urls;
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
    "input[placeholder*='pesquisar' i]",
    "input[placeholder*='procura' i]",
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

    if (await clickSearchSubmit(page)) {
      await page.waitForTimeout(900);
      if (await hasSearchChanged(page, beforeUrl, query)) return true;
    }
  }

  return false;
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
        target.closest("a[href]") ??
        target.querySelector("button, [role='button']") ??
        target.closest("button, [role='button']");
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

    if (!existsSync(statePath)) {
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
        await openProductPage(page, context, statePath, mapping, group.concorrente);

        if (await shouldRetryLogin(page, mapping, group.concorrente)) {
          await resetAuthState(context, page, statePath, group.concorrente, "login vencido");
          await login(page, group.concorrente);
          await ensurePreferencesForRead(page, group.concorrente);
          await context.storageState({ path: statePath });
          await openProductPage(page, context, statePath, mapping, group.concorrente);
        }

        if (await isLoginRequired(page)) {
          throw new Error("Login nao confirmado; pagina ainda solicita autenticacao");
        }

        if (await isProductUnavailable(page)) {
          throw new Error("Produto indisponivel no concorrente");
        }

        const priceOptions = {
          referencePrice: Number(mapping.produtos.preco_atual ?? 0),
        };
        const price =
          (await extractPriceNearTerms(page, priceSearchTerms(mapping), priceOptions)) ??
          (await extractPrice(page, mapping.seletor_preco, priceOptions));

        if (await isProductUnavailable(page)) {
          throw new Error("Produto indisponivel no concorrente");
        }

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
  const terms = [
    mapping.sku_concorrente,
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
  const exact = /^\d{3,}$/.test(normalized) ? [normalized] : [];
  const extracted = [...normalized.matchAll(/\d{3,}/g)].map((match) => match[0]);

  return [...new Set([...exact, ...extracted])];
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

async function isLoginRequired(page) {
  const text = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  const normalized = normalizeText(text);

  if (!normalized) return false;
  if (hasPriceLikeText(text)) return false;
  if (await hasVisiblePasswordField(page)) return true;

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
    /fora\s+(?:de|do)\s+estoque|produto\s+indisponivel|item\s+indisponivel|indisponivel\s+no\s+momento|temporariamente\s+indisponivel|sem\s+estoque|produto\s+esgotado|esgotado|avise-?me\s+quando\s+chegar|aviseme\s+quando\s+chegar|produto\s+sob\s+consulta/.test(
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
  if (await isLoginRequired(page)) return true;

  if (resolveConcorrenteKey(concorrente.nome) === "MEGALESTE") {
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
