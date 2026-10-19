// Turning a plan's settings into a link analysis request: the two ends, each direction's budget,
// and whether the two radios can talk at all.

import type { LatLng } from './engine/geo'
import type { Direction, PathRadio } from './engine/link'
import {
  effectiveFreqMhz,
  effectiveRadio,
  effectiveSensitivityDbm,
  linkBudget,
  pathRadio,
  terrainCellM,
  type PlannedNode,
  type Settings,
} from './settings'

export interface LinkEndpoint {
  name: string
  position: LatLng
  /** Antenna height above ground, metres. */
  heightM: number
}

export interface LinkPlan {
  a: LinkEndpoint
  b: LinkEndpoint
  /** True when the far end is one of the plan's nodes (so the link runs both ways). */
  bIsNode: boolean
  radio: PathRadio
  directions: Direction[]
  /** Set when the two nodes use different radio settings and so cannot hear each other. */
  mismatch: string | null
  /** Terrain sample spacing, metres. */
  cellM: number
}

/** Why there is no link to analyse yet, for the panel to say. */
export type LinkWaiting = 'pick-target' | 'missing-node' | 'same-node'

export type LinkPlanResult = { ok: true; plan: LinkPlan } | { ok: false; reason: LinkWaiting }

const radioText = (n: PlannedNode) => {
  const { sf, bwKhz } = effectiveRadio(n)
  return `${n.name}: SF${sf}, ${bwKhz} kHz, ${effectiveFreqMhz(n)} MHz`
}

/** null if the two nodes can hear each other; otherwise a sentence about how they differ. */
export function radioMismatch(a: PlannedNode, b: PlannedNode): string | null {
  const ra = effectiveRadio(a)
  const rb = effectiveRadio(b)
  const same = ra.sf === rb.sf && ra.bwKhz === rb.bwKhz && Math.abs(effectiveFreqMhz(a) - effectiveFreqMhz(b)) <= 0.1
  return same ? null : `${radioText(a)} vs ${radioText(b)}`
}

export function buildLinkPlan(s: Settings): LinkPlanResult {
  const link = s.link
  if (!link) return { ok: false, reason: 'missing-node' }
  const a = s.nodes.find((n) => n.id === link.from)
  if (!a) return { ok: false, reason: 'missing-node' }
  const radio = pathRadio(s, effectiveFreqMhz(a))
  const cellM = terrainCellM(s.detail)
  const from: LinkEndpoint = { name: a.name, position: a.position, heightM: a.hTxM }

  if (link.to.kind === 'point') {
    if (!link.to.position) return { ok: false, reason: 'pick-target' }
    return {
      ok: true,
      plan: {
        a: from,
        b: { name: 'Target', position: link.to.position, heightM: s.hRxM },
        bIsNode: false,
        radio,
        // the target uses the shared "receiving device" settings, and the same network settings as the node
        directions: [{ label: `${a.name} to target`, budget: linkBudget(a, s), sensitivityDbm: effectiveSensitivityDbm(a, s) }],
        mismatch: null,
        cellM,
      },
    }
  }

  const toId = link.to.id
  const b = s.nodes.find((n) => n.id === toId)
  if (!b) return { ok: false, reason: 'missing-node' }
  if (b.id === a.id) return { ok: false, reason: 'same-node' }
  const oneWay = (tx: PlannedNode, rx: PlannedNode): Direction => ({
    label: `${tx.name} to ${rx.name}`,
    budget: {
      txPowerDbm: tx.txPowerDbm,
      txGainDbi: tx.txGainDbi,
      txCableLossDb: tx.txCableLossDb,
      rxGainDbi: rx.txGainDbi,
      rxCableLossDb: rx.txCableLossDb,
      extraLossDb: s.extraLossDb,
    },
    sensitivityDbm: effectiveSensitivityDbm(rx, s),
  })
  return {
    ok: true,
    plan: {
      a: from,
      b: { name: b.name, position: b.position, heightM: b.hTxM },
      bIsNode: true,
      radio,
      directions: [oneWay(a, b), oneWay(b, a)],
      mismatch: radioMismatch(a, b),
      cellM,
    },
  }
}

/** Everything that changes the analysis (and nothing that does not), as a string to compare. */
export function linkPlanKey(plan: LinkPlan): string {
  return JSON.stringify(plan)
}
