alter table historico_precos alter column preco_concorrente drop not null;
alter table historico_precos alter column preco_concorrente drop default;
alter table historico_precos alter column diferenca_valor drop not null;
alter table historico_precos alter column diferenca_valor drop default;
alter table historico_precos alter column diferenca_percentual drop not null;
alter table historico_precos alter column diferenca_percentual drop default;
