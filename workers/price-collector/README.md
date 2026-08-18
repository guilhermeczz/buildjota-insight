# Worker de coleta de precos

Worker externo em Node.js + Playwright para coletar precos dos concorrentes cadastrados.

Nesta versao de teste, o worker usa PostgreSQL direto pela variavel `DATABASE_URL`.

## Variaveis de ambiente

Crie um arquivo `.env.worker.local` localmente ou configure estas variaveis no servidor:

```env
DATABASE_URL=postgres://radar:senha@localhost:5432/radar_construjota

COFEMA_LOGIN=
COFEMA_PASSWORD=
COFEMA_BASE_URL=https://novo.cofema.com.br
COFEMA_LOGIN_URL=/
CONSTRUJA_LOGIN=
CONSTRUJA_PASSWORD=
MAREST_LOGIN=
MAREST_PASSWORD=
MEGALESTE_LOGIN=
MEGALESTE_PASSWORD=

# Opcional. Vazio mantem a unidade que a conta autenticada ja apresenta.
# Se preenchido, o worker so continua depois de confirmar a opcao no cabecalho.
COFEMA_UNIDADE=
MAREST_REGIAO=SP
MEGALESTE_REGIAO=SP

# Opcional. Por padrao o worker bloqueia imagens, fontes e midias para economizar rede.
WORKER_BLOCK_HEAVY_ASSETS=true

# Opcional. Quantos concorrentes podem ser lidos ao mesmo tempo em execucoes agendadas.
# Em VM de 8 GB, 2 costuma ser um bom equilibrio. Use 1 se quiser consumo minimo.
WORKER_CONCURRENCY=2

# Opcional. Orçamento de tempo por pagina para evitar leituras travadas.
WORKER_NAVIGATION_TIMEOUT_MS=18000
WORKER_CONSTRUJA_NAVIGATION_TIMEOUT_MS=45000
WORKER_CONSTRUJA_NAVIGATION_ATTEMPTS=3
WORKER_CONSTRUJA_PRICE_SIGNAL_TIMEOUT_MS=12000
# Mantem um intervalo minimo entre produtos e respeita o tempo de espera informado pela API 429.
WORKER_CONSTRUJA_PRODUCT_INTERVAL_MS=6500
WORKER_CONSTRUJA_RATE_LIMIT_MAX_WAIT_SECONDS=900
WORKER_CONSTRUJA_RATE_LIMIT_RETRIES=2
WORKER_QUICK_LOAD_TIMEOUT_MS=3500
WORKER_PRICE_SIGNAL_TIMEOUT_MS=4500
WORKER_PRODUCT_SETTLE_MS=350
WORKER_ACTION_TIMEOUT_MS=5000

```

## Como rodar

As coletas com gravacao sao iniciadas exclusivamente pelo agendador. Para validar o worker sem
gravar no banco:

```bash
npm run worker:prices:dry
```

O dry-run apenas consulta os mapeamentos: nao prepara/altera o schema, nao cria uma execucao e nao
persiste historico, status ou ultimo preco.

Para validar com o navegador visivel:

```bash
npm run worker:prices:headed -- --dry-run
```

Para isolar um unico mapeamento sem gravar no banco:

```bash
npm run worker:prices:headed -- --dry-run --mapeamento-id=<id>
```

### COFEMA

A COFEMA exige login confirmado antes de qualquer preco ser aceito. O worker valida a sessao
salva visitando a home e procurando os controles de cliente e unidade no cabecalho; a mera
existencia de `.worker-auth/cofema.json` nao e considerada autenticacao. Se a sessao venceu,
cookies e storage da COFEMA sao limpos e o login e repetido uma vez.

URLs de produto no novo dominio sao abertas diretamente. Se a URL estiver ausente, pertencer ao
site antigo, retornar uma pagina invalida ou nao confirmar a identidade, o worker pesquisa por
SKU/codigo, referencia do fornecedor e nome. URLs recebidas com `/br/page/produto/...` sao
preservadas; no site observado em agosto de 2026, a busca atualmente gera a forma canonica
`/page/produto/...`, por isso uma URL `/br/...` que retorne 404 segue automaticamente para a busca.

