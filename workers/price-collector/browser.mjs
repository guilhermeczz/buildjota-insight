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

function absoluteUrl(value, fallbackBase) {
  if (!value) return fallbackBase;
  try {
    return new URL(value).toString();
  } catch {
    return new URL(value, fallbackBase).toString();
  }
}

function productUrlForMapping(mapping, concorrente) {
  if (resolveConcorrenteKey(concorrente.nome) === "MEGALESTE" && mapping.sku_concorrente) {
    return absoluteUrl(`/c/produto/${mapping.sku_concorrente}`, concorrente.site_url);
  }

  return absoluteUrl(mapping.url_produto, concorrente.site_url);
}

function loginUrlForConcorrente(concorrente) {
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
    if (resolveConcorrenteKey(concorrente.nome) === "COFEMA") {
      await ensureConcorrentePreferences(page, concorrente).catch(() => false);
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

async function openLoginSurface(page) {
  await clickFirstVisible(page, [
    ".menu-user > a",
    "a[role='button'][data-toggle='dropdown'][aria-haspopup='true']",
    "a[data-toggle='dropdown']:has(svg)",
    "#botao-login",
    "a[href*='cliente' i]",
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
  const productUrl = productUrlForMapping(mapping, concorrente);

  await page.goto(productUrl, {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  });

  if (await ensureConcorrentePreferences(page, concorrente)) {
    await context.storageState({ path: statePath });
    await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: navigationTimeoutMs,
    });
    if (await ensureConcorrentePreferences(page, concorrente)) {
      await context.storageState({ path: statePath });
    }
  }

  await waitForProductSignal(page);
  if (await ensureConcorrentePreferences(page, concorrente)) {
    await context.storageState({ path: statePath });
    await waitForProductSignal(page);
  }
  if (productSettleMs > 0) await page.waitForTimeout(productSettleMs);
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
      await ensureConcorrentePreferences(page, group.concorrente);
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
        await openProductPage(page, context, statePath, mapping, group.concorrente);

        if (await shouldRetryLogin(page, mapping, group.concorrente)) {
          rmSync(statePath, { force: true });
          await context.clearCookies().catch(() => null);
          await login(page, group.concorrente);
          await ensureConcorrentePreferences(page, group.concorrente);
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
          /Credenciais invalidas|Login nao confirmado|Configuracao de unidade|Regiao .* nao selecionada/i.test(
            error.message,
          ) &&
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

function priceSearchTerms(mapping) {
  const terms = [
    mapping.sku_concorrente,
    mapping.produtos?.sku_interno,
    mapping.produtos?.nome,
    ...productNameVariants(mapping.produtos?.nome),
  ];

  return [...new Set(terms.map((term) => String(term ?? "").trim()).filter(Boolean))];
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
        return /R\$\s*\d|\d{1,3}(?:\.\d{3})*,\d{2,3}|indisponivel|indisponível|sem estoque|esgotado|login|cadastre-se|preco|preço/i.test(
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

        return /R\$\s*\d|\d{1,3}(?:\.\d{3})*,\d{2,3}|indisponivel|sem estoque|esgotado|definir configuracoes|escolha uma regiao/.test(
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
