# Prompt para adaptar o coletor da COFEMA

Copie todo o texto abaixo e envie ao Codex depois de colocar as quatro capturas de tela nesta pasta.

---

Você está trabalhando no projeto `buildjota-insight`. Implemente e valide a adaptação completa do coletor Playwright da COFEMA para o novo site `https://novo.cofema.com.br`, fazendo a COFEMA funcionar com o mesmo nível de confiabilidade dos demais concorrentes.

## Evidências visuais obrigatórias

Antes de editar código, abra e analise todas as imagens existentes em `docs/cofema-novo-site/`. Elas documentam:

1. Home deslogada com o botão `Entre ou Cadastre-se` no cabeçalho.
2. Menu aberto com a opção `Área do Cliente`.
3. Modal `Login do Cliente`, com os campos `Código, CPF ou CNPJ` e `Senha`, além do botão `Entrar`.
4. Modal eventual `NOVIDADE SITE`, que pode ser fechado pelo `X` ou pelo botão `Fechar` e não pode impedir o login ou a coleta.
5. Página autenticada de produto, contendo o código do produto, nome, preço e unidade/região no cabeçalho.

Não deduza seletores apenas pela aparência das capturas. Use as imagens para entender o fluxo e inspecione o DOM real com Playwright para obter seletores estáveis.

## Comportamento observado

- Domínio novo: `https://novo.cofema.com.br`.
- Exemplo de página de produto:
  `https://novo.cofema.com.br/br/page/produto/410409-otto-baumgart-bianco-900g-sache-122854-substituto-para-o-codigo-408287`
- Na página do exemplo, a identidade visível é:
  - código principal: `410409`;
  - nome: `OTTO BAUMGART BIANCO 900G SACHE 122854`;
  - referência do fornecedor: `122854`;
  - código de barras: `7897321128543`;
  - preço principal exibido: `R$ 32,33`;
  - informação de embalagem: `Abre 6 un.`.
- Quando deslogado, aparece `Entre ou Cadastre-se`.
- Ao abrir esse controle, deve-se escolher `Área do Cliente`.
- O login usa `COFEMA_LOGIN` no campo `Código, CPF ou CNPJ` e `COFEMA_PASSWORD` no campo `Senha`.
- Depois do login, o cabeçalho passa a mostrar o cliente autenticado (na captura, `CENTERMAK`) e a localização/unidade (na captura, `São Paulo`).

## Arquivos e código existentes a preservar

Comece inspecionando, no mínimo:

- `workers/price-collector/browser.mjs`
- `workers/price-collector/config.mjs`
- `workers/price-collector/env.mjs`
- `workers/price-collector/extract-price.mjs`
- `workers/price-collector/index.mjs`
- `workers/price-collector/database.mjs`
- `workers/price-collector/README.md`
- `.env.worker.example`
- `database/schema.sql`
- migrações existentes em `database/migrations/`

Já existem funções específicas da COFEMA, como `cofemaUrl`, `loginCofema`, `openCofemaLoginModal`, `clickCofemaAreaCliente`, `isCofemaLoggedIn` e `configureCofema`. Avalie o que ainda corresponde ao site antigo. Refatore ou substitua apenas o necessário. Não quebre os fluxos de CONSTRUJA, MAREST e MEGALESTE.

## Requisitos de implementação

### 1. Configuração e URLs

- Usar `COFEMA_BASE_URL`, com padrão `https://novo.cofema.com.br`.
- Usar `COFEMA_LOGIN_URL`, com padrão `/`.
- Manter `COFEMA_LOGIN` e `COFEMA_PASSWORD` obrigatórios.
- Documentar essas variáveis em `.env.worker.example` e `workers/price-collector/README.md`, sem copiar ou exibir credenciais reais.
- Atualizar o cadastro padrão da COFEMA e criar uma migração idempotente para trocar `site_url` e `login_url` para o novo domínio. Não alterar somente `database/schema.sql`, pois bancos já existentes também precisam ser atualizados.
- Preservar URLs novas no formato `/br/page/produto/...`.
- Não transformar URLs antigas simplesmente trocando o hostname: o caminho do novo site também mudou. Para uma URL legada, localizar o produto pela busca usando `sku_concorrente`, código, referência do fornecedor ou nome e então abrir/confirmar a página correta.

### 2. Login obrigatório e determinístico

Implementar este fluxo:

1. Abrir a home do novo domínio.
2. Fechar overlays conhecidos, incluindo `NOVIDADE SITE`, usando controles visíveis dentro do modal (`Fechar`, `X`, `aria-label`, botão de fechamento).
3. Verificar se a sessão já está realmente autenticada.
4. Se estiver deslogado, clicar em `Entre ou Cadastre-se`.
5. No menu aberto, clicar em `Área do Cliente`.
6. Aguardar o modal `Login do Cliente` ficar visível.
7. Preencher `Código, CPF ou CNPJ` com `COFEMA_LOGIN`.
8. Preencher `Senha` com `COFEMA_PASSWORD`.
9. Clicar em `Entrar` e aguardar o resultado real da autenticação.
10. Confirmar a sessão por sinais positivos do cabeçalho autenticado e pela ausência do formulário de login. Não considerar qualquer entrada genérica de `localStorage` como prova suficiente de autenticação.

