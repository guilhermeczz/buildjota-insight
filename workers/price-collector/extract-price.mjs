// Price parts are frequently rendered in separate DOM nodes (currency, integer and cents).
// Keep one shared pattern for the browser-side candidate search and the final parser.
const moneyPatternSource = String.raw`(?:R\$\s*)?(\d{1,3}(?:\s*\.\s*\d{3})*\s*,\s*\d{2,3})`;
const moneyPattern = new RegExp(moneyPatternSource, "g");
const placeholderPricePattern = /R\$\s*[-–—]+(?:\s*[-–—]+|,\s*[-–—]+)*/i;
const unavailableSignalPattern =
  /fora\s+(?:de|do)\s+estoque|sem\s+(?:estoque|saldo)|nao\s+disponivel|indisponivel|temporariamente\s+indisponivel|esgotado|avise-?me\s+quando\s+(?:chegar|disponivel)|aviseme\s+quando\s+(?:chegar|disponivel)|produto\s+sob\s+consulta|consulte\s+(?:a\s+)?disponibilidade|aguardando\s+estoque/;
const construjaTitleSelector = "h2[class*='Produto_nomeProduto__']";
const construjaSkuSelector = "span[class*='Produto_codigoProduto__'] strong";
const construjaPriceSelector =
  ".stepPreco .stepPrecoContent [class*='Produto_precoProdutoContainer__']";

const priceHints = [
  { selector: "[itemprop='price']", preferLast: false },
  { selector: "meta[itemprop='price']", preferLast: false },
  { selector: "meta[property='product:price:amount']", preferLast: false },
  { selector: "[data-testid*='price' i]", preferLast: true },
  { selector: "[class*='precoProdutoContainer' i]", preferLast: true },
  { selector: "[class*='precoAtual' i]", preferLast: true },
  { selector: "[class*='precoPromocional' i]", preferLast: true },
  { selector: "[class*='preco-promocional' i]", preferLast: true },
  { selector: "[class*='precoPor' i]", preferLast: true },
  { selector: "[class*='preco-por' i]", preferLast: true },
  { selector: "[class*='precoVenda' i]", preferLast: true },
  { selector: "[class*='precoSelecionado' i]", preferLast: true },
  { selector: "[class*='preco-selecao' i]", preferLast: true },
  { selector: "[class*='precoSelecao' i]", preferLast: true },
  { selector: "[class*='valorProduto' i]", preferLast: true },
  { selector: "[class*='valor-produto' i]", preferLast: true },
  { selector: "[class*='product-price' i]", preferLast: true },
  { selector: "[class*='current-price' i]", preferLast: true },
  { selector: "[class*='price-current' i]", preferLast: true },
  { selector: "[class*='sale-price' i]", preferLast: true },
  { selector: "[class*='best-price' i]", preferLast: true },
  { selector: "[class*='price' i]", preferLast: true },
  { selector: "[class*='preco' i]", preferLast: true },
  { selector: "[id*='price' i]", preferLast: true },
  { selector: "[id*='preco' i]", preferLast: true },
  { selector: ".stepPreco", preferLast: true },
  { selector: ".valor", preferLast: true },
  { selector: ".product-price", preferLast: true },
  { selector: ".preco", preferLast: true },
];

export function parseBRL(text, options = {}) {
  if (shouldRejectText(text, options)) return null;

  if (options.preferPrazo) {
    const prazo = parsePrazoBRL(text, options);
    if (prazo) return prazo;

    // MEGALESTE may show only its main price in the result card. It is a safe
    // fallback only when there is no competing monetary value in that block.
    const uniquePrices = [
      ...new Set(parseBRLValues(text, options).filter((value) => isPlausiblePrice(value, options))),
    ];
    return uniquePrices.length === 1 ? uniquePrices[0] : null;
  }

  if (!options.requireCurrency) {
    const preferred = parsePreferredLabeledBRL(text, options);
    if (preferred) return preferred;
  }

  const discounted = parseDiscountedBRL(text, options);
  if (discounted) return discounted;

  const matches = parseBRLValues(text, options);
  if (matches.length === 0) return null;

  return selectPrice(matches, options);
}

