import assert from "node:assert/strict";
import test from "node:test";

import {
  earliestScheduleOccurrence,
  hasScheduleTimeArrived,
  isConstrujotaMercosScheduleDue,
  isScheduleDue,
  nextScheduleOccurrence,
  scheduleLocalParts,
  shouldWaitForConstrujotaMercosBeforeCompetitors,
  timeToMinutes,
} from "./schedule.mjs";

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

test("calcula um unico despertar no horario exato da proxima agenda", () => {
  const now = new Date("2026-08-28T12:34:30.000Z"); // 09:34:30 em Sao Paulo
  assert.equal(
    nextScheduleOccurrence(
      { scheduledTime: "09:35", weekdays: [5] },
      now,
      "America/Sao_Paulo",
    )?.toISOString(),
    "2026-08-28T12:35:00.000Z",
  );
  assert.deepEqual(scheduleLocalParts(now, "America/Sao_Paulo"), {
    date: "2026-08-28",
    time: "09:34",
    weekday: 5,
  });
});

test("agenda ja vencida hoje aponta para o proximo dia selecionado", () => {
  assert.equal(
    nextScheduleOccurrence(
      { scheduledTime: "09:35", weekdays: [1, 2, 3, 4, 5] },
      new Date("2026-08-28T13:00:00.000Z"),
      "America/Sao_Paulo",
    )?.toISOString(),
    "2026-08-31T12:35:00.000Z",
  );
});

test("escolhe o horario mais proximo sem consultar o banco repetidamente", () => {
  const next = earliestScheduleOccurrence(
    [
      {
        scheduledTime: "18:00",
        weekdays: [1, 2, 3, 4, 5],
        timeZone: "America/Sao_Paulo",
      },
      {
        scheduledTime: "09:35",
        weekdays: [5],
        timeZone: "America/Sao_Paulo",
      },
    ],
    new Date("2026-08-28T12:00:00.000Z"),
  );
  assert.equal(next?.toISOString(), "2026-08-28T12:35:00.000Z");
});

test("CONSTRUJOTA_MERCOS executa de segunda a sexta depois do horario", () => {
  for (const weekday of [1, 2, 3, 4, 5]) {
    assert.equal(
      isConstrujotaMercosScheduleDue(
        {
          scheduledTime: "06:00",
          weekdays: [1, 2, 3, 4, 5],
          lastRun: null,
        },
        { date: `2026-08-${23 + weekday}`, time: "18:00", weekday },
      ),
      true,
    );
  }
});

test("CONSTRUJOTA_MERCOS nunca executa sabado ou domingo", () => {
  for (const weekday of [0, 6]) {
    assert.equal(
      isConstrujotaMercosScheduleDue(
        {
          scheduledTime: "06:00",
          // Even a malformed persisted configuration cannot enable weekends.
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          lastRun: null,
        },
        { date: "2026-08-29", time: "18:00", weekday },
      ),
      false,
    );
  }
});

test("CONSTRUJOTA_MERCOS fica pendente no mesmo dia enquanto o worker esta ocupado", () => {
  assert.equal(
    isConstrujotaMercosScheduleDue(
      {
        scheduledTime: "06:00",
        weekdays: [1, 2, 3, 4, 5],
        lastRun: null,
      },
      { date: "2026-08-24", time: "18:00", weekday: 1 },
    ),
    true,
  );
});

test("CONSTRUJOTA_MERCOS executa no maximo uma vez por dia", () => {
  assert.equal(
    isConstrujotaMercosScheduleDue(
      {
        scheduledTime: "14:00",
        weekdays: [1, 2, 3, 4, 5],
        lastRun: { date: "2026-08-24", time: "06:00", weekday: 1 },
      },
      { date: "2026-08-24", time: "18:00", weekday: 1 },
    ),
    false,
  );
});

test("CONSTRUJOTA_MERCOS nao recupera sexta-feira no fim de semana", () => {
  const schedule = {
    scheduledTime: "23:00",
    weekdays: [1, 2, 3, 4, 5],
    lastRun: { date: "2026-08-27", time: "23:00", weekday: 4 },
  };

  assert.equal(
    isConstrujotaMercosScheduleDue(schedule, {
      date: "2026-08-29",
      time: "12:00",
      weekday: 6,
    }),
    false,
  );
  assert.equal(
    isConstrujotaMercosScheduleDue(schedule, {
      date: "2026-08-30",
      time: "12:00",
      weekday: 0,
    }),
    false,
  );
});

test("CONSTRUJOTA_MERCOS volta a executar na segunda depois da sexta-feira", () => {
  assert.equal(
    isConstrujotaMercosScheduleDue(
      {
        scheduledTime: "06:00",
        weekdays: [1, 2, 3, 4, 5],
        lastRun: { date: "2026-08-28", time: "06:00", weekday: 5 },
      },
      { date: "2026-08-31", time: "06:00", weekday: 1 },
    ),
    true,
  );
});

test("concorrentes aguardam a tentativa diaria da CONSTRUJOTA_MERCOS", () => {
  const current = { date: "2026-08-24", time: "08:00", weekday: 1 };
  assert.equal(
    shouldWaitForConstrujotaMercosBeforeCompetitors(
      { scheduledTime: "08:00", weekdays: [1, 2, 3, 4, 5], lastRun: null },
      current,
    ),
    true,
  );
  assert.equal(
    shouldWaitForConstrujotaMercosBeforeCompetitors(
      {
        scheduledTime: "08:00",
        weekdays: [1, 2, 3, 4, 5],
        lastRun: { date: "2026-08-24", time: "07:00", weekday: 1 },
      },
      current,
    ),
    false,
  );
});

test("agenda propria futura nao bloqueia concorrente que ja chegou ao horario", () => {
  const current = { date: "2026-08-28", time: "09:35", weekday: 5 };
  assert.equal(
    shouldWaitForConstrujotaMercosBeforeCompetitors(
      {
        scheduledTime: "18:00",
        weekdays: [1, 2, 3, 4, 5],
        lastRun: null,
      },
      current,
    ),
    false,
  );
});

test("agenda propria nao bloqueia concorrentes no fim de semana", () => {
  assert.equal(
    shouldWaitForConstrujotaMercosBeforeCompetitors(
      { scheduledTime: "06:00", weekdays: [1, 2, 3, 4, 5], lastRun: null },
      { date: "2026-08-29", time: "12:00", weekday: 6 },
    ),
    false,
  );
});
