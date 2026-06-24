# Worker de coleta de precos

Worker externo em Node.js + Playwright para coletar precos dos concorrentes cadastrados.

## Variaveis de ambiente

Crie um arquivo `.env.worker.local` localmente ou configure estas variaveis no servidor:

```env
SUPABASE_URL=https://esnybqbtytfuitqctghs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_FUNCTION_JWT=

COFEMA_LOGIN=
COFEMA_PASSWORD=
CONSTRUJA_LOGIN=
CONSTRUJA_PASSWORD=
MAREST_LOGIN=
MAREST_PASSWORD=
MEGALESTE_LOGIN=
MEGALESTE_PASSWORD=
```

`SUPABASE_FUNCTION_JWT` pode ser a anon key ou service role key. O worker usa esse token apenas para chamar a Edge Function `registrar-coleta`. Em desenvolvimento, o worker tambem le `.env.local` e reaproveita `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

## Como rodar

```bash
npm run worker:prices
```

Para validar sem gravar no Supabase:

```bash
npm run worker:prices:dry
```

Para rodar visivel no navegador:

```bash
npm run worker:prices:headed
```

## Acionamento manual pelo painel

Deixe este processo rodando no servidor/local:

```bash
npm run worker:server
```

O painel chama `VITE_WORKER_TRIGGER_URL`, por padrao `http://localhost:8787/run`.

## Como o worker decide o preco

1. Se o mapeamento tiver `seletor_preco`, ele tenta ler esse seletor primeiro.
2. Se nao tiver seletor, ele procura textos com padrao de moeda brasileira na pagina.
3. Ele salva sucesso/erro em `historico_precos`, atualiza `mapeamentos_sku` e registra a execucao em `execucoes_robo` via Edge Function.

Para a validacao da OTTO, cadastre URLs diretas nos mapeamentos. Se uma pagina exigir seletor especifico, preencha `Seletor de preco` no mapeamento.

## Regras por concorrente

- `CONSTRUJA`: usa a URL cadastrada no mapeamento e reaproveita a sessao salva em `.worker-auth/construja.json`.
- `COFEMA`: abre o botao `Entre`, faz login com as credenciais do ambiente, usa a URL cadastrada no mapeamento e reaproveita `.worker-auth/cofema.json`.
- `MAREST`: entra por `/login`, faz login com as credenciais do ambiente, usa a URL cadastrada no mapeamento e reaproveita `.worker-auth/marest.json`.
- `MEGALESTE`: abre o menu de usuario, faz login com `user/pass`, transforma o codigo do concorrente em `/c/produto/{codigo}` e prioriza o preco `A vista`. Se o site redirecionar para `/sp`, o worker trata como sessao invalida e refaz o login.

Se o site retornar mensagem de login/senha invalida, o worker apaga a sessao local daquele concorrente e registra erro de credencial em vez de tentar ler preco da pagina errada.