function parsePrazoBRL(text, options = {}) {
  if (!text) return null;

  const plain = normalizeText(String(text).replace(/\s+/g, " "));
  const valuePattern = String.raw`(\d{1,3}(?:\s*\.\s*\d{3})*\s*,\s*\d{2,3})`;
  const labelPattern = String.raw`(?:(?:preco|valor)\s+)?(?:a\s+)?prazo`;
  const patterns = [
    new RegExp(`${labelPattern}\\s*[:\\-]?\\s*(?:r\\$\\s*)?${valuePattern}`, "i"),
    new RegExp(`(?:r\\$\\s*)?${valuePattern}\\s*[:\\-]?\\s*${labelPattern}`, "i"),
  ];

  for (const pattern of patterns) {
    const match = plain.match(pattern);
    const value = match ? parseMoney(match[1]) : null;
    if (value && isPlausiblePrice(value, options)) return value;
  }

  return null;
}

function parsePreferredLabeledBRL(text, options = {}) {
  if (!text) return null;

  const normalized = text.replace(/\s+/g, " ").trim();
  const plain = normalizeText(normalized);
  const labelPatterns = [
    /(?:preco\s*)?(?:a vista|avista)\s*(?:r\$)?\s*(\d{1,3}(?:\s*\.\s*\d{3})*\s*,\s*\d{2,3})/i,
    /(?:r\$)?\s*(\d{1,3}(?:\s*\.\s*\d{3})*\s*,\s*\d{2,3})\s*(?:a vista|avista)/i,
    /(?:preco|valor|por)\s*(?:r\$)?\s*(\d{1,3}(?:\s*\.\s*\d{3})*\s*,\s*\d{2,3})/i,
  ];

  for (const pattern of labelPatterns) {
    const match = plain.match(pattern);
    const value = match ? parseMoney(match[1]) : null;
    if (value && isPlausiblePrice(value, options)) return value;
  }

  return null;
}

function parseDiscountedBRL(text, options = {}) {
  if (!text) return null;

  const normalized = normalizeText(text);
  if (!/(off|desconto|promocao|promocional|por apenas|especial)/i.test(normalized)) return null;

  const matches = parseBRLValues(text, options);
  if (matches.length === 0) return null;

  return selectPrice(matches, { ...options, preferLast: true });
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

function selectPrice(values, options = {}) {
  const candidates = values.filter((value) => isPlausiblePrice(value, options));
  if (candidates.length === 0) return null;
  if (options.requireSingle && candidates.length !== 1) return null;

  if (options.preferLargest) return Math.max(...candidates);
  return options.preferLast ? candidates[candidates.length - 1] : candidates[0];
}

function shouldRejectText(text, options = {}) {
  if (options.allowUnavailableText) return false;

  const normalized = normalizeText(String(text ?? ""));
  if (!normalized) return false;
  if (unavailableSignalPattern.test(normalized)) return true;
  return placeholderPricePattern.test(String(text ?? ""));
}

function isPlausiblePrice(value, options = {}) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return false;

  const referencePrice = Number(options.referencePrice ?? 0);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return true;

  const minimum = Math.max(1, referencePrice * 0.15);
  const maximum = Math.max(referencePrice * 5, referencePrice + 500);
  return price >= minimum && price <= maximum;
}

function parseLoosePrice(value, options = {}) {
  if (value == null) return null;
  if (typeof value === "number") return isPlausiblePrice(value, options) ? value : null;

  const text = String(value).trim();
  const brl = parseBRL(text, { ...options, preferLast: true });
  if (brl) return brl;

  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(",", ".");
  const parsed = Number(normalized);
  return isPlausiblePrice(parsed, options) ? parsed : null;
}

export async function extractPrice(page, selector, options = {}) {
  for (const candidate of selectorCandidates(selector)) {
    const parsed = await parseLocatorPrice(page, candidate, { ...options, preferLast: true });
    if (parsed) return parsed;
  }

  const structuredPrice = await extractStructuredPrice(page, options);
  if (structuredPrice) return structuredPrice;

  for (const hint of priceHints) {
    const parsed = await parseLocatorPrice(page, hint.selector, {
      ...options,
      preferLast: hint.preferLast,
    });
    if (parsed) return parsed;
  }

  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 8000 })
    .catch(() => "");
  return parseBRL(bodyText, { ...options, preferLast: true, requireSingle: true });
}

export async function extractPriceFromLocator(page, selector, options = {}) {
  return parseLocatorPrice(page, selector, options);
}

export async function extractConstrujaPrice(page, mapping, options = {}) {
  const result = await inspectConstrujaPrice(page, mapping, options);
  if (typeof options.onResult === "function") options.onResult(result);
  return result.price;
}

