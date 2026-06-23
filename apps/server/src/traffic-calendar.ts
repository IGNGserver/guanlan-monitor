import type {
  TrafficCalendarCell,
  TrafficCalendarMode,
  TrafficCalendarResponse,
  TrafficRangeRecord
} from "@dsc/shared";
import type { TimeSeriesRecord } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCAL_OFFSET_MS = 8 * 60 * 60 * 1000;

export function buildTrafficCalendar(
  points: TimeSeriesRecord[],
  mode: TrafficCalendarMode,
  anchorDate: string,
  selectedStart?: string
): TrafficCalendarResponse {
  const anchor = startOfDay(parseDate(anchorDate));
  const { periods, defaultSelectedKey } = buildPeriods(mode, anchor);
  const selectedKey = selectedStart
    ? startOfDay(parseDate(selectedStart)).toISOString()
    : defaultSelectedKey;

  const cells: TrafficCalendarCell[] = periods.map((period) => {
    const records = collectPeriodRecords(points, period.start, period.end);
    const totals = sumRecords(records);
    const key = period.start.toISOString();
    return {
      key,
      label: period.label,
      rangeStart: period.start.toISOString(),
      rangeEnd: period.end.toISOString(),
      totalRxBytes: totals.rx,
      totalTxBytes: totals.tx,
      isSelected: key === selectedKey,
      isCurrentPeriod: containsDate(period.start, period.end, new Date()),
      isInPrimaryScope: period.isInPrimaryScope
    };
  });

  const selectedCell = cells.find((cell) => cell.isSelected) ?? cells.at(-1);
  const selectedRecords = selectedCell
    ? collectPeriodRecords(points, new Date(selectedCell.rangeStart), new Date(selectedCell.rangeEnd))
    : [];
  const selectedTotals = sumRecords(selectedRecords);

  return {
    mode,
    anchor: anchor.toISOString(),
    title: buildTitle(mode, anchor),
    rangeStart: selectedCell?.rangeStart ?? anchor.toISOString(),
    rangeEnd: selectedCell?.rangeEnd ?? anchor.toISOString(),
    cells,
    records: selectedRecords.map((record) => ({
      timestamp: new Date(record.timestamp).toISOString(),
      rxBytes: record.trafficRxBytes,
      txBytes: record.trafficTxBytes,
      totalBytes: record.trafficRxBytes + record.trafficTxBytes
    })),
    totalRxBytes: selectedTotals.rx,
    totalTxBytes: selectedTotals.tx
  };
}

function buildPeriods(mode: TrafficCalendarMode, anchor: Date) {
  if (mode === "day") {
    const monthStart = startOfLocalMonth(anchor);
    const nextMonthStart = addLocalMonths(monthStart, 1);
    const gridStart = startOfWeek(monthStart);
    const gridEnd = new Date(startOfWeek(nextMonthStart).getTime() + DAY_MS * 7);
    const periods = [];
    for (let current = gridStart; current < gridEnd; current = new Date(current.getTime() + DAY_MS)) {
      const localCurrent = toLocalDate(current);
      periods.push({
        start: current,
        end: new Date(current.getTime() + DAY_MS),
        label: String(localCurrent.getUTCDate()).padStart(2, "0"),
        isInPrimaryScope: current >= monthStart && current < nextMonthStart
      });
    }
    return {
      periods,
      defaultSelectedKey: selectCurrentOrLast(periods, anchor)
    };
  }

  if (mode === "week") {
    const monthStart = startOfLocalMonth(anchor);
    const nextMonthStart = addLocalMonths(monthStart, 1);
    const periods = [];
    let current = startOfWeek(monthStart);
    while (current < nextMonthStart) {
      const end = new Date(current.getTime() + DAY_MS * 7);
      const localCurrent = toLocalDate(current);
      periods.push({
        start: current,
        end,
        label: `${String(localCurrent.getUTCMonth() + 1).padStart(2, "0")}/${String(localCurrent.getUTCDate()).padStart(2, "0")}`,
        isInPrimaryScope: current < nextMonthStart && end > monthStart
      });
      current = end;
    }
    return {
      periods,
      defaultSelectedKey: selectCurrentOrLast(periods, anchor)
    };
  }

  const yearStart = startOfLocalYear(anchor);
  const periods = Array.from({ length: 12 }, (_, index) => {
    const start = addLocalMonths(yearStart, index);
    const end = addLocalMonths(yearStart, index + 1);
    return {
      start,
      end,
      label: `${index + 1}月`,
      isInPrimaryScope: true
    };
  });
  return {
    periods,
    defaultSelectedKey: selectCurrentOrLast(periods, anchor)
  };
}

