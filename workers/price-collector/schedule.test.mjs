import assert from "node:assert/strict";
import test from "node:test";

import { hasScheduleTimeArrived, isScheduleDue, timeToMinutes } from "./schedule.mjs";

test("converte horarios validos e rejeita valores invalidos", () => {
  assert.equal(timeToMinutes("06:30:00"), 390);
  assert.equal(timeToMinutes("23:59"), 1439);
  assert.equal(timeToMinutes("24:00"), null);
  assert.equal(timeToMinutes("invalido"), null);
});

test("considera a agenda pendente a partir do horario configurado", () => {
  assert.equal(hasScheduleTimeArrived("06:00", "06:00"), true);
  assert.equal(hasScheduleTimeArrived("06:00", "06:01"), true);
  assert.equal(hasScheduleTimeArrived("06:00", "18:00"), true);
});

test("nao executa antes do horario", () => {
  assert.equal(hasScheduleTimeArrived("06:00", "05:59"), false);
});

test("executa somente no dia selecionado", () => {
  const current = { date: "2026-08-15", time: "10:30", weekday: 6 };
  assert.equal(
    isScheduleDue({ scheduledTime: "10:00", weekdays: [1, 2, 3, 4, 5], lastRun: null }, current),
    false,
  );
  assert.equal(
    isScheduleDue({ scheduledTime: "10:00", weekdays: [0, 6], lastRun: null }, current),
    true,
  );
});

test("mantem a coleta pendente se o worker estava ocupado", () => {
  const current = { date: "2026-08-15", time: "18:00", weekday: 6 };
  assert.equal(
    isScheduleDue({ scheduledTime: "06:00", weekdays: [6], lastRun: null }, current),
    true,
  );
});

test("nao repete uma agenda ja iniciada no mesmo dia e horario", () => {
  const current = { date: "2026-08-15", time: "18:00", weekday: 6 };
  assert.equal(
    isScheduleDue(
      {
        scheduledTime: "06:00",
        weekdays: [6],
        lastRun: { date: "2026-08-15", time: "06:00", weekday: 6 },
      },
      current,
    ),
    false,
  );
});

test("permite novo horario salvo depois de uma execucao anterior no mesmo dia", () => {
  const current = { date: "2026-08-15", time: "15:00", weekday: 6 };
  assert.equal(
    isScheduleDue(
      {
        scheduledTime: "14:00",
        weekdays: [6],
        lastRun: { date: "2026-08-15", time: "10:00", weekday: 6 },
      },
      current,
    ),
    true,
  );
});

test("nao carrega uma agenda do dia anterior pela meia-noite", () => {
  assert.equal(hasScheduleTimeArrived("23:59", "00:00"), false);
});