export async function inspectConstrujaPrice(page, mapping, options = {}) {
  const expectedSku = String(mapping?.sku_concorrente ?? "").trim();
  const expectedTitle = String(mapping?.produtos?.nome ?? "").trim();
  const pageUrl = page.url();
  const baseResult = {
    price: null,
    error: "",
    url: pageUrl,
    expectedSku,
    observedSku: "",
    title: "",
    selector: construjaPriceSelector,
    rawText: "",
    productConfirmed: false,
    priceVisible: false,
    mainPriceCount: 0,
  };
  const failed = (error, details = {}) => ({ ...baseResult, ...details, error });
  const waitTimeoutMs = Number.isFinite(Number(options.waitTimeoutMs))
    ? Math.max(0, Number(options.waitTimeoutMs))
    : 5000;

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
    return failed("CONSTRUJA: produto nao corresponde ao SKU solicitado");
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

  const product = await page
    .evaluate(
      ({ titleSelector, skuSelector, priceSelector }) => {
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
            const priceElements = [...root.querySelectorAll(priceSelector)].filter(
              (element) => isVisible(element) && !isOldPriceNode(element, element),
            );

            return {
              title: (heading.innerText || heading.textContent || "").replace(/\s+/g, " ").trim(),
              observedSku: (skuElement?.textContent ?? "").replace(/\s+/g, " ").trim(),
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

  const [{ title, observedSku, prices }] = product;
  const identity = { title, observedSku };
  if (observedSku !== expectedSku) {
    return failed("CONSTRUJA: produto nao corresponde ao SKU solicitado", identity);
  }
  if (!construjaTitleMatches(title, expectedTitle)) {
    return failed("CONSTRUJA: titulo principal nao corresponde ao produto mapeado", identity);
  }

  const visiblePrices = prices.filter((candidate) => candidate.visible && candidate.rawText);
  const details = {
    ...identity,
    rawText: visiblePrices.map((candidate) => candidate.rawText).join(" | "),
    productConfirmed: true,
    priceVisible: visiblePrices.length > 0,
    mainPriceCount: visiblePrices.length,
  };
  if (visiblePrices.length === 0) {
    return failed("CONSTRUJA: preco principal nao encontrado", details);
  }
  if (visiblePrices.length !== 1) {
    return failed("CONSTRUJA: preco principal ambiguo", details);
  }

  const parsedPrices = visiblePrices.map((candidate) => {
    const values = parseBRLValues(candidate.rawText, { requireCurrency: true }).filter((value) =>
      isPlausiblePrice(value),
    );
    return values.length === 1 ? values[0] : null;
  });
  if (parsedPrices.some((price) => price === null)) {
    const currencyCount = visiblePrices.reduce(
      (total, candidate) => total + (candidate.rawText.match(/R\$/gi)?.length ?? 0),
      0,
    );
    return failed(
      currencyCount > 1
        ? "CONSTRUJA: preco principal ambiguo"
        : "CONSTRUJA: preco principal em formato nao reconhecido",
      details,
    );
  }

  const uniquePrices = [...new Set(parsedPrices)];
  if (uniquePrices.length !== 1) {
    return failed("CONSTRUJA: preco principal ambiguo", details);
  }

  return {
    ...baseResult,
    ...details,
    price: uniquePrices[0],
    error: "",
  };
}

export async function extractPriceNearTerms(page, terms, options = {}) {
  const normalizedTerms = [...new Set((terms ?? []).map(normalizeText).filter(Boolean))]
    .filter(isUsefulSearchTerm)
    .sort((a, b) => b.length - a.length);
  if (normalizedTerms.length === 0) return null;

  const candidates = await page
    .evaluate(
      ({ searchTerms, browserMoneyPatternSource, requireCurrency }) => {
        const moneyPattern = new RegExp(browserMoneyPatternSource);
        const placeholderPricePattern = /R\$\s*[-–—]+(?:\s*[-–—]+|,\s*[-–—]+)*/i;
        const unavailableSignalPattern =
          /fora\s+(?:de|do)\s+estoque|sem\s+(?:estoque|saldo)|nao\s+disponivel|indisponivel|temporariamente\s+indisponivel|esgotado|avise-?me\s+quando\s+(?:chegar|disponivel)|aviseme\s+quando\s+(?:chegar|disponivel)|produto\s+sob\s+consulta|consulte\s+(?:a\s+)?disponibilidade|aguardando\s+estoque/;
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
        const termMatches = (text, term) => {
          if (!/^\d+$/.test(term)) return text.includes(term);
          return new RegExp(`(^|[^0-9])${term}([^0-9]|$)`).test(text);
        };
        const isOldPriceNode = (node, root) => {
          let current = node instanceof Element ? node : node.parentElement;
          while (current && current !== root) {
            const style = window.getComputedStyle(current);
            const classAndId = `${current.className ?? ""} ${current.id ?? ""}`;
            if (/line-through/.test(style.textDecorationLine)) return true;
            if (
              /(preco[-_ ]?de|precoantigo|old[-_ ]?price|valor[-_ ]?de|riscado|strike)/i.test(
                classAndId,
              )
            ) {
              return true;
            }
            current = current.parentElement;
          }
          return false;
        };
        const currentPriceText = (element) => {
          const parts = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (!isOldPriceNode(walker.currentNode, element)) {
              parts.push(walker.currentNode.textContent ?? "");
            }
          }
          return parts.join(" ");
        };

        const elements = [
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
              "div",
            ].join(", "),
          ),
        ];

        return elements
          .filter((element) => element instanceof HTMLElement && visible(element))
          .map((element) => {
            const text = currentPriceText(element);
            const normalized = normalize(text);
            const matchedTerm = searchTerms.find((term) => termMatches(normalized, term));
            return {
              text,
              length: normalized.length,
              matchedTerm: matchedTerm ?? "",
              hasPrice: moneyPattern.test(text) && (!requireCurrency || /R\$\s*\d/i.test(text)),
              unavailable:
                unavailableSignalPattern.test(normalized) || placeholderPricePattern.test(text),
            };
          })
          .filter(
            (item) => item.matchedTerm && item.hasPrice && !item.unavailable && item.length <= 2000,
          )
          .sort((a, b) => {
            const termDiff = b.matchedTerm.length - a.matchedTerm.length;
            if (termDiff !== 0) return termDiff;
            return a.length - b.length;
          })
          .slice(0, 12)
          .map((item) => item.text);
      },
      {
        searchTerms: normalizedTerms,
        browserMoneyPatternSource: moneyPatternSource,
        requireCurrency: options.requireCurrency === true,
      },
    )
    .catch(() => []);

  for (const text of candidates) {
    const parsed = parseBRL(text, {
      ...options,
      preferLast: options.preferLast ?? true,
    });
    if (parsed) return parsed;
  }

  return null;
}

