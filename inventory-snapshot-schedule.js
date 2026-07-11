const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

export function inventorySnapshotScheduleAt({
  now = new Date(),
  timeZone = "America/Halifax",
  dayIntervalMs,
  offHoursIntervalMs = dayIntervalMs,
  dayStartHour = 0,
  dayEndHour = 24,
} = {}) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError("now must be a valid date");

  const local = localTimeParts(date, timeZone);
  const dayWindow = hourIsInWindow(local.hour, dayStartHour, dayEndHour);
  const intervalMs = positiveInterval(dayWindow ? dayIntervalMs : offHoursIntervalMs);

  return {
    window: dayWindow ? "day" : "off_hours",
    currentIntervalMs: intervalMs,
    delayMs: alignedDelayMs(date, local, intervalMs),
    localHour: local.hour,
    localMinute: local.minute,
  };
}

export function hourIsInWindow(hour, startHour, endHour) {
  const hourValue = integerInRange(hour, 0, 23, "hour");
  const start = integerInRange(startHour, 0, 23, "startHour");
  const end = integerInRange(endHour, 0, 24, "endHour");

  if (start === end || (start === 0 && end === 24)) return true;
  if (start < end) return hourValue >= start && hourValue < end;
  return hourValue >= start || hourValue < end;
}

function localTimeParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));

  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function alignedDelayMs(date, local, intervalMs) {
  if (intervalMs % MINUTE_MS !== 0) return intervalMs;
  const intervalMinutes = intervalMs / MINUTE_MS;
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > DAY_MINUTES) {
    return intervalMs;
  }

  const minuteOfDay = local.hour * 60 + local.minute;
  const minutesToNextBoundary = intervalMinutes - (minuteOfDay % intervalMinutes);
  const elapsedThisMinuteMs = local.second * 1000 + date.getUTCMilliseconds();
  return Math.max(1, minutesToNextBoundary * MINUTE_MS - elapsedThisMinuteMs);
}

function positiveInterval(value) {
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new TypeError("snapshot intervals must be positive integers");
  }
  return interval;
}

function integerInRange(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}
