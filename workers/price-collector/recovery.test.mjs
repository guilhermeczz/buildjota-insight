import assert from "node:assert/strict";
import test from "node:test";
import {
  cofemaLoginResponseError,
  createCofemaProductNavigator,
  inspectWithRecovery,
  isCofemaLoginResponse,
} from "./recovery.mjs";
import { isConfirmedUnavailableEvidence } from "./extract-price.mjs";

function navigationFixture(responses, options = {}) {
  let clock = Date.parse("2026-09-28T12:00:00Z");
  const calls = [];
  const waits = [];
  const navigator = createCofemaProductNavigator({
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    navigate: async (url) => {
      calls.push({ url, at: clock });
      const { status, retryAfter = null } = responses.shift();
      return {
        status: () => status,
        ok: () => status === 200,
        headerValue: async () => retryAfter,
      };
    },
    ...options,
  });
  return { navigator, calls, waits };
}

test("Cofema spaces successful product navigations", async () => {
  const { navigator, calls, waits } = navigationFixture([{ status: 200 }, { status: 200 }]);
  await navigator.goto("one");
  await navigator.goto("two");
  assert.deepEqual(waits, [6500]);
  assert.equal(calls[1].at - calls[0].at, 6500);
});

test("Cofema waits 15s then 30s and retains the cooldown for the next product after exhaustion", async () => {
  const { navigator, calls, waits } = navigationFixture([
    { status: 403 },
    { status: 403 },
    { status: 403 },
    { status: 200 },
  ]);
  await assert.rejects(navigator.goto("one"), /HTTP 403$/);
  await navigator.goto("two");
  assert.deepEqual(waits, [15000, 30000, 60000]);
  assert.deepEqual(
    calls.map(({ url }) => url),
    ["one", "one", "one", "two"],
  );
});

test("Cofema respects Retry-After seconds and HTTP dates", async () => {
  for (const retryAfter of ["45", "Mon, 28 Sep 2026 12:00:45 GMT"]) {
    const { navigator, waits } = navigationFixture([{ status: 429, retryAfter }, { status: 200 }]);
    await navigator.goto("one");
    assert.deepEqual(waits, [45000]);
  }
});

test("Cofema invalid Retry-After falls back to backoff, and long waits suspend all later requests", async () => {
  const invalid = navigationFixture([{ status: 503, retryAfter: "invalid" }, { status: 200 }]);
  await invalid.navigator.goto("one");
  assert.deepEqual(invalid.waits, [15000]);
  const long = navigationFixture([{ status: 429, retryAfter: "600" }]);
  await assert.rejects(long.navigator.goto("one"), /coleta COFEMA suspensa/);
  await assert.rejects(long.navigator.goto("two"), /coleta COFEMA suspensa/);
  assert.equal(long.calls.length, 1);
});

test("Cofema does not retry credential errors or missing URLs as transient HTTP errors", async () => {
  const auth = navigationFixture([{ status: 401 }]);
  await assert.rejects(auth.navigator.goto("one"), /HTTP 401$/);
  assert.equal(auth.calls.length, 1);
  for (const status of [404, 410]) {
    const missing = navigationFixture([{ status }]);
    assert.equal((await missing.navigator.goto("one")).status(), status);
    assert.equal(missing.calls.length, 1);
  }
});

test("Cofema waits for loginCliente, ignoring status/logout responses on the same URL", () => {
  const response = (action, method = "POST", url = "https://www.cofema.com.br/api/auth") => ({
    url: () => url,
    request: () => ({ method: () => method, postDataJSON: () => ({ action }) }),
  });
  assert.equal(isCofemaLoginResponse(response("loginCliente")), true);
  for (const action of ["getAuthStatus", "logout", "loginVendedor", ""]) {
    assert.equal(isCofemaLoginResponse(response(action)), false);
  }
  assert.equal(isCofemaLoginResponse(response("loginCliente", "GET")), false);
  assert.equal(
    isCofemaLoginResponse(response("loginCliente", "POST", "https://example.com/api/auth")),
    false,
  );
});

test("Cofema gives actionable auth errors without echoing response data", () => {
  assert.match(
    cofemaLoginResponseError(200, { resetPasswordOnNextLogin: true }),
    /atualizacao de senha/,
  );
  assert.match(cofemaLoginResponseError(401, { error: "secret" }), /HTTP 401/);
  assert.match(cofemaLoginResponseError(429, {}), /limite temporario/);
  assert.match(cofemaLoginResponseError(503, {}), /temporariamente indisponivel/);
  assert.equal(cofemaLoginResponseError(200, { success: true }), "");
});

test("Cofema distinguishes service 404, account lookup and explicit credential rejection", () => {
  assert.equal(
    cofemaLoginResponseError(404, { success: false, error: "" }),
    "COFEMA: falha no servico de autenticacao (HTTP 404)",
  );
  assert.match(
    cofemaLoginResponseError(404, {
      success: false,
      error: "Cliente nao encontrado: private-account",
    }),
    /cadastro nao localizado/,
  );
  assert.match(
    cofemaLoginResponseError(401, { success: false, error: "Usuário ou senha inválidos!" }),
    /credenciais recusadas/,
  );
  assert.match(cofemaLoginResponseError(403, { success: false }), /bloqueado/);
  assert.doesNotMatch(
    cofemaLoginResponseError(404, { success: false, error: "private-account" }),
    /private-account|credenciais recusadas|PRODUTO INDISPONIVEL/,
  );
});

test("missing main price is retried once and the final evidence is returned", async () => {
  let reads = 0;
  let recoveries = 0;
  const success = { price: 12.34, error: "" };
  const result = await inspectWithRecovery({
    inspect: async () =>
      ++reads === 1 ? { price: null, error: "CONSTRUJA: preco principal nao encontrado" } : success,
    recover: async () => {
      recoveries++;
    },
  });
  assert.equal(result, success);
  assert.equal(reads, 2);
  assert.equal(recoveries, 1);
});

test("persistent missing product terminates after one recovery", async () => {
  let reads = 0;
  const failure = { price: null, error: "MAREST: bloco principal do produto nao encontrado" };
  assert.equal(
    await inspectWithRecovery({
      inspect: async () => {
        reads++;
        return failure;
      },
      recover: async () => {},
    }),
    failure,
  );
  assert.equal(reads, 2);
});

test("unavailability, ambiguous price, wrong SKU and auth errors are not retried as missing DOM", async () => {
  for (const reason of [
    "PRODUTO INDISPONIVEL",
    "preco principal ambiguo",
    "produto nao corresponde ao SKU solicitado",
    "login nao confirmado",
  ]) {
    const failure = { price: null, error: `MAREST: ${reason}` };
    assert.equal(
      await inspectWithRecovery({
        inspect: async () => failure,
        recover: async () => assert.fail("must not retry"),
      }),
      failure,
    );
  }
});

test("unavailability requires the exact product and purchase block to be confirmed", () => {
  const evidence = { unavailable: true, productConfirmed: true, priceScopeConfirmed: true };
  assert.equal(isConfirmedUnavailableEvidence(evidence), true);
  for (const key of Object.keys(evidence)) {
    assert.equal(isConfirmedUnavailableEvidence({ ...evidence, [key]: false }), false);
  }
  assert.equal(isConfirmedUnavailableEvidence({ error: "login nao confirmado" }), false);
});
