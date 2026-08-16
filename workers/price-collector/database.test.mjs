import assert from "node:assert/strict";
import test from "node:test";

import { normalizeResultForPersistence } from "./database.mjs";

test("persistence rejects a Construja success without final product and price confirmation", () => {
  const result = normalizeResultForPersistence({
    concorrente: "CONSTRUJA",
    status: "sucesso",
    preco_concorrente: 2.19,
  });

  assert.equal(result.sucesso, false);
  assert.equal(result.status, "erro");
  assert.equal(result.precoConcorrente, null);
  assert.equal(result.preservarUltimoPreco, true);
  assert.match(result.mensagemErro, /validacao final/i);
});

test("persistence accepts a positive Construja price only after both confirmations", () => {
  const result = normalizeResultForPersistence({
    concorrente: "CONSTRUJA",
    status: "sucesso",
    preco_concorrente: 4.12,
    produto_confirmado: true,
    preco_principal_confirmado: true,
  });

  assert.equal(result.sucesso, true);
  assert.equal(result.status, "sucesso");
  assert.equal(result.precoConcorrente, 4.12);
  assert.equal(result.preservarUltimoPreco, false);
  assert.equal(result.mensagemErro, null);
});

test("persistence keeps the last valid Construja price when extraction returns an error", () => {
  const result = normalizeResultForPersistence({
    concorrente: "CONSTRUJA",
    status: "erro",
    preco_concorrente: null,
    mensagem_erro: "CONSTRUJA: preco principal nao encontrado",
    preservar_ultimo_preco: true,
  });

  assert.equal(result.status, "erro");
  assert.equal(result.precoConcorrente, null);
  assert.equal(result.preservarUltimoPreco, true);
  assert.match(result.mensagemErro, /preco principal nao encontrado/i);
});
