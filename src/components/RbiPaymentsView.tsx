import { Line } from 'react-chartjs-2'
import { useDashboard } from '../lib/DashboardContext'
import { useRbiPaymentsAll } from '../lib/queries'
import { SectionHead } from './SectionHead'
import { SplitBar } from './SplitBar'
import { Footer } from './Footer'
import { downloadCSV } from '../lib/csv'
import { CsvButton } from './CsvButton'
import { fullLabel, lakhToCr, shortLabel } from '../lib/format'
import { chartGridColor } from '../lib/chartTheme'
import { RbiPaymentsFlatTable, type FlatMetaEntry } from './RbiPaymentsFlatTable'

const RAILS = [
  ['rtgs_total', 'RTGS', '#F5A524'],
  ['neft', 'NEFT', '#3FC1A8'],
  ['imps', 'IMPS', '#5B8DEF'],
  ['nach_credit', 'NACH Credit', '#E8654F'],
  ['upi', 'UPI', '#9A7FD1'],
] as const

const SETTLEMENT_META: FlatMetaEntry[] = [
  ['ccil_total', 'CCIL Operated Systems', 0],
  ['ccil_govt_securities', 'Govt Securities Clearing', 1],
  ['ccil_govt_outright', 'Outright', 2],
  ['ccil_govt_repo', 'Repo', 2],
  ['ccil_govt_tri_party_repo', 'Tri-party Repo', 2],
  ['ccil_forex', 'Forex Clearing', 1],
  ['ccil_rupee_derivatives', 'Rupee Derivatives', 1],
  ['rtgs_total', 'RTGS (Credit Transfers)', 0],
  ['rtgs_customer', 'Customer Transactions', 1],
  ['rtgs_interbank', 'Interbank Transactions', 1],
  ['retail_credit_transfers', 'Retail Credit Transfers', 0],
  ['aeps_fund_transfers', 'AePS (Fund Transfers)', 1],
  ['apbs', 'APBS', 1],
  ['imps', 'IMPS', 1],
  ['nach_credit', 'NACH Credit', 1],
  ['neft', 'NEFT', 1],
  ['upi', 'UPI', 1],
  ['debit_transfers', 'Debit Transfers & Direct Debits', 0],
  ['bhim_aadhaar_pay', 'BHIM Aadhaar Pay', 1],
  ['nach_debit', 'NACH Debit', 1],
  ['netc_linked_account', 'NETC (linked to bank account)', 1],
  ['card_payments', 'Card Payments', 0],
  ['credit_cards', 'Credit Cards', 1],
  ['credit_cards_pos', 'PoS based', 2],
  ['credit_cards_other', 'Other (incl. online)', 2],
  ['debit_cards', 'Debit Cards', 1],
  ['debit_cards_pos', 'PoS based', 2],
  ['debit_cards_other', 'Other (incl. online)', 2],
  ['ppi_total', 'Prepaid Payment Instruments', 0],
  ['ppi_wallets', 'Wallets', 1],
  ['ppi_cards', 'Cards', 1],
  ['ppi_cards_pos', 'PoS based', 2],
  ['ppi_cards_other', 'Other (incl. online)', 2],
  ['paper_instruments', 'Paper-based Instruments', 0],
  ['paper_cts', 'CTS (NPCI managed)', 1],
  ['total_retail_payments', 'Total Retail Payments', 0, true, 'Retail Credit Transfers + Debit Transfers + Card Payments + PPI + Paper'],
  ['total_payments', 'Total Payments', 0, true, 'RTGS + Retail Credit Transfers + Debit Transfers + Card Payments + PPI + Paper'],
  ['total_digital_payments', 'Total Digital Payments', 0, true, 'RTGS + Retail Credit Transfers + Debit Transfers + Card Payments + PPI (everything except Paper)'],
]

