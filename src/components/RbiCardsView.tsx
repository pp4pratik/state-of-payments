import { Line } from 'react-chartjs-2'
import { useDashboard } from '../lib/DashboardContext'
import { useRbiCardsAll, type RbiCardsRow } from '../lib/queries'
import { SectionHead } from './SectionHead'
import { SplitBarPair } from './SplitBar'
import { Footer } from './Footer'
import { downloadCSV } from '../lib/csv'
import { CsvButton } from './CsvButton'
import { fullLabel, rbiCountToCr, rbiValueToCr, shortLabel } from '../lib/format'
import { chartGridColor } from '../lib/chartTheme'

const RBI_CHANNELS = [
  { key: 'credit_pos', label: 'Credit card — PoS', side: 'credit', spend: true },
  { key: 'credit_online', label: 'Credit card — Online/e-com', side: 'credit', spend: true },
  { key: 'credit_others', label: 'Credit card — Other txns', side: 'credit', spend: true },
  { key: 'credit_atm_withdrawal', label: 'Credit card — ATM withdrawal', side: 'credit', spend: false },
  { key: 'debit_pos', label: 'Debit card — PoS', side: 'debit', spend: true },
  { key: 'debit_online', label: 'Debit card — Online/e-com', side: 'debit', spend: true },
  { key: 'debit_others', label: 'Debit card — Other txns', side: 'debit', spend: true },
  { key: 'debit_atm_withdrawal', label: 'Debit card — ATM withdrawal', side: 'debit', spend: false },
  { key: 'debit_pos_withdrawal', label: 'Debit card — PoS cash withdrawal', side: 'debit', spend: false },
] as const

function channelVol(row: RbiCardsRow, key: string): number {
  return (row as unknown as Record<string, number>)[`${key}_volume`] ?? 0
}
function channelVal(row: RbiCardsRow, key: string): number {
  return (row as unknown as Record<string, number>)[`${key}_value`] ?? 0
}
function sideTotal(row: RbiCardsRow, side: 'credit' | 'debit', field: 'vol' | 'val'): number {
  return RBI_CHANNELS.filter((c) => c.side === side && c.spend).reduce(
    (sum, c) => sum + (field === 'vol' ? channelVol(row, c.key) : channelVal(row, c.key)),
    0,
  )
}

