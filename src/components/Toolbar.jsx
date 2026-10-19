export default function Toolbar({ nodeCount, selectedRegionCount, plannerHref, menuOpen, onToggleMenu }) {
  return (
    <div className="toolbar">
      <div className="toolbar-title">
        <span>LoRa Mesh Map</span>
        <span className="toolbar-count">
          {nodeCount} nodes
          {selectedRegionCount > 0 && ` · ${selectedRegionCount} region${selectedRegionCount === 1 ? '' : 's'} selected`}
        </span>
        {/* The coverage planner is a separate app published next to this one. */}
        {plannerHref && (
          <a className="toolbar-link" href={plannerHref}>
            Plan coverage
          </a>
        )}
        {/* Hidden above the mobile breakpoint (see App.css) — on desktop
            the panel stack below is always visible, so there's nothing
            for this button to do there. */}
        <button
          type="button"
          className="burger-btn"
          onClick={onToggleMenu}
          aria-label={menuOpen ? 'Hide map controls' : 'Show map controls'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>
    </div>
  )
}
