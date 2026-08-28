-- Notifica o worker somente quando uma agenda e alterada. O worker usa LISTEN
-- e mantem um timer em memoria ate o proximo horario; nao ha polling frequente.

create or replace function notify_radar_agenda_changed()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify(
    'radar_agenda_changed',
    json_build_object('table', tg_table_name, 'operation', tg_op)::text
  );
  return null;
end;
$$;

drop trigger if exists notify_radar_agenda_coletas_changed on agenda_coletas;
create trigger notify_radar_agenda_coletas_changed
  after insert or update or delete on agenda_coletas
  for each statement execute function notify_radar_agenda_changed();

drop trigger if exists notify_radar_agenda_construjota_changed on agenda_construjota_mercos;
create trigger notify_radar_agenda_construjota_changed
  after insert or update or delete on agenda_construjota_mercos
  for each statement execute function notify_radar_agenda_changed();
