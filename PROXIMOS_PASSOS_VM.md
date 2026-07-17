# Proximos passos da VM

## Estado atual

- Projeto rodando na VM Ubuntu em `/home/guilherme/Projeto-Gui/buildjota-insight`.
- IP local da VM: `192.168.15.18`.
- Frontend servido pelo Nginx em `/var/www/radar`.
- API Node rodando no PM2 como `radar-api`, porta interna `3001`.
- Worker trigger rodando no PM2 como `radar-worker`, porta interna `8787`.
- Login funcionando.
- Banco PostgreSQL local funcionando.
- Coleta manual testada com:

```bash
curl -s -X POST http://127.0.0.1:8787/run -H "content-type: application/json" -d '{}'
```

- Cron da coleta diaria configurado para 06:00:

```cron
0 6 * * * curl -s -X POST http://127.0.0.1:8787/run -H "content-type: application/json" -d '{}' >> /home/guilherme/Projeto-Gui/buildjota-insight/worker-cron.log 2>&1
```

- Dominio No-IP criado:

```text
radarjj.sytes.net -> 177.172.146.118
```

## Pendente com o Paulo / Vivo

Configurar redirecionamento de portas no roteador/modem da Vivo:

```text
80 TCP  -> 192.168.15.18:80
443 TCP -> 192.168.15.18:443
```

Depois testar fora da rede local, por exemplo no celular usando 4G/5G:

```text
http://radarjj.sytes.net
```

Se abrir a tela de login, o redirecionamento esta correto.

## Depois que o dominio funcionar

1. Atualizar `.env.local` na VM:

```env
VITE_API_URL=
WORKER_INTERNAL_URL=http://127.0.0.1:8787

DATABASE_URL=postgres://radar:radar_dev_password@localhost:5432/radar_construjota
APP_JWT_SECRET=troque-por-uma-chave-grande-na-vm
PORT=3001
CORS_ORIGIN=https://radarjj.sytes.net
```

2. Rebuildar e copiar o frontend:

```bash
cd /home/guilherme/Projeto-Gui/buildjota-insight
npm run build
sudo cp -r dist/* /var/www/radar/
pm2 restart radar-api
```

3. Conferir Nginx:

```bash
sudo nano /etc/nginx/sites-available/radar
```

O `server_name` deve conter:

```nginx
server_name radarjj.sytes.net 192.168.15.18;
```

Depois:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

4. Ativar HTTPS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d radarjj.sytes.net
```

5. Testar:

```text
https://radarjj.sytes.net
```

## Comandos uteis

Ver processos:

```bash
pm2 status
```

Ver logs do worker:

```bash
pm2 logs radar-worker --lines 50
```

Ver cron:

```bash
crontab -l
```

Ver log do cron da coleta:

```bash
tail -n 50 /home/guilherme/Projeto-Gui/buildjota-insight/worker-cron.log
```

Testar API:

```bash
curl http://127.0.0.1:3001/api/health
```

Testar worker:

```bash
curl http://127.0.0.1:8787/health
```