Se houver storage state salvo, visite o site e valide positivamente a sessão antes de coletar. Um arquivo `.worker-auth/cofema.json` existente não prova que a sessão continua válida. Se estiver expirada, limpe cookies/storage/arquivo de sessão, autentique novamente uma vez e salve o novo storage state.

Não permitir leitura pública como fallback. Se o formulário não abrir, os campos não forem encontrados, a credencial for recusada ou o login não puder ser confirmado, a coleta da COFEMA deve retornar um erro específico e acionável. Nunca registrar sucesso usando preço público quando o login falhou.

### 3. Unidade/localização

- Depois do login, identificar o controle de unidade/localização no cabeçalho.
- Respeitar `COFEMA_UNIDADE` se configurada.
- O novo site mostra rótulos como `São Paulo`; não assumir que o fluxo/modal antigo de `SUMARE` ainda existe.
- Se for necessária uma seleção, abrir o controle, escolher a opção configurada e confirmar visualmente a opção ativa.
- Se a localização já estiver correta, não abrir nem alterar o seletor.
- Não inventar uma seleção quando o DOM real não exigir isso. Documentar o comportamento encontrado.

### 4. Abertura e identificação do produto

- Preferir uma `url_produto` válida do novo domínio.
- Para URL ausente, antiga ou inválida, usar a busca do novo site com identificadores confiáveis do mapeamento.
- Suportar código principal e referência do fornecedor como identificadores diferentes. No exemplo, `410409` e `122854` pertencem ao mesmo produto.
- Antes de extrair o preço, validar que a página corresponde ao mapeamento. Usar código visível, referência, URL e termos relevantes do nome. Nunca associar o preço de um produto parecido ao SKU errado.
- Se houver mais de um resultado de busca, escolher somente um resultado cuja identidade possa ser confirmada; caso contrário, retornar erro de produto ambíguo/não confirmado.

### 5. Extração do preço

- Criar uma extração específica e limitada à área principal do produto da COFEMA, se os extratores genéricos não forem seguros.
- No exemplo, o resultado correto é numericamente `32.33`, lido do texto `R$ 32,33` próximo ao nome/código do produto.
- Não capturar preço de banner, carrinho, modal, recomendação, parcela, limite de crédito ou outro produto.
- A informação `Abre 6 un.` é embalagem/quantidade e não deve multiplicar nem dividir o preço sem uma regra de negócio já existente e comprovada.
- Confirmar que o seletor encontrado está visível e pertence ao produto validado.
- Manter o comportamento atual de gravação: `preco_concorrente` numérico e `status: "sucesso"` somente após autenticação, identidade e preço serem confirmados.

### 6. Observabilidade e tratamento de erros

Gerar mensagens específicas, sem incluir login, senha, cookies ou tokens. Exemplos:

- `COFEMA: modal de comunicado nao pôde ser fechado`
- `COFEMA: menu Area do Cliente nao abriu`
- `COFEMA: formulario de login nao encontrado`
- `COFEMA: credenciais recusadas`
- `COFEMA: login nao confirmado`
- `COFEMA: unidade configurada nao encontrada`
- `COFEMA: produto nao corresponde ao mapeamento`
- `COFEMA: preco principal nao encontrado`

Capture screenshot e HTML de diagnóstico apenas em falha e somente em uma pasta ignorada pelo Git, removendo/evitando dados sensíveis do formulário. Não comite sessão autenticada nem `.env`.

## Validação obrigatória

Faça a validação real, não apenas lint:

1. Execute lint e checagem de sintaxe dos arquivos alterados.
2. Rode uma coleta visível e isolada de um mapeamento COFEMA com `--headed --dry-run --mapeamento-id=<id>` (use a sintaxe realmente aceita pelo worker).
3. Confirme no navegador o fechamento do comunicado, login, cliente autenticado, localização, produto correto e preço correto.
4. Rode novamente reutilizando a sessão e confirme que ela é validada.
5. Teste sessão expirada removendo ou invalidando apenas o storage state da COFEMA e confirme o relogin automático.
6. Teste URL nova direta.
7. Teste URL antiga ou ausente usando busca/fallback.
8. Confirme que credenciais inválidas geram erro e nunca sucesso público.
9. Execute os testes/lint relevantes dos demais concorrentes para verificar que não houve regressão.

Se a conexão com o banco local impedir o teste, não declare a COFEMA funcionando. Informe exatamente o bloqueio e, se possível, crie um modo/teste isolado que exercite o navegador com um fixture de mapeamento sem gravar no banco. Não altere credenciais de banco silenciosamente.

## Critérios de aceite

A tarefa só está concluída quando:

- o novo domínio é usado em login, busca e produto;
- o comunicado eventual não bloqueia o fluxo;
- a autenticação é confirmada positivamente;
- sessão expirada é recuperada automaticamente;
- o produto é validado por identidade;
- `R$ 32,33` resulta em `32.33` no produto de exemplo;
- não existe fallback público após falha de login;
- URLs antigas não são tratadas apenas com troca de hostname;
- os demais concorrentes continuam funcionando;
- lint/checagens passam;
- a coleta real isolada da COFEMA foi demonstrada ou o bloqueio externo foi informado com precisão.

Ao final, entregue um resumo dos arquivos alterados, decisões de seletores, evidências dos testes executados e qualquer configuração/migração que ainda precise ser aplicada.

---

