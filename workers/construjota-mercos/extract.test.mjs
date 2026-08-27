import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

import {
  inspectConstrujotaMercosProduct,
  isConfirmedConstrujotaMercosResult,
  mercosProductIdFromUrl,
  parseMercosTablePrice,
  skuFromMercosText,
  subtitleMatchesExactSku,
} from "./extract.mjs";

let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
});

function detailFixture({
  sku = "503",
  title = "VEDALIT 900ML SACHE (06)",
  priceMarkup = '<h3 class="AddToCartContainer__price__fixture">R$ 13,69</h3>',
  unavailableMarkup = "",
  relatedMarkup = "",
  headings = `<h1>${title}</h1>`,
  delayMarkup = "",
} = {}) {
  return `<!doctype html><html><body>
    <main>
      <section class="ProductPage__productDetails__fixture">
        ${headings}
        <div class="ProductInfo__productInfo__fixture">Cód. ${sku} • UN<br>Múltiplo: 6</div>
        ${unavailableMarkup}
        ${priceMarkup}
        <button type="button">COMPRAR</button>
      </section>
      ${relatedMarkup}
    </main>
    ${delayMarkup}
  </body></html>`;
}

async function withFixture(html, callback, productId = "237153522") {
  const context = await browser.newContext({ locale: "pt-BR" });
  const page = await context.newPage();
  const url = `https://construjota2.mercos.com/produtos/${productId}`;
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  try {
    return await callback(page);
  } finally {
    await context.close();
  }
}

test("accepts SKU 503 and only the price inside the confirmed main product block", async () => {
  const html = detailFixture({
    relatedMarkup: `
      <section><h2>Produtos relacionados</h2><span>R$ 11,99</span></section>
      <aside class="sticky-summary">R$ 13,69</aside>
      <div class="cart-subtotal">R$ 99,90</div>`,
  });
  await withFixture(html, async (page) => {
    const result = await inspectConstrujotaMercosProduct(page, "503", {
      waitTimeoutMs: 100,
      hasPreviousPrice: true,
    });
    assert.equal(result.status, "sucesso");
    assert.equal(result.preco, 13.69);
    assert.equal(result.mercos_produto_id, "237153522");
    assert.equal(isConfirmedConstrujotaMercosResult(result), true);
  });
});

test("preserves the previous value when SKU 419 is unavailable and ignores related prices", async () => {
  const html = detailFixture({
    sku: "419",
    title: "BIANCO 900G SACHE (6)",
    priceMarkup: "",
    unavailableMarkup: `<div class="InfoMessage__messageContainer__fixture">
      Ops! Já vendemos todo o estoque deste produto.
      Por favor, entre em contato se você precisar comprá-lo.
    </div>`,
    relatedMarkup: "<section>R$ 11,99 <article>R$ 13,69</article></section>",
  });
  await withFixture(
    html,
    async (page) => {
      const result = await inspectConstrujotaMercosProduct(page, "419", {
        waitTimeoutMs: 100,
        hasPreviousPrice: true,
      });
      assert.equal(result.status, "indisponivel");
      assert.equal(result.preco, null);
      assert.equal(result.produto_confirmado, true);
      assert.match(result.mensagem, /último preço confirmado preservado/);
    },
    "237153309",
  );
});

test("marks unavailable without history separately", async () => {
  const html = detailFixture({
    sku: "419",
    priceMarkup: "",
    unavailableMarkup:
      '<div class="InfoMessage__messageContainer__fixture">Ops! Já vendemos todo o estoque deste produto.</div>',
  });
  await withFixture(html, async (page) => {
    const result = await inspectConstrujotaMercosProduct(page, "419", {
      waitTimeoutMs: 100,
      hasPreviousPrice: false,
    });
    assert.equal(result.status, "indisponivel_sem_historico");
    assert.equal(result.preco, null);
  });
});

test("rejects a product detail whose displayed code differs from the requested SKU", async () => {
  await withFixture(detailFixture({ sku: "2503" }), async (page) => {
    const result = await inspectConstrujotaMercosProduct(page, "503", { waitTimeoutMs: 50 });
    assert.equal(result.status, "sku_divergente");
    assert.equal(result.preco, null);
    assert.equal(result.sku_observado, "2503");
  });
});

