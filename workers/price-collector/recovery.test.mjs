import assert from "node:assert/strict";
import test from "node:test";
import {
  cofemaLoginResponseError,
  inspectWithRecovery,
  isCofemaLoginResponse,
} from "./recovery.mjs";
import { isConfirmedUnavailableEvidence } from "./extract-price.mjs";

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
