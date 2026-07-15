export const toDateString = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return "";
};

export const toTimestamp = (value: unknown) => {
  const normalized = toDateString(value);
  if (!normalized) return 0;
  const date = new Date(normalized);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const formatBRL = (value: number | null | undefined) =>
  Number(value ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });

export const formatPct = (value: number | null | undefined) => {
  const amount = Number(value ?? 0);
  return `${amount > 0 ? "+" : ""}${amount.toFixed(2).replace(".", ",")}%`;
};

export const formatDateTime = (value: unknown) => {
  const date = new Date(toDateString(value));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
