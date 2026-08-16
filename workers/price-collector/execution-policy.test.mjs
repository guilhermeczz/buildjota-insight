import test from "node:test";
import assert from "node:assert/strict";
import { assertExecutionAllowed } from "./execution-policy.mjs";

test("permite uma coleta vinculada a agenda e familia", () => {
  assert.doesNotThrow(() =>
    assertExecutionAllowed({
      scheduled: true,
      dispatchedByScheduler: true,
      agendaId: "agenda-1",
      familiaId: "familia-1",
      dryRun: false,
    }),
  );
});

test("bloqueia coleta manual com gravacao", () => {
  assert.throws(
    () =>
      assertExecutionAllowed({
        scheduled: false,
        dispatchedByScheduler: false,
        agendaId: "",
        familiaId: "",
        dryRun: false,
      }),
    /coletas com gravacao so podem ser iniciadas por uma agenda ativa/i,
  );
});

test("bloqueia flag agendada sem vinculo com uma agenda", () => {
  assert.throws(
    () =>
      assertExecutionAllowed({
        scheduled: true,
        dispatchedByScheduler: true,
        agendaId: "",
        familiaId: "familia-1",
        dryRun: false,
      }),
    /agenda ativa/i,
  );
});

test("bloqueia execucao direta mesmo com argumentos de agenda", () => {
  assert.throws(
    () =>
      assertExecutionAllowed({
        scheduled: true,
        dispatchedByScheduler: false,
        agendaId: "agenda-1",
        familiaId: "familia-1",
        dryRun: false,
      }),
    /agenda ativa/i,
  );
});

test("mantem diagnosticos dry-run disponiveis sem gravacao", () => {
  assert.doesNotThrow(() =>
    assertExecutionAllowed({
      scheduled: false,
      dispatchedByScheduler: false,
      agendaId: "",
      familiaId: "",
      dryRun: true,
    }),
  );
});
