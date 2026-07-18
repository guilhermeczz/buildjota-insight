// Price parts are frequently rendered in separate DOM nodes (currency, integer and cents).
// Keep one shared pattern for the browser-side candidate search and the final parser.
const moneyPatternSource = String.raw`(?:R\$\s*)?(\d{1,3}(?:\s*\.\s*\d{3})*\s*,\s*\d{2,3})`;
const moneyPattern = new RegExp(moneyPatternSource, "g");
const placeholderPricePattern = /R\$\s*[-–—]+(?:\s*[-–—]+|,\s*[-–—]+)*/i;
const unavailableSignalPattern =
  /fora\s+(?:de|do)\s+estoque|sem\s+(?:estoque|saldo)|nao\s+disponivel|indisponivel|temporariamente\s+indisponivel|esgotado|avise-?me\s+quando\s+(?:chegar|disponivel)|aviseme\s+quando\s+(?:chegar|disponivel)|produto\s+sob\s+consulta|consulte\s+(?:a\s+)?disponibilidade|aguardando\s+estoque/;

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

  const preferred = parsePreferredLabeledBRL(text, options);
  if (preferred) return preferred;

  const discounted = parseDiscountedBRL(text, options);
  if (discounted) return discounted;

  const matches = parseBRLValues(text);
  if (matches.length === 0) return null;

  return selectPrice(matches, options);
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

  const matches = parseBRLValues(text);
  if (matches.length === 0) return null;

  return selectPrice(matches, { ...options, preferLast: true });
}

function parseBRLValues(text) {
  if (!text) return [];

  const normalized = text.replace(/R\$/g, " R$").replace(/(\d)(R\$)/g, "$1 $2");
  return [...normalized.matchAll(moneyPattern)]
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

export async function extractPriceNearTerms(page, terms, options = {}) {
  const normalizedTerms = [...new Set((terms ?? []).map(normalizeText).filter(Boolean))]
    .filter(isUsefulSearchTerm)
    .sort((a, b) => b.length - a.length);
  if (normalizedTerms.length === 0) return null;

  const candidates = await page
    .evaluate(
      ({ searchTerms, browserMoneyPatternSource }) => {
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
              hasPrice: moneyPattern.test(text),
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
      { searchTerms: normalizedTerms, browserMoneyPatternSource: moneyPatternSource },
    )
    .catch(() => []);

  for (const text of candidates) {
    const parsed = parseBRL(text, { ...options, preferLast: true });
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

function selectorCandidates(selector) {
  const value = selector?.trim();
  if (!value) return [];

  if (/^[.#[]/.test(value) || value.includes(" ") || value.includes(">") || value.includes(":")) {
    return [value];
  }

  return [value, `.${value}`, `#${value}`];
}
