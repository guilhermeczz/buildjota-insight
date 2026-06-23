insert into public.concorrentes (nome, site_url, login_url, tipo_consulta, observacoes, ativo)
values
  ('FERA ATACADO', 'https://www.feraatacado.com', 'https://www.feraatacado.com', 'SKU', '', true),
  ('COFEMA', 'https://www.cofema.com.br', 'https://www.cofema.com.br', 'SKU', '', true),
  ('CONSTRUJA', 'https://www.construja.com.br', 'https://www.construja.com.br', 'SKU', '', true),
  ('MAREST', 'https://www.marest.com.br', 'https://www.marest.com.br', 'SKU', '', true),
  ('MEGALESTE', 'https://www.megaleste.com.br', 'https://www.megaleste.com.br', 'SKU', '', true)
on conflict (nome) do update set
  site_url = excluded.site_url,
  login_url = excluded.login_url,
  tipo_consulta = excluded.tipo_consulta,
  ativo = excluded.ativo,
  updated_at = now();
