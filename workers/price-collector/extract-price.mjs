const moneyPattern = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2,3})/g;

const priceHints = [
  { selector: "[class*='precoProdutoContainer' i]", preferLast: true },
  { selector: "[class*='precoAtual' i]", preferLast: true },
  { selector: ".stepPreco", preferLast: true },
  { selector: "[class*='precoSelecionado' i]", preferLast: true },
  { selector: "[class*='preco-selecao' i]", preferLast: true },
  { selector: "[class*='precoSelecao' i]", preferLast: true },
  { selector: "[data-testid*='price' i]", preferLast: true },
  { selector: "[class*='price' i]", preferLast: true },
  { selector: "[class*='preco' i]", preferLast: true },
  { selector: "[id*='price' i]", preferLast: true },
  { selector: "[id*='preco' i]", preferLast: true },
  { selector: ".valor", preferLast: true },
  { selector: ".product-price", preferLast: true },
  { selector: ".preco", preferLast: true },
];

export function parseBRL(text, options = {}) {
  const preferred = parsePreferredLabeledBRL(text);
  if (preferred) return preferred;

  const matches = parseBRLValues(text);
  if (matches.length === 0) return null;

  return options.preferLast ? matches[matches.length - 1] : matches[0];
}

function parsePreferredLabeledBRL(text) {
  if (!text) return null;

  const normalized = text.replace(/\s+/g, " ").trim();
  const labelPatterns = [
    /(?:à|a)\s*vista\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2,3})/i,
    /pre[cç]o\s*(?:à|a)\s*vista\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2,3})/i,
  ];

  for (const pattern of labelPatterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const value = Number(match[1].replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}

function parseBRLValues(text) {
  if (!text) return [];

  const normalized = text.replace(/R\$/g, " R$").replace(/(\d)(R\$)/g, "$1 $2");
  const matches = [...normalized.matchAll(moneyPattern)]
    .map((match) => match[1])
    .map((value) => Number(value.replace(/\./g, "").replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0);

  return matches;
}

export async function extractPrice(page, selector) {
  for (const candidate of selectorCandidates(selector)) {
    const locator = page.locator(candidate).first();
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      const text = await locator.textContent({ timeout: 8000 }).catch(() => "");
      const parsed = parseBRL(text, { preferLast: true });
      if (parsed) return parsed;
    }
  }

  for (const hint of priceHints) {
    const texts = await page
      .locator(hint.selector)
      .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
    const parsed = parseBRL(texts[0] ?? texts.join(" "), { preferLast: hint.preferLast });
    if (parsed) return parsed;
  }

  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 8000 })
    .catch(() => "");
  return parseBRL(bodyText);
}

function selectorCandidates(selector) {
  const value = selector?.trim();
  if (!value) return [];

  if (/^[.#[]/.test(value) || value.includes(" ") || value.includes(">") || value.includes(":")) {
    return [value];
  }

  return [value, `.${value}`, `#${value}`];
}
