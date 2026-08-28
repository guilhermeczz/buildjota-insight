export function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? "").slice(0, 5));
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return hour * 60 + minute;
}

export function hasScheduleTimeArrived(scheduledTime, currentTime) {
  const scheduled = timeToMinutes(scheduledTime);
  const current = timeToMinutes(currentTime);
  if (scheduled === null || current === null) return false;

  return current >= scheduled;
}

export function scheduleLocalParts(date = new Date(), timeZone = "America/Sao_Paulo") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
    weekday: weekdayMap[value.weekday] ?? 0,
  };
}

function addCalendarDays(dateText, amount) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return date.toISOString().slice(0, 10);
}

function calendarWeekday(dateText) {
  return new Date(`${dateText}T12:00:00Z`).getUTCDay();
}

function zonedDateTimeToUtc(dateText, timeText, timeZone) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const [hour, minute] = String(timeText).slice(0, 5).split(":").map(Number);
  const desiredLocalTimestamp = Date.UTC(year, month - 1, day, hour, minute);
  let candidateTimestamp = desiredLocalTimestamp;

  // Intl does not expose a direct zoned-date constructor. Converging the
  // formatted wall-clock value keeps the timer correct if the IANA offset ever
  // changes, without hardcoding -03:00.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = scheduleLocalParts(new Date(candidateTimestamp), timeZone);
    const [localYear, localMonth, localDay] = local.date.split("-").map(Number);
    const [localHour, localMinute] = local.time.split(":").map(Number);
    const actualLocalTimestamp = Date.UTC(
      localYear,
      localMonth - 1,
      localDay,
      localHour,
      localMinute,
    );
    const correction = desiredLocalTimestamp - actualLocalTimestamp;
    candidateTimestamp += correction;
    if (correction === 0) break;
  }

  return new Date(candidateTimestamp);
}

export function nextScheduleOccurrence(
  { scheduledTime, weekdays },
  now = new Date(),
  timeZone = "America/Sao_Paulo",
) {
  const normalizedTime = String(scheduledTime ?? "").slice(0, 5);
  if (timeToMinutes(normalizedTime) === null) return null;
  const normalizedWeekdays = Array.isArray(weekdays)
    ? [...new Set(weekdays.map(Number).filter((day) => day >= 0 && day <= 6))]
    : [];
  if (normalizedWeekdays.length === 0) return null;

  const localNow = scheduleLocalParts(now, timeZone);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = addCalendarDays(localNow.date, offset);
    if (!normalizedWeekdays.includes(calendarWeekday(date))) continue;
    const candidate = zonedDateTimeToUtc(date, normalizedTime, timeZone);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return null;
}

export function earliestScheduleOccurrence(schedules, now = new Date()) {
  let earliest = null;
  for (const schedule of Array.isArray(schedules) ? schedules : []) {
    const candidate = nextScheduleOccurrence(
      schedule,
      now,
      schedule.timeZone ?? "America/Sao_Paulo",
    );
    if (candidate && (!earliest || candidate.getTime() < earliest.getTime())) {
      earliest = candidate;
    }
  }
  return earliest;
}

export function isScheduleDue({ scheduledTime, weekdays, lastRun }, current) {
  const normalizedWeekdays = Array.isArray(weekdays) ? weekdays.map(Number) : [];
  if (!normalizedWeekdays.includes(Number(current?.weekday))) return false;
  if (!hasScheduleTimeArrived(scheduledTime, current?.time)) return false;
  if (!lastRun || lastRun.date !== current?.date) return true;

  return lastRun.time < String(scheduledTime).slice(0, 5);
}

export const CONSTRUJOTA_MERCOS_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5]);

/**
 * The own-store price refresh has stricter semantics than competitor schedules:
 * it may only run on business days and at most once per local calendar day.
 * Keeping this separate preserves the existing competitor schedule behavior,
 * which allows a newly-saved later time to run again on the same day.
 */
export function isConstrujotaMercosScheduleDue({ scheduledTime, weekdays, lastRun }, current) {
  const currentWeekday = Number(current?.weekday);
  if (!CONSTRUJOTA_MERCOS_WEEKDAYS.includes(currentWeekday)) return false;

  const configuredWeekdays = Array.isArray(weekdays)
    ? weekdays.map(Number).filter((weekday) => CONSTRUJOTA_MERCOS_WEEKDAYS.includes(weekday))
    : CONSTRUJOTA_MERCOS_WEEKDAYS;

  if (!configuredWeekdays.includes(currentWeekday)) return false;
  if (!hasScheduleTimeArrived(scheduledTime, current?.time)) return false;

  return !lastRun || lastRun.date !== current?.date;
}

export function shouldWaitForConstrujotaMercosBeforeCompetitors(
  { scheduledTime, weekdays, lastRun },
  current,
) {
  const currentWeekday = Number(current?.weekday);
  if (!CONSTRUJOTA_MERCOS_WEEKDAYS.includes(currentWeekday)) return false;
  const configuredWeekdays = Array.isArray(weekdays)
    ? weekdays.map(Number).filter((weekday) => CONSTRUJOTA_MERCOS_WEEKDAYS.includes(weekday))
    : CONSTRUJOTA_MERCOS_WEEKDAYS;
  if (!configuredWeekdays.includes(currentWeekday)) return false;
  // A prioridade da atualizacao propria so pode bloquear concorrentes quando o
  // horario dela tambem chegou. Uma agenda das 18:00 jamais deve impedir uma
  // coleta de concorrente marcada para 09:35.
  if (!hasScheduleTimeArrived(scheduledTime, current?.time)) return false;
  return !lastRun || lastRun.date !== current?.date;
}
