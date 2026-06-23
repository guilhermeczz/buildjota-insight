alter table public.produtos
  alter column preco_atual type numeric(12,3);

alter table public.mapeamentos_sku
  alter column ultimo_preco type numeric(12,3);

alter table public.historico_precos
  alter column preco_construjota type numeric(12,3),
  alter column preco_concorrente type numeric(12,3),
  alter column diferenca_valor type numeric(12,3);
