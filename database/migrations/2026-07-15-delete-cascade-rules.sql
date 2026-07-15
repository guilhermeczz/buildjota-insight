-- Ajusta as regras de exclusao da base existente.
-- Rode este arquivo uma vez no DBeaver antes de usar os botoes de excluir.

alter table produtos
  drop constraint if exists produtos_familia_id_fkey;

alter table produtos
  add constraint produtos_familia_id_fkey
  foreign key (familia_id)
  references familias(id)
  on delete set null;

alter table mapeamentos_sku
  drop constraint if exists mapeamentos_sku_produto_id_fkey;

alter table mapeamentos_sku
  add constraint mapeamentos_sku_produto_id_fkey
  foreign key (produto_id)
  references produtos(id)
  on delete cascade;

alter table mapeamentos_sku
  drop constraint if exists mapeamentos_sku_concorrente_id_fkey;

alter table mapeamentos_sku
  add constraint mapeamentos_sku_concorrente_id_fkey
  foreign key (concorrente_id)
  references concorrentes(id)
  on delete cascade;

alter table historico_precos
  drop constraint if exists historico_precos_mapeamento_id_fkey;

alter table historico_precos
  add constraint historico_precos_mapeamento_id_fkey
  foreign key (mapeamento_id)
  references mapeamentos_sku(id)
  on delete cascade;

alter table agenda_coletas
  drop constraint if exists agenda_coletas_familia_id_fkey;

alter table agenda_coletas
  add constraint agenda_coletas_familia_id_fkey
  foreign key (familia_id)
  references familias(id)
  on delete cascade;
