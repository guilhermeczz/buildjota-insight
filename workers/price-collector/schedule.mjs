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
