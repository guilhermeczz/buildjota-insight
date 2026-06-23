const measurePattern =
  /(\d+(?:[,.]\d+)?)\s*(ml|mililitros?|l|lt|lts|litros?|g|gr|gramas?|kg|quilos?|un|und|unid|unidade?s?)\b/i;

const collator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

type ProductSortParts = {
  base: string;
  measureGroup: string;
  measureValue: number | null;
  normalizedName: string;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function measureMultiplier(unit: string) {
  const normalized = normalizeText(unit);

  if (["l", "lt", "lts", "litro", "litros"].includes(normalized)) {
    return { group: "volume", multiplier: 1000 };
  }

  if (["ml", "mililitro", "mililitros"].includes(normalized)) {
    return { group: "volume", multiplier: 1 };
  }

  if (["kg", "quilo", "quilos"].includes(normalized)) {
    return { group: "peso", multiplier: 1000 };
  }

  if (["g", "gr", "grama", "gramas"].includes(normalized)) {
    return { group: "peso", multiplier: 1 };
  }

  return { group: "unidade", multiplier: 1 };
}

function productSortParts(name: string): ProductSortParts {
  const normalizedName = normalizeText(name);
  const match = normalizedName.match(measurePattern);

  if (!match || match.index === undefined) {
    return {
      base: normalizedName,
      measureGroup: "",
      measureValue: null,
      normalizedName,
    };
  }

  const amount = Number(match[1].replace(",", "."));
  const unit = measureMultiplier(match[2]);

  return {
    base: normalizedName.slice(0, match.index).trim() || normalizedName,
    measureGroup: unit.group,
    measureValue: Number.isNaN(amount) ? null : amount * unit.multiplier,
    normalizedName,
  };
}

export function compareProductNames(a: string, b: string) {
  const left = productSortParts(a);
  const right = productSortParts(b);

  const baseCompare = collator.compare(left.base, right.base);
  if (baseCompare !== 0) return baseCompare;

  if (left.measureGroup !== right.measureGroup) {
    return collator.compare(left.measureGroup, right.measureGroup);
  }

  if (left.measureValue !== null && right.measureValue !== null) {
    const measureCompare = left.measureValue - right.measureValue;
    if (measureCompare !== 0) return measureCompare;
  }

  return collator.compare(left.normalizedName, right.normalizedName);
}

export function sortByProductName<T>(items: T[], getName: (item: T) => string) {
  return [...items].sort((a, b) => compareProductNames(getName(a), getName(b)));
}
