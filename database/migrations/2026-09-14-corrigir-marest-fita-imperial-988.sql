-- Produto ConstruJota 988: o SKU MAREST 2278 pertence a outro produto (R$ 0,57).
-- A fita imperial 18mm x 20m e o SKU 22782. Coleta autenticada em 14/09/2026
-- confirmou R$ 8,39 como preco vigente, ignorando R$ 9,10 riscado.
-- Nao fixa um preco: a proxima coleta deve ler novamente o valor vigente.
begin;

create temporary table tmp_marest_fita_988 on commit drop as
select m.id
from mapeamentos_sku m
join produtos p on p.id = m.produto_id
join concorrentes c on c.id = m.concorrente_id
where p.sku_interno = '988'
  and upper(trim(c.nome)) = 'MAREST'
  and trim(m.sku_concorrente) = '2278';

-- Mantem os registros e o valor original na mensagem para auditoria, mas exclui
-- a leitura incorreta dos precos validos e dos calculos de diferenca.
update historico_precos h
set mensagem_erro = concat_ws(' | ', nullif(h.mensagem_erro, ''),
      'Invalidado em 14/09/2026: preco original R$ 0,57 do SKU MAREST 2278; a fita ConstruJota 988 corresponde ao SKU 22782.'),
    preco_concorrente = null,
    diferenca_valor = null,
    diferenca_percentual = null,
    status = 'erro'
from tmp_marest_fita_988 t
where h.mapeamento_id = t.id
  and h.preco_concorrente = 0.57;

update mapeamentos_sku m
set sku_concorrente = '22782',
    url_produto = 'https://www.marest.com.br/product?sku=22782',
    ultimo_preco = null,
    ultima_atualizacao = null,
    status_coleta = 'pendente',
    observacoes = concat_ws(' | ', nullif(m.observacoes, ''),
      'Corrigido em 14/09/2026: SKU MAREST 2278 -> 22782, fita imperial 18mm x 20m 3M; preco anterior invalidado por pertencer a outro produto.'),
    updated_at = now()
from tmp_marest_fita_988 t
where m.id = t.id;

commit;
