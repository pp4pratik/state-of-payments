import { useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { useCirculars } from '../lib/queries'
import { Footer } from './Footer'
import { downloadCSV } from '../lib/csv'
import { CsvButton } from './CsvButton'

export function CircularsView() {
  const circulars = useCirculars()
  const [search, setSearch] = useState('')

  if (circulars.isPending) return <p className="section-note">Loading…</p>
  if (circulars.error) return <p className="section-note">Failed to load: {circulars.error.message}</p>

  const filtered = circulars.data.filter((c) => {
    if (!search) return true
    const t = `${c.ref} ${c.title}`.toLowerCase()
    return t.includes(search.toLowerCase())
  })

  return (
    <div>
      <div className="section">
        <div className="section-head">
          <p className="section-title">Circulars &amp; notifications</p>
          <div className="section-actions">
            <p className="section-note">NPCI · UPI, newest first</p>
            <CsvButton
              onClick={() =>
                downloadCSV(
                  'upi-pulse-circulars.csv',
                  [['Reference', 'FY', 'Title', 'PDF URL'], ...circulars.data.map((c) => [c.ref, c.fy, c.title, c.pdf_url ?? ''])],
                )
              }
            />
          </div>
        </div>
        <div className="card">
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="circular-search"
              style={{ paddingLeft: 32 }}
              placeholder="Search circulars by keyword or OC number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="circular-list">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>FY</th>
                  <th>Title</th>
                  <th>PDF</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="name">
                      No matches.
                    </td>
                  </tr>
                )}
                {filtered.map((c) => (
                  <tr key={`${c.fy}-${c.ref}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.ref}</td>
                    <td>
                      <span className="fy-badge">FY {c.fy}</span>
                    </td>
                    <td className="name">{c.title}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.pdf_url ? (
                        <a
                          href={c.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--teal)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          View PDF <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="section-note" style={{ marginTop: 14 }}>
            {circulars.data.length} circulars synced. Earlier ones on{' '}
            <a href="https://www.npci.org.in/circulars/upi" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)' }}>
              NPCI's site
            </a>
            .
          </p>
        </div>
      </div>

      <Footer
        sources={[{ href: 'https://www.npci.org.in/circulars/upi', label: 'NPCI — UPI Circulars & Notifications' }]}
        disclaimer="Operating circulars issued by NPCI for UPI."
      />
    </div>
  )
}
