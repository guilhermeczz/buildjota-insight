// Price parts are frequently rendered in separate DOM nodes (currency, integer and cents).
// The parser recognizes the format, but never resolves ambiguity by ordering or magnitude.
const moneyPatternSource = String.raw`(?:R\$\s*)?(\d{1,3}(?:\s*\.\s*\d{3})*\s*,\s*\d{2,3})`;
const moneyPattern = new RegExp(moneyPatternSource, "g");
const placeholderPricePattern = /R\$\s*[-–—]+(?:\s*[-–—]+|,\s*[-–—]+)*/i;
const unavailableSignalPattern =
  /fora\s+(?:de|do)\s+estoque|sem\s+(?:estoque|saldo)|nao\s+disponivel|indisponivel|temporariamente\s+indisponivel|esgotado|avise-?me\s+quando\s+(?:chegar|disponivel)|aviseme\s+quando\s+(?:chegar|disponivel)|produto\s+sob\s+consulta|consulte\s+(?:a\s+)?disponibilidade|aguardando\s+estoque/;
const construjaTitleSelector = "h2[class*='Produto_nomeProduto__']";
const construjaSkuSelector = "span[class*='Produto_codigoProduto__'] strong";
const construjaPriceSelector =
  ".stepPreco .stepPrecoContent [class*='Produto_precoProdutoContainer__']";
const construjaUnavailableSelector =
  ".stepPreco [class*='ProdutoCompactCarrinho_mensagemIndisponivel__']";
const cofemaPriceSelector = ".produto-preco .produto-preco-row";
const marestRootSelector = "[class*='ProductRowContainer-sc-']";
const marestPriceSelector =
  "[class*='BuyInformation-sc-'] [class*='PriceContainer-sc-'] p.prod-price";
const megalesteRootSelector = ".product-line[data-id]";
const megalestePriceSelector = ":scope > .price";

export function isConfirmedPriceEvidence(result) {
  const price = Number(result?.price);
  return (
    !result?.error &&
    Number.isFinite(price) &&
    price > 0 &&
    result?.productConfirmed === true &&
    result?.priceScopeConfirmed === true &&
    result?.priceVisible === true &&
    result?.mainPriceCount === 1 &&
    result?.priceFormatRecognized === true
  );
}

export function persistenceFieldsForPriceEvidence(result) {
  return {
    concorrente: String(result?.competitor ?? "")
      .trim()
      .toUpperCase(),
    leitura_confirmada: isConfirmedPriceEvidence(result),
    produto_confirmado: result?.productConfirmed === true,
    bloco_preco_confirmado: result?.priceScopeConfirmed === true,
    elemento_preco_visivel: result?.priceVisible === true,
    quantidade_precos_principais: Number(result?.mainPriceCount ?? 0),
    formato_preco_reconhecido: result?.priceFormatRecognized === true,
    preco_principal_confirmado: isConfirmedPriceEvidence(result),
  };
}

export function isConstrujaLoginWallText(value) {
  const text = normalizeText(value);
  return /(?:faca login ou |entre ou )?cadastre(?:-se)? para ver (?:o |os )?precos?|entre para ver (?:o |os )?precos?/.test(
    text,
  );
}

