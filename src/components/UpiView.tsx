import { useEffect, useState } from 'react'
import type { ScriptableContext } from 'chart.js'
import { Chart as ChartJSComponent, Line, Bar } from 'react-chartjs-2'
import { LineChart, MapPin, PieChart, Receipt, ShoppingBag, TrendingDown, TrendingUp, Trophy } from 'lucide-react'
import { useDashboard } from '../lib/DashboardContext'
import { useAppStatsAll, useMerchantCategoriesAll, useMonthlyTrend, useP2pAll, useStatewiseAll, type AppStatsAll, type P2pRow } from '../lib/queries'
import { SectionHead } from './SectionHead'
import { LiveCounter } from './LiveCounter'
import { IndiaMap } from './IndiaMap'
import { SplitBarPair } from './SplitBar'
import { Footer } from './Footer'
import { downloadCSV } from '../lib/csv'
import { CsvButton } from './CsvButton'
import { aposLabel, crNum, fmtPct, fullLabel, mnToCr, mom, rupees, shortLabel, yoy } from '../lib/format'
import { chartGridColor } from '../lib/chartTheme'

const APP_COLORS: Record<string, string> = {
  PhonePe: '#F5A524',
  'Google Pay': '#5B8DEF',
  Paytm: '#3FC1A8',
  Navi: '#E8654F',
  'super.money': '#9A7FD1',
}
const FALLBACK_COLORS = ['#5FD97A', '#7DD3E0', '#E8B4D8', '#C9A876', '#3A4759']

// NPCI publishes a total for the month, not a live feed - this spreads that total
// evenly across the month's real seconds to get a plausible per-second rate for
// the live ticker. Not a real-time signal, just a reasonable estimate from the
// latest published average.
function upiTxnsPerSecond(monthIso: string, totalVolumeMn: number): number {
  const [y, m] = monthIso.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  return (totalVolumeMn * 1_000_000) / (daysInMonth * 86400)
}

export function UpiView() {
  const trend = useMonthlyTrend()
  const appStats = useAppStatsAll()
  const p2p = useP2pAll()
  const categories = useMerchantCategoriesAll()
  const geo = useStatewiseAll()
  const { metric, selectedMonth } = useDashboard()

  const loading = trend.isPending || appStats.isPending || p2p.isPending || categories.isPending || geo.isPending
  const anyError = trend.error || appStats.error || p2p.error || categories.error || geo.error
  if (loading) return <p className="section-note">Loading…</p>
  if (anyError) return <p className="section-note">Failed to load: {anyError.message}</p>

  const idx = appStats.data.months.indexOf(selectedMonth ?? '')
  if (idx < 0) return null

  const latestTrend = trend.data[trend.data.length - 1]
  const liveRate = latestTrend ? upiTxnsPerSecond(latestTrend.month, latestTrend.total_volume_mn) : 0

  return (
    <div>
      <LiveCounter perSecondRate={liveRate} />
      <TrendSection months={trend.data.map((r) => r.month)} mVol={trend.data.map((r) => mnToCr(r.total_volume_mn)!)} mVal={trend.data.map((r) => r.total_value_cr)} />
      <LeaderboardSection appStats={appStats.data} idx={idx} metric={metric} monthLabel={fullLabel(appStats.data.months[idx])} />
      <div className="section">
        <div className="row-2">
          <P2pCard p2p={p2p.data} month={appStats.data.months[idx]} monthLabel={fullLabel(appStats.data.months[idx])} />
          <CategoriesCard categories={categories.data[appStats.data.months[idx]] ?? []} metric={metric} monthLabel={fullLabel(appStats.data.months[idx])} />
        </div>
      </div>
      <GeographySection geo={geo.data} month={appStats.data.months[idx]} metric={metric} />
      <AppTrendSection appStats={appStats.data} idx={idx} metric={metric} />
      <TicketSection appStats={appStats.data} idx={idx} monthLabel={fullLabel(appStats.data.months[idx])} />
      <Footer
        sources={[
          { href: 'https://www.npci.org.in/product/upi/product-statistics', label: 'NPCI — UPI Product Statistics' },
          { href: 'https://www.npci.org.in/product/ecosystem-statistics/upi', label: 'NPCI — UPI Ecosystem Statistics' },
        ]}
        disclaimer="Sourced from NPCI's official statistics. Geography is district-level from March 2026 onward, state-level before. Ticket size is computed from volume/value, not published directly by NPCI."
      />
    </div>
  )
}

