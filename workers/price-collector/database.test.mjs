import assert from "node:assert/strict";
import test from "node:test";

import { normalizeResultForPersistence } from "./database.mjs";

const competitors = ["COFEMA", "CONSTRUJA", "MAREST", "MEGALESTE"];

function confirmedResult(competitor, overrides = {}) {
  return {
    concorrente: competitor,
    status: "sucesso",
    preco_concorrente: 4.12,
    leitura_confirmada: true,
    produto_confirmado: true,
    bloco_preco_confirmado: true,
    elemento_preco_visivel: true,
    quantidade_precos_principais: 1,
    formato_preco_reconhecido: true,
    preco_principal_confirmado: true,
    ...overrides,
  };
}

test("persistence rejects a positive price without complete evidence for every competitor", () => {
  for (const competitor of competitors) {
    const result = normalizeResultForPersistence({
      concorrente: competitor,
      status: "sucesso",
      preco_concorrente: 2.19,
    });

    assert.equal(result.sucesso, false, competitor);
    assert.equal(result.status, "erro", competitor);
    assert.equal(result.precoConcorrente, null, competitor);
    assert.equal(result.preservarUltimoPreco, true, competitor);
    assert.match(result.mensagemErro, /validacao final/i, competitor);
  }
});

test("persistence accepts a positive price only with complete evidence", () => {
  for (const competitor of competitors) {
    const result = normalizeResultForPersistence(confirmedResult(competitor));

    assert.equal(result.sucesso, true, competitor);
    assert.equal(result.status, "sucesso", competitor);
    assert.equal(result.precoConcorrente, 4.12, competitor);
    assert.equal(result.preservarUltimoPreco, false, competitor);
    assert.equal(result.mensagemErro, null, competitor);
  }
});

test("persistence rejects ambiguous, hidden or unrecognized main prices", () => {
  const invalidEvidence = [
    { quantidade_precos_principais: 2 },
    { elemento_preco_visivel: false },
    { formato_preco_reconhecido: false },
    { produto_confirmado: false },
    { bloco_preco_confirmado: false },
  ];

  for (const evidence of invalidEvidence) {
    const result = normalizeResultForPersistence(confirmedResult("MAREST", evidence));
    assert.equal(result.status, "erro");
    assert.equal(result.precoConcorrente, null);
    assert.equal(result.preservarUltimoPreco, true);
  }
});

test("persistence keeps the last valid price whenever extraction returns an error", () => {
  for (const competitor of competitors) {
    const result = normalizeResultForPersistence({
      concorrente: competitor,
      status: "erro",
      preco_concorrente: null,
      mensagem_erro: `${competitor}: preco principal nao encontrado`,
    });

    assert.equal(result.status, "erro", competitor);
    assert.equal(result.precoConcorrente, null, competitor);
    assert.equal(result.preservarUltimoPreco, true, competitor);
    assert.match(result.mensagemErro, /preco principal nao encontrado/i, competitor);
  }
});
