// Retry only missing DOM/price signals. Ambiguous prices, mismatched identities and
// confirmed unavailability must never be turned into a successful reading by retries.
export function isIncompletePriceEvidence(result) {
  return (
    result?.price == null &&
    /: (?:bloco principal (?:do produto|de preco)|preco principal|cartao exato do produto) nao encontrado$/i.test(
      String(result?.error ?? ""),
    )
  );
}

export async function inspectWithRecovery({ inspect, recover }) {
  const first = await inspect();
  if (!isIncompletePriceEvidence(first)) return first;
  await recover();
  return inspect();
}

export function isCofemaLoginResponse(response) {
  try {
    const request = response.request();
    const url = new URL(response.url());
    return (
      /(^|\.)cofema\.com\.br$/i.test(url.hostname) &&
      url.pathname === "/api/auth" &&
      request.method() === "POST" &&
      request.postDataJSON()?.action === "loginCliente"
    );
  } catch {
    return false;
  }
}

export function cofemaLoginResponseError(status, body) {
  if (body?.resetPasswordOnNextLogin === true) {
    return "COFEMA: site exige atualizacao de senha; conclua o acesso manualmente";
  }
  if (status === 429) return "COFEMA: limite temporario de tentativas de login";
  if (status >= 500) return "COFEMA: servico de autenticacao temporariamente indisponivel";
  if ([400, 401, 403].includes(status) || body?.success === false) {
    return `COFEMA: autenticacao recusada pelo site (HTTP ${status})`;
  }
  return "";
}
