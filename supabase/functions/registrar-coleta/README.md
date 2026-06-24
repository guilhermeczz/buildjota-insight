# Secrets do robô

As credenciais dos concorrentes não devem ser salvas no front-end nem em migrations.
Configure-as como secrets no ambiente que executa o robô, por exemplo:

- `COFEMA_LOGIN`
- `COFEMA_PASSWORD`
- `CONSTRUJA_LOGIN`
- `CONSTRUJA_PASSWORD`
- `MAREST_LOGIN`
- `MAREST_PASSWORD`
- `MEGALESTE_LOGIN`
- `MEGALESTE_PASSWORD`

No Supabase Edge Functions, use `supabase secrets set` ou o painel do projeto.
