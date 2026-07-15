-- Teste de importacao de mapeamentos para os 3 produtos BIANCO.
--
-- Antes de rodar:
-- 1. Substitua todos os TODO_* pelo codigo/URL real do produto no concorrente.
-- 2. Rode no DBeaver conectado ao banco radar_construjota.
--
-- Observacao:
-- O robo abre url_produto. Se a URL estiver errada ou vazia, a coleta vai retornar erro.

begin;

create temporary table tmp_mapeamentos_bianco (
  sku_cj text not null,
  concorrente text not null,
  sku_concorrente text not null,
  url_produto text not null,
  unidade_equivalente text not null default '',
  seletor_preco text,
  observacoes text not null default ''
) on commit drop;

insert into tmp_mapeamentos_bianco
  (sku_cj, concorrente, sku_concorrente, url_produto, unidade_equivalente, seletor_preco, observacoes)
values
  -- BIANCO 900G SACHE - SKU CJ 419
  ('419', 'COFEMA', 'TODO_COFEMA_419_CODIGO', 'TODO_COFEMA_419_URL', '900G', null, 'Teste importacao Bianco'),
  ('419', 'CONSTRUJA', 'TODO_CONSTRUJA_419_CODIGO', 'TODO_CONSTRUJA_419_URL', '900G', null, 'Teste importacao Bianco'),
  ('419', 'MAREST', 'TODO_MAREST_419_CODIGO', 'TODO_MAREST_419_URL', '900G', null, 'Teste importacao Bianco'),
  ('419', 'MEGALESTE', 'TODO_MEGALESTE_419_CODIGO', 'https://www.megaleste.com.br', '900G', null, 'Teste importacao Bianco'),

  -- BIANCO 3,6 LTS - SKU CJ 389
  ('389', 'COFEMA', 'TODO_COFEMA_389_CODIGO', 'TODO_COFEMA_389_URL', '3,6 LTS', null, 'Teste importacao Bianco'),
  ('389', 'CONSTRUJA', 'TODO_CONSTRUJA_389_CODIGO', 'TODO_CONSTRUJA_389_URL', '3,6 LTS', null, 'Teste importacao Bianco'),
  ('389', 'MAREST', 'TODO_MAREST_389_CODIGO', 'TODO_MAREST_389_URL', '3,6 LTS', null, 'Teste importacao Bianco'),
  ('389', 'MEGALESTE', 'TODO_MEGALESTE_389_CODIGO', 'https://www.megaleste.com.br', '3,6 LTS', null, 'Teste importacao Bianco'),

  -- BIANCO 18 LTS - SKU CJ 482
  ('482', 'COFEMA', 'TODO_COFEMA_482_CODIGO', 'TODO_COFEMA_482_URL', '18 LTS', null, 'Teste importacao Bianco'),
  ('482', 'CONSTRUJA', 'TODO_CONSTRUJA_482_CODIGO', 'TODO_CONSTRUJA_482_URL', '18 LTS', null, 'Teste importacao Bianco'),
  ('482', 'MAREST', 'TODO_MAREST_482_CODIGO', 'TODO_MAREST_482_URL', '18 LTS', null, 'Teste importacao Bianco'),
  ('482', 'MEGALESTE', 'TODO_MEGALESTE_482_CODIGO', 'https://www.megaleste.com.br', '18 LTS', null, 'Teste importacao Bianco');

do $$
begin
  if exists (
    select 1
    from tmp_mapeamentos_bianco
    where sku_concorrente like 'TODO_%'
       or url_produto like 'TODO_%'
  ) then
    raise exception 'Preencha todos os TODO_* de sku_concorrente e url_produto antes de rodar.';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from tmp_mapeamentos_bianco t
    left join produtos p on p.sku_interno = t.sku_cj
    where p.id is null
  ) then
    raise exception 'Existe SKU CJ no arquivo que nao foi encontrado em produtos.';
  end if;

  if exists (
    select 1
    from tmp_mapeamentos_bianco t
    left join concorrentes c on upper(c.nome) = upper(t.concorrente)
    where c.id is null
  ) then
    raise exception 'Existe concorrente no arquivo que nao foi encontrado em concorrentes.';
  end if;
end $$;

delete from mapeamentos_sku m
using produtos p, concorrentes c
where m.produto_id = p.id
  and m.concorrente_id = c.id
  and p.sku_interno in ('419', '389', '482')
  and upper(c.nome) in ('COFEMA', 'CONSTRUJA', 'MAREST', 'MEGALESTE');

insert into mapeamentos_sku (
  produto_id,
  concorrente_id,
  sku_concorrente,
  url_produto,
  unidade_equivalente,
  seletor_preco,
  observacoes,
  ativo,
  status_coleta
)
select
  p.id,
  c.id,
  t.sku_concorrente,
  t.url_produto,
  t.unidade_equivalente,
  t.seletor_preco,
  t.observacoes,
  true,
  'pendente'
from tmp_mapeamentos_bianco t
join produtos p on p.sku_interno = t.sku_cj
join concorrentes c on upper(c.nome) = upper(t.concorrente);

select
  p.sku_interno as sku_cj,
  p.nome as produto,
  c.nome as concorrente,
  m.sku_concorrente,
  m.url_produto,
  m.status_coleta
from mapeamentos_sku m
join produtos p on p.id = m.produto_id
join concorrentes c on c.id = m.concorrente_id
where p.sku_interno in ('419', '389', '482')
order by p.sku_interno, c.nome;

commit;
