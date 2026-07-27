export function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? "").slice(0, 5));
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return hour * 60 + minute;
}

export function isInsideScheduleWindow(scheduledTime, currentTime, graceMinutes = 1) {
  const scheduled = timeToMinutes(scheduledTime);
  const current = timeToMinutes(currentTime);
  if (scheduled === null || current === null) return false;

  const grace = Math.max(0, Math.min(60, Number(graceMinutes) || 0));
  const delay = current - scheduled;

  return delay >= 0 && delay <= grace;
}
