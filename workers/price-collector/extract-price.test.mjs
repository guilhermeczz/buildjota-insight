import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

import { extractConstrujaPrice, inspectConstrujaPrice, parseBRL } from "./extract-price.mjs";

let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
});

const construjaMapping = {
  sku_concorrente: "15839",
  produtos: { nome: "AMANCO - CAIXINHA LUZ PVC 4X4 AM." },
};

function construjaFixture({
  sku = "15839",
  title = "AMANCO - CAIXINHA LUZ PVC 4X4 AM.",
  priceMarkup = "",
  relatedMarkup = "",
}) {
  return `<!doctype html>
    <html>
      <body>
        <main>
          <div class="row pt-3">
            <div class="product-summary d-flex flex-column col-lg-6">
              <div class="stepHeader">
                <div>
                  <h2 class="Produto_nomeProduto__fixture">${title}</h2>
                  <span class="Produto_codigoProduto__fixture">Código: <strong>${sku}</strong></span>
                </div>
              </div>
              <div class="stepPreco">
                <div class="stepPrecoContent">
                  ${priceMarkup}
                  <label>Quantidade</label>
                  <button type="button">-</button>
                  <button type="button">+</button>
                  <button type="button">Comprar</button>
                </div>
              </div>
            </div>
          </div>
          ${relatedMarkup}
        </main>
      </body>
    </html>`;
}

function mainPrice(markup) {
  return `<div class="Produto_precoProdutoContainer__fixture">${markup}</div>`;
}

async function withConstrujaFixture(fixture, callback) {
  const context = await browser.newContext({ locale: "pt-BR" });
  const page = await context.newPage();
  const pageSku = fixture.urlSku ?? fixture.sku ?? "15839";
  const url = `https://www.construja.com.br/produto/${pageSku}/fixture-produto`;
  await page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: construjaFixture(fixture),
    }),
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });

  try {
    return await callback(page);
  } finally {
    await context.close();
  }
}

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

test("reads Brazilian prices with three decimal places", () => {
  assert.equal(parseBRL("R$ 4,120", { requireCurrency: true }), 4.12);
  assert.equal(parseBRL("R$ 51,700", { requireCurrency: true }), 51.7);
  assert.equal(parseBRL("R$ 1.234,567", { requireCurrency: true }), 1234.567);
});

test("Construja reads only the main product price and ignores R$ 2,19 outside its block", async () => {
  await withConstrujaFixture(
    {
      priceMarkup: mainPrice("R$ 4,120"),
      relatedMarkup: `
        <section aria-label="Compre junto">
          <article class="card-produto-grid">
            <h3>TRAMON - CAIXINHA LUZ PVC 4X4 AM</h3>
            <span>Código: 166253</span><span>R$ 2,19</span>
          </article>
        </section>`,
    },
    async (page) => {
      assert.equal(await extractConstrujaPrice(page, construjaMapping), 4.12);
    },
  );
});

test("Construja joins currency, integer and three-decimal DOM parts", async () => {
  await withConstrujaFixture(
    {
      priceMarkup: mainPrice("<span>R$</span><span>4</span><span>,120</span>"),
    },
    async (page) => {
      const result = await inspectConstrujaPrice(page, construjaMapping);
      assert.equal(result.rawText, "R$ 4 ,120");
      assert.equal(result.price, 4.12);
    },
  );
});

test("Construja ignores a related product containing the same AMANCO term", async () => {
  await withConstrujaFixture(
    {
      priceMarkup: mainPrice("R$ 4,120"),
      relatedMarkup: `
        <section aria-label="Similares">
          <article><h3>AMANCO - OUTRO PRODUTO</h3><span>R$ 2,190</span></article>
        </section>`,
    },
    async (page) => {
      assert.equal(await extractConstrujaPrice(page, construjaMapping), 4.12);
    },
  );
});