`COFEMA_UNIDADE` e opcional. Sem ela, a unidade ja ativa no cabecalho (por exemplo, `Sao Paulo`)
e mantida. Quando configurada, o menu de unidade so e aberto se o rotulo atual for diferente, e a
coleta para com erro se a opcao nao existir ou nao puder ser confirmada.

Se o PostgreSQL local nao estiver disponivel, o fluxo real do navegador pode ser exercitado sem
consultar nem gravar no banco. Os modos cobrem URL direta, URL localizada `/br`, URL legada e URL
ausente:

```bash
npm run worker:prices:headed -- --dry-run --cofema-fixture=direct --mapeamento-id=cofema-fixture-direct
npm run worker:prices:headed -- --dry-run --cofema-fixture=localized
npm run worker:prices:headed -- --dry-run --cofema-fixture=legacy
npm run worker:prices:headed -- --dry-run --cofema-fixture=missing
```

Em falhas, screenshot e HTML higienizado sao salvos em `.worker-diagnostics/`, que e ignorada pelo
Git. Credenciais, cookies e arquivos de sessao nao devem ser versionados.

## Servidor do agendador

Deixe este processo rodando no servidor/local:

```bash
npm run worker:server
```

O endpoint manual `/api/worker/run` fica bloqueado. A API usa apenas `/api/worker/health` para
mostrar o estado do worker no painel. O processo consulta as agendas diretamente no banco.

## Agenda automatica

O mesmo processo `npm run worker:server` tambem consulta a tabela `agenda_coletas` a cada minuto.
Quando uma familia estiver ativa, no dia correto e a partir do horario configurado, ele executa:

```bash
node workers/price-collector/index.mjs --familia-id=<id> --agenda-id=<id> --scheduled
```

Configure os horarios pela tela **Agenda de Coleta**. O limite "Paralelo" controla quantos
concorrentes podem ser lidos ao mesmo tempo, de 1 a 4. Em VPS de 8 GB, comece com 1.
Se o worker estiver ocupado no horario, a coleta permanece pendente e inicia assim que o robo
ficar livre. Se o processo for reiniciado mais tarde no mesmo dia, ele recupera as agendas daquele
dia que ainda nao foram executadas. Cada agenda roda no maximo uma vez por dia e horario salvo.

## Como o worker decide o preco

Cada concorrente usa um extrator dedicado e limitado ao produto confirmado:

- COFEMA: resumo principal que contem `main h1` e `.produto-preco .produto-preco-row`.
- CONSTRUJA: `.stepPreco .stepPrecoContent` da URL e do codigo esperados; a mensagem visivel de
  indisponibilidade no mesmo `.stepPreco` e tratada antes da ausencia de preco.
- MAREST: rota direta `/product?sku=SKU`, validada pelo codigo exibido, e seu bloco de compra.
- MEGALESTE: cartao `.product-line[data-id="SKU"]` e seu filho direto `.price`; valores riscados
  dentro desse bloco sao antigos e o unico valor visivel restante e o vigente.

O worker nao escolhe preco pelo primeiro/ultimo valor da pagina, por menor/maior valor nem por
proximidade do preco interno. A identidade e confirmada exclusivamente pelo mapeamento cadastrado,
pela URL ou consulta do produto e pelo SKU exato exibido pelo concorrente. O titulo e guardado
somente para diagnostico e nunca aprova nem reprova uma leitura, pois a descricao de um mesmo
produto varia entre Construjota e fornecedores. O bloco e o elemento de preco precisam estar
visiveis, e o valor principal segue a regra comprovada daquele site. Somente conflitos sem regra
especifica, ausencia, URL/SKU divergente ou formato invalido sao rejeitados.

Qualquer ausencia, conflito ou incerteza grava erro com `preco_concorrente = null`. A barreira de
persistencia repete essas verificacoes para os quatro concorrentes e nunca substitui
`ultimo_preco` quando a leitura falha. Screenshot e HTML higienizado sao gerados somente nas
falhas, sem valores de campos, credenciais, scripts ou atributos sensiveis.
