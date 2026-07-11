import type { RoutineFrequency, RoutineWeekday } from "./routine.types";

const BUSINESS_WEEKDAYS: RoutineWeekday[] = ["mon", "tue", "wed", "thu", "fri"];

export function normalizeRoutineRecurrence(input: {
  frequency?: RoutineFrequency;
  weekdays?: RoutineWeekday[];
}) {
  const frequency = input.frequency ?? "daily";
  if (frequency === "weekly") {
    if (input.weekdays?.length !== 1) throw new Error("ROUTINE_WEEKLY_WEEKDAY_INVALID");
    return { frequency, weekdays: [input.weekdays[0]!] };
  }
  if (frequency === "daily") {
    return {
      frequency,
      weekdays: input.weekdays?.length ? [...new Set(input.weekdays)] : [...BUSINESS_WEEKDAYS]
    };
  }
  return { frequency, weekdays: [] as RoutineWeekday[] };
}
