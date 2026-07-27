import assert from "node:assert/strict";
import test from "node:test";

import { isInsideScheduleWindow, timeToMinutes } from "./schedule.mjs";

test("converte horarios validos e rejeita valores invalidos", () => {
  assert.equal(timeToMinutes("06:30:00"), 390);
  assert.equal(timeToMinutes("23:59"), 1439);
  assert.equal(timeToMinutes("24:00"), null);
  assert.equal(timeToMinutes("invalido"), null);
});

test("aceita o minuto agendado e a tolerancia configurada", () => {
  assert.equal(isInsideScheduleWindow("06:00", "06:00", 1), true);
  assert.equal(isInsideScheduleWindow("06:00", "06:01", 1), true);
});

test("nao executa antes nem depois da janela", () => {
  assert.equal(isInsideScheduleWindow("06:00", "05:59", 1), false);
  assert.equal(isInsideScheduleWindow("06:00", "06:02", 1), false);
  assert.equal(isInsideScheduleWindow("06:00", "18:00", 1), false);
});

test("nao carrega uma agenda do dia anterior pela meia-noite", () => {
  assert.equal(isInsideScheduleWindow("23:59", "00:00", 1), false);
});
