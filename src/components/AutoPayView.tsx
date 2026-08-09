import { useState } from 'react'
import { Bar } from 'react-chartjs-2'
import { AlertTriangle, Gauge, Landmark, Repeat, ShieldAlert, ShieldCheck, TrendingDown, Wallet, Zap } from 'lucide-react'
import { useAutoPayExecutions, useAutoPayExecutionsByPsp, useAutoPayRegistrations, useAutoPayRegistrationsByBank } from '../lib/queries'
import { useDashboard } from '../lib/DashboardContext'
import { Footer } from './Footer'
import { downloadCSV } from '../lib/csv'
import { CsvButton } from './CsvButton'
import { crNum, fullLabel, mnToCr } from '../lib/format'
import { chartGridColor } from '../lib/chartTheme'
import { useCountUp } from '../lib/useCountUp'

// NPCI Circular OC-151 / OC-151A (AFA limit enhancement for UPI AutoPay): the
// default no-PIN execution limit is Rs 15,000 for every category; these 8 MCCs
// are the only ones RBI/NPCI permit to run without a UPI PIN up to Rs 1,00,000.
// Above Rs 1,00,000 (any category), every execution needs manual PIN entry -
// the initial mandate setup always needs PIN regardless of amount either way.
const AUTOPAY_MCC_LIMITS = [
  { mcc: '5413', category: 'Credit card bill payments' },
  { mcc: '5960', category: 'Direct marketing — insurance services' },
  { mcc: '6012', category: 'Financial institutions — merchandise & services' },
  { mcc: '6211', category: 'Securities brokers & dealers' },
  { mcc: '6300', category: 'Insurance sales, underwriting & premiums' },
  { mcc: '6381', category: 'Insurance premiums' },
  { mcc: '6399', category: 'Insurance (not elsewhere classified)' },
  { mcc: '6529', category: 'LIC (Life Insurance Corporation)' },
]

