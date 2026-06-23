const moneyPattern = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2,3})/g;

const priceHints = [
  ".stepPreco",
  "[class*='precoSelecionado' i]",
  "[class*='preco-selecao' i]",
  "[class*='precoSelecao' i]",
  "[data-testid*='price' i]",
  "[class*='price' i]",
  "[class*='preco' i]",
  "[id*='price' i]",
  "[id*='preco' i]",
  ".valor",
  ".product-price",
  ".preco",
];

export function parseBRL(text) {
  if (!text) return null;

  const matches = [...text.matchAll(moneyPattern)]
    .map((match) => match[1])
    .map((value) => Number(value.replace(/\./g, "").replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (matches.length === 0) return null;

  return matches[0] ?? null;
}

export async function extractPrice(page, selector) {
  for (const candidate of selectorCandidates(selector)) {
    const locator = page.locator(candidate).first();
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      const text = await locator.innerText({ timeout: 8000 }).catch(() => "");
      const parsed = parseBRL(text);
      if (parsed) return parsed;
    }
  }

  for (const hint of priceHints) {
    const texts = await page
      .locator(hint)
      .allInnerTexts()
      .catch(() => []);
    const parsed = parseBRL(texts.join(" "));
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
