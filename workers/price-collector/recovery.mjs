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
  // Never copy a provider response into logs: it may echo an account identifier.
  // A 404/403 alone does not establish that the submitted password was rejected.
  const reason = String(
    typeof body?.error === "string" ? body.error : (body?.error?.message ?? body?.message ?? ""),
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (body?.resetPasswordOnNextLogin === true) {
    return "COFEMA: site exige atualizacao de senha; conclua o acesso manualmente";
  }
  if (status === 429) return "COFEMA: limite temporario de tentativas de login";
  if (status >= 500) return "COFEMA: servico de autenticacao temporariamente indisponivel";
  if (/usuario ou senha invalid|credenciais invalid|senha incorreta|senha invalida/.test(reason)) {
    return `COFEMA: credenciais recusadas pelo site (HTTP ${status}); confira a configuracao usada pelo worker`;
  }
  if (
    /cadastro nao encontr|cadastro nao localiz|cliente nao encontr|cliente nao localiz/.test(reason)
  ) {
    return `COFEMA: cadastro nao localizado no login (HTTP ${status}); confira codigo ou CPF/CNPJ`;
  }
  if (status === 404) return "COFEMA: falha no servico de autenticacao (HTTP 404)";
  if (status === 403) return "COFEMA: acesso ao servico de autenticacao bloqueado (HTTP 403)";
  if (status >= 400 || body?.success === false) {
    return `COFEMA: autenticacao nao concluida pelo site (HTTP ${status})`;
  }
  return "";
}
