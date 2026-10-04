import React, { useMemo } from "react";
import { chartSeriesColor, formatSampleTime } from "../charts";
import { chartSampleWindow, indexChartSamples, summarizeSeries, type SeriesSummary } from "../chartInspection.ts";
import type { DeviceChartTile } from "./deviceCharts";
import { ChartInfoRows } from "./deviceCharts";
import { TelemetryModelList } from "./shared";

/**
 * 设备图表卡片的半屏详情。
 *
 * 卡片默认只留标题、读数与图，其余说明按「先看数、再看口径、最后看硬件」排进来：
 * 时间窗统计 → 说明与容量 → 已采集型号。所有内容都来自磁贴已有的数据，不额外取数。
 */
export function DeviceChartSheet({ tile }: { tile: DeviceChartTile }) {
  const series = useMemo(() => tile.series ?? [], [tile.series]);
  const summaries = useMemo(() => series.map(summarizeSeries), [series]);
  const sampleWindow = useMemo(() => chartSampleWindow(indexChartSamples(series)), [series]);
  const format = (index: number) => series[index]?.valueFormatter ?? tile.valueFormatter ?? String;
  const hasStats = summaries.some((summary) => summary.latest);
  const title = tile.title ?? "图表";

  return (
    <div className="chart-sheet">
      {hasStats ? (
        <section className="chart-sheet__section">
          <h4 className="chart-sheet__heading">本时段统计</h4>
          {summaries.length === 1
            ? <SingleSeriesStats summary={summaries[0]} format={format(0)} />
            : <SeriesStatsTable summaries={summaries} format={format} label={title} />}
          {sampleWindow ? (
            <p className="chart-sheet__caption">
              {formatSampleTime(sampleWindow.start)} – {formatSampleTime(sampleWindow.end)} · {sampleWindow.count} 个采样时刻
            </p>
          ) : null}
        </section>
      ) : null}

      {tile.subtitle || tile.facts?.length ? (
        <section className="chart-sheet__section">
          <h4 className="chart-sheet__heading">说明</h4>
          {tile.subtitle ? <p className="chart-sheet__text">{tile.subtitle}</p> : null}
          {tile.facts?.length ? <ChartInfoRows rows={tile.facts} label={title} /> : null}
        </section>
      ) : null}

      {tile.models ? (
        <section className="chart-sheet__section">
          <TelemetryModelList label={tile.models.label} items={tile.models.items} collapsible={false} />
        </section>
      ) : null}
    </div>
  );
}

function StatValue({ point, value, format }: { point?: SeriesSummary["peak"]; value: number | null | undefined; format: (value: number) => string }) {
  if (value == null) return <>—</>;
  return (
    <>
      <span className="chart-sheet__value">{format(value)}</span>
      {point ? <time className="chart-sheet__when" dateTime={new Date(point.timestamp).toISOString()}>{formatSampleTime(Date.parse(point.timestamp))}</time> : null}
    </>
  );
}

function SingleSeriesStats({ summary, format }: { summary: SeriesSummary; format: (value: number) => string }) {
  // 当前值已经在卡片读数里，这里只给读数看不到的三项。
  return (
    <dl className="chart-sheet__stats">
      <div><dt>平均</dt><dd><StatValue value={summary.average} format={format} /></dd></div>
      <div><dt>峰值</dt><dd><StatValue value={summary.peak?.value} point={summary.peak} format={format} /></dd></div>
      <div><dt>最低</dt><dd><StatValue value={summary.minimum?.value} point={summary.minimum} format={format} /></dd></div>
    </dl>
  );
}

function SeriesStatsTable({ summaries, format, label }: { summaries: SeriesSummary[]; format: (index: number) => (value: number) => string; label: string }) {
  return (
    <div className="chart-sheet__table-scroll">
      <table className="m3e-table chart-sheet__table" aria-label={`${label}时段统计`}>
        <thead>
          <tr>
            <th scope="col">序列</th>
            <th scope="col">平均</th>
            <th scope="col">峰值</th>
            <th scope="col">最低</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary, index) => (
            <tr key={`${index}-${summary.label}`}>
              <th scope="row">
                <span className="m3e-chart__swatch" style={{ background: chartSeriesColor(index) }} aria-hidden="true" />
                {summary.label}
              </th>
              <td><StatValue value={summary.average} format={format(index)} /></td>
              <td><StatValue value={summary.peak?.value} point={summary.peak} format={format(index)} /></td>
              <td><StatValue value={summary.minimum?.value} point={summary.minimum} format={format(index)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