function TrendSection({ months, mVol, mVal }: { months: string[]; mVol: number[]; mVal: number[] }) {
  const { theme } = useDashboard()
  const [rawOpen, setRawOpen] = useState(false)
  const labels = months.map(shortLabel)
  const latestMomPct = mom(mVol, mVol.length - 1)

  return (
    <div className="section">
      <SectionHead
        title={
          <>
            <TrendingUp size={17} />
            Monthly trend
          </>
        }
        note={`Volume (bars) & value (line) · ${shortLabel(months[0])} – ${shortLabel(months[months.length - 1])}`}
        onRawToggle={() => setRawOpen((v) => !v)}
        rawOpen={rawOpen}
        onCsv={() =>
          downloadCSV('upi-pulse-trend.csv', [
            ['Month', 'Volume (Cr)', 'MoM %', 'YoY %', 'Value (Cr)', 'MoM %', 'YoY %'],
            ...months.map((_, i) => [
              labels[i],
              mVol[i] ?? '',
              mom(mVol, i) ?? '',
              yoy(mVol, i) ?? '',
              mVal[i] ?? '',
              mom(mVal, i) ?? '',
              yoy(mVal, i) ?? '',
            ]),
          ])
        }
      >
        {latestMomPct != null && (
          <span className={`chip ${latestMomPct >= 0 ? 'up' : 'down'}`}>
            {latestMomPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {fmtPct(latestMomPct)} MoM
          </span>
        )}
      </SectionHead>
      <div className="card">
        <div style={{ position: 'relative', height: 300 }}>
          <ChartJSComponent
            type="bar"
            data={{
              labels,
              datasets: [
                {
                  type: 'bar' as const,
                  label: 'Volume (Cr txns)',
                  data: mVol,
                  backgroundColor: (ctx: ScriptableContext<'bar'>) => {
                    const { chartArea, ctx: canvasCtx } = ctx.chart
                    if (!chartArea) return '#F5A524'
                    const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
                    gradient.addColorStop(0, '#F5A524')
                    gradient.addColorStop(1, 'rgba(245,165,36,0.5)')
                    return gradient
                  },
                  borderRadius: 3,
                  yAxisID: 'y',
                  order: 2,
                  barThickness: 10,
                },
                {
                  type: 'line' as const,
                  label: 'Value (₹ Cr)',
                  data: mVal,
                  borderColor: '#3FC1A8',
                  backgroundColor: (ctx: ScriptableContext<'line'>) => {
                    const { chartArea, ctx: canvasCtx } = ctx.chart
                    if (!chartArea) return 'rgba(63,193,168,0.25)'
                    const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
                    gradient.addColorStop(0, 'rgba(63,193,168,0.32)')
                    gradient.addColorStop(1, 'rgba(63,193,168,0)')
                    return gradient
                  },
                  fill: true,
                  pointRadius: 0,
                  borderWidth: 2,
                  tension: 0.3,
                  yAxisID: 'y1',
                  order: 1,
                  spanGaps: true,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              scales: {
                x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 13, maxRotation: 0, font: { size: 10 } } },
                y: {
                  position: 'left',
                  title: { display: true, text: 'Volume (Cr)', font: { size: 11 } },
                  grid: { color: chartGridColor(theme) },
                  ticks: { callback: (v) => Number(v).toLocaleString('en-IN') },
                },
                y1: {
                  position: 'right',
                  title: { display: true, text: 'Value (₹ Cr)', font: { size: 11 } },
                  grid: { display: false },
                  ticks: { callback: (v) => Number(v).toLocaleString('en-IN') },
                },
              },
              plugins: { legend: { display: false } },
            }}
          />
        </div>
        <p className="section-note" style={{ marginTop: 10 }}>
          Some months may be missing from NPCI's data.
        </p>
        {rawOpen && (
          <div className="raw-panel open">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Volume (Cr)</th>
                  <th>MoM %</th>
                  <th>YoY %</th>
                  <th>Value (Cr)</th>
                  <th>MoM %</th>
                  <th>YoY %</th>
                </tr>
              </thead>
              <tbody>
                {months.map((_, i) => (
                  <tr key={i}>
                    <td className="name">{labels[i]}</td>
                    <td>{crNum(mVol[i])}</td>
                    <td>{fmtPct(mom(mVol, i))}</td>
                    <td>{fmtPct(yoy(mVol, i))}</td>
                    <td>{crNum(mVal[i], 0)}</td>
                    <td>{fmtPct(mom(mVal, i))}</td>
                    <td>{fmtPct(yoy(mVal, i))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function LeaderboardSection({
  appStats,
  idx,
  metric,
  monthLabel,
}: {
  appStats: AppStatsAll
  idx: number
  metric: 'volume' | 'value'
  monthLabel: string
}) {
  const names = Object.keys(appStats.byApp).filter((n) => appStats.byApp[n].vol[idx] > 0)
  names.sort((a, b) =>
    metric === 'volume' ? appStats.byApp[b].vol[idx] - appStats.byApp[a].vol[idx] : appStats.byApp[b].val[idx] - appStats.byApp[a].val[idx],
  )
  const top10 = names.slice(0, 10)
  const totalVol = appStats.monthTotalVol[idx]
  const totalVal = appStats.monthTotalVal[idx]

  return (
    <div className="section">
      <SectionHead
        title={
          <>
            <Trophy size={17} />
            Leaderboard — top 10 apps
          </>
        }
        note={`${monthLabel} · sorted by selected metric`}
        onCsv={() =>
          downloadCSV('upi-pulse-leaderboard.csv', [
            ['Rank', 'App', 'Volume (Cr)', 'Value (Cr)', 'Avg ticket (Rs)', 'Share %'],
            ...top10.map((n, i) => {
              const vol = mnToCr(appStats.byApp[n].vol[idx])!
              const val = appStats.byApp[n].val[idx]
              const share = metric === 'volume' ? (appStats.byApp[n].vol[idx] / totalVol) * 100 : (appStats.byApp[n].val[idx] / totalVal) * 100
              return [i + 1, n, vol, val, (val / vol).toFixed(0), share.toFixed(2)]
            }),
          ])
        }
      />
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>App</th>
                <th>Volume (Cr)</th>
                <th>Value (₹ Cr)</th>
                <th>Avg ticket (₹)</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((n, i) => {
                const volMn = appStats.byApp[n].vol[idx]
                const volCr = mnToCr(volMn)!
                const val = appStats.byApp[n].val[idx]
                const share = metric === 'volume' ? (volMn / totalVol) * 100 : (val / totalVal) * 100
                return (
                  <tr key={n}>
                    <td>{i + 1}</td>
                    <td className="name">{n}</td>
                    <td>{crNum(volCr, 1)}</td>
                    <td>{crNum(val, 0)}</td>
                    <td>{rupees(val / volCr)}</td>
                    <td>{share.toFixed(2)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function P2pCard({ p2p, month, monthLabel }: { p2p: P2pRow[]; month: string; monthLabel: string }) {
  // p2p_p2m only has data from Jan 2025 onward (hand-entered - NPCI's own site 500s
  // on this tab) while App Stats goes back further, so this can't assume the two
  // arrays line up index-for-index - look up the matching month explicitly instead
  // of indexing by position (confirmed the hard way: positional indexing showed
  // wrong-month data for most of 2025 and nothing at all for H2 2025 onward).
  const d = p2p.find((r) => r.month === month)
  if (!d) return null
  const totalVol = d.p2p_volume_mn + d.p2m_volume_mn
  const totalVal = d.p2p_value_cr + d.p2m_value_cr
  const volData = [+(((d.p2m_volume_mn / totalVol) * 100).toFixed(2)), +(((d.p2p_volume_mn / totalVol) * 100).toFixed(2))]
  const valData = [+(((d.p2m_value_cr / totalVal) * 100).toFixed(2)), +(((d.p2p_value_cr / totalVal) * 100).toFixed(2))]
  const p2pTicket = d.p2p_value_cr / mnToCr(d.p2p_volume_mn)!
  const p2mTicket = d.p2m_value_cr / mnToCr(d.p2m_volume_mn)!

  return (
    <div className="card">
      <div className="section-head">
        <p className="section-title">
          <PieChart size={16} />
          P2P vs P2M split
        </p>
        <p className="section-note">{monthLabel}</p>
      </div>
      <div className="p2p-grid">
        <SplitBarPair title="Volume" a={{ label: 'P2M', pct: volData[0], color: '#F5A524' }} b={{ label: 'P2P', pct: volData[1], color: '#3FC1A8' }} />
        <SplitBarPair title="Value" a={{ label: 'P2M', pct: valData[0], color: '#F5A524' }} b={{ label: 'P2P', pct: valData[1], color: '#3FC1A8' }} />
      </div>
      <div className="legend" style={{ marginTop: 14 }}>
        <span><i style={{ background: '#3FC1A8' }} />P2P avg ticket: {rupees(p2pTicket)}</span>
        <span><i style={{ background: '#F5A524' }} />P2M avg ticket: {rupees(p2mTicket)}</span>
      </div>
    </div>
  )
}

function CategoriesCard({ categories, metric, monthLabel }: { categories: { name: string; vol: number; val: number }[]; metric: 'volume' | 'value'; monthLabel: string }) {
  const sorted = [...categories].sort((a, b) => (metric === 'volume' ? b.vol - a.vol : b.val - a.val))
  return (
    <div className="card">
      <div className="section-head">
        <p className="section-title">
          <ShoppingBag size={16} />
          Top merchant categories
        </p>
        <div className="section-actions">
          <p className="section-note">{monthLabel}</p>
          <CsvButton
            label="CSV"
            onClick={() => downloadCSV('upi-pulse-category.csv', [['Category', 'Volume (Cr)', 'Value (Cr)'], ...sorted.map((c) => [c.name, mnToCr(c.vol), c.val])])}
          />
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Volume (Cr)</th>
              <th>Value (₹ Cr)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.name}>
                <td className="name">{c.name}</td>
                <td>{crNum(mnToCr(c.vol))}</td>
                <td>{crNum(c.val, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function titleCase(upper: string): string {
  return upper
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function GeographySection({
  geo,
  month,
  metric,
}: {
  geo: { byMonth: Record<string, { name: string; state: string; vol: number; val: number }[]>; granularityByMonth: Record<string, 'State' | 'District'> }
  month: string
  metric: 'volume' | 'value'
}) {
  const [rawOpen, setRawOpen] = useState(false)
  const [selectedState, setSelectedState] = useState<string | null>(null)

  useEffect(() => setSelectedState(null), [month])

  // "Unclassified" (transactions NPCI couldn't attribute to any district) has no
  // polygon to shade and no real place on a map or in a per-state drill-down, so it's
  // dropped from this view entirely rather than shown as a top-ranked phantom "place".
  const monthRows = (geo.byMonth[month] ?? []).filter((r) => r.name.trim().toUpperCase() !== 'UNCLASSIFIED')
  const granularity = geo.granularityByMonth[month] ?? 'State'
  const canDrillDown = granularity === 'District'
  const scopedRows = selectedState && canDrillDown ? monthRows.filter((r) => r.state.trim().toUpperCase() === selectedState) : monthRows

  const allRows = [...scopedRows].sort((a, b) => (metric === 'volume' ? b.vol - a.vol : b.val - a.val))
  const rows = allRows.slice(0, 10)

  return (
    <div className="section">
      <SectionHead
        title={
          selectedState ? (
            <>
              <MapPin size={17} />
              Geography — districts in {titleCase(selectedState)}
            </>
          ) : (
            <>
              <MapPin size={17} />
              Geography — top {granularity === 'District' ? 'districts' : 'states'} nationally
            </>
          )
        }
        note={`${fullLabel(month)} · NPCI reports at ${granularity.toLowerCase()} level${granularity === 'State' ? ' for this month' : ''}`}
        onRawToggle={() => setRawOpen((v) => !v)}
        rawOpen={rawOpen}
        onCsv={() =>
          downloadCSV(selectedState ? `upi-pulse-geo-${selectedState.toLowerCase().replace(/\s+/g, '-')}.csv` : 'upi-pulse-geo.csv', [
            [granularity, 'Volume Share %', 'Value Share %'],
            ...allRows.map((g) => [g.name, g.vol, g.val]),
          ])
        }
      >
        {selectedState && (
          <button className="mini-btn" onClick={() => setSelectedState(null)}>
            ← All India
          </button>
        )}
      </SectionHead>
      <div className="row-2">
        <div className="card">
          <IndiaMap rows={monthRows} metric={metric} selectedState={selectedState} onStateClick={setSelectedState} clickable={canDrillDown} />
          <p className="section-note" style={{ marginTop: 10 }}>
            {canDrillDown ? 'Click a state for its districts.' : 'Shaded by state, hover for share.'}
            {granularity === 'District' && ' Districts summed to their parent state.'}
          </p>
        </div>
        <div className="card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{granularity}</th>
                  <th>Volume share</th>
                  <th>Value share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.name}>
                    <td className="name">{g.name}</td>
                    <td>{g.vol}%</td>
                    <td>{g.val}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="section-note" style={{ marginTop: 10 }}>
            {selectedState
              ? `Showing top ${Math.min(10, allRows.length)} of ${allRows.length} districts in ${titleCase(selectedState)}.`
              : `Showing top 10 of ${allRows.length} ${granularity.toLowerCase()}s nationally.`}
          </p>
        </div>
      </div>
      {rawOpen && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="raw-panel open">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{granularity}</th>
                  <th>Volume share</th>
                  <th>Value share</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((g, i) => (
                  <tr key={g.name}>
                    <td>{i + 1}</td>
                    <td className="name">{g.name}</td>
                    <td>{g.vol}%</td>
                    <td>{g.val}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function AppTrendSection({ appStats, idx, metric }: { appStats: AppStatsAll; idx: number; metric: 'volume' | 'value' }) {
  const { theme } = useDashboard()
  const [rawOpen, setRawOpen] = useState(false)
  const top5 = Object.keys(appStats.byApp)
    .sort((a, b) => appStats.byApp[b].vol[idx] - appStats.byApp[a].vol[idx])
    .slice(0, 5)
  const labels = appStats.months.map(aposLabel)

  const datasets = top5.map((n, i) => {
    const color = APP_COLORS[n] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
    const series = metric === 'volume' ? appStats.byApp[n].vol.map(mnToCr) : appStats.byApp[n].val
    return { label: n, data: series, borderColor: color, backgroundColor: color, tension: 0.3 }
  })

  return (
    <div className="section">
      <SectionHead
        title={
          <>
            <LineChart size={17} />
            App trend — {fullLabel(appStats.months[0])} to {fullLabel(appStats.months[appStats.months.length - 1])}
          </>
        }
        note={`${aposLabel(appStats.months[0])} – ${aposLabel(appStats.months[appStats.months.length - 1])}, top 5 apps`}
        onRawToggle={() => setRawOpen((v) => !v)}
        rawOpen={rawOpen}
        onCsv={() =>
          downloadCSV('upi-pulse-quarter.csv', [
            ['App', ...labels.map((m) => `${m} Vol(Cr)`), ...labels.map((m) => `${m} Val(Cr)`)],
            ...Object.keys(appStats.byApp).map((n) => [n, ...appStats.byApp[n].vol.map(mnToCr), ...appStats.byApp[n].val]),
          ])
        }
      />
      <div className="card">
        <div style={{ position: 'relative', height: 220 }}>
          <Line
            data={{ labels, datasets }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: { grid: { display: false } },
                y: { title: { display: true, text: metric === 'volume' ? 'Volume (Cr)' : 'Value (₹ Cr)', font: { size: 11 } }, grid: { color: chartGridColor(theme) } },
              },
              plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
            }}
          />
        </div>
        {rawOpen && (
          <div className="raw-panel open">
            <table>
              <thead>
                <tr>
                  <th>App</th>
                  {labels.map((m) => (
                    <th key={m + 'v'}>{m} Vol(Cr)</th>
                  ))}
                  {labels.map((m) => (
                    <th key={m + 'l'}>{m} Val(Cr)</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(appStats.byApp).map((n) => (
                  <tr key={n}>
                    <td className="name">{n}</td>
                    {appStats.byApp[n].vol.map((v, i) => (
                      <td key={i}>{crNum(mnToCr(v))}</td>
                    ))}
                    {appStats.byApp[n].val.map((v, i) => (
                      <td key={i}>{crNum(v, 0)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function TicketSection({ appStats, idx, monthLabel }: { appStats: AppStatsAll; idx: number; monthLabel: string }) {
  const { theme } = useDashboard()
  const names = Object.keys(appStats.byApp).filter((n) => appStats.byApp[n].vol[idx] > 0)
  const ticket = (n: string) => appStats.byApp[n].val[idx] / mnToCr(appStats.byApp[n].vol[idx])!
  const order = [...names].sort((a, b) => ticket(b) - ticket(a))
  const data = order.map((n) => +ticket(n).toFixed(0))

  return (
    <div className="section">
      <SectionHead
        title={
          <>
            <Receipt size={17} />
            Average ticket size
          </>
        }
        note={`${monthLabel}, ₹ per transaction`}
        onCsv={() => downloadCSV('upi-pulse-ticket.csv', [['App', 'Avg ticket size (Rs)'], ...order.map((n, i) => [n, data[i]])])}
      />
      <div className="card">
        <div style={{ position: 'relative', height: 240 }}>
          <Bar
            data={{ labels: order, datasets: [{ label: '₹ per txn', data, backgroundColor: '#F5A524', borderRadius: 4 }] }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: { x: { grid: { display: false } }, y: { grid: { color: chartGridColor(theme) }, title: { display: true, text: '₹ per transaction', font: { size: 11 } } } },
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `₹${Number(c.raw).toLocaleString('en-IN')}` } } },
            }}
          />
        </div>
      </div>
    </div>
  )
}
