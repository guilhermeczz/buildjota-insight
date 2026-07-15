-- Limpa leituras falsas da MAREST em que o robô capturou R$ 1,02 como preço.
-- Escopo propositalmente restrito: produtos BIANCO, concorrente MAREST,
-- leituras do dia 2026-07-15 e preço concorrente ate R$ 2,00.

begin;

create temporary table tmp_marest_preco_invalido_mapeamentos on commit drop as
select distinct h.mapeamento_id
from historico_precos h
join mapeamentos_sku m on m.id = h.mapeamento_id
join produtos p on p.id = m.produto_id
join concorrentes c on c.id = m.concorrente_id
where c.nome ilike 'MAREST'
  and p.nome ilike 'BIANCO%'
  and h.coletado_em::date = date '2026-07-15'
  and h.preco_concorrente is not null
  and h.preco_concorrente <= 2;

delete from historico_precos h
using mapeamentos_sku m, produtos p, concorrentes c
where h.mapeamento_id = m.id
  and p.id = m.produto_id
  and c.id = m.concorrente_id
  and c.nome ilike 'MAREST'
  and p.nome ilike 'BIANCO%'
  and h.coletado_em::date = date '2026-07-15'
  and h.preco_concorrente is not null
  and h.preco_concorrente <= 2;

update mapeamentos_sku m
set ultimo_preco = ultimo.preco_concorrente,
    status_coleta = coalesce(ultimo.status, 'pendente'),
    ultima_atualizacao = coalesce(ultimo.coletado_em, m.ultima_atualizacao)
from tmp_marest_preco_invalido_mapeamentos t
left join lateral (
  select h.preco_concorrente, h.status, h.coletado_em
  from historico_precos h
  where h.mapeamento_id = t.mapeamento_id
    and h.status = 'sucesso'
    and h.preco_concorrente is not null
  order by h.coletado_em desc
  limit 1
) ultimo on true
where m.id = t.mapeamento_id;

commit;
