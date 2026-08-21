-- O endpoint novo.cofema.com.br passou a redirecionar para o portal canônico em www.
-- Mantém bancos existentes no mesmo domínio usado para login, busca e páginas de produto.
update concorrentes
set site_url = 'https://www.cofema.com.br',
    login_url = 'https://www.cofema.com.br/',
    updated_at = now()
where upper(trim(nome)) = 'COFEMA'
  and (
    site_url is distinct from 'https://www.cofema.com.br'
    or login_url is distinct from 'https://www.cofema.com.br/'
  );
