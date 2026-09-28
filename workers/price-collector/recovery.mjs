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

// Keep one policy per browser page/session. A cooldown also applies to the next
// product when the current product exhausts its attempts.
export function createCofemaProductNavigator({
  navigate,
  wait,
  now = Date.now,
  intervalMs = 6500,
  retries = 2,
  retryDelayMs = 15000,
  maxWaitMs = 120000,
}) {
  let nextAllowedAt = 0;
  let suspendedError = null;
  const ready = async () => {
    if (suspendedError) throw suspendedError;
    const remainingMs = nextAllowedAt - now();
    if (remainingMs > 0) await wait(remainingMs);
  };
  return {
    ready,
    async goto(url) {
      for (let attempt = 0; ; attempt++) {
        await ready();
        nextAllowedAt = now() + intervalMs;
        const response = await navigate(url);
        if (!response || response.ok()) return response;
        const status = response.status();
        // The caller may search the exact SKU when an old product URL is gone.
        if ([404, 410].includes(status)) return response;
        const error = new Error(`COFEMA: pagina do produto retornou HTTP ${status}`);
        if (![403, 429, 502, 503, 504].includes(status)) throw error;

        const header = String((await response.headerValue("retry-after")) ?? "").trim();
        let requestedMs = 0;
        if (/^\d+$/.test(header)) requestedMs = Number(header) * 1000;
        else if (header && Number.isFinite(Date.parse(header))) {
          requestedMs = Math.max(0, Date.parse(header) - now());
        }
        const delayMs = Math.max(Math.min(retryDelayMs * 2 ** attempt, maxWaitMs), requestedMs);
        nextAllowedAt = Math.max(nextAllowedAt, now() + delayMs);
        if (delayMs > maxWaitMs) {
          // Never shorten Retry-After or immediately hit the next product.
          suspendedError = new Error(
            `${error.message}; coleta COFEMA suspensa nesta execucao: pausa solicitada excede ${maxWaitMs / 1000}s`,
          );
          throw suspendedError;
        }
        if (attempt >= retries) throw error;
        console.log(
          `[COFEMA] HTTP ${status}; aguardando ${Math.ceil(delayMs / 1000)}s antes de repetir o mesmo produto (${attempt + 1}/${retries}).`,
        );
      }
    },
  };
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