function collectPeriodRecords(points: TimeSeriesRecord[], start: Date, end: Date) {
  const inRange = points.filter((point) => point.timestamp >= start.getTime() && point.timestamp < end.getTime());
  if (!inRange.length) return [];

  let baselineRx = inRange[0]?.trafficRxBytes ?? 0;
  let baselineTx = inRange[0]?.trafficTxBytes ?? 0;
  const records: TimeSeriesRecord[] = [];

  for (const point of inRange) {
    if (point.trafficRxBytes < baselineRx) baselineRx = point.trafficRxBytes;
    if (point.trafficTxBytes < baselineTx) baselineTx = point.trafficTxBytes;
    records.push({
      ...point,
      trafficRxBytes: Math.max(0, point.trafficRxBytes - baselineRx),
      trafficTxBytes: Math.max(0, point.trafficTxBytes - baselineTx)
    });
  }

  return records;
}

function sumRecords(records: TimeSeriesRecord[]) {
  const last = records.at(-1);
  return {
    rx: last?.trafficRxBytes ?? 0,
    tx: last?.trafficTxBytes ?? 0
  };
}

function buildTitle(mode: TrafficCalendarMode, anchor: Date) {
  const localAnchor = toLocalDate(anchor);
  if (mode === "month") {
    return `${localAnchor.getUTCFullYear()} 年`;
  }
  return `${localAnchor.getUTCFullYear()} 年 ${localAnchor.getUTCMonth() + 1} 月`;
}

function startOfDay(date: Date) {
  const local = toLocalDate(date);
  return fromLocalParts(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

function startOfWeek(date: Date) {
  const local = toLocalDate(date);
  const day = local.getUTCDay() || 7;
  return new Date(startOfDay(date).getTime() - (day - 1) * DAY_MS);
}

function parseDate(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

function containsDate(start: Date, end: Date, target: Date) {
  const normalizedTarget = startOfDay(target);
  return normalizedTarget >= start && normalizedTarget < end;
}

function toLocalDate(date: Date) {
  return new Date(date.getTime() + LOCAL_OFFSET_MS);
}

function fromLocalParts(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day) - LOCAL_OFFSET_MS);
}

function startOfLocalMonth(date: Date) {
  const local = toLocalDate(date);
  return fromLocalParts(local.getUTCFullYear(), local.getUTCMonth(), 1);
}

function startOfLocalYear(date: Date) {
  const local = toLocalDate(date);
  return fromLocalParts(local.getUTCFullYear(), 0, 1);
}

function addLocalMonths(date: Date, amount: number) {
  const local = toLocalDate(date);
  return fromLocalParts(local.getUTCFullYear(), local.getUTCMonth() + amount, 1);
}

function selectCurrentOrLast(
  periods: Array<{ start: Date; end: Date; isInPrimaryScope: boolean }>,
  anchor: Date
) {
  const current = periods.find((period) => containsDate(period.start, period.end, new Date()));
  if (current && current.isInPrimaryScope) return current.start.toISOString();

  const anchorPeriod = periods.find((period) => containsDate(period.start, period.end, anchor) && period.isInPrimaryScope);
  if (anchorPeriod) return anchorPeriod.start.toISOString();

  return periods.filter((period) => period.isInPrimaryScope).at(-1)?.start.toISOString();
}