test("rejects a missing price without an unavailable message", async () => {
  await withFixture(detailFixture({ priceMarkup: "" }), async (page) => {
    const result = await inspectConstrujotaMercosProduct(page, "503", { waitTimeoutMs: 50 });
    assert.equal(result.status, "erro");
    assert.match(result.mensagem, /preco principal nao encontrado/);
  });
});

test("rejects two visible main price elements even when the values are equal", async () => {
  const priceMarkup = `
    <h3 class="AddToCartContainer__price__one">R$ 13,69</h3>
    <h3 class="AddToCartContainer__price__two">R$ 13,69</h3>`;
  await withFixture(detailFixture({ priceMarkup }), async (page) => {
    const result = await inspectConstrujotaMercosProduct(page, "503", { waitTimeoutMs: 50 });
    assert.equal(result.status, "ambiguo");
    assert.equal(result.quantidade_precos_principais, 2);
  });
});

test("rejects conflicting prices inside the only selected main price element", async () => {
  const priceMarkup =
    '<h3 class="AddToCartContainer__price__fixture">R$ 13,69 <span>R$ 12,99</span></h3>';
  await withFixture(detailFixture({ priceMarkup }), async (page) => {
    const result = await inspectConstrujotaMercosProduct(page, "503", { waitTimeoutMs: 50 });
    assert.equal(result.status, "ambiguo");
    assert.equal(result.preco, null);
  });
});

test("waits for asynchronous product content before deciding it has no price", async () => {
  const html = detailFixture({
    priceMarkup: '<div id="price-slot"></div>',
    delayMarkup: `<script>
      setTimeout(() => {
        document.querySelector('#price-slot').outerHTML =
          '<h3 class="AddToCartContainer__price__async">R$ 13,69</h3>';
      }, 80);
    </script>`,
  });
  await withFixture(html, async (page) => {
    const result = await inspectConstrujotaMercosProduct(page, "503", {
      waitTimeoutMs: 1_000,
    });
    assert.equal(result.status, "sucesso");
    assert.equal(result.preco, 13.69);
  });
});

test("requires exactly one visible title in the main block", async () => {
  const headings = "<h1>VEDALIT 900ML</h1><h1>OUTRO PRODUTO</h1>";
  await withFixture(detailFixture({ headings }), async (page) => {
    const result = await inspectConstrujotaMercosProduct(page, "503", { waitTimeoutMs: 50 });
    assert.equal(result.status, "erro");
    assert.match(result.mensagem, /titulo principal/);
  });
});

test("recognizes exact SKU boundaries in catalog subtitles", () => {
  const subtitles = [
    "Cód. 503 • UN",
    "Cód. 2503 • UN",
    "Cód. 5030 • UN",
    "Cód. 5032 • UN",
    "Cód. 5033 • UN",
    "Cód. 5034 • UN",
    "Cód. 5503 • UN",
  ];
  assert.deepEqual(
    subtitles.filter((value) => subtitleMatchesExactSku(value, "503")),
    ["Cód. 503 • UN"],
  );
  assert.equal(skuFromMercosText("Cód. ABC-503 • CX"), "ABC-503");
});

test("parses Brazilian table prices with two or three decimals without guessing", () => {
  assert.equal(parseMercosTablePrice("R$ 13,69"), 13.69);
  assert.equal(parseMercosTablePrice("R$ 1.234,56"), 1234.56);
  assert.equal(parseMercosTablePrice("R$ 162,093"), 162.093);
  assert.equal(parseMercosTablePrice("R$ 0,00"), null);
  assert.equal(parseMercosTablePrice("R$ 13,69 R$ 12,99"), null);
  assert.equal(parseMercosTablePrice("Código 503 • Múltiplo 6"), null);
});

test("accepts only canonical numeric Mercos product URLs", () => {
  assert.equal(
    mercosProductIdFromUrl("https://construjota2.mercos.com/produtos/237153522"),
    "237153522",
  );
  assert.equal(mercosProductIdFromUrl("https://construjota2.mercos.com/produtos/503"), "503");
  assert.equal(mercosProductIdFromUrl("https://construjota2.mercos.com/?busca=503"), "");
});