export function construjaRateLimitRetrySeconds(value) {
  const match = normalizeText(value).match(
    /muitas requisicoes(?: efetuadas)?(?: nesse recurso)?\.? tente novamente em (\d+) segundos?/,
  );
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

export function parseBRL(text, options = {}) {
  if (shouldRejectText(text, options)) return null;
  const prices = [
    ...new Set(parseBRLValues(text, options).filter((value) => isPlausiblePrice(value))),
  ];
  return prices.length === 1 ? prices[0] : null;
}

function parseBRLValues(text, options = {}) {
  if (!text) return [];

  const normalized = text.replace(/R\$/g, " R$").replace(/(\d)(R\$)/g, "$1 $2");
  return [...normalized.matchAll(moneyPattern)]
    .filter((match) => !options.requireCurrency || /^\s*R\$/i.test(match[0]))
    .map((match) => parseMoney(match[1]))
    .filter((value) => value !== null);
}

function parseMoney(value) {
  const parsed = Number(String(value).replace(/\s+/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function shouldRejectText(text, options = {}) {
  if (options.allowUnavailableText) return false;

  const normalized = normalizeText(String(text ?? ""));
  if (!normalized) return false;
  if (unavailableSignalPattern.test(normalized)) return true;
  return placeholderPricePattern.test(String(text ?? ""));
}

function isPlausiblePrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0;
}

function basePriceEvidence(competitor, page, mapping, selector, priceRule) {
  return {
    competitor,
    price: null,
    error: "",
    url: page.url(),
    expectedSku: String(mapping?.sku_concorrente ?? "").trim(),
    observedSku: "",
    title: "",
    selector,
    rawText: "",
    priceRule,
    productConfirmed: false,
    priceScopeConfirmed: false,
    priceVisible: false,
    mainPriceCount: 0,
    priceFormatRecognized: false,
  };
}

function failPriceEvidence(base, error, details = {}) {
  return { ...base, ...details, price: null, error };
}

function finalizeSingleMainPrice(base, details = {}) {
  const visiblePrices = (details.prices ?? []).filter(
    (candidate) => candidate?.visible === true && String(candidate.rawText ?? "").trim(),
  );
  const shared = {
    ...details,
    prices: undefined,
    rawText: visiblePrices.map((candidate) => candidate.rawText).join(" | "),
    priceScopeConfirmed: details.priceScopeConfirmed === true,
    priceVisible: visiblePrices.length > 0,
    mainPriceCount: visiblePrices.length,
  };

  if (details.unavailable === true) {
    return failPriceEvidence(base, `${base.competitor}: produto indisponivel`, shared);
  }
  if (!shared.priceScopeConfirmed) {
    return failPriceEvidence(
      base,
      `${base.competitor}: bloco principal de preco nao encontrado`,
      shared,
    );
  }
  if (visiblePrices.length === 0) {
    return failPriceEvidence(base, `${base.competitor}: preco principal nao encontrado`, shared);
  }
  if (visiblePrices.length !== 1) {
    return failPriceEvidence(base, `${base.competitor}: preco principal ambiguo`, shared);
  }

  const rawText = visiblePrices[0].rawText;
  const values = parseBRLValues(rawText, { requireCurrency: true }).filter((value) =>
    isPlausiblePrice(value),
  );
  const currencyCount = rawText.match(/R\$/gi)?.length ?? 0;
  if (values.length !== 1 || currencyCount !== 1) {
    return failPriceEvidence(
      base,
      values.length > 1 || currencyCount > 1
        ? `${base.competitor}: preco principal ambiguo`
        : `${base.competitor}: preco principal em formato nao reconhecido`,
      {
        ...shared,
        mainPriceCount: Math.max(visiblePrices.length, values.length, currencyCount),
      },
    );
  }

  return {
    ...base,
    ...shared,
    price: values[0],
    error: "",
    priceFormatRecognized: true,
  };
}

export async function inspectCofemaPrice(page, mapping, options = {}) {
  const base = basePriceEvidence(
    "COFEMA",
    page,
    mapping,
    cofemaPriceSelector,
    "preco-unico-no-resumo-principal",
  );
  const waitTimeoutMs = normalizedWaitTimeout(options.waitTimeoutMs);
  let parsedUrl;
  try {
    parsedUrl = new URL(base.url);
  } catch {
    return failPriceEvidence(base, "COFEMA: URL nao corresponde a uma pagina de produto");
  }
  const urlCode =
    parsedUrl.pathname.match(/^\/(?:[a-z]{2}\/)?page\/produto\/(\d{3,})(?:[-/]|$)/i)?.[1] ?? "";
  if (!/(^|\.)cofema\.com\.br$/i.test(parsedUrl.hostname) || !urlCode) {
    return failPriceEvidence(base, "COFEMA: URL nao corresponde a uma pagina de produto");
  }

  await page
    .locator("main h1")
    .first()
    .waitFor({ state: "visible", timeout: waitTimeoutMs })
    .catch(() => null);
  const products = await page
    .evaluate(
      ({ priceSelector }) => {
        const oldPricePattern =
          /preco(?:antigo|anterior|semdesconto)|valor(?:antigo|anterior)|oldprice|priceold|riscado|strike/i;
        const isVisible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          let current = element;
          while (current) {
            const style = getComputedStyle(current);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              Number(style.opacity || 1) === 0 ||
              current.hidden ||
              current.getAttribute("aria-hidden") === "true"
            ) {
              return false;
            }
            current = current.parentElement;
          }
          return true;
        };
        const isOldPriceNode = (node, boundary) => {
          let current = node instanceof Element ? node : node.parentElement;
          while (current && current !== boundary.parentElement) {
            const style = getComputedStyle(current);
            const classAndId = `${current.className ?? ""} ${current.id ?? ""}`.replace(
              /[^a-z0-9]/gi,
              "",
            );
            if (["DEL", "S", "STRIKE"].includes(current.tagName)) return true;
            if (/line-through/.test(style.textDecorationLine)) return true;
            if (oldPricePattern.test(classAndId)) return true;
            if (current === boundary) break;
            current = current.parentElement;
          }
          return false;
        };
        const currentText = (element) => {
          const parts = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const parent = walker.currentNode.parentElement;
            if (parent && isVisible(parent) && !isOldPriceNode(walker.currentNode, element)) {
              parts.push(walker.currentNode.textContent ?? "");
            }
          }
          return parts.join(" ").replace(/\s+/g, " ").trim();
        };

        return [...document.querySelectorAll("main h1")]
          .filter(isVisible)
          .map((heading) => {
            const main = heading.closest("main");
            const summary = heading.closest("div.space-y-2");
            if (!(main instanceof HTMLElement) || !(summary instanceof HTMLElement)) return null;
            const mainText = (main.innerText || main.textContent || "").replace(/\s+/g, " ").trim();
            const normalized = mainText
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase();
            const summaryText = String(summary.innerText || summary.textContent || "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            const priceElements = [...summary.querySelectorAll(priceSelector)].filter(
              (element) => isVisible(element) && !isOldPriceNode(element, element),
            );
            return {
              title: (heading.innerText || heading.textContent || "").replace(/\s+/g, " ").trim(),
              mainCode: normalized.match(/codigo:\s*([a-z0-9._/-]+)/i)?.[1] ?? "",
              supplierReference:
                normalized.match(/referencia do fornecedor:\s*([a-z0-9._/-]+)/i)?.[1] ?? "",
              barcode: normalized.match(/codigo barras:\s*([a-z0-9._/-]+)/i)?.[1] ?? "",
              priceScopeConfirmed: true,
              unavailable:
                /fora\s+(?:de|do)\s+estoque|sem\s+(?:estoque|saldo)|indisponivel|esgotado/.test(
                  summaryText,
                ),
              prices: priceElements.map((element) => ({
                rawText: currentText(element),
                visible: true,
              })),
            };
          })
          .filter(Boolean);
      },
      { priceSelector: cofemaPriceSelector },
    )
    .catch(() => []);

  if (products.length !== 1) {
    return failPriceEvidence(
      base,
      products.length > 1
        ? "COFEMA: identificacao principal do produto ambigua"
        : "COFEMA: bloco principal do produto nao encontrado",
    );
  }
  const [product] = products;
  const observedCodes = [product.mainCode, product.supplierReference, product.barcode].filter(
    Boolean,
  );
  const urlMatchesMain = codesMatch(urlCode, product.mainCode);
  const skuMatches = observedCodes.some((code) => codesMatch(base.expectedSku, code));
  const identity = {
    title: product.title,
    observedSku:
      observedCodes.find((code) => codesMatch(base.expectedSku, code)) ?? product.mainCode,
    productConfirmed: Boolean(base.expectedSku && urlMatchesMain && skuMatches),
  };
  if (!identity.productConfirmed) {
    return failPriceEvidence(base, "COFEMA: URL ou SKU nao corresponde ao mapeamento", identity);
  }
  return finalizeSingleMainPrice(base, { ...product, ...identity });
}

