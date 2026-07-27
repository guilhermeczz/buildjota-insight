import assert from "node:assert/strict";
import test from "node:test";

import { parseBRL } from "./extract-price.mjs";

test("reads prices whose DOM parts are separated by whitespace or lines", () => {
  const cases = [
    ["R$\n162\n,093", 162.093],
    ["R$ 162 , 09", 162.09],
    ["R$\n1 . 162 , 09", 1162.09],
    ["Preco por R$\n2 . 345 ,\n678", 2345.678],
  ];

  for (const [text, expected] of cases) {
    assert.equal(parseBRL(text), expected);
  }
});

test("keeps reading standard Brazilian price formats", () => {
  assert.equal(parseBRL("R$ 1.162,09"), 1162.09);
  assert.equal(parseBRL("R$ 162,09"), 162.09);
});

test("Construja mode ignores dimensions, codes and quantities around the real price", () => {
  const productText = `
    AMANCO - CURVA LONGA ESG 75X90
    Codigo: 158494 | EMB: 1 | Emb. Venda: 10 Master: 10 PC
    15,117
    R$ 51,700
  `;

  assert.equal(parseBRL(productText, { requireCurrency: true, preferLast: false }), 51.7);
});

test("Construja mode chooses the first explicit currency price in the product block", () => {
  assert.equal(
    parseBRL("R$ 51,700 informacao secundaria R$ 15,117", {
      requireCurrency: true,
      preferLast: false,
    }),
    51.7,
  );
});

test("Megaleste mode always chooses the labeled prazo price", () => {
  const options = { preferPrazo: true };
  assert.equal(parseBRL("À prazo R$ 42,130 | À vista R$ 40,024", options), 42.13);
  assert.equal(parseBRL("Preço a prazo: R$ 52,990 | PIX R$ 47,691", options), 52.99);
  assert.equal(parseBRL("Valor a prazo R$ 18,500 | 10% OFF R$ 16,650", options), 18.5);
  assert.equal(parseBRL("Prazo R$ 103,457 | boleto R$ 99,000", options), 103.457);
});

test("Megaleste mode accepts one unlabeled price but does not guess between multiple prices", () => {
  const options = { preferPrazo: true };
  assert.equal(parseBRL("Produto 12345 R$ 42,130", options), 42.13);
  assert.equal(parseBRL("R$ 42,130 | R$ 40,024", options), null);
});

test("Megaleste mode rejects unavailable products even when a price remains in the DOM", () => {
  assert.equal(parseBRL("Produto indisponível | À prazo R$ 42,130", { preferPrazo: true }), null);
  assert.equal(parseBRL("Fora de estoque R$ 42,130", { preferPrazo: true }), null);
});

test("rejects prices inside unavailable product blocks", () => {
  assert.equal(parseBRL("Consulte a disponibilidade R$ 162,09"), null);
  assert.equal(parseBRL("Produto sem saldo R$ 162,09"), null);
  assert.equal(parseBRL("Avise-me quando disponivel R$ 162,09"), null);
});