function isUsefulSearchTerm(term) {
  if (!term) return false;
  if (/^\d+$/.test(term)) return term.length >= 4;
  if (/^(bianco|otto|baumgart|produto)$/.test(term)) return false;
  return term.length >= 6;
}

async function parseLocatorPrice(page, selector, options) {
  const locator = page.locator(selector);
  const count = await locator.count().catch(() => 0);
  if (count === 0) return null;

  const priceTexts = await locator
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const element = node instanceof HTMLElement ? node : null;
        const content =
          element?.getAttribute("content") ??
          element?.getAttribute("value") ??
          element?.getAttribute("data-price") ??
          element?.getAttribute("data-preco") ??
          "";
        const fallback = element?.innerText ?? node.textContent ?? "";
        const normalize = (value) =>
          String(value ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        const placeholderPricePattern = /R\$\s*[-–—]+(?:\s*[-–—]+|,\s*[-–—]+)*/i;
        const unavailableSignalPattern =
          /fora\s+(?:de|do)\s+estoque|sem\s+(?:estoque|saldo)|nao\s+disponivel|indisponivel|temporariamente\s+indisponivel|esgotado|avise-?me\s+quando\s+(?:chegar|disponivel)|aviseme\s+quando\s+(?:chegar|disponivel)|produto\s+sob\s+consulta|consulte\s+(?:a\s+)?disponibilidade|aguardando\s+estoque/;

        const isVisible = (target) => {
          if (!target || target instanceof HTMLMetaElement) return true;
          const style = window.getComputedStyle(target);
          const rect = target.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const rootClassAndId = `${element?.className ?? ""} ${element?.id ?? ""}`;
        const rootStyle = element ? window.getComputedStyle(element) : null;
        const rootIsOldPrice =
          Boolean(rootStyle && /line-through/.test(rootStyle.textDecorationLine)) ||
          /(preco[-_ ]?de|precoantigo|old[-_ ]?price|valor[-_ ]?de|riscado|strike)/i.test(
            rootClassAndId,
          );

        if (element && !content && (!isVisible(element) || rootIsOldPrice)) {
          return { preferred: "", fallback: "" };
        }

        const isOldPriceNode = (target) => {
          let current = target instanceof Element ? target : target.parentElement;
          while (current && current !== node) {
            const style = window.getComputedStyle(current);
            const classAndId = `${current.className ?? ""} ${current.id ?? ""}`;
            if (/line-through/.test(style.textDecorationLine)) return true;
            if (
              /(preco[-_ ]?de|precoantigo|old[-_ ]?price|valor[-_ ]?de|riscado|strike)/i.test(
                classAndId,
              )
            ) {
              return true;
            }
            current = current.parentElement;
          }
          return false;
        };

        const textNodes = [];
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const textNode = walker.currentNode;
          if (!isOldPriceNode(textNode)) textNodes.push(textNode.textContent ?? "");
        }

        const preferred = `${content} ${textNodes.join(" ")}`.trim();
        const fallbackText = `${content} ${fallback}`.trim();
        const combinedText = `${preferred} ${fallbackText}`;

        if (
          placeholderPricePattern.test(combinedText) ||
          unavailableSignalPattern.test(normalize(combinedText))
        ) {
          return { preferred: "", fallback: "" };
        }

        return { preferred, fallback: fallbackText };
      }),
    )
    .catch(() => []);

  const filteredPriceTexts = priceTexts.filter((item) => {
    const text = `${item.preferred ?? ""} ${item.fallback ?? ""}`;
    const normalized = normalizeText(text);
    return (
      text.trim() &&
      !placeholderPricePattern.test(text) &&
      !unavailableSignalPattern.test(normalized)
    );
  });

  const preferred = filteredPriceTexts
    .map((item) => item.preferred)
    .filter(Boolean)
    .join(" ");
  const fallback = filteredPriceTexts
    .map((item) => item.fallback)
    .filter(Boolean)
    .join(" ");

  return (
    parseBRL(preferred, options) ??
    parseLoosePrice(preferred, options) ??
    parseBRL(fallback, options) ??
    parseLoosePrice(fallback, options)
  );
}

