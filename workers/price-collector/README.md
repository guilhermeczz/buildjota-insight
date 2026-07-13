# Worker de coleta de precos

Worker externo em Node.js + Playwright para coletar precos dos concorrentes cadastrados.

Nesta versao de teste, o worker usa PostgreSQL direto pela variavel `DATABASE_URL`.

## Variaveis de ambiente

Crie um arquivo `.env.worker.local` localmente ou configure estas variaveis no servidor:

```env
DATABASE_URL=postgres://radar:senha@localhost:5432/radar_construjota

COFEMA_LOGIN=
COFEMA_PASSWORD=
CONSTRUJA_LOGIN=
CONSTRUJA_PASSWORD=
MAREST_LOGIN=
MAREST_PASSWORD=
MEGALESTE_LOGIN=
MEGALESTE_PASSWORD=

# Opcional. Por padrao o worker bloqueia imagens, fontes e midias para economizar rede.
WORKER_BLOCK_HEAVY_ASSETS=true
```

## Como rodar

```bash
npm run worker:prices
```

Para validar sem gravar no banco:

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

## Agenda automatica

O mesmo processo `npm run worker:server` tambem consulta a tabela `agenda_coletas` a cada minuto.
Quando uma familia estiver ativa, no dia correto e com horario vencido, ele executa:

```bash
node workers/price-collector/index.mjs --familia-id=<id> --scheduled
```

Configure os horarios pela tela **Agenda de Coleta**. O limite "Paralelo" controla quantos
concorrentes podem ser lidos ao mesmo tempo, de 1 a 4. Em VPS de 8 GB, comece com 1.

## Como o worker decide o preco

1. Se o mapeamento tiver `seletor_preco`, ele tenta ler esse seletor primeiro.
2. Se nao tiver seletor, ele procura textos com padrao de moeda brasileira na pagina.
3. Ele salva sucesso/erro em `historico_precos`, atualiza `mapeamentos_sku` e registra a execucao em `execucoes_robo`.
