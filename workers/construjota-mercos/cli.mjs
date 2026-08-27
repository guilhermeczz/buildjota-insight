export function cliArgValue(argv, name) {
  const args = Array.isArray(argv) ? argv : [];
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index] ?? "");
    if (argument.startsWith(prefix)) return argument.slice(prefix.length).trim();
    if (argument === name) {
      const next = String(args[index + 1] ?? "").trim();
      return next && !next.startsWith("--") ? next : "";
    }
  }
  return "";
}

export function normalizeDryRunProductUrl(value, baseUrl) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  let url;
  let expectedOrigin;
  try {
    url = new URL(raw);
    expectedOrigin = new URL(baseUrl).origin;
  } catch {
    throw new Error('--url invalida; informe a URL completa de "/produtos/{id}"');
  }

  if (url.protocol !== "https:" || url.origin !== expectedOrigin) {
    throw new Error(`--url deve pertencer ao portal ${expectedOrigin}`);
  }
  if (!/^\/produtos\/\d+\/?$/.test(url.pathname)) {
    throw new Error('--url deve apontar para uma pagina "/produtos/{id}" da Mercos');
  }

  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString();
}
