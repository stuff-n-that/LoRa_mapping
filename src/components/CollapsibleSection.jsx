import { useState } from 'react'

export default function CollapsibleSection({ title, summary, defaultCollapsed = true, className = '', children }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <div className={className}>
      <button className="panel-header" type="button" onClick={() => setCollapsed((c) => !c)}>
        <span className="panel-header-title">
          {title}
          {summary && <span className="panel-header-summary"> · {summary}</span>}
        </span>
        <span className="panel-chevron">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && <div className="panel-body">{children}</div>}
    </div>
  )
}
