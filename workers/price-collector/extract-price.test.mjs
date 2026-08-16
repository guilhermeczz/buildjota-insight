import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

import {
  construjaRateLimitRetrySeconds,
  extractConstrujaPrice,
  extractPriceNearTerms,
  inspectCofemaPrice,
  inspectConstrujaPrice,
  inspectMarestPrice,
  inspectMegalestePrice,
  isConstrujaLoginWallText,
  isConfirmedPriceEvidence,
  parseBRL,
} from "./extract-price.mjs";

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

async function withHtmlFixture(url, html, callback) {
  const context = await browser.newContext({ locale: "pt-BR" });
  const page = await context.newPage();
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

test("the legacy broad proximity extractor fails closed", async () => {
  const url = "https://example.test/produto/123";
  await withHtmlFixture(
    url,
    "<main><h1>Produto 123</h1><section>R$ 2,19</section></main>",
    async (page) => {
      assert.equal(await extractPriceNearTerms(page, ["123"]), null);
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

test("Construja uses mapped URL and exact SKU even when the supplier title changes", async () => {
  await withConstrujaFixture(
    {
      title: "AMANCO - CURVA LONGA ESGOTO 75X90",
      priceMarkup: mainPrice("R$ 4,120"),
    },
    async (page) => {
      const result = await inspectConstrujaPrice(page, construjaMapping);
      assert.equal(result.price, 4.12);
      assert.equal(result.productConfirmed, true);
      assert.equal(result.title, "AMANCO - CURVA LONGA ESGOTO 75X90");
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

test("Construja identifies the plural login wall instead of reporting a missing price", async () => {
  assert.equal(isConstrujaLoginWallText("FAÇA LOGIN OU CADASTRE-SE PARA VER OS PREÇOS"), true);

  await withConstrujaFixture(
    {
      priceMarkup: "<div>FAÇA LOGIN OU CADASTRE-SE PARA VER OS PREÇOS</div>",
    },
    async (page) => {
      const result = await inspectConstrujaPrice(page, construjaMapping, { waitTimeoutMs: 50 });
      assert.equal(result.price, null);
      assert.equal(result.productConfirmed, true);
      assert.match(result.error, /sessao expirada; preco exige login/i);
    },
  );
});

test("Construja identifies a temporary API rate limit instead of reporting a missing price", async () => {
  assert.equal(
    construjaRateLimitRetrySeconds(
      "Muitas requisições efetuadas nesse recurso. Tente novamente em 483 segundos.",
    ),
    483,
  );

  await withConstrujaFixture(
    {
      sku: "185620",
      priceMarkup: "<div>Obtendo preço atualizado</div>",
      relatedMarkup:
        '<div role="alert">Muitas requisições efetuadas nesse recurso. Tente novamente em 483 segundos.</div>',
    },
    async (page) => {
      const result = await inspectConstrujaPrice(
        page,
        { sku_concorrente: "185620", produtos: { nome: "TÍTULO DIFERENTE" } },
        { waitTimeoutMs: 50 },
      );
      assert.equal(result.price, null);
      assert.equal(result.productConfirmed, true);
      assert.match(result.error, /limite temporario.*483s/i);
    },
  );
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

const cofemaMapping = {
  sku_concorrente: "410409",
  produtos: { nome: "OTTO BAUMGART BIANCO 900G SACHE 122854" },
};

function cofemaFixture({
  priceMarkup = "",
  relatedMarkup = "",
  code = "410409",
  title = "OTTO BAUMGART BIANCO 900G SACHE 122854",
} = {}) {
  return `<!doctype html><html><body><main>
    <div class="space-y-2">
      <h1>${title}</h1>
      <p>Código: ${code}</p>
      <p>Referência do fornecedor: 122854</p>
      <div class="produto-preco">${priceMarkup}</div>
      <label>Quantidade</label><button>Comprar</button>
    </div>
    ${relatedMarkup}
  </main></body></html>`;
}

test("Cofema reads only the visible main-summary price", async () => {
  const url = "https://novo.cofema.com.br/br/page/produto/410409-fixture";
  await withHtmlFixture(
    url,
    cofemaFixture({
      priceMarkup: '<div class="produto-preco-row"><s>R$ 35,00</s><span>R$ 32,33</span></div>',
      relatedMarkup: "<section><h2>Relacionados</h2><span>R$ 2,19</span></section>",
    }),
    async (page) => {
      const result = await inspectCofemaPrice(page, cofemaMapping);
      assert.equal(result.price, 32.33);
      assert.equal(isConfirmedPriceEvidence(result), true);
      assert.match(result.selector, /produto-preco-row/);
    },
  );
});

test("Cofema rejects two current prices in its main summary", async () => {
  const url = "https://novo.cofema.com.br/page/produto/410409-fixture";
  await withHtmlFixture(
    url,
    cofemaFixture({
      priceMarkup:
        '<div class="produto-preco-row"><span>R$ 32,33</span><span>R$ 31,90</span></div>',
    }),
    async (page) => {
      const result = await inspectCofemaPrice(page, cofemaMapping);
      assert.equal(result.price, null);
      assert.match(result.error, /preco principal ambiguo/i);
      assert.equal(isConfirmedPriceEvidence(result), false);
    },
  );
});

test("Cofema rejects a displayed code that conflicts with the mapped URL and SKU", async () => {
  const url = "https://novo.cofema.com.br/page/produto/410409-fixture";
  await withHtmlFixture(
    url,
    cofemaFixture({
      code: "999999",
      title: cofemaMapping.produtos.nome,
      priceMarkup: '<div class="produto-preco-row">R$ 32,33</div>',
    }),
    async (page) => {
      const result = await inspectCofemaPrice(page, cofemaMapping);
      assert.equal(result.price, null);
      assert.equal(result.productConfirmed, false);
      assert.match(result.error, /URL ou SKU nao corresponde/i);
    },
  );
});

const marestMapping = {
  sku_concorrente: "3502",
  produtos: { nome: "ADESIVO PVC 175G AMANCO 90061" },
};

function marestFixture({
  sku = "3502",
  title = "ADESIVO PVC 175G AMANCO 90061",
  priceMarkup = '<p class="prod-price">R$ 16,38</p>',
  relatedMarkup = "",
} = {}) {
  return `<!doctype html><html><body><main>
    <div class="styles__ProductRowContainer-sc-fixture">
      <div class="detailsHeader">
        <p class="styles-module__cod-sku">Cod. ${sku}</p>
        <h1>${title}</h1>
      </div>
      <div class="styles__BuyInformation-sc-fixture">
        <h3>Em estoque</h3>
        <div class="styles__PriceContainer-sc-fixture">${priceMarkup}</div>
        <label>Quantidade</label><input name="qtd"><button>COMPRAR</button>
      </div>
    </div>
    ${relatedMarkup}
  </main></body></html>`;
}

test("Marest ignores related and struck prices outside the current main price", async () => {
  const url = "https://www.marest.com.br/product?sku=3502&nome=3502";
  await withHtmlFixture(
    url,
    marestFixture({
      priceMarkup: '<p class="prod-price"><s>R$ 19,90</s><span>R$ 16,38</span></p>',
      relatedMarkup:
        '<section><h2>Também pode gostar: AMANCO</h2><p class="prod-price">R$ 1,02</p></section>',
    }),
    async (page) => {
      const result = await inspectMarestPrice(page, marestMapping);
      assert.equal(result.price, 16.38);
      assert.equal(isConfirmedPriceEvidence(result), true);
      assert.match(result.selector, /PriceContainer/);
    },
  );
});

test("Marest rejects conflicting main prices and a page from another SKU", async () => {
  const correctUrl = "https://www.marest.com.br/product?sku=3502&nome=3502";
  await withHtmlFixture(
    correctUrl,
    marestFixture({
      priceMarkup: '<p class="prod-price">R$ 16,38</p><p class="prod-price">R$ 15,90</p>',
    }),
    async (page) => {
      const result = await inspectMarestPrice(page, marestMapping);
      assert.equal(result.price, null);
      assert.match(result.error, /preco principal ambiguo/i);
    },
  );

  const wrongUrl = "https://www.marest.com.br/product?sku=9999&nome=9999";
  await withHtmlFixture(wrongUrl, marestFixture({ sku: "9999" }), async (page) => {
    const result = await inspectMarestPrice(page, marestMapping);
    assert.equal(result.price, null);
    assert.match(result.error, /SKU solicitado/i);
  });
});

const megalesteMapping = {
  sku_concorrente: "335029",
  produtos: { nome: "AUMENTO P TORNEIRA 3/4 MED 10861 GARDEN" },
};

function megalesteCard({
  sku = "335029",
  title = "AUMENTO P/TORN. 3/4 MED 10861 GARDEN",
  priceMarkup = '<span class="price">R$ 5,290</span>',
  hidden = false,
} = {}) {
  return `<div class="product-line product-${sku}" data-id="${sku}"${hidden ? ' style="display:none"' : ""}>
    <a href="/c/produto/${sku}" class="btn-modal show-lupa"></a>
    <div class="product-content"><h4>${title}</h4><small>Cód. ${sku} Emb.: PC0100/001</small></div>
    ${priceMarkup}
    <input type="text" name="qtd"><button class="btn-cart-add">Adic.</button>
  </div>`;
}

test("Megaleste uses only the current price in the exact SKU card", async () => {
  const url = "https://www.megaleste.com.br/c/busca?linha=&q=335029";
  const html = `<!doctype html><html><body>
    <section aria-label="Promoções"><span class="price">R$ 2,190</span></section>
    <div class="search-result">
      ${megalesteCard({
        priceMarkup:
          '<small class="price"><strike>R$ 6,530</strike></small><span class="price text-danger font-weight-bold">R$ 5,290</span>',
      })}
      ${megalesteCard({ sku: "999999", title: "OUTRO AMANCO", priceMarkup: '<span class="price">R$ 2,190</span>' })}
    </div>
  </body></html>`;
  await withHtmlFixture(url, html, async (page) => {
    const result = await inspectMegalestePrice(page, megalesteMapping);
    assert.equal(result.price, 5.29);
    assert.equal(isConfirmedPriceEvidence(result), true);
    assert.equal(result.observedSku, "335029");
  });
});

test("Megaleste reads the current promotional price inside the direct price container", async () => {
  const url = "https://www.megaleste.com.br/c/busca?q=355666";
  const mapping = {
    sku_concorrente: "355666",
    produtos: { nome: "TEK BOND ARALDITE HOBBY 16G" },
  };
  await withHtmlFixture(
    url,
    `<!doctype html><html><body>${megalesteCard({
      sku: "355666",
      title: "ARALDITE TEKBOND HOBBY 16GR 10 MIN.",
      priceMarkup:
        '<div class="price"><strike>R$ 17,820</strike><span class="text-danger font-weight-bold">R$ 16,590</span></div>',
    })}</body></html>`,
    async (page) => {
      const result = await inspectMegalestePrice(page, mapping);
      assert.equal(result.rawText, "R$ 16,590");
      assert.equal(result.price, 16.59);
      assert.equal(isConfirmedPriceEvidence(result), true);
    },
  );
});

test("Megaleste ignores hidden duplicates but rejects two visible current prices", async () => {
  const url = "https://www.megaleste.com.br/c/busca?q=335029";
  await withHtmlFixture(
    url,
    `<!doctype html><html><body>${megalesteCard()}${megalesteCard({ hidden: true, priceMarkup: '<span class="price">R$ 2,190</span>' })}</body></html>`,
    async (page) => {
      const result = await inspectMegalestePrice(page, megalesteMapping);
      assert.equal(result.price, 5.29);
    },
  );

  await withHtmlFixture(
    url,
    `<!doctype html><html><body>${megalesteCard({ priceMarkup: '<span class="price">R$ 5,290</span><span class="price">R$ 4,990</span>' })}</body></html>`,
    async (page) => {
      const result = await inspectMegalestePrice(page, megalesteMapping);
      assert.equal(result.price, null);
      assert.match(result.error, /preco principal ambiguo/i);
    },
  );
});

test("Megaleste rejects a missing price and a different displayed SKU", async () => {
  const url = "https://www.megaleste.com.br/c/busca?q=335029";
  await withHtmlFixture(
    url,
    `<!doctype html><html><body>${megalesteCard({ priceMarkup: "" })}</body></html>`,
    async (page) => {
      const result = await inspectMegalestePrice(page, megalesteMapping, { waitTimeoutMs: 50 });
      assert.equal(result.price, null);
      assert.match(result.error, /preco principal nao encontrado/i);
    },
  );
  await withHtmlFixture(
    url,
    `<!doctype html><html><body>${megalesteCard({ sku: "999999" })}</body></html>`,
    async (page) => {
      const result = await inspectMegalestePrice(page, megalesteMapping, { waitTimeoutMs: 50 });
      assert.equal(result.price, null);
      assert.match(result.error, /cartao exato do produto nao encontrado/i);
    },
  );
});

test("exact URL and SKU remain authoritative when supplier titles differ from the mapping", async () => {
  await withHtmlFixture(
    "https://novo.cofema.com.br/page/produto/410409-fixture",
    cofemaFixture({
      title: "BIANCO SACHE",
      priceMarkup: '<div class="produto-preco-row">R$ 32,33</div>',
    }),
    async (page) => {
      const result = await inspectCofemaPrice(page, cofemaMapping);
      assert.equal(result.price, 32.33);
      assert.equal(result.productConfirmed, true);
      assert.equal(result.title, "BIANCO SACHE");
    },
  );

  await withHtmlFixture(
    "https://www.marest.com.br/product?sku=3502&nome=3502",
    marestFixture({ title: "ADESIVO PVC AMANCO" }),
    async (page) => {
      const result = await inspectMarestPrice(page, marestMapping);
      assert.equal(result.price, 16.38);
      assert.equal(result.productConfirmed, true);
      assert.equal(result.title, "ADESIVO PVC AMANCO");
    },
  );

  await withHtmlFixture(
    "https://www.megaleste.com.br/c/busca?q=335029",
    `<!doctype html><html><body>${megalesteCard({ title: "AUMENTO PARA TORNEIRA GARDEN" })}</body></html>`,
    async (page) => {
      const result = await inspectMegalestePrice(page, megalesteMapping);
      assert.equal(result.price, 5.29);
      assert.equal(result.productConfirmed, true);
      assert.equal(result.title, "AUMENTO PARA TORNEIRA GARDEN");
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

  assert.equal(parseBRL(productText, { requireCurrency: true }), 51.7);
});

test("generic parsing rejects multiple prices instead of choosing by position", () => {
  assert.equal(
    parseBRL("R$ 51,700 informacao secundaria R$ 15,117", { requireCurrency: true }),
    null,
  );
});

test("generic parsing does not use labels to guess between conflicting prices", () => {
  assert.equal(parseBRL("À prazo R$ 42,130 | À vista R$ 40,024"), null);
  assert.equal(parseBRL("Preço a prazo: R$ 52,990 | PIX R$ 47,691"), null);
  assert.equal(parseBRL("Valor a prazo R$ 18,500 | 10% OFF R$ 16,650"), null);
  assert.equal(parseBRL("Prazo R$ 103,457 | boleto R$ 99,000"), null);
});

test("generic parsing accepts one price but does not guess between multiple prices", () => {
  assert.equal(parseBRL("Produto 12345 R$ 42,130"), 42.13);
  assert.equal(parseBRL("R$ 42,130 | R$ 40,024"), null);
});

test("generic parsing rejects unavailable products even when a price remains in the DOM", () => {
  assert.equal(parseBRL("Produto indisponível | À prazo R$ 42,130"), null);
  assert.equal(parseBRL("Fora de estoque R$ 42,130"), null);
});

test("rejects prices inside unavailable product blocks", () => {
  assert.equal(parseBRL("Consulte a disponibilidade R$ 162,09"), null);
  assert.equal(parseBRL("Produto sem saldo R$ 162,09"), null);
  assert.equal(parseBRL("Avise-me quando disponivel R$ 162,09"), null);
});
