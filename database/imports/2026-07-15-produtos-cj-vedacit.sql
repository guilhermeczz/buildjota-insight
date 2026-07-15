begin;

insert into produtos (sku_interno, nome, unidade, preco_atual, observacoes, ativo)
values
  ('419', 'BIANCO 900G SACHE', '', 27.900, '', true),
  ('389', 'BIANCO 3,6 LTS', '', 82.900, '', true),
  ('482', 'BIANCO 18 LTS', '', 289.900, '', true),
  ('772', 'COMPOUND 1 KG', '', 64.900, '', true),
  ('2473', 'NEUTROL 45 900ML', '', 41.900, '', true),
  ('2389', 'NEUTROL 45 3,6 LTS', '', 119.900, '', true),
  ('2390', 'NEUTROL 45 18 LTS', '', 409.900, '', true),
  ('388', 'NEUTROL ACQUA 900ML SACHE', '', 31.690, '', true),
  ('746', 'NEUTROL ACQUA 3,6 LTS', '', 87.990, '', true),
  ('321', 'NEUTROL ACQUA 18 LTS', '', 315.900, '', true),
  ('412', 'VEDACIT 900G SACHE', '', 10.990, '', true),
  ('361', 'VEDACIT 3,6 LTS', '', 34.900, '', true),
  ('316', 'VEDACIT 18 LTS', '', 116.900, '', true),
  ('4306', 'VEDACIT NEUTRALIZADOR FERRUGEM (ARMATEC) 200ML', '', 10.690, '', true),
  ('2046', 'VEDACIT VEDATUDO 20 CM X 10 MTS', '', 36.900, '', true),
  ('390', 'VEDACIT VEDATUDO 30 CM X 10 MTS', '', 54.900, '', true),
  ('5073', 'VEDACIT VEDATUDO 90 CM X 10 MTS', '', 149.900, '', true),
  ('503', 'VEDALIT 900ML SACHE', '', 13.990, '', true),
  ('512', 'VEDALIT 3,6 LTS SACHE', '', 39.990, '', true),
  ('544', 'VEDALIT 18 LTS', '', 144.900, '', true),
  ('480', 'VEDAPREN BRANCO 3,6 KG', '', 89.900, '', true),
  ('4078', 'VEDAPREN BRANCO 18 KG', '', 309.900, '', true),
  ('737', 'VEDAPREN PAREDE 3,6 LTS', '', 69.900, '', true),
  ('688', 'VEDAPREN PAREDE 18 LTS', '', 269.900, '', true),
  ('4080', 'VEDAPREN PRETO 3,6 LTS', '', 89.900, '', true),
  ('4079', 'VEDAPREN PRETO 18LTS', '', 319.900, '', true)
on conflict (sku_interno) do update set
  nome = excluded.nome,
  unidade = excluded.unidade,
  preco_atual = excluded.preco_atual,
  observacoes = excluded.observacoes,
  ativo = true;

commit;
