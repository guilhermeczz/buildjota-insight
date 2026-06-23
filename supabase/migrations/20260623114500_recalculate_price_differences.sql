update public.historico_precos
set
  diferenca_valor = round((preco_construjota - preco_concorrente)::numeric, 3),
  diferenca_percentual = case
    when preco_concorrente > 0
      then round((((preco_construjota - preco_concorrente) / preco_concorrente) * 100)::numeric, 4)
    else 0
  end
where status = 'sucesso';