test("Construja ignores a struck old price and reads the visible current price", async () => {
  await withConstrujaFixture(
    {
      priceMarkup: mainPrice(
        '<s class="Produto_precoAnterior__fixture">R$ 5,000</s><span>R$ 4,120</span>',
      ),
    },
    async (page) => {
      assert.equal(await extractConstrujaPrice(page, construjaMapping), 4.12);
    },
  );
});

test("Construja ignores a hidden competing price inside the product summary", async () => {
  await withConstrujaFixture(
    {
      priceMarkup: `${mainPrice("R$ 4,120")}<div style="display:none">${mainPrice(
        "R$ 2,190",
      )}</div>`,
    },
    async (page) => {
      assert.equal(await extractConstrujaPrice(page, construjaMapping), 4.12);
    },
  );
});

test("Construja rejects two conflicting main prices", async () => {
  await withConstrujaFixture(
    {
      priceMarkup: `${mainPrice("R$ 4,120")}${mainPrice("R$ 4,990")}`,
    },
    async (page) => {
      const result = await inspectConstrujaPrice(page, construjaMapping);
      assert.equal(result.price, null);
      assert.match(result.error, /preco principal ambiguo/i);
    },
  );
});

test("Construja rejects a page whose URL and displayed SKU belong to another product", async () => {
  await withConstrujaFixture(
    {
      sku: "99999",
      title: "AMANCO - OUTRO PRODUTO",
      priceMarkup: mainPrice("R$ 4,120"),
    },
    async (page) => {
      const result = await inspectConstrujaPrice(page, construjaMapping);
      assert.equal(result.price, null);
      assert.match(result.error, /produto nao corresponde ao SKU solicitado/i);
    },
  );
});

test("Construja rejects a displayed SKU that conflicts with the product URL", async () => {
  await withConstrujaFixture(
    {
      urlSku: "15839",
      sku: "99999",
      priceMarkup: mainPrice("R$ 4,120"),
    },
    async (page) => {
      const result = await inspectConstrujaPrice(page, construjaMapping);
      assert.equal(result.price, null);
      assert.match(result.error, /produto nao corresponde ao SKU solicitado/i);
    },
  );
});

test("Construja rejects a main title that does not identify the mapped product", async () => {
  await withConstrujaFixture(
    {
      title: "AMANCO - CURVA LONGA ESGOTO 75X90",
      priceMarkup: mainPrice("R$ 4,120"),
    },
    async (page) => {
      const result = await inspectConstrujaPrice(page, construjaMapping);
      assert.equal(result.price, null);
      assert.match(result.error, /titulo principal nao corresponde/i);
    },
  );
});

test("Construja rejects a confirmed product with no main price", async () => {
  await withConstrujaFixture({}, async (page) => {
    const result = await inspectConstrujaPrice(page, construjaMapping, { waitTimeoutMs: 50 });
    assert.equal(result.price, null);
    assert.match(result.error, /preco principal nao encontrado/i);
  });
});

test("Construja never falls back to a related price while the main price is absent", async () => {
  await withConstrujaFixture(
    {
      relatedMarkup: `
        <section aria-label="Similares">
          <article><h3>TRAMON - CAIXINHA LUZ PVC 4X4 AM</h3><span>R$ 2,190</span></article>
        </section>`,
    },
    async (page) => {
      const result = await inspectConstrujaPrice(page, construjaMapping, { waitTimeoutMs: 50 });
      assert.equal(result.price, null);
      assert.match(result.error, /preco principal nao encontrado/i);
    },
  );
});

test("currency-required parsing ignores dimensions, codes and quantities around a price", () => {
  const productText = `
    AMANCO - CURVA LONGA ESG 75X90
    Codigo: 158494 | EMB: 1 | Emb. Venda: 10 Master: 10 PC
    15,117
    R$ 51,700
  `;

  assert.equal(parseBRL(productText, { requireCurrency: true, preferLast: false }), 51.7);
});

test("generic parsing preserves its configured first-price behavior for other callers", () => {
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