export function RbiCardsView() {
  const { selectedMonth, theme } = useDashboard()
  const rbiCards = useRbiCardsAll()

  if (rbiCards.isPending) return <p className="section-note">Loading…</p>
  if (rbiCards.error) return <p className="section-note">Failed to load: {rbiCards.error.message}</p>

  const rows = rbiCards.data
  const row = rows.find((r) => r.month === selectedMonth) ?? rows[rows.length - 1]
  if (!row) return null

  const months = rows.map((r) => r.month)
  const atmsCr = rows.map((r) => rbiCountToCr(r.atms_onsite + r.atms_offsite)!)
  const posCr = rows.map((r) => rbiCountToCr(r.pos_terminals)!)
  const microAtmCr = rows.map((r) => rbiCountToCr(r.micro_atms)!)
  const creditCardsCr = rows.map((r) => rbiCountToCr(r.credit_cards_outstanding)!)
  const debitCardsCr = rows.map((r) => rbiCountToCr(r.debit_cards_outstanding)!)

  const creditVol = sideTotal(row, 'credit', 'vol')
  const debitVol = sideTotal(row, 'debit', 'vol')
  const creditVal = rbiValueToCr(sideTotal(row, 'credit', 'val'))!
  const debitVal = rbiValueToCr(sideTotal(row, 'debit', 'val'))!
  const creditVolCr = rbiCountToCr(creditVol)!
  const debitVolCr = rbiCountToCr(debitVol)!

  const channelRows = RBI_CHANNELS.map((c) => {
    const vol = rbiCountToCr(channelVol(row, c.key))!
    const val = rbiValueToCr(channelVal(row, c.key))!
    return { ...c, vol, val, ticket: val / vol }
  }).sort((a, b) => b.vol - a.vol)

  const volTotal = creditVolCr + debitVolCr
  const valTotal = creditVal + debitVal
  const creditVolPct = volTotal ? +((creditVolCr / volTotal) * 100).toFixed(1) : 0
  const debitVolPct = volTotal ? +((debitVolCr / volTotal) * 100).toFixed(1) : 0
  const creditValPct = valTotal ? +((creditVal / valTotal) * 100).toFixed(1) : 0
  const debitValPct = valTotal ? +((debitVal / valTotal) * 100).toFixed(1) : 0

  return (
    <div>
      <div className="kpi-strip four">
        <div className="kpi">
          <p className="kpi-label">ATMs &amp; CRMs</p>
          <p className="kpi-value">{rbiCountToCr(row.atms_onsite + row.atms_offsite)!.toFixed(4)} Cr</p>
          <p className="kpi-sub">on-site + off-site</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">PoS terminals</p>
          <p className="kpi-value">{rbiCountToCr(row.pos_terminals)!.toFixed(2)} Cr</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Credit cards outstanding</p>
          <p className="kpi-value">{rbiCountToCr(row.credit_cards_outstanding)!.toFixed(2)} Cr</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Debit cards outstanding</p>
          <p className="kpi-value">{rbiCountToCr(row.debit_cards_outstanding)!.toFixed(2)} Cr</p>
        </div>
      </div>

      <div className="section">
        <SectionHead
          title="Payment infrastructure"
          note={`${shortLabel(months[0])} – ${shortLabel(months[months.length - 1])}`}
          onCsv={() =>
            downloadCSV('upi-pulse-rbiInfra.csv', [
              ['Month', 'ATMs & CRMs (Cr)', 'PoS Terminals (Cr)', 'Micro ATMs (Cr)'],
              ...months.map((m, i) => [shortLabel(m), atmsCr[i], posCr[i], microAtmCr[i]]),
            ])
          }
        />
        <div className="card">
          <div style={{ position: 'relative', height: 240 }}>
            <Line
              data={{
                labels: months.map(shortLabel),
                datasets: [
                  { label: 'ATMs & CRMs', data: atmsCr, borderColor: '#F5A524', backgroundColor: '#F5A524', pointRadius: 2, borderWidth: 2, tension: 0.3 },
                  { label: 'PoS terminals', data: posCr, borderColor: '#3FC1A8', backgroundColor: '#3FC1A8', pointRadius: 2, borderWidth: 2, tension: 0.3, yAxisID: 'y1' },
                  { label: 'Micro ATMs', data: microAtmCr, borderColor: '#5B8DEF', backgroundColor: '#5B8DEF', pointRadius: 2, borderWidth: 2, tension: 0.3, yAxisID: 'y1' },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: { grid: { display: false } },
                  y: { position: 'left', title: { display: true, text: 'ATMs & CRMs (Cr)', font: { size: 11 } }, grid: { color: chartGridColor(theme) } },
                  y1: { position: 'right', title: { display: true, text: 'PoS / Micro ATMs (Cr)', font: { size: 11 } }, grid: { display: false } },
                },
                plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
              }}
            />
          </div>
        </div>
      </div>

      <div className="section">
        <SectionHead
          title="Cards outstanding"
          note={`${shortLabel(months[0])} – ${shortLabel(months[months.length - 1])}`}
          onCsv={() =>
            downloadCSV('upi-pulse-rbiCardsOutstanding.csv', [
              ['Month', 'Credit Cards (Cr)', 'Debit Cards (Cr)'],
              ...months.map((m, i) => [shortLabel(m), creditCardsCr[i], debitCardsCr[i]]),
            ])
          }
        />
        <div className="card">
          <div style={{ position: 'relative', height: 220 }}>
            <Line
              data={{
                labels: months.map(shortLabel),
                datasets: [
                  { label: 'Credit cards', data: creditCardsCr, borderColor: '#F5A524', backgroundColor: '#F5A524', pointRadius: 2, borderWidth: 2, tension: 0.3 },
                  { label: 'Debit cards', data: debitCardsCr, borderColor: '#3FC1A8', backgroundColor: '#3FC1A8', pointRadius: 2, borderWidth: 2, tension: 0.3, yAxisID: 'y1' },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: { grid: { display: false } },
                  y: { position: 'left', title: { display: true, text: 'Credit cards (Cr)', font: { size: 11 } }, grid: { color: chartGridColor(theme) } },
                  y1: { position: 'right', title: { display: true, text: 'Debit cards (Cr)', font: { size: 11 } }, grid: { display: false } },
                },
                plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
              }}
            />
          </div>
        </div>
      </div>

      <div className="section">
        <div className="row-2">
          <div className="card">
            <div className="section-head">
              <p className="section-title">Credit vs Debit split — spends</p>
              <p className="section-note">{fullLabel(row.month)}</p>
            </div>
            <div className="p2p-grid">
              <SplitBarPair title="Volume" a={{ label: 'Debit', pct: debitVolPct, color: '#F5A524' }} b={{ label: 'Credit', pct: creditVolPct, color: '#3FC1A8' }} />
              <SplitBarPair title="Value" a={{ label: 'Debit', pct: debitValPct, color: '#F5A524' }} b={{ label: 'Credit', pct: creditValPct, color: '#3FC1A8' }} />
            </div>
          </div>
          <div className="card">
            <div className="section-head">
              <p className="section-title">Transactions by channel</p>
              <div className="section-actions">
                <p className="section-note">{fullLabel(row.month)}</p>
                <CsvButton
                  label="CSV"
                  onClick={() =>
                    downloadCSV('upi-pulse-rbiChannel.csv', [
                      ['Channel', 'Volume (Cr)', 'Value (Cr)', 'Avg ticket (Rs)'],
                      ...channelRows.map((c) => [c.label, c.vol, c.val, isFinite(c.ticket) ? c.ticket.toFixed(0) : '']),
                    ])
                  }
                />
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Volume (Cr)</th>
                    <th>Value (₹ Cr)</th>
                    <th>Avg ticket (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {channelRows.map((c) => (
                    <tr key={c.key}>
                      <td className="name">{c.label}</td>
                      <td>{c.vol.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td>
                      <td>{c.val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                      <td>{isFinite(c.ticket) ? `₹${c.ticket.toFixed(0)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <Footer
        sources={[{ href: 'https://rbi.org.in/Scripts/Statistics.aspx', label: 'RBI — Bank-wise ATM/POS/Card Statistics' }]}
        disclaimer="From RBI's Bank-wise ATM/POS/Card Statistics — separate from NPCI's UPI data. Cards/ATMs/PoS are month-end stock counts, not flows. Provisional, subject to revision."
      />
    </div>
  )
}
