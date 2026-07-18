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

test("rejects prices inside unavailable product blocks", () => {
  assert.equal(parseBRL("Consulte a disponibilidade R$ 162,09"), null);
  assert.equal(parseBRL("Produto sem saldo R$ 162,09"), null);
  assert.equal(parseBRL("Avise-me quando disponivel R$ 162,09"), null);
});
