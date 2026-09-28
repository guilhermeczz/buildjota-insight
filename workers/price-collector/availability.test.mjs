import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { inspectConstrujaPrice } from "./extract-price.mjs";

test("Construja stock message overrides a login prompt in the same confirmed product", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `
      <div><div class="stepHeader">
        <h2 class="Produto_nomeProduto__test">Engate 30 cm</h2>
        <span class="Produto_codigoProduto__test"><strong>158299</strong></span>
      </div><div class="stepPreco"><div class="stepPrecoContent">
        <p>FAÇA LOGIN OU CADASTRE-SE PARA VER OS PREÇOS</p>
        <span class="ProdutoCompactCarrinho_mensagemIndisponivel__test">Produto indisponível</span>
      </div></div></div>`,
      }),
    );
    await page.goto("https://www.construja.com.br/produto/158299/engate");
    const result = await inspectConstrujaPrice(
      page,
      { sku_concorrente: "158299" },
      { waitTimeoutMs: 1 },
    );
    assert.equal(result.error, "CONSTRUJA: PRODUTO INDISPONIVEL");
    assert.equal(result.price, null);
    assert.equal(result.productConfirmed, true);
  } finally {
    await browser.close();
  }
});

test("failed group authentication still reports confirmed sold-out products without accepting guest prices", async () => {
  // Isolate auth/diagnostics and environment from the operator's real credentials.
  const cwd = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "price-availability-"));
  const saved = Object.fromEntries(
    ["COFEMA_LOGIN", "COFEMA_PASSWORD", "WORKER_BLOCK_HEAVY_ASSETS"].map((k) => [
      k,
      process.env[k],
    ]),
  );
  let browser;
  try {
    process.chdir(directory);
    mkdirSync(join(directory, ".worker-auth"));
    delete process.env.COFEMA_LOGIN;
    delete process.env.COFEMA_PASSWORD;
    process.env.WORKER_BLOCK_HEAVY_ASSETS = "false";
    const { collectGroup } = await import("./browser.mjs");
    browser = await chromium.launch();
    const routedBrowser = {
      version: () => browser.version(),
      newContext: async (options) => {
        const context = await browser.newContext(options);
        await context.route("**/*", (route) => {
          const sku = new URL(route.request().url()).pathname.split("/").at(-1);
          const mainSku = sku === "410411" ? "999999" : sku;
          return route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: `<header>Entre ou Cadastre-se</header>
          <main><div class="space-y-2"><h1>Produto</h1><p>Código: ${mainSku}</p>
          ${sku === "410410" ? '<div class="produto-preco"><div class="produto-preco-row">R$ 32,33</div></div>' : sku === "410412" ? "<p>Preço indisponível. Faça login para ver os preços.</p>" : sku === "410413" ? "<button>Indisponível</button>" : "<p>Produto indisponível</p>"}
          </div></main>`,
          });
        });
        return context;
      },
    };
    const results = await collectGroup(routedBrowser, {
      concorrente: { nome: "COFEMA", site_url: "https://www.cofema.com.br" },
      mapeamentos: ["410409", "410410", "410411", "410412", "410413"].map((sku) => ({
        id: sku,
        sku_concorrente: sku,
        url_produto: `https://www.cofema.com.br/page/produto/${sku}`,
        produtos: { nome: "Produto", preco_atual: 40 },
      })),
    });
    assert.equal(results.length, 5);
    assert.equal(results[0].mensagem_erro, "COFEMA: PRODUTO INDISPONIVEL");
    assert.equal(results[4].mensagem_erro, "COFEMA: PRODUTO INDISPONIVEL");
    for (const result of results.slice(1, 4))
      assert.match(result.mensagem_erro, /Credenciais nao configuradas/);
    for (const result of results) {
      assert.equal(result.preco_concorrente, null);
      assert.equal(result.preservar_ultimo_preco, true);
    }
  } finally {
    await browser?.close();
    process.chdir(cwd);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
