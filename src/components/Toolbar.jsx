export default function Toolbar({ nodeCount }) {
  return (
    <div className="toolbar">
      <div className="toolbar-title">
        <span>LoRa Mesh Map</span>
        <span className="toolbar-count">{nodeCount} nodes</span>
      </div>
    </div>
  )
}
