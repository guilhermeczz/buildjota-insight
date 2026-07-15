-- Remove o Fera Atacado do fluxo do robô sem apagar histórico.
-- O worker também foi travado para coletar apenas COFEMA, CONSTRUJA, MAREST e MEGALESTE.

update concorrentes
set ativo = false,
    observacoes = trim(coalesce(observacoes, '') || ' Desativado: login exige codigo de validacao.')
where upper(nome) in ('FERA', 'FERA ATACADO', 'FERAATACADO')
   or upper(nome) like '%FERA%ATACADO%';
