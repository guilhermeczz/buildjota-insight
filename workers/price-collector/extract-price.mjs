const moneyPattern = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2,3})/g;

const priceHints = [
  { selector: "[itemprop='price']", preferLast: false },
  { selector: "meta[itemprop='price']", preferLast: false },
  { selector: "meta[property='product:price:amount']", preferLast: false },
  { selector: "[data-testid*='price' i]", preferLast: true },
  { selector: "[class*='precoProdutoContainer' i]", preferLast: true },
  { selector: "[class*='precoAtual' i]", preferLast: true },
  { selector: "[class*='precoVenda' i]", preferLast: true },
  { selector: "[class*='precoSelecionado' i]", preferLast: true },
  { selector: "[class*='preco-selecao' i]", preferLast: true },
  { selector: "[class*='precoSelecao' i]", preferLast: true },
  { selector: "[class*='valorProduto' i]", preferLast: true },
  { selector: "[class*='valor-produto' i]", preferLast: true },
  { selector: "[class*='product-price' i]", preferLast: true },
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
  const preferred = parsePreferredLabeledBRL(text, options);
  if (preferred) return preferred;

  const matches = parseBRLValues(text);
  if (matches.length === 0) return null;

  return selectPrice(matches, options);
}

function parsePreferredLabeledBRL(text, options = {}) {
  if (!text) return null;

  const normalized = text.replace(/\s+/g, " ").trim();
  const plain = normalizeText(normalized);
  const labelPatterns = [
    /(?:preco\s*)?(?:a vista|avista)\s*(?:r\$)?\s*(\d{1,3}(?:\.\d{3})*,\d{2,3})/i,
    /(?:r\$)?\s*(\d{1,3}(?:\.\d{3})*,\d{2,3})\s*(?:a vista|avista)/i,
    /(?:preco|valor|por)\s*(?:r\$)?\s*(\d{1,3}(?:\.\d{3})*,\d{2,3})/i,
  ];

  for (const pattern of labelPatterns) {
    const match = plain.match(pattern);
    const value = match ? parseMoney(match[1]) : null;
    if (value && isPlausiblePrice(value, options)) return value;
  }

  return null;
}

function parseBRLValues(text) {
  if (!text) return [];

  const normalized = text.replace(/R\$/g, " R$").replace(/(\d)(R\$)/g, "$1 $2");
  return [...normalized.matchAll(moneyPattern)]
    .map((match) => parseMoney(match[1]))
    .filter((value) => value !== null);
}

function parseMoney(value) {
  const parsed = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function selectPrice(values, options = {}) {
  const candidates = values.filter((value) => isPlausiblePrice(value, options));
  if (candidates.length === 0) return null;

  if (options.preferLargest) return Math.max(...candidates);
  return options.preferLast ? candidates[candidates.length - 1] : candidates[0];
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
  return parseBRL(bodyText, { ...options, preferLargest: true });
}

async function parseLocatorPrice(page, selector, options) {
  const locator = page.locator(selector);
  const count = await locator.count().catch(() => 0);
  if (count === 0) return null;

  const texts = await locator
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const element = node instanceof HTMLElement ? node : null;
        const content =
          element?.getAttribute("content") ??
          element?.getAttribute("value") ??
          element?.getAttribute("data-price") ??
          element?.getAttribute("data-preco") ??
          "";
        const text = element?.innerText ?? node.textContent ?? "";
        return `${content} ${text}`.trim();
      }),
    )
    .catch(() => []);

  const joined = texts.filter(Boolean).join(" ");
  return parseBRL(joined, options) ?? parseLoosePrice(joined, options);
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

function selectorCandidates(selector) {
  const value = selector?.trim();
  if (!value) return [];

  if (/^[.#[]/.test(value) || value.includes(" ") || value.includes(">") || value.includes(":")) {
    return [value];
  }

  return [value, `.${value}`, `#${value}`];
}
