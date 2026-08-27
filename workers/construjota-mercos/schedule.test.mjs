import assert from "node:assert/strict";
import test from "node:test";

import {
  isConstrujotaMercosBusinessDay,
  parseSimulationDate,
  saoPauloDateParts,
} from "./schedule.mjs";

test("runs Monday through Friday in America/Sao_Paulo", () => {
  for (const day of [24, 25, 26, 27, 28]) {
    assert.equal(isConstrujotaMercosBusinessDay(new Date(`2026-08-${day}T12:00:00-03:00`)), true);
  }
});

test("does not run Saturday or Sunday in America/Sao_Paulo", () => {
  assert.equal(isConstrujotaMercosBusinessDay(new Date("2026-08-29T12:00:00-03:00")), false);
  assert.equal(isConstrujotaMercosBusinessDay(new Date("2026-08-30T12:00:00-03:00")), false);
});

test("uses Sao Paulo calendar date across UTC boundaries", () => {
  assert.deepEqual(saoPauloDateParts(new Date("2026-08-29T01:30:00Z")), {
    date: "2026-08-28",
    weekday: 5,
  });
});

test("validates simulated dry-run dates", () => {
  assert.equal(parseSimulationDate("2026-08-31").toISOString(), "2026-08-31T15:00:00.000Z");
  assert.throws(() => parseSimulationDate("31/08/2026"), /AAAA-MM-DD/);
});
