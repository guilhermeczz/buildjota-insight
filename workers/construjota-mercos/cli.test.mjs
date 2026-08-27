import assert from "node:assert/strict";
import test from "node:test";

import { cliArgValue, normalizeDryRunProductUrl } from "./cli.mjs";

test("accepts CLI values with equals or as the following argument", () => {
  assert.equal(cliArgValue(["--sku=503"], "--sku"), "503");
  assert.equal(cliArgValue(["--sku", "503"], "--sku"), "503");
  assert.equal(cliArgValue(["--sku", "--dry-run"], "--sku"), "");
});

test("accepts only a canonical product URL from the configured Mercos portal", () => {
  const baseUrl = "https://construjota2.mercos.com";
  assert.equal(
    normalizeDryRunProductUrl(
      "https://construjota2.mercos.com/produtos/237153522/?origem=teste#preco",
      baseUrl,
    ),
    "https://construjota2.mercos.com/produtos/237153522",
  );
  assert.throws(
    () => normalizeDryRunProductUrl("https://construjota2.mercos.com/", baseUrl),
    /\/produtos\/\{id\}/,
  );
  assert.throws(
    () => normalizeDryRunProductUrl("https://www.construja.com.br/produto/503", baseUrl),
    /deve pertencer ao portal/,
  );
});