export async function inspectMarestPrice(page, mapping, options = {}) {
  const base = basePriceEvidence(
    "MAREST",
    page,
    mapping,
    marestPriceSelector,
    "preco-unico-no-bloco-de-compra",
  );
  const waitTimeoutMs = normalizedWaitTimeout(options.waitTimeoutMs);
  let parsedUrl;
  try {
    parsedUrl = new URL(base.url);
  } catch {
    return failPriceEvidence(base, "MAREST: URL nao corresponde a uma pagina de produto");
  }
  const urlSku = String(parsedUrl.searchParams.get("sku") ?? "").trim();
  if (
    !/(^|\.)marest\.com\.br$/i.test(parsedUrl.hostname) ||
    parsedUrl.pathname.replace(/\/+$/, "") !== "/product" ||
    !urlSku
  ) {
    return failPriceEvidence(base, "MAREST: URL nao corresponde a uma pagina de produto");
  }
  if (!base.expectedSku || !codesMatch(urlSku, base.expectedSku)) {
    return failPriceEvidence(base, "MAREST: produto nao corresponde ao SKU solicitado");
  }

  await page
    .locator(marestRootSelector)
    .first()
    .waitFor({ state: "visible", timeout: waitTimeoutMs })
    .catch(() => null);
  const products = await page
    .evaluate(
      ({ expectedSku, rootSelector, priceSelector }) => {
        const oldPricePattern =
          /preco(?:antigo|anterior|semdesconto)|valor(?:antigo|anterior)|oldprice|priceold|riscado|strike/i;
        const isVisible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          let current = element;
          while (current) {
            const style = getComputedStyle(current);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              Number(style.opacity || 1) === 0 ||
              current.hidden ||
              current.getAttribute("aria-hidden") === "true"
            ) {
              return false;
            }
            current = current.parentElement;
          }
          return true;
        };
        const isOldPriceNode = (node, boundary) => {
          let current = node instanceof Element ? node : node.parentElement;
          while (current && current !== boundary.parentElement) {
            const style = getComputedStyle(current);
            const classAndId = `${current.className ?? ""} ${current.id ?? ""}`.replace(
              /[^a-z0-9]/gi,
              "",
            );
            if (["DEL", "S", "STRIKE"].includes(current.tagName)) return true;
            if (/line-through/.test(style.textDecorationLine)) return true;
            if (oldPricePattern.test(classAndId)) return true;
            if (current === boundary) break;
            current = current.parentElement;
          }
          return false;
        };
        const currentText = (element) => {
          const parts = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const parent = walker.currentNode.parentElement;
            if (parent && isVisible(parent) && !isOldPriceNode(walker.currentNode, element)) {
              parts.push(walker.currentNode.textContent ?? "");
            }
          }
          return parts.join(" ").replace(/\s+/g, " ").trim();
        };
        return [...document.querySelectorAll(rootSelector)]
          .filter(isVisible)
          .map((root) => {
            const heading = [...root.querySelectorAll(".detailsHeader h1")].find(isVisible);
            const sku = [...root.querySelectorAll("p[class*='cod-sku']")].find(isVisible);
            const buyBlock = [...root.querySelectorAll("[class*='BuyInformation-sc-']")].find(
              isVisible,
            );
            const prices = buyBlock
              ? [...root.querySelectorAll(priceSelector)].filter(
                  (element) =>
                    buyBlock.contains(element) &&
                    isVisible(element) &&
                    !isOldPriceNode(element, buyBlock),
                )
              : [];
            const buyText = String(buyBlock?.innerText || buyBlock?.textContent || "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            return {
              title: String(heading?.innerText || heading?.textContent || "")
                .replace(/\s+/g, " ")
                .trim(),
              observedSku:
                String(sku?.innerText || sku?.textContent || "")
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .match(/cod\.?\s*([a-z0-9._/-]+)/i)?.[1] ?? "",
              priceScopeConfirmed: Boolean(buyBlock),
              unavailable:
                /fora\s+(?:de|do)\s+estoque|sem\s+(?:estoque|saldo)|indisponivel|esgotado/.test(
                  buyText,
                ),
              prices: prices.map((element) => ({
                rawText: currentText(element),
                visible: true,
              })),
            };
          })
          .filter((product) => product.observedSku === expectedSku);
      },
      {
        expectedSku: base.expectedSku,
        rootSelector: marestRootSelector,
        priceSelector: marestPriceSelector,
      },
    )
    .catch(() => []);

  if (products.length !== 1) {
    return failPriceEvidence(
      base,
      products.length > 1
        ? "MAREST: identificacao principal do produto ambigua"
        : "MAREST: bloco principal do produto nao encontrado",
    );
  }
  const [product] = products;
  const identity = {
    title: product.title,
    observedSku: product.observedSku,
    productConfirmed: codesMatch(product.observedSku, base.expectedSku),
  };
  if (!identity.productConfirmed) {
    return failPriceEvidence(base, "MAREST: URL ou SKU nao corresponde ao mapeamento", identity);
  }
  return finalizeSingleMainPrice(base, { ...product, ...identity });
}

