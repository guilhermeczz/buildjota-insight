const MAIN_BLOCK_SELECTOR = '[class*="ProductPage__productDetails__"]';
const INFO_BLOCK_SELECTOR = '[class*="ProductInfo__productInfo__"]';
const PRICE_SELECTOR = 'h3[class*="AddToCartContainer__price__"]';
const UNAVAILABLE_SELECTOR = '[class*="InfoMessage__messageContainer__"]';
const UNAVAILABLE_MESSAGE = "Ops! Já vendemos todo o estoque deste produto.";

export const construjotaMercosSelectors = Object.freeze({
  mainBlock: MAIN_BLOCK_SELECTOR,
  infoBlock: INFO_BLOCK_SELECTOR,
  price: PRICE_SELECTOR,
  unavailable: UNAVAILABLE_SELECTOR,
  search: 'input[placeholder="Pesquisar em todos os produtos"]',
  catalogCard: ".catalog-item-b2b",
  catalogSubtitle: '.catalog-item-b2b-subtitle, [class*="CatalogItem__subtitle__"]',
});

export function normalizeSku(value) {
  return String(value ?? "").trim();
}

export function skuFromMercosText(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const match = /C[oó]d\.\s*([^•|\r\n]+)/i.exec(normalized);
  return match ? normalizeSku(match[1]) : "";
}

export function subtitleMatchesExactSku(value, expectedSku) {
  return skuFromMercosText(value) === normalizeSku(expectedSku);
}

export function mercosProductIdFromUrl(value) {
  try {
    const url = new URL(value);
    return /^\/produtos\/(\d+)\/?$/.exec(url.pathname)?.[1] ?? "";
  } catch {
    return "";
  }
}

export function parseMercosTablePrice(value) {
  const normalized = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const matches = [
    ...normalized.matchAll(/R\$\s*((?:\d{1,3}(?:\.\d{3})+)|\d+)\s*,\s*(\d{2,3})(?!\d)/g),
  ];
  if (matches.length !== 1) return null;
  const integer = matches[0][1].replace(/\./g, "");
  const decimal = matches[0][2];
  const parsed = Number(`${integer}.${decimal}`);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function errorResult(status, message, details = {}) {
  return {
    status,
    preco: null,
    mensagem: message,
    produto_confirmado: false,
    preco_principal_confirmado: false,
    ...details,
  };
}

async function visibleLocators(locator) {
  const visible = [];
  for (let index = 0; index < (await locator.count()); index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) visible.push(item);
  }
  return visible;
}

