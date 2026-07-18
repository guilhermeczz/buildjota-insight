-- ATENCAO: esta operacao apaga definitivamente o historico e as execucoes do robo.
-- Preserva mapeamentos, produtos, concorrentes, familias, usuarios, configuracoes
-- e a configuracao das agendas.

begin;

delete from historico_precos;
delete from execucoes_robo;

update mapeamentos_sku
set ultimo_preco = null,
    ultima_atualizacao = null,
    status_coleta = 'pendente';

update agenda_coletas
set ultima_execucao = null,
    ultimo_status = null,
    ultimo_erro = null;

commit;

-- Conferencia: os dois primeiros totais devem ser zero; os mapeamentos permanecem.
select
  (select count(*) from historico_precos) as historicos_restantes,
  (select count(*) from execucoes_robo) as execucoes_restantes,
  (select count(*) from mapeamentos_sku) as mapeamentos_preservados;