export async function inspectMegalestePrice(page, mapping, options = {}) {
  const base = basePriceEvidence(
    "MEGALESTE",
    page,
    mapping,
    megalestePriceSelector,
    "preco-vigente-direto-do-cartao-do-sku",
  );
  const waitTimeoutMs = normalizedWaitTimeout(options.waitTimeoutMs);
  let parsedUrl;
  try {
    parsedUrl = new URL(base.url);
  } catch {
    return failPriceEvidence(base, "MEGALESTE: URL nao corresponde a busca de produto");
  }
  const querySku = String(parsedUrl.searchParams.get("q") ?? "").trim();
  if (
    !/(^|\.)megaleste\.com\.br$/i.test(parsedUrl.hostname) ||
    parsedUrl.pathname.replace(/\/+$/, "") !== "/c/busca" ||
    !querySku
  ) {
    return failPriceEvidence(base, "MEGALESTE: URL nao corresponde a busca de produto");
  }
  if (!base.expectedSku || !codesMatch(querySku, base.expectedSku)) {
    return failPriceEvidence(base, "MEGALESTE: produto nao corresponde ao SKU solicitado");
  }

  await page
    .locator(megalesteRootSelector)
    .first()
    .waitFor({ state: "visible", timeout: waitTimeoutMs })
    .catch(() => null);
  const products = await page
    .evaluate(
      ({ expectedSku, rootSelector, priceSelector }) => {
        const oldPricePattern =
          /preco(?:antigo|anterior|semdesconto)|valor(?:antigo|anterior)|oldprice|priceold|riscado|strike/i;
        const isVisible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          let current = element;
          while (current) {
            const style = getComputedStyle(current);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              Number(style.opacity || 1) === 0 ||
              current.hidden ||
              current.getAttribute("aria-hidden") === "true"
            ) {
              return false;
            }
            current = current.parentElement;
          }
          return true;
        };
        const isOldPriceNode = (node, boundary) => {
          let current = node instanceof Element ? node : node.parentElement;
          while (current && current !== boundary.parentElement) {
            const style = getComputedStyle(current);
            const classAndId = `${current.className ?? ""} ${current.id ?? ""}`.replace(
              /[^a-z0-9]/gi,
              "",
            );
            if (["DEL", "S", "STRIKE"].includes(current.tagName)) return true;
            if (/line-through/.test(style.textDecorationLine)) return true;
            if (oldPricePattern.test(classAndId)) return true;
            if (current === boundary) break;
            current = current.parentElement;
          }
          return false;
        };
        const currentText = (element) => {
          const parts = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const parent = walker.currentNode.parentElement;
            if (parent && isVisible(parent) && !isOldPriceNode(walker.currentNode, element)) {
              parts.push(walker.currentNode.textContent ?? "");
            }
          }
          return parts.join(" ").replace(/\s+/g, " ").trim();
        };
        return [...document.querySelectorAll(rootSelector)]
          .filter(
            (root) =>
              isVisible(root) && String(root.getAttribute("data-id") ?? "").trim() === expectedSku,
          )
          .map((root) => {
            const heading = [...root.querySelectorAll(".product-content h4")].find(isVisible);
            const skuText = [...root.querySelectorAll(".product-content small")].find(isVisible);
            const prices = [...root.querySelectorAll(priceSelector)].filter(isVisible);
            const text = String(root.innerText || root.textContent || "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            return {
              title: String(heading?.innerText || heading?.textContent || "")
                .replace(/\s+/g, " ")
                .trim(),
              observedSku:
                String(skuText?.innerText || skuText?.textContent || "")
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .match(/cod\.?\s*([a-z0-9._/-]+)/i)?.[1] ?? "",
              priceScopeConfirmed:
                Boolean(root.querySelector("input[name='qtd']")) &&
                Boolean(root.querySelector("button.btn-cart-add")),
              unavailable:
                /fora\s+(?:de|do)\s+estoque|sem\s+(?:estoque|saldo)|indisponivel|esgotado/.test(
                  text,
                ),
              prices: prices.map((element) => ({
                rawText: currentText(element),
                visible: true,
              })),
            };
          });
      },
      {
        expectedSku: base.expectedSku,
        rootSelector: megalesteRootSelector,
        priceSelector: megalestePriceSelector,
      },
    )
    .catch(() => []);

  if (products.length !== 1) {
    return failPriceEvidence(
      base,
      products.length > 1
        ? "MEGALESTE: identificacao principal do produto ambigua"
        : "MEGALESTE: cartao exato do produto nao encontrado",
    );
  }
  const [product] = products;
  const identity = {
    title: product.title,
    observedSku: product.observedSku,
    productConfirmed: codesMatch(product.observedSku, base.expectedSku),
  };
  if (!identity.productConfirmed) {
    return failPriceEvidence(
      base,
      "MEGALESTE: consulta ou SKU nao corresponde ao mapeamento",
      identity,
    );
  }
  return finalizeSingleMainPrice(base, { ...product, ...identity });
}