const CHANNELS_META: FlatMetaEntry[] = [
  ['mobile_payments', 'Mobile Payments (app-based)', 0],
  ['mobile_intrabank', 'Intra-bank', 1],
  ['mobile_interbank', 'Inter-bank', 1],
  ['internet_payments', 'Internet Payments (Netbanking)', 0],
  ['internet_intrabank', 'Intra-bank', 1],
  ['internet_interbank', 'Inter-bank', 1],
  ['atm_cash_withdrawal', 'Cash Withdrawal at ATMs', 0],
  ['atm_withdrawal_credit_card', 'Using Credit Cards', 1],
  ['atm_withdrawal_debit_card', 'Using Debit Cards', 1],
  ['atm_withdrawal_prepaid_card', 'Using Prepaid Cards', 1],
  ['pos_cash_withdrawal', 'Cash Withdrawal at PoS', 0],
  ['pos_withdrawal_debit_card', 'Using Debit Cards', 1],
  ['pos_withdrawal_prepaid_card', 'Using Prepaid Cards', 1],
  ['micro_atm_withdrawal', 'Cash Withdrawal at Micro ATMs', 0],
  ['micro_atm_aeps', 'AePS', 1],
]

const INFRA_META: [key: string, label: string, depth: 0 | 1][] = [
  ['cards_total_count', 'Number of Cards', 0],
  ['credit_cards_count', 'Credit Cards', 1],
  ['debit_cards_count', 'Debit Cards', 1],
  ['ppi_total_count', 'Number of PPIs', 0],
  ['ppi_wallets_count', 'Wallets', 1],
  ['ppi_cards_count', 'Cards', 1],
  ['atms_and_crms_count', 'ATMs & CRMs', 0],
  ['bank_owned_atms_count', 'Bank-owned ATMs & CRMs', 1],
  ['white_label_atms_count', 'White Label ATMs', 1],
  ['micro_atms_count', 'Micro ATMs', 0],
  ['pos_terminals_count', 'PoS Terminals', 0],
  ['bharat_qr_count', 'Bharat QR', 0],
  ['upi_qr_count', 'UPI QR', 0],
]

