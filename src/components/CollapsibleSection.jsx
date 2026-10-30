import { useId, useState } from 'react'

export default function CollapsibleSection({ title, summary, defaultCollapsed = true, collapsed: controlledCollapsed, onCollapsedChange, className = '', children }) {
  const [localCollapsed, setCollapsed] = useState(defaultCollapsed)
  const collapsed = controlledCollapsed ?? localCollapsed
  const bodyId = useId()

  function toggle() {
    setCollapsed(!collapsed)
    onCollapsedChange?.(!collapsed)
  }

  return (
    <div className={className}>
      <button className="panel-header" type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls={bodyId}>
        <span className="panel-header-title">
          {title}
          {summary && <span className="panel-header-summary"> · {summary}</span>}
        </span>
        <span className="panel-chevron" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </button>
      <div id={bodyId} className="panel-body" hidden={collapsed}>{children}</div>
    </div>
  )
}