async function extractStructuredPrice(page, options = {}) {
  const candidates = await page
    .evaluate(() => {
      const values = [];
      const push = (value) => {
        if (value !== null && value !== undefined && String(value).trim() !== "") {
          values.push(String(value));
        }
      };

      document
        .querySelectorAll(
          [
            "meta[itemprop='price']",
            "meta[property='product:price:amount']",
            "meta[property='og:price:amount']",
            "[itemprop='price']",
          ].join(", "),
        )
        .forEach((node) => {
          push(node.getAttribute("content"));
          push(node.getAttribute("value"));
          push(node.textContent);
        });

      const walk = (value) => {
        if (!value || values.length >= 20) return;
        if (Array.isArray(value)) {
          value.forEach(walk);
          return;
        }
        if (typeof value !== "object") return;

        for (const [key, nested] of Object.entries(value)) {
          if (/^(price|lowPrice|highPrice|minPrice|maxPrice|salePrice)$/i.test(key)) {
            push(nested);
          } else if (typeof nested === "object") {
            walk(nested);
          }
        }
      };

      document.querySelectorAll("script[type='application/ld+json']").forEach((script) => {
        try {
          walk(JSON.parse(script.textContent ?? ""));
        } catch {
          // Ignore malformed structured data from third-party scripts.
        }
      });

      return values;
    })
    .catch(() => []);

  const prices = candidates
    .map((value) => parseLoosePrice(value, options))
    .filter((value) => value !== null);
  return selectPrice(prices, options);
}

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function construjaTitleMatches(actualTitle, expectedTitle) {
  const actual = normalizeText(String(actualTitle ?? ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const expected = normalizeText(String(expectedTitle ?? ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  if (actual.includes(expected) || expected.includes(actual)) {
    return (
      Math.min(actual.length, expected.length) / Math.max(actual.length, expected.length) >= 0.75
    );
  }

  const ignored = new Set(["a", "as", "o", "os", "de", "da", "das", "do", "dos", "e", "para"]);
  const expectedTerms = [...new Set(expected.split(" ").filter((term) => !ignored.has(term)))];
  const actualTerms = new Set(actual.split(" ").filter((term) => !ignored.has(term)));
  const numericTerms = expectedTerms.filter((term) => /\d/.test(term));
  if (numericTerms.some((term) => !actualTerms.has(term))) return false;

  const matched = expectedTerms.filter((term) => actualTerms.has(term)).length;
  return matched >= Math.max(2, Math.ceil(expectedTerms.length * 0.7));
}

function selectorCandidates(selector) {
  const value = selector?.trim();
  if (!value) return [];

  if (/^[.#[]/.test(value) || value.includes(" ") || value.includes(">") || value.includes(":")) {
    return [value];
  }

  return [value, `.${value}`, `#${value}`];
}