export async function extractConstrujaPrice(page, mapping, options = {}) {
  const result = await inspectConstrujaPrice(page, mapping, options);
  if (typeof options.onResult === "function") options.onResult(result);
  return result.price;
}

export async function inspectConstrujaPrice(page, mapping, options = {}) {
  const expectedSku = String(mapping?.sku_concorrente ?? "").trim();
  const pageUrl = page.url();
  const baseResult = basePriceEvidence(
    "CONSTRUJA",
    page,
    mapping,
    construjaPriceSelector,
    "preco-unico-no-bloco-principal-do-produto",
  );
  const failed = (error, details = {}) => ({ ...baseResult, ...details, error });
  const waitTimeoutMs = normalizedWaitTimeout(options.waitTimeoutMs);

  let parsedUrl;
  try {
    parsedUrl = new URL(pageUrl);
  } catch {
    return failed("CONSTRUJA: URL nao corresponde a uma pagina de produto");
  }

  const urlSku = decodeURIComponent(
    parsedUrl.pathname.match(/^\/produto\/([^/]+)(?:\/|$)/i)?.[1] ?? "",
  );
  if (!/(^|\.)construja\.com\.br$/i.test(parsedUrl.hostname) || !urlSku) {
    return failed("CONSTRUJA: URL nao corresponde a uma pagina de produto");
  }
  if (!expectedSku || urlSku !== expectedSku) {
    return failed(
      `CONSTRUJA: produto nao corresponde ao SKU solicitado ` +
        `(esperado ${expectedSku || "ausente"}; URL ${urlSku || "ausente"})`,
    );
  }

  await page
    .locator(construjaTitleSelector)
    .first()
    .waitFor({ state: "visible", timeout: waitTimeoutMs })
    .catch(() => null);
  await page
    .locator(construjaPriceSelector)
    .first()
    .waitFor({ state: "visible", timeout: waitTimeoutMs })
    .catch(() => null);
  const pageAlerts = await page
    .locator("[role='alert']")
    .allInnerTexts()
    .then((values) => values.join(" "))
    .catch(() => "");

  const product = await page
    .evaluate(
      ({ titleSelector, skuSelector, priceSelector, unavailableSelector }) => {
        const oldPricePattern =
          /preco(?:antigo|anterior|semdesconto)|valor(?:antigo|anterior)|oldprice|priceold|riscado|strike/i;
        const isVisible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;

          let current = element;
          while (current) {
            const style = window.getComputedStyle(current);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              Number(style.opacity || 1) === 0 ||
              current.getAttribute("aria-hidden") === "true" ||
              current.hidden
            ) {
              return false;
            }
            current = current.parentElement;
          }
          return true;
        };
        const isOldPriceNode = (node, boundary) => {
          let current = node instanceof Element ? node : node.parentElement;
          while (current && current !== boundary.parentElement) {
            const style = window.getComputedStyle(current);
            const classAndId = `${current.className ?? ""} ${current.id ?? ""}`.replace(
              /[^a-z0-9]/gi,
              "",
            );
            if (["DEL", "S", "STRIKE"].includes(current.tagName)) return true;
            if (/line-through/.test(style.textDecorationLine)) return true;
            if (oldPricePattern.test(classAndId)) return true;
            if (current === boundary) break;
            current = current.parentElement;
          }
          return false;
        };
        const visibleCurrentText = (element) => {
          const parts = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const parent = walker.currentNode.parentElement;
            if (parent && isVisible(parent) && !isOldPriceNode(walker.currentNode, element)) {
              parts.push(walker.currentNode.textContent ?? "");
            }
          }
          return parts.join(" ").replace(/\s+/g, " ").trim();
        };

        const headings = [...document.querySelectorAll(titleSelector)].filter(isVisible);
        const summaries = headings
          .map((heading) => {
            const header = heading.closest(".stepHeader");
            const root = header?.parentElement;
            if (!(root instanceof HTMLElement) || !root.querySelector(".stepPreco")) return null;

            const skuElement = header.querySelector(skuSelector);
            const priceStep = root.querySelector(".stepPreco");
            const unavailableElement = [...root.querySelectorAll(unavailableSelector)].find(
              isVisible,
            );
            const priceElements = [...root.querySelectorAll(priceSelector)].filter(
              (element) => isVisible(element) && !isOldPriceNode(element, element),
            );
            const priceStepText = String(priceStep?.innerText || priceStep?.textContent || "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();

            return {
              title: (heading.innerText || heading.textContent || "").replace(/\s+/g, " ").trim(),
              observedSku: (skuElement?.textContent ?? "").replace(/\s+/g, " ").trim(),
              productText: String(root.innerText || root.textContent || "")
                .replace(/\s+/g, " ")
                .trim(),
              priceScopeConfirmed: true,
              unavailable:
                Boolean(unavailableElement) ||
                /produto indisponivel|fora\s+(?:de|do)\s+estoque|sem\s+estoque|esgotado/.test(
                  priceStepText,
                ),
              prices: priceElements.map((element) => ({
                rawText: visibleCurrentText(element),
                visible: true,
              })),
            };
          })
          .filter(Boolean);

        return summaries;
      },
      {
        titleSelector: construjaTitleSelector,
        skuSelector: construjaSkuSelector,
        priceSelector: construjaPriceSelector,
        unavailableSelector: construjaUnavailableSelector,
      },
    )
    .catch(() => []);

  if (product.length !== 1) {
    return failed(
      product.length > 1
        ? "CONSTRUJA: identificacao principal do produto ambigua"
        : "CONSTRUJA: bloco principal do produto nao encontrado",
    );
  }

  const [{ title, observedSku, productText, unavailable, prices, priceScopeConfirmed }] = product;
  const identity = { title, observedSku };
  if (observedSku !== expectedSku) {
    return failed(
      `CONSTRUJA: produto nao corresponde ao SKU solicitado ` +
        `(esperado ${expectedSku}; URL ${urlSku}; exibido ${observedSku || "ausente"})`,
      identity,
    );
  }
  if (isConstrujaLoginWallText(productText)) {
    return failed("CONSTRUJA: sessao expirada; preco exige login", {
      ...identity,
      productConfirmed: true,
      priceScopeConfirmed,
    });
  }
  const rateLimitSeconds = construjaRateLimitRetrySeconds(`${productText} ${pageAlerts}`);
  if (rateLimitSeconds !== null) {
    return failed(
      `CONSTRUJA: limite temporario de requisicoes; tente novamente em ${rateLimitSeconds}s`,
      {
        ...identity,
        productConfirmed: true,
        priceScopeConfirmed,
      },
    );
  }
  return finalizeSingleMainPrice(baseResult, {
    ...identity,
    unavailable,
    prices,
    productConfirmed: true,
    priceScopeConfirmed,
  });
}

// Kept as a fail-closed compatibility export. Production collection must use one of the
// competitor-specific inspectors above; broad proximity scans are not valid price evidence.
export async function extractPriceNearTerms() {
  return null;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizedWaitTimeout(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 5000;
}

function codesMatch(left, right) {
  const normalizeCode = (value) =>
    normalizeText(String(value ?? ""))
      .replace(/[^a-z0-9]/g, "")
      .trim();
  const normalizedLeft = normalizeCode(left);
  const normalizedRight = normalizeCode(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}
