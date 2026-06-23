export const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });

export const formatPct = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")}%`;

export const formatDateTime = (iso: string) => {
  const date = new Date(iso);
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
