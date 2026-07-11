import assert from "node:assert/strict";
import test from "node:test";
import {
  hourIsInWindow,
  inventorySnapshotScheduleAt,
} from "../inventory-snapshot-schedule.js";

const DAY_INTERVAL_MS = 10 * 60 * 1000;
const OFF_HOURS_INTERVAL_MS = 30 * 60 * 1000;

function scheduleAt(iso) {
  return inventorySnapshotScheduleAt({
    now: new Date(iso),
    timeZone: "America/Halifax",
    dayIntervalMs: DAY_INTERVAL_MS,
    offHoursIntervalMs: OFF_HOURS_INTERVAL_MS,
    dayStartHour: 8,
    dayEndHour: 20,
  });
}

function daytimeOnlyScheduleAt(iso) {
  return inventorySnapshotScheduleAt({
    now: new Date(iso),
    timeZone: "America/Halifax",
    dayIntervalMs: DAY_INTERVAL_MS,
    offHoursEnabled: false,
    dayStartHour: 9,
    dayEndHour: 19,
  });
}

test("inventory snapshot schedule uses ten-minute daytime cadence", () => {
  const schedule = scheduleAt("2026-07-11T15:04:25.000Z"); // 12:04:25 Halifax
  assert.equal(schedule.window, "day");
  assert.equal(schedule.currentIntervalMs, DAY_INTERVAL_MS);
  assert.equal(schedule.delayMs, 5 * 60 * 1000 + 35 * 1000);
});

test("inventory snapshot schedule uses thirty-minute overnight cadence", () => {
  const schedule = scheduleAt("2026-07-11T07:12:30.000Z"); // 04:12:30 Halifax
  assert.equal(schedule.window, "off_hours");
  assert.equal(schedule.currentIntervalMs, OFF_HOURS_INTERVAL_MS);
  assert.equal(schedule.delayMs, 17 * 60 * 1000 + 30 * 1000);
});

test("inventory snapshot schedule changes cadence at the configured boundaries", () => {
  assert.equal(scheduleAt("2026-07-11T10:59:30.000Z").window, "off_hours"); // 07:59:30
  assert.equal(scheduleAt("2026-07-11T11:00:00.000Z").window, "day"); // 08:00
  assert.equal(scheduleAt("2026-07-11T22:59:30.000Z").window, "day"); // 19:59:30
  assert.equal(scheduleAt("2026-07-11T23:00:00.000Z").window, "off_hours"); // 20:00
});

test("inventory snapshot schedule handles Halifax daylight-saving time", () => {
  const winter = scheduleAt("2026-01-15T12:05:00.000Z"); // 08:05 AST
  const summer = scheduleAt("2026-07-15T11:05:00.000Z"); // 08:05 ADT
  assert.equal(winter.window, "day");
  assert.equal(summer.window, "day");
  assert.equal(winter.delayMs, 5 * 60 * 1000);
  assert.equal(summer.delayMs, 5 * 60 * 1000);
});

test("daytime-only schedule pauses overnight until 9 a.m.", () => {
  const schedule = daytimeOnlyScheduleAt("2026-07-11T22:12:00.000Z"); // 19:12 Halifax
  assert.equal(schedule.window, "off_hours");
  assert.equal(schedule.paused, true);
  assert.equal(schedule.currentIntervalMs, null);
  assert.equal(schedule.delayMs, (13 * 60 + 48) * 60 * 1000);
});

test("daytime-only schedule accounts for daylight-saving changes overnight", () => {
  const springForward = daytimeOnlyScheduleAt("2026-03-07T23:00:00.000Z"); // 19:00 AST
  const fallBack = daytimeOnlyScheduleAt("2026-10-31T22:00:00.000Z"); // 19:00 ADT
  assert.equal(springForward.delayMs, 13 * 60 * 60 * 1000);
  assert.equal(fallBack.delayMs, 15 * 60 * 60 * 1000);
});

test("hour windows support all-day and overnight schedules", () => {
  assert.equal(hourIsInWindow(3, 0, 24), true);
  assert.equal(hourIsInWindow(3, 8, 8), true);
  assert.equal(hourIsInWindow(23, 20, 8), true);
  assert.equal(hourIsInWindow(7, 20, 8), true);
  assert.equal(hourIsInWindow(12, 20, 8), false);
});