export function RbiPaymentsView() {
  const { metric, selectedMonth, theme } = useDashboard()
  const rbiPayments = useRbiPaymentsAll()

  if (rbiPayments.isPending) return <p className="section-note">Loading…</p>
  if (rbiPayments.error) return <p className="section-note">Failed to load: {rbiPayments.error.message}</p>

  const rows = rbiPayments.data as unknown as Record<string, number | string>[]
  const row = (rows.find((r) => r.month === selectedMonth) ?? rows[rows.length - 1]) as Record<string, number> | undefined
  if (!row) return null

  const months = rows.map((r) => r.month as string)
  const fmtCr = (v: number | null) => (v == null ? '—' : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`)

  const digitalShare = row.total_payments_value ? (row.total_digital_payments_value / row.total_payments_value) * 100 : null

  const railSeries = RAILS.map(([key, label, color]) => ({
    label,
    color,
    data: rows.map((r) => {
      const rr = r as unknown as Record<string, number>
      const v = metric === 'volume' ? lakhToCr(rr[`${key}_volume`]) : rr[`${key}_value`]
      return v ?? null
    }),
  }))

  const splitData = RAILS.map(([key]) => {
    const v = metric === 'volume' ? lakhToCr(row[`${key}_volume`]) : row[`${key}_value`]
    return v ?? 0
  })
  const splitTotal = splitData.reduce((a, b) => a + b, 0)

  return (
    <div>
      <div className="kpi-strip four">
        <div className="kpi">
          <p className="kpi-label">Total payments</p>
          <p className="kpi-value">{fmtCr(row.total_payments_value ?? null)}</p>
          <p className="kpi-sub">value, all systems</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Digital payments</p>
          <p className="kpi-value">{digitalShare == null ? '—' : `${digitalShare.toFixed(1)}%`}</p>
          <p className="kpi-sub">share of total value</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">UPI</p>
          <p className="kpi-value">{fmtCr(row.upi_value ?? null)}</p>
          <p className="kpi-sub">value</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">RTGS</p>
          <p className="kpi-value">{fmtCr(row.rtgs_total_value ?? null)}</p>
          <p className="kpi-sub">value</p>
        </div>
      </div>

      <div className="section">
        <SectionHead
          title="Payment rails — monthly trend"
          note={`${shortLabel(months[0])} – ${shortLabel(months[months.length - 1])}`}
          onCsv={() =>
            downloadCSV('upi-pulse-rbiPaymentsRails.csv', [
              ['Month', ...RAILS.map((r) => `${r[1]} (Cr)`)],
              ...months.map((m, i) => [shortLabel(m), ...railSeries.map((s) => s.data[i] ?? '')]),
            ])
          }
        />
        <div className="row-2">
          <div className="card">
            <div style={{ position: 'relative', height: 260 }}>
              <Line
                data={{
                  labels: months.map(shortLabel),
                  datasets: railSeries.map((s) => ({
                    label: s.label,
                    data: s.data,
                    borderColor: s.color,
                    backgroundColor: s.color,
                    pointRadius: 2,
                    borderWidth: 2,
                    tension: 0.3,
                    spanGaps: true,
                  })),
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: 'index', intersect: false },
                  scales: {
                    x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 9, font: { size: 10 } } },
                    y: { title: { display: true, text: metric === 'volume' ? 'Volume (Cr)' : 'Value (₹ Cr)', font: { size: 11 } }, grid: { color: chartGridColor(theme) } },
                  },
                  plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
                }}
              />
            </div>
          </div>
          <div className="card">
            <p className="section-note" style={{ textAlign: 'center', margin: '0 0 10px' }}>
              {fullLabel(String(row.month))} · {metric === 'volume' ? 'by volume' : 'by value'}
            </p>
            <SplitBar
              height={10}
              segments={RAILS.map(([, label, color], i) => ({
                label,
                color,
                pct: splitTotal ? +((splitData[i] / splitTotal) * 100).toFixed(1) : 0,
              }))}
            />
            <div className="legend" style={{ justifyContent: 'center', marginTop: 12 }}>
              {RAILS.map(([, label, color], i) => (
                <span key={label}>
                  <i style={{ background: color }} />
                  {label} {splitTotal ? ((splitData[i] / splitTotal) * 100).toFixed(1) : '0.0'}%
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <p className="section-title">Settlement systems &amp; payment rails</p>
          <p className="section-note">{fullLabel(String(row.month))}</p>
        </div>
        <div className="card">
          <RbiPaymentsFlatTable meta={SETTLEMENT_META} row={row} csvName="upi-pulse-rbiPaymentsSettlement.csv" />
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <p className="section-title">Payment channels</p>
          <p className="section-note">{fullLabel(String(row.month))}</p>
        </div>
        <div className="card">
          <RbiPaymentsFlatTable meta={CHANNELS_META} row={row} csvName="upi-pulse-rbiPaymentsChannels.csv" />
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <p className="section-title">Payment infrastructure</p>
          <p className="section-note">{fullLabel(String(row.month))}</p>
        </div>
        <div className="card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Count (Cr)</th>
                </tr>
              </thead>
              <tbody>
                {INFRA_META.map(([key, label, depth]) => (
                  <tr key={key}>
                    <td className="name" style={depth === 1 ? { paddingLeft: 18, color: 'var(--text-secondary)' } : { fontWeight: 600 }}>
                      {label}
                    </td>
                    <td>{lakhToCr(row[key])?.toLocaleString('en-IN', { maximumFractionDigits: 4 }) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 10 }}>
              <CsvButton
                label="CSV"
                onClick={() => downloadCSV('upi-pulse-rbiPaymentsInfra.csv', [['Metric', 'Count (Cr)'], ...INFRA_META.map(([key, label]) => [label, lakhToCr(row[key]) ?? ''])])}
              />
            </div>
          </div>
        </div>
      </div>

      <Footer
        sources={[{ href: 'https://rbi.org.in/Scripts/Statistics.aspx', label: 'RBI — Payment System Indicators' }]}
        disclaimer="From RBI's Payment System Indicators — a separate release from the UPI and RBI Cards views, so overlapping figures may not match exactly. Provisional, subject to revision."
      />
    </div>
  )
}
