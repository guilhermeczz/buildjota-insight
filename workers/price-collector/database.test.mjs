import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeConstrujotaMercosResultForPersistence,
  normalizeResultForPersistence,
  persistConstrujotaMercosResultForTest,
} from "./database.mjs";

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

function confirmedConstrujotaMercosResult(overrides = {}) {
  return {
    status: "sucesso",
    preco: 13.69,
    leitura_confirmada: true,
    produto_confirmado: true,
    bloco_preco_confirmado: true,
    elemento_preco_visivel: true,
    quantidade_precos_principais: 1,
    formato_preco_reconhecido: true,
    preco_principal_confirmado: true,
    produto_indisponivel: false,
    mercos_produto_id: "237153522",
    url_produto: "https://construjota2.mercos.com/produtos/237153522",
    ...overrides,
  };
}

test("CONSTRUJOTA_MERCOS accepts only a fully confirmed main product price", () => {
  const result = normalizeConstrujotaMercosResultForPersistence(confirmedConstrujotaMercosResult());

  assert.equal(result.sucesso, true);
  assert.equal(result.status, "sucesso");
  assert.equal(result.preco, 13.69);
  assert.equal(result.preservarUltimoPreco, false);
  assert.equal(result.mercosProdutoId, "237153522");
  assert.equal(result.urlProduto, "https://construjota2.mercos.com/produtos/237153522");
});

test("CONSTRUJOTA_MERCOS preserves the last price for an unavailable product", () => {
  const result = normalizeConstrujotaMercosResultForPersistence({
    status: "indisponivel",
    preco: 11.99,
    produto_indisponivel: true,
    mercos_produto_id: "related-product-id",
    url_produto: "https://construjota2.mercos.com/produtos/related-product-id",
  });

  assert.equal(result.sucesso, false);
  assert.equal(result.status, "indisponivel");
  assert.equal(result.preco, null);
  assert.equal(result.preservarUltimoPreco, true);
  assert.equal(result.mercosProdutoId, null);
  assert.equal(result.urlProduto, null);
  assert.match(result.mensagem, /último preço confirmado preservado/i);
});

test("CONSTRUJOTA_MERCOS rejects ambiguous or incomplete successful readings", () => {
  const invalidResults = [
    confirmedConstrujotaMercosResult({ quantidade_precos_principais: 2 }),
    confirmedConstrujotaMercosResult({ produto_confirmado: false }),
    confirmedConstrujotaMercosResult({ elemento_preco_visivel: false }),
    confirmedConstrujotaMercosResult({ formato_preco_reconhecido: false }),
    confirmedConstrujotaMercosResult({ preco: 0 }),
  ];

  for (const item of invalidResults) {
    const result = normalizeConstrujotaMercosResultForPersistence(item);
    assert.equal(result.sucesso, false);
    assert.equal(result.status, "erro");
    assert.equal(result.preco, null);
    assert.equal(result.preservarUltimoPreco, true);
    assert.equal(result.mercosProdutoId, null);
    assert.equal(result.urlProduto, null);
  }
});

test("CONSTRUJOTA_MERCOS keeps discovery failures distinct from competitor errors", () => {
  for (const status of ["nao_encontrado", "ambiguo", "indisponivel_sem_historico"]) {
    const result = normalizeConstrujotaMercosResultForPersistence({ status });
    assert.equal(result.status, status);
    assert.equal(result.preco, null);
    assert.equal(result.preservarUltimoPreco, true);
  }
});

function persistenceClient(mappingOverrides = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      if (/select m\.\*, p\.preco_atual/i.test(sql)) {
        return {
          rows: [
            {
              id: "mapping-id",
              produto_id: "product-id",
              preco_atual: "13.690",
              ultimo_preco: "13.690",
              ultimo_sucesso_em: "2026-08-26T12:00:00.000Z",
              ...mappingOverrides,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
}

test("CONSTRUJOTA_MERCOS transaction leaves product and last success untouched when unavailable", async () => {
  const client = persistenceClient();
  const persisted = await persistConstrujotaMercosResultForTest(
    client,
    {
      mapeamento_id: "mapping-id",
      status: "indisponivel",
      preco: null,
      produto_indisponivel: true,
      mensagem: "CONSTRUJOTA_MERCOS: produto indisponível; último preço confirmado preservado",
    },
    "execution-id",
    "2026-08-27T12:00:00.000Z",
  );

  assert.equal(persisted.ultimo_preco_preservado, true);
  assert.equal(persisted.preco_anterior, 13.69);
  assert.equal(
    client.calls.some((call) => /update produtos/i.test(call.sql)),
    false,
  );
  const mappingUpdate = client.calls.find((call) =>
    /update mapeamentos_construjota_mercos/i.test(call.sql),
  );
  assert.ok(mappingUpdate);
  assert.doesNotMatch(mappingUpdate.sql, /ultimo_preco\s*=|ultimo_sucesso_em\s*=/i);
  const historyInsert = client.calls.find((call) =>
    /insert into historico_precos_construjota_mercos/i.test(call.sql),
  );
  assert.equal(historyInsert.values[2], null);
  assert.equal(historyInsert.values[3], "indisponivel");
});

test("CONSTRUJOTA_MERCOS transaction updates product only after complete evidence", async () => {
  const client = persistenceClient();
  const persisted = await persistConstrujotaMercosResultForTest(
    client,
    { mapeamento_id: "mapping-id", ...confirmedConstrujotaMercosResult() },
    "execution-id",
    "2026-08-27T12:00:00.000Z",
  );

  assert.equal(persisted.status, "sucesso");
  const productUpdate = client.calls.find((call) => /update produtos/i.test(call.sql));
  assert.ok(productUpdate);
  assert.deepEqual(productUpdate.values, [13.69, "product-id"]);
  const historyInsert = client.calls.find((call) =>
    /insert into historico_precos_construjota_mercos/i.test(call.sql),
  );
  assert.equal(historyInsert.values[2], 13.69);
  assert.equal(historyInsert.values[3], "sucesso");
});