export async function waitForMercosProductSignal(page, timeoutMs = 12_000) {
  try {
    await page.waitForFunction(
      ({ mainSelector, priceSelector, unavailableSelector }) => {
        if (location.pathname === "/entrar" || location.pathname.startsWith("/entrar/")) {
          return true;
        }
        const main = document.querySelector(mainSelector);
        if (!main) return false;
        const price = main.querySelector(priceSelector);
        const unavailable = main.querySelector(unavailableSelector);
        return Boolean(price || unavailable);
      },
      {
        mainSelector: MAIN_BLOCK_SELECTOR,
        priceSelector: PRICE_SELECTOR,
        unavailableSelector: UNAVAILABLE_SELECTOR,
      },
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

export async function inspectConstrujotaMercosProduct(page, expectedSku, options = {}) {
  const sku = normalizeSku(expectedSku);
  const productId = mercosProductIdFromUrl(page.url());
  if (!productId) {
    return errorResult("erro", "CONSTRUJOTA_MERCOS: URL de detalhe do produto nao confirmada", {
      sku,
      url_produto: page.url(),
    });
  }

  await waitForMercosProductSignal(page, options.waitTimeoutMs ?? 12_000);

  if (new URL(page.url()).pathname.startsWith("/entrar")) {
    return errorResult("sessao_expirada", "CONSTRUJOTA_MERCOS: sessao expirada", {
      sku,
      url_produto: page.url(),
      mercos_produto_id: productId,
    });
  }

  const mainBlocks = await visibleLocators(page.locator(MAIN_BLOCK_SELECTOR));
  if (mainBlocks.length !== 1) {
    return errorResult(
      "erro",
      "CONSTRUJOTA_MERCOS: bloco principal do produto nao encontrado de forma unica",
      { sku, url_produto: page.url(), mercos_produto_id: productId },
    );
  }
  const main = mainBlocks[0];
  const headingLocator = main.locator("h1");
  const headings = await visibleLocators(headingLocator);
  if ((await headingLocator.count()) !== 1 || headings.length !== 1) {
    return errorResult(
      "erro",
      "CONSTRUJOTA_MERCOS: titulo principal do produto nao encontrado de forma unica",
      { sku, url_produto: page.url(), mercos_produto_id: productId },
    );
  }
  const title = (await headings[0].innerText()).replace(/\s+/g, " ").trim();

  const infoBlocks = await visibleLocators(main.locator(INFO_BLOCK_SELECTOR));
  if (infoBlocks.length !== 1) {
    return errorResult(
      "erro",
      "CONSTRUJOTA_MERCOS: bloco de identificacao do produto nao encontrado de forma unica",
      {
        sku,
        titulo: title,
        url_produto: page.url(),
        mercos_produto_id: productId,
      },
    );
  }
  const infoText = (
    await Promise.all(infoBlocks.map((locator) => locator.innerText().catch(() => "")))
  ).join(" ");
  const observedSku = skuFromMercosText(infoText);
  if (!observedSku || observedSku !== sku) {
    return errorResult(
      "sku_divergente",
      `CONSTRUJOTA_MERCOS: codigo exibido nao corresponde ao SKU solicitado (${sku})`,
      {
        sku,
        sku_observado: observedSku || null,
        titulo: title,
        url_produto: page.url(),
        mercos_produto_id: productId,
      },
    );
  }

  const unavailableBlocks = await visibleLocators(main.locator(UNAVAILABLE_SELECTOR));
  const unavailableText = (
    await Promise.all(unavailableBlocks.map((locator) => locator.innerText().catch(() => "")))
  )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (unavailableText.includes(UNAVAILABLE_MESSAGE)) {
    const hasPreviousPrice = options.hasPreviousPrice === true;
    return errorResult(
      hasPreviousPrice ? "indisponivel" : "indisponivel_sem_historico",
      hasPreviousPrice
        ? "CONSTRUJOTA_MERCOS: produto indisponível; último preço confirmado preservado"
        : "CONSTRUJOTA_MERCOS: produto indisponível e sem preço confirmado anterior",
      {
        sku,
        sku_observado: observedSku,
        titulo: title,
        produto_confirmado: true,
        indisponivel: true,
        produto_indisponivel: true,
        url_produto: page.url(),
        mercos_produto_id: productId,
      },
    );
  }

  const prices = await visibleLocators(main.locator(PRICE_SELECTOR));
  if (prices.length === 0) {
    return errorResult("erro", "CONSTRUJOTA_MERCOS: preco principal nao encontrado", {
      sku,
      sku_observado: observedSku,
      titulo: title,
      produto_confirmado: true,
      url_produto: page.url(),
      mercos_produto_id: productId,
    });
  }
  if (prices.length !== 1) {
    return errorResult(
      "ambiguo",
      "CONSTRUJOTA_MERCOS: mais de um elemento de preco vigente no bloco principal",
      {
        sku,
        sku_observado: observedSku,
        titulo: title,
        produto_confirmado: true,
        quantidade_precos_principais: prices.length,
        url_produto: page.url(),
        mercos_produto_id: productId,
      },
    );
  }

  const rawText = (await prices[0].innerText()).replace(/\s+/g, " ").trim();
  const price = parseMercosTablePrice(rawText);
  if (price === null) {
    return errorResult(
      "ambiguo",
      "CONSTRUJOTA_MERCOS: formato ou quantidade de precos principais nao reconhecido",
      {
        sku,
        sku_observado: observedSku,
        titulo: title,
        produto_confirmado: true,
        quantidade_precos_principais: 1,
        texto_preco: rawText,
        url_produto: page.url(),
        mercos_produto_id: productId,
      },
    );
  }

  return {
    status: "sucesso",
    preco: price,
    mensagem: null,
    sku,
    sku_observado: observedSku,
    titulo: title,
    leitura_confirmada: true,
    produto_confirmado: true,
    bloco_preco_confirmado: true,
    elemento_preco_visivel: true,
    quantidade_precos_principais: 1,
    formato_preco_reconhecido: true,
    preco_principal_confirmado: true,
    texto_preco: rawText,
    seletor_preco: PRICE_SELECTOR,
    url_produto: page.url(),
    mercos_produto_id: productId,
  };
}

export function isConfirmedConstrujotaMercosResult(result) {
  return Boolean(
    result?.status === "sucesso" &&
    Number.isFinite(Number(result?.preco)) &&
    Number(result.preco) > 0 &&
    result.leitura_confirmada === true &&
    result.produto_confirmado === true &&
    result.bloco_preco_confirmado === true &&
    result.elemento_preco_visivel === true &&
    result.quantidade_precos_principais === 1 &&
    result.formato_preco_reconhecido === true &&
    result.preco_principal_confirmado === true,
  );
}
