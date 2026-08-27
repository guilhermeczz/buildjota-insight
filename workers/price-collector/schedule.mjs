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

export function shouldWaitForConstrujotaMercosBeforeCompetitors({ weekdays, lastRun }, current) {
  const currentWeekday = Number(current?.weekday);
  if (!CONSTRUJOTA_MERCOS_WEEKDAYS.includes(currentWeekday)) return false;
  const configuredWeekdays = Array.isArray(weekdays)
    ? weekdays.map(Number).filter((weekday) => CONSTRUJOTA_MERCOS_WEEKDAYS.includes(weekday))
    : CONSTRUJOTA_MERCOS_WEEKDAYS;
  if (!configuredWeekdays.includes(currentWeekday)) return false;
  return !lastRun || lastRun.date !== current?.date;
}