export function AutoPayView() {
  const { theme } = useDashboard()
  const [mode, setMode] = useState<'registration' | 'execution'>('registration')

  const registrations = useAutoPayRegistrations()
  const executions = useAutoPayExecutions()
  const registrationsByBank = useAutoPayRegistrationsByBank()
  const executionsByPsp = useAutoPayExecutionsByPsp()

  // Pre-load-safe fallbacks so the KPI number derivations below (and the useCountUp
  // calls that depend on them) can run unconditionally, before the loading/error
  // early-return - React requires every hook to run in the same order on every
  // render, and useCountUp is a hook, so it can't sit after a conditional return.
  const regRows = registrations.data?.rows ?? []
  const execRows = executions.data?.rows ?? []

  const totalRegCr = regRows.reduce((s, r) => s + r.registrations_mn, 0) / 10
  const totalExecCr = execRows.reduce((s, r) => s + r.executions_mn, 0) / 10

  // Approved/BD/TD % straight from AutoPay's own Executions table (bank-level, weighted
  // by that bank's execution volume) - replaces an earlier approximation borrowed from
  // the general UPI PSP Member Performance table, which wasn't AutoPay-specific at all.
  // Rows missing a given % (not yet backfilled for older months) are excluded from that
  // rate's average rather than treated as 0, so one gap doesn't drag the whole rate down.
  const weightedExec = (key: 'approved_pct' | 'bd_pct' | 'td_pct') => {
    const rows = execRows.filter((r) => r[key] != null)
    const vol = rows.reduce((s, r) => s + r.executions_mn, 0)
    if (!vol) return null
    return rows.reduce((s, r) => s + r.executions_mn * r[key]!, 0) / vol
  }
  const bdRateRaw = weightedExec('bd_pct')
  const tdRateRaw = weightedExec('td_pct')

  // Total Volume = every attempt NPCI logged; Final Volume = the subset that actually
  // went through (Total Volume x Approved %). Approved % can be null for months
  // fetched before this field was captured - final volume falls back to null (shows
  // as a gap in the chart / blank in the CSV) rather than silently pretending 0.
  const finalCr = (volumeMn: number, approvedPct: number | null) =>
    approvedPct == null ? null : mnToCr((volumeMn * approvedPct) / 100)!

  const regByPspFinal = regRows.map((r) => finalCr(r.registrations_mn, r.approved_pct))
  const execByBankFinalAll = execRows.map((r) => finalCr(r.executions_mn, r.approved_pct))

  // Same Total-vs-Final split as the bar charts, rolled up into one headline pair per
  // KPI tile - null (not 0) if any entity is missing Approved % that month, so an
  // incomplete sum never gets presented as a real approved total. KPI tiles use the
  // by-PSP tables' full totals (not the by-bank tables), matching what the hero
  // figures always represented before this breakdown existed.
  const totalRegFinalCrRaw = regByPspFinal.some((v) => v == null) ? null : regByPspFinal.reduce<number>((s, v) => s + (v ?? 0), 0)
  const totalExecFinalCrRaw = execByBankFinalAll.some((v) => v == null) ? null : execByBankFinalAll.reduce<number>((s, v) => s + (v ?? 0), 0)

  const totalRegFinalCr = useCountUp(totalRegFinalCrRaw)
  const totalExecFinalCr = useCountUp(totalExecFinalCrRaw)
  const bdRate = useCountUp(bdRateRaw)
  const tdRate = useCountUp(tdRateRaw)

  if (registrations.isPending || executions.isPending || registrationsByBank.isPending || executionsByPsp.isPending) {
    return <p className="section-note">Loading…</p>
  }
  const err = registrations.error || executions.error || registrationsByBank.error || executionsByPsp.error
  if (err) return <p className="section-note">Failed to load: {err.message}</p>

  const regApprovalPct = totalRegFinalCrRaw != null && totalRegCr ? (totalRegFinalCrRaw / totalRegCr) * 100 : null
  const execApprovalPct = totalExecFinalCrRaw != null && totalExecCr ? (totalExecFinalCrRaw / totalExecCr) * 100 : null

  // "By PSP" and "by remitter bank" for Registrations, and the mirror pair for
  // Executions - NPCI's Ecosystem Statistics page has all 4 as separate tabs, so
  // these are 4 independently-fetched tables, not one dataset sliced two ways.
  // PSP counts are small (~13-19) so every PSP gets a bar; remitter bank counts run
  // up to 50, so those charts cap at the top 10 like Geography's district table does.
  const regByPspLabels = registrations.data.rows.map((r) => r.psp)
  const regByPspTotal = registrations.data.rows.map((r) => mnToCr(r.registrations_mn)!)

  const regByBankLabels = registrationsByBank.data.rows.slice(0, 10).map((r) => r.remitter_bank)
  const regByBankTotal = registrationsByBank.data.rows.slice(0, 10).map((r) => mnToCr(r.registrations_mn)!)
  const regByBankFinal = registrationsByBank.data.rows.slice(0, 10).map((r) => finalCr(r.registrations_mn, r.approved_pct))

  const execByBankLabels = executions.data.rows.slice(0, 10).map((r) => r.bank)
  const execByBankTotal = executions.data.rows.slice(0, 10).map((r) => mnToCr(r.executions_mn)!)
  const execByBankFinal = executions.data.rows.slice(0, 10).map((r) => finalCr(r.executions_mn, r.approved_pct))

  const execByPspLabels = executionsByPsp.data.rows.map((r) => r.psp)
  const execByPspTotal = executionsByPsp.data.rows.map((r) => mnToCr(r.executions_mn)!)
  const execByPspFinal = executionsByPsp.data.rows.map((r) => finalCr(r.executions_mn, r.approved_pct))

  const isReg = mode === 'registration'
  const modeLabel = isReg ? 'Registrations' : 'Executions'
  const modeMonth = fullLabel(isReg ? registrations.data.month : executions.data.month)
  const modeColor = isReg ? '#3FC1A8' : '#F5A524'
  const modeColorFaint = isReg ? 'rgba(63,193,168,0.35)' : 'rgba(245,165,36,0.35)'
  const pspLabels = isReg ? regByPspLabels : execByPspLabels
  const pspTotal = isReg ? regByPspTotal : execByPspTotal
  const pspFinal = isReg ? regByPspFinal : execByPspFinal
  const pspApprovedPcts = (isReg ? registrations.data.rows : executionsByPsp.data.rows).map((r) => r.approved_pct)
  const bankLabels = isReg ? regByBankLabels : execByBankLabels
  const bankTotal = isReg ? regByBankTotal : execByBankTotal
  const bankFinal = isReg ? regByBankFinal : execByBankFinal
  const bankApprovedPcts = (isReg ? registrationsByBank.data.rows.slice(0, 10) : executions.data.rows.slice(0, 10)).map((r) => r.approved_pct)

  const barOptions = (horizontal: boolean) => ({
    indexAxis: horizontal ? ('y' as const) : ('x' as const),
    responsive: true,
    maintainAspectRatio: false,
    scales: horizontal
      ? { x: { grid: { color: chartGridColor(theme) }, title: { display: true, text: 'Crore', font: { size: 11 } } }, y: { grid: { display: false } } }
      : { x: { grid: { display: false } }, y: { grid: { color: chartGridColor(theme) }, title: { display: true, text: 'Crore', font: { size: 11 } } } },
    plugins: {
      legend: { display: true, position: 'top' as const, labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (c: { dataset: { label?: string }; raw: unknown }) => `${c.dataset.label}: ${c.raw == null ? '—' : Number(c.raw).toFixed(2) + ' Cr'}` } },
    },
  })

  return (
    <div>
      <div className="kpi-strip four">
        <div className="kpi">
          <p className="kpi-label">
            <Repeat size={13} />
            Registrations, {fullLabel(registrations.data.month)}
          </p>
          <p className="kpi-value" style={{ color: 'var(--green)' }}>
            {totalRegFinalCr == null ? '—' : `${crNum(totalRegFinalCr)} Cr`}
            {totalRegFinalCr != null && <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 6 }}>~{regApprovalPct!.toFixed(1)}%</span>}
          </p>
          <p className="kpi-sub">
            {totalRegFinalCr == null && 'Approval % not yet available · '}
            {crNum(totalRegCr)} Cr attempted · {registrations.data.rows.length} PSPs
          </p>
        </div>
        <div className="kpi">
          <p className="kpi-label">
            <Zap size={13} />
            Executions, {fullLabel(executions.data.month)}
          </p>
          <p className="kpi-value" style={{ color: 'var(--green)' }}>
            {totalExecFinalCr == null ? '—' : `${crNum(totalExecFinalCr)} Cr`}
            {totalExecFinalCr != null && <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 6 }}>~{execApprovalPct!.toFixed(1)}%</span>}
          </p>
          <p className="kpi-sub">
            {totalExecFinalCr == null && 'Approval % not yet available · '}
            {crNum(totalExecCr)} Cr attempted · {executions.data.rows.length} banks
          </p>
        </div>
        <div className="kpi">
          <p className="kpi-label">
            <TrendingDown size={13} />
            Weighted business decline
          </p>
          <p className="kpi-value">{bdRate == null ? '—' : `~${bdRate.toFixed(1)}%`}</p>
          <p className="kpi-sub">insufficient balance & similar</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">
            <AlertTriangle size={13} />
            Weighted technical decline
          </p>
          <p className="kpi-value">{tdRate == null ? '—' : `~${tdRate.toFixed(1)}%`}</p>
          <p className="kpi-sub">bank/NPCI system issues</p>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <p className="section-title">{modeLabel}</p>
          <div className="section-actions">
            <p className="section-note">{modeMonth} · Total vs Final (approved)</p>
            <div className="toggle" role="tablist">
              <button className={`toggle-btn ${isReg ? 'active' : ''}`} role="tab" aria-selected={isReg} onClick={() => setMode('registration')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Repeat size={13} />
                Registration
              </button>
              <button className={`toggle-btn ${!isReg ? 'active' : ''}`} role="tab" aria-selected={!isReg} onClick={() => setMode('execution')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Zap size={13} />
                Execution
              </button>
            </div>
          </div>
        </div>
        <div className="row-2">
          <div className="card">
            <div className="section-head">
              <p className="section-title">
                <Wallet size={16} />
                By PSP
              </p>
              <CsvButton
                label="CSV"
                onClick={() =>
                  downloadCSV(`upi-pulse-autopay-${mode}-by-psp.csv`, [
                    ['PSP', 'Total Volume (Cr)', 'Final Volume (Cr)', 'Approved %'],
                    ...pspLabels.map((l, i) => [l, pspTotal[i], pspFinal[i] ?? '', pspApprovedPcts[i] ?? '']),
                  ])
                }
              />
            </div>
            <div style={{ position: 'relative', height: 260 }}>
              <Bar
                data={{
                  labels: pspLabels,
                  datasets: [
                    { label: 'Total Volume (Cr)', data: pspTotal, backgroundColor: modeColorFaint, borderRadius: 4 },
                    { label: 'Final Volume (Cr)', data: pspFinal, backgroundColor: modeColor, borderRadius: 4 },
                  ],
                }}
                options={barOptions(false)}
              />
            </div>
          </div>
          <div className="card">
            <div className="section-head">
              <p className="section-title">
                <Landmark size={16} />
                By remitter bank
              </p>
              <CsvButton
                label="CSV"
                onClick={() =>
                  downloadCSV(`upi-pulse-autopay-${mode}-by-bank.csv`, [
                    ['Bank', 'Total Volume (Cr)', 'Final Volume (Cr)', 'Approved %'],
                    ...bankLabels.map((l, i) => [l, bankTotal[i], bankFinal[i] ?? '', bankApprovedPcts[i] ?? '']),
                  ])
                }
              />
            </div>
            <div style={{ position: 'relative', height: 260 }}>
              <Bar
                data={{
                  labels: bankLabels,
                  datasets: [
                    { label: 'Total Volume (Cr)', data: bankTotal, backgroundColor: modeColorFaint, borderRadius: 4 },
                    { label: 'Final Volume (Cr)', data: bankFinal, backgroundColor: modeColor, borderRadius: 4 },
                  ],
                }}
                options={barOptions(true)}
              />
            </div>
          </div>
        </div>
        <p className="section-note" style={{ marginTop: 10 }}>
          Top 10 of {isReg ? registrationsByBank.data.rows.length : executions.data.rows.length} banks shown.
        </p>
      </div>

      <div className="section">
        <div className="card">
          <div className="section-head">
            <p className="section-title">
              <Gauge size={16} />
              AutoPay limits — MCC & category-wise
            </p>
            <p className="section-note">NPCI Circular OC-151 / OC-151A</p>
          </div>
          <div className="row-2" style={{ marginBottom: 18 }}>
            <div style={{ padding: '14px 16px', background: 'var(--surface2)', borderRadius: 12, border: '1px solid var(--border)' }}>
              <p className="kpi-label" style={{ marginBottom: 6 }}>
                <ShieldCheck size={13} />
                Standard limit
              </p>
              <p className="kpi-value" style={{ fontSize: 20 }}>
                ₹15,000
              </p>
              <p className="kpi-sub">Default for every category not listed below. No PIN needed per execution.</p>
            </div>
            <div style={{ padding: '14px 16px', background: 'var(--surface2)', borderRadius: 12, border: '1px solid var(--border)' }}>
              <p className="kpi-label" style={{ marginBottom: 6 }}>
                <ShieldAlert size={13} />
                Enhanced limit
              </p>
              <p className="kpi-value" style={{ fontSize: 20 }}>
                ₹1,00,000
              </p>
              <p className="kpi-sub">Only for the 8 MCCs below. Above this, PIN entry is required each time.</p>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>MCC</th>
                  <th>Category</th>
                  <th>Limit</th>
                </tr>
              </thead>
              <tbody>
                {AUTOPAY_MCC_LIMITS.map((l) => (
                  <tr key={l.mcc}>
                    <td>{l.mcc}</td>
                    <td className="name">{l.category}</td>
                    <td>₹1,00,000</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="section-note" style={{ marginTop: 14 }}>
            Mandate setup always requires PIN. Source: NPCI/RBI, not derived from the volume data above.
          </p>
        </div>
      </div>

      <Footer
        sources={[{ href: 'https://www.npci.org.in/product/ecosystem-statistics/autopay', label: 'NPCI — AutoPay Ecosystem Statistics' }]}
        disclaimer="Sourced from NPCI's AutoPay Ecosystem Statistics. Registrations and Executions may lag by a month. Final Volume = Total Volume × Approved %."
      />
    </div>
  )
}
