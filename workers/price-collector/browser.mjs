import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { credentialsFor } from "./config.mjs";
import { extractPrice } from "./extract-price.mjs";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const authStateDir = join(process.cwd(), ".worker-auth");

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

    await locator.fill(value, { timeout: 8000 });
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
      page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null),
      locator.click({ timeout: 8000 }).then(
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
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await dismissOverlays(page);
  await openLoginSurface(page);
  await page
    .locator("input[type='password'], input[name*='senha' i], input[id*='senha' i]")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
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
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  }

  await page.waitForTimeout(3000);

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

  await page.waitForTimeout(1000);
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
    await page.waitForTimeout(500);
  }
}

export async function collectPricesByBrowser(groups, options = {}) {
  mkdirSync(authStateDir, { recursive: true });

  const browser = await chromium.launch({
    headless: !options.headed,
  });

  const resultados = [];

  try {
    for (const group of groups) {
      const statePath = storageStatePath(group.concorrente.nome);
      const context = await browser.newContext({
        userAgent,
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        storageState: existsSync(statePath) ? statePath : undefined,
      });
      const page = await context.newPage();

      try {
        if (!existsSync(statePath)) {
          await login(page, group.concorrente);
          await context.storageState({ path: statePath });
        }

        for (const mapping of group.mapeamentos) {
          try {
            if (!mapping.url_produto) {
              throw new Error("URL do produto nao cadastrada");
            }

            const productUrl = productUrlForMapping(mapping, group.concorrente);
            await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
            await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
            await page.waitForTimeout(1500);

            if (await shouldRetryLogin(page, mapping, group.concorrente)) {
              await login(page, group.concorrente);
              await context.storageState({ path: statePath });
              await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
              await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
              await page.waitForTimeout(1500);
            }

            if (await isLoginRequired(page)) {
              throw new Error("Login nao confirmado; pagina ainda solicita autenticacao");
            }

            const price = await extractPrice(page, mapping.seletor_preco);

            if (!price) {
              throw new Error("Preco nao encontrado na pagina");
            }

            resultados.push({
              mapeamento_id: mapping.id,
              preco_construjota: Number(mapping.produtos.preco_atual ?? 0),
              preco_concorrente: price,
              status: "sucesso",
            });
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
              preco_concorrente: 0,
              status: "erro",
              mensagem_erro: error instanceof Error ? error.message : "Erro desconhecido",
            });
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
            preco_concorrente: 0,
            status: "erro",
            mensagem_erro: error instanceof Error ? error.message : "Erro desconhecido",
          });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return resultados;
}

async function isLoginRequired(page) {
  const text = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");

  return /fa[cç]a login|cadastre-se para ver os pre[cç]os/i.test(text);
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
