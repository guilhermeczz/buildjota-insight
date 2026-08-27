const BUSINESS_WEEKDAYS = new Set([1, 2, 3, 4, 5]);

export function saoPauloDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[values.weekday];
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    weekday,
  };
}

export function isConstrujotaMercosBusinessDay(date = new Date()) {
  return BUSINESS_WEEKDAYS.has(saoPauloDateParts(date).weekday);
}

export function parseSimulationDate(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("--simulate-date deve usar o formato AAAA-MM-DD");
  }
  const parsed = new Date(`${value}T12:00:00-03:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Data de simulacao invalida");
  return parsed;
}
