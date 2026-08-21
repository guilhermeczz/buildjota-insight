-- Corrige somente mapeamentos cuja identidade foi confirmada no catalogo do concorrente.
-- O ultimo preco e o historico sao preservados; o status volta a pendente para nova coleta.
with correcoes (sku_interno, concorrente, sku_concorrente, url_produto) as (
  values
    ('995',  'COFEMA',    '53309',  'https://www.cofema.com.br/page/produto/53309-fita-isolante-3m-scotch-33-20m-x-19-hb004482475'),
    ('304',  'CONSTRUJA', '158278', 'https://www.construja.com.br/produto/158278/amanco-tubo-pvc-agua-32'),
    ('359',  'CONSTRUJA', '15895',  'https://www.construja.com.br/produto/15895/amanco-corrugado-pvc-25mm-lar-metro50'),
    ('360',  'CONSTRUJA', '15896',  'https://www.construja.com.br/produto/15896/amanco-corrugado-pvc-32mm-lar-metro25'),
    ('2554', 'CONSTRUJA', '158520', 'https://www.construja.com.br/produto/158520/amanco-joelho-rr-34x45'),
    ('2629', 'CONSTRUJA', '158348', 'https://www.construja.com.br/produto/158348/amanco-joelho-rr-12'),
    ('4979', 'CONSTRUJA', '13707',  'https://www.construja.com.br/produto/13707/aliana-fech-banh-cr-280041'),
    ('1020', 'MAREST',    '25362',  'https://marest.com.br/product?sku=25362'),
    ('1021', 'MAREST',    '25363',  'https://marest.com.br/product?sku=25363'),
    ('4978', 'MAREST',    '19885',  'https://marest.com.br/product?sku=19885'),
    ('237',  'MAREST',    '13541',  'https://marest.com.br/product?sku=13541')
)
update mapeamentos_sku m
set sku_concorrente = correcoes.sku_concorrente,
    url_produto = correcoes.url_produto,
    status_coleta = 'pendente',
    updated_at = now()
from produtos p,
     concorrentes c,
     correcoes
where p.id = m.produto_id
  and c.id = m.concorrente_id
  and p.sku_interno = correcoes.sku_interno
  and upper(trim(c.nome)) = correcoes.concorrente
  and (
    m.sku_concorrente is distinct from correcoes.sku_concorrente
    or m.url_produto is distinct from correcoes.url_produto
  );

-- Este cadastro nunca teve SKU nem URL e ja estava marcado como inexistente no concorrente.
-- Inativo evita buscas por nome que nao podem confirmar uma identidade de produto.
update mapeamentos_sku m
set ativo = false,
    status_coleta = 'pendente',
    observacoes = trim(coalesce(nullif(m.observacoes, ''), '') ||
      ' Desativado em 21/08/2026: produto correspondente nao existe no catalogo da COFEMA.'),
    updated_at = now()
from produtos p,
     concorrentes c
where p.id = m.produto_id
  and c.id = m.concorrente_id
  and p.sku_interno = '480'
  and upper(trim(c.nome)) = 'COFEMA'
  and trim(m.sku_concorrente) = ''
  and trim(m.url_produto) = ''
  and m.ativo = true;
