-- Atualiza bancos existentes para o novo portal da COFEMA.
-- Idempotente: executar novamente mantem os mesmos valores.
update concorrentes
set site_url = 'https://novo.cofema.com.br',
    login_url = 'https://novo.cofema.com.br/',
    updated_at = now()
where upper(trim(nome)) = 'COFEMA'
  and (
    site_url is distinct from 'https://novo.cofema.com.br'
    or login_url is distinct from 'https://novo.cofema.com.br/'
  );
