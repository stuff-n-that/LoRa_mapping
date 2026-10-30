import { describe, expect, it } from 'vitest'
import { gridGeometry, unionGrid } from '../src/engine/coverage'
import { AzimuthalEquidistant } from '../src/engine/geo'
import {
  DEFAULTS,
  MAX_NODES,
  NODE_DEFAULTS,
  effectiveFreqMhz,
  effectiveSensitivityDbm,
  newNode,
  parseSettings,
  planKey,
  toHash,
  toJob,
  toJobs,
  type PlannedNode,
  type Settings,
} from '../src/settings'

const here = { lat: 51.5074, lng: -0.1278 }
const node = (over: Partial<PlannedNode> = {}, pos = here): PlannedNode => ({ ...newNode([], pos), ...over })
const plan = (nodes: PlannedNode[], over: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, nodes, ...over })

/** A position the given east/north metres from `here`, to the 6 decimals a link keeps (about 10 cm). */
function offset(xEast: number, yNorth: number) {
  const ll = { lat: 0, lng: 0 }
  new AzimuthalEquidistant(here).inverse(xEast, yNorth, ll)
  return { lat: Math.round(ll.lat * 1e6) / 1e6, lng: Math.round(ll.lng * 1e6) / 1e6 }
}

describe('settings <-> URL hash: one node (the original format)', () => {
  it('gives defaults for an empty hash', () => {
    expect(parseSettings('')).toEqual(DEFAULTS)
    expect(toHash(DEFAULTS)).toBe('')
  })

  it('still reads links written before there were several nodes', () => {
    const s = parseSettings('#lat=51.5&lng=-0.1&net=meshcore&rp=mc-eu&tp=27&tg=5.8&tc=1&th=15&rk=30&rel=90&r=GB,FR')
    expect(s.nodes).toHaveLength(1)
    expect(s.nodes[0]).toMatchObject({ id: 'n1', name: 'Node 1', position: { lat: 51.5, lng: -0.1 }, network: 'meshcore', presetId: 'mc-eu', txPowerDbm: 27, txGainDbi: 5.8, txCableLossDb: 1, hTxM: 15 })
    expect(s).toMatchObject({ radiusKm: 30, reliability: 90, regions: ['GB', 'FR'] })
  })

  it("reads the map's 'plan from here' link", () => {
    const s = parseSettings('#lat=54.4609&lng=-3.0886&r=GB')
    expect(s.nodes).toHaveLength(1)
    expect(s.nodes[0].position).toEqual({ lat: 54.4609, lng: -3.0886 })
    expect(s.regions).toEqual(['GB'])
  })

  it('writes one default-named node in the same flat format, and round-trips', () => {
    const s = plan([node({ txPowerDbm: 27, hTxM: 25, network: 'meshcore', presetId: 'mc-eu' })], { radiusKm: 30, reliability: 90, extraLossDb: 6, regions: ['GB'] })
    const hash = toHash(s)
    expect(hash).toContain('lat=51.5074')
    expect(hash).not.toContain('n=')
    expect(parseSettings(hash)).toEqual(s)
  })
})

describe('settings <-> URL hash: several nodes', () => {
  const second = newNode([node()], offset(5000, 3000), node({ txPowerDbm: 14 }))
  const third = newNode([node(), second], offset(-4000, 8000), second)

  it('writes repeated compact n= records', () => {
    const hash = toHash(plan([node(), { ...second, id: 'n2' }]))
    expect(hash.match(/n=/g)).toHaveLength(2)
    expect(hash).toContain('n=51.5074,-0.1278&n=')
    expect(hash).not.toContain('%2C')
  })

  it('round-trips nodes with their own radios, hardware, networks and names', () => {
    const a = node({ name: 'Hill top', txPowerDbm: 27, txGainDbi: 8, hTxM: 30 })
    const b = { ...second, id: 'n2', name: 'Barn, "north" & café', network: 'meshcore' as const, presetId: 'mc-us' }
    const c = { ...third, id: 'n3', presetId: 'custom', sf: 9, bwKhz: 125, freqMhz: 868.1 }
    const s = plan([a, b, c], { radiusKm: 10, detail: 'fine', climate: 6 })
    expect(parseSettings(toHash(s))).toEqual(s)
  })

  it('keeps a single node with a custom name (the flat format has nowhere to put it)', () => {
    const s = plan([node({ name: 'Mast' })])
    expect(toHash(s)).toContain('n=')
    expect(parseSettings(toHash(s))).toEqual(s)
  })

  it('drops unusable records and keeps the rest, numbering from the survivors', () => {
    const s = parseSettings('n=abc,1&n=10,20&n=95,0&n=30,40')
    expect(s.nodes.map((n) => [n.id, n.position.lat])).toEqual([['n1', 10], ['n2', 30]])
  })

  it('limits the number of nodes', () => {
    const many = Array.from({ length: MAX_NODES + 5 }, (_, i) => `n=${10 + i},20`).join('&')
    expect(parseSettings(many).nodes).toHaveLength(MAX_NODES)
  })

  it('ignores junk and clamps out-of-range values inside a record', () => {
    const s = parseSettings('n=10,20,wifi,nope,mars,9999,-99,-3,0,zz,17,5')
    expect(s.nodes[0]).toMatchObject({ network: 'meshtastic', presetId: 'mt-long-fast', bandId: 'us915', txPowerDbm: 36, txGainDbi: -10, txCableLossDb: 0, hTxM: 1, sf: NODE_DEFAULTS.sf, bwKhz: NODE_DEFAULTS.bwKhz })
  })

  it('only offers presets that belong to the node network', () => {
    expect(parseSettings('n=10,20,meshcore,mt-long-fast').nodes[0].presetId).toBe('mc-us')
    expect(parseSettings('n=10,20,meshtastic,mc-us').nodes[0].presetId).toBe('mt-long-fast')
  })

  it('keeps names at the same length the name box allows', () => {
    const name = 'x'.repeat(24)
    expect(parseSettings(toHash(plan([node({ name })]))).nodes[0].name).toBe(name)
  })

  it('shortens long names and survives a malformed escape', () => {
    expect(parseSettings(`n=10,20,,,,,,,,,,,${'x'.repeat(60)}`).nodes[0].name).toHaveLength(24)
    expect(parseSettings('n=10,20,,,,,,,,,,,%E0%A4%A').nodes[0].name).toBe('Node 1')
  })
})

describe('settings <-> URL hash: shared settings', () => {
  it('round-trips them and clamps junk', () => {
    const s = plan([], { rxGainDbi: 3, rxCableLossDb: 1, hRxM: 1.5, extraLossDb: 8, radiusKm: 50, detail: 'fast', reliability: 90, climate: 6, groundId: 'poor', sensitivityOverride: -120, regions: ['GB', 'FR'] })
    expect(parseSettings(toHash(s))).toEqual(s)
    const j = parseSettings('rk=7&dt=huge&r=gb,zzz,fr,1&sens=-5&xl=999&rh=-4')
    expect(j).toMatchObject({ radiusKm: DEFAULTS.radiusKm, detail: DEFAULTS.detail, regions: ['GB', 'FR'], sensitivityOverride: -60, extraLossDb: 60, hRxM: 0.5 })
  })

  it('rejects coordinates outside the map', () => {
    expect(parseSettings('lat=89&lng=0').nodes).toHaveLength(0)
    expect(parseSettings('lat=10&lng=200').nodes).toHaveLength(0)
    expect(parseSettings('lat=abc&lng=5').nodes).toHaveLength(0)
  })
})

describe('adding nodes', () => {
  it('numbers and names new nodes, reusing a freed slot', () => {
    const a = newNode([], here)
    const b = newNode([a], offset(1000, 0))
    expect([a.id, a.name, b.id, b.name]).toEqual(['n1', 'Node 1', 'n2', 'Node 2'])
    expect(newNode([b], offset(2000, 0)).id).toBe('n1') // Node 1 was removed
    expect(newNode([a, b], offset(2000, 0)).id).toBe('n3')
  })

  it('copies the radio and hardware of the template, not its position or name', () => {
    const t = node({ network: 'meshcore', presetId: 'mc-eu', txPowerDbm: 27, txGainDbi: 8, txCableLossDb: 2, hTxM: 30, name: 'Hill' })
    const n = newNode([t], offset(3000, 0), t)
    expect(n).toMatchObject({ network: 'meshcore', presetId: 'mc-eu', txPowerDbm: 27, txGainDbi: 8, txCableLossDb: 2, hTxM: 30, name: 'Node 2' })
    expect(n.position).not.toEqual(t.position)
  })
})

describe('derived values', () => {
  it('uses a preset-fixed frequency, else the band centre, else the custom value', () => {
    expect(effectiveFreqMhz(node({ network: 'meshcore', presetId: 'mc-us' }))).toBe(910.525)
    expect(effectiveFreqMhz(node({ bandId: 'eu868' }))).toBeCloseTo(869.525, 3)
    expect(effectiveFreqMhz(node({ presetId: 'custom', freqMhz: 868.1 }))).toBe(868.1)
  })

  it('derives sensitivity from each node radio unless overridden for all', () => {
    const lf = node()
    const mc = node({ network: 'meshcore', presetId: 'mc-us' })
    expect(effectiveSensitivityDbm(lf, DEFAULTS)).toBeCloseTo(-131.5, 1)
    expect(effectiveSensitivityDbm(mc, DEFAULTS)).toBeCloseTo(-127.5, 1)
    expect(effectiveSensitivityDbm(lf, { sensitivityOverride: -120 })).toBe(-120)
    expect(effectiveSensitivityDbm(mc, { sensitivityOverride: -120 })).toBe(-120)
  })
})

describe('building engine jobs', () => {
  it('a single node gets the same grid as before', () => {
    const s = plan([node()])
    const [job] = toJobs(s)
    expect(job.fMhz).toBe(915)
    expect(job.radiusM).toBe(20_000)
    const plain = gridGeometry(here, 20_000, 150)
    expect(job.grid?.n).toBe(plain.n)
    expect(job.grid?.uSize).toBeCloseTo(plain.uSize, 12)
  })

  it('gives every node the same shared grid, and each its own radio and hardware', () => {
    const a = node({ txPowerDbm: 27, hTxM: 30 })
    const b = { ...newNode([a], offset(15_000, 4_000)), network: 'meshcore' as const, presetId: 'mc-us', txPowerDbm: 14 }
    const jobs = toJobs(plan([a, b]))
    expect(jobs).toHaveLength(2)
    expect(jobs[0].grid).toEqual(jobs[1].grid)
    expect(jobs[0].grid).toEqual(unionGrid([a.position, b.position], 20_000, 150))
    expect(jobs.map((j) => [j.origin, j.hTxM, j.budget.txPowerDbm, j.fMhz])).toEqual([
      [a.position, 30, 27, 915],
      [b.position, 10, 14, 910.525],
    ])
  })

  it('applies cautious to both reliability and confidence', () => {
    const s = plan([node()])
    expect(toJob(s, s.nodes[0])).toMatchObject({ reliability: 50, confidence: 50 })
    expect(toJob({ ...s, reliability: 90 }, s.nodes[0])).toMatchObject({ reliability: 90, confidence: 90 })
  })

  it('needs a node, and refuses nodes too far apart', () => {
    expect(() => toJobs(DEFAULTS)).toThrow(/Place a node/)
    expect(() => toJobs(plan([node(), newNode([node()], offset(700_000, 0))]))).toThrow(/too far apart/)
  })

  it("a plan's key changes with the nodes and what they compute, not with how it is shown", () => {
    const a = node()
    const b = newNode([a], offset(5000, 0))
    const base = plan([a, b])
    const key = planKey(base)
    expect(key).toBeTruthy()
    expect(planKey(plan([a, b], { sensitivityOverride: -100, regions: ['GB'] }))).toBe(key)
    expect(planKey(plan([a, { ...b, name: 'Renamed' }]))).toBe(key)
    expect(planKey(plan([a, { ...b, txPowerDbm: 14 }]))).not.toBe(key)
    expect(planKey(plan([a, { ...b, position: offset(5100, 0) }]))).not.toBe(key)
    expect(planKey(plan([a]))).not.toBe(key) // removing a node
    expect(planKey(plan([a, b], { radiusKm: 30 }))).not.toBe(key)
    expect(planKey(DEFAULTS)).toBeNull()
  })
})


describe('link in the URL', () => {
  const a = node()
  const b = newNode([a], offset(5000, 0))
  const c = newNode([a, b], offset(0, 6000))
  const three = [a, { ...b, id: 'n2' }, { ...c, id: 'n3' }]

  it('writes and reads a link between two nodes', () => {
    const s = plan(three, { link: { from: 'n1', to: { kind: 'node', id: 'n3' } } })
    expect(toHash(s)).toContain('lk=1:3')
    expect(parseSettings(toHash(s)).link).toEqual({ from: 'n1', to: { kind: 'node', id: 'n3' } })
  })

  it('writes and reads a link to a point, and to a target not yet placed', () => {
    const point = offset(3000, 3000)
    const toPoint = plan(three, { link: { from: 'n2', to: { kind: 'point', position: point } } })
    expect(parseSettings(toHash(toPoint)).link).toEqual(toPoint.link)
    const unset = plan(three, { link: { from: 'n2', to: { kind: 'point', position: null } } })
    expect(toHash(unset)).toContain('lk=2:')
    expect(parseSettings(toHash(unset)).link).toEqual(unset.link)
  })

  it('keeps the target height of a point, placed or not, and clamps a wild one', () => {
    const placed = plan(three, { link: { from: 'n2', to: { kind: 'point', position: offset(3000, 3000), heightM: 7.5 } } })
    expect(toHash(placed)).toMatch(/lk=2:[-\d.]+,[-\d.]+:7\.5/)
    expect(parseSettings(toHash(placed)).link).toEqual(placed.link)
    const unset = plan(three, { link: { from: 'n2', to: { kind: 'point', position: null, heightM: 4 } } })
    expect(toHash(unset)).toContain('lk=2::4')
    expect(parseSettings(toHash(unset)).link).toEqual(unset.link)
    expect(parseSettings('n=10,20&n=11,21&lk=1::900').link).toEqual({ from: 'n1', to: { kind: 'point', position: null, heightM: 100 } })
    expect(parseSettings('n=10,20&n=11,21&lk=1::abc').link).toEqual({ from: 'n1', to: { kind: 'point', position: null } })
  })

  it('works with the original one-node link format too', () => {
    const s = plan([a], { link: { from: 'n1', to: { kind: 'point', position: offset(2000, 0) } } })
    const h = toHash(s)
    expect(h).toContain('lat=')
    expect(parseSettings(h)).toEqual(s)
  })

  it('drops links that point at nodes that are not there', () => {
    expect(parseSettings('n=10,20&n=11,21&lk=3:1').link).toBeNull() // no node 3
    expect(parseSettings('n=10,20&n=11,21&lk=1:1').link).toBeNull() // a node to itself
    expect(parseSettings('n=10,20&n=11,21&lk=1:7').link).toBeNull()
    expect(parseSettings('n=10,20&lk=1:abc').link).toBeNull()
    expect(parseSettings('n=10,20&lk=1:99,0').link).toBeNull() // off the map
    expect(parseSettings('n=10,20&lk=oops').link).toBeNull()
    expect(parseSettings('lk=1:2').link).toBeNull() // no nodes at all
  })

  it('does not write a link whose node was removed', () => {
    expect(toHash(plan([a], { link: { from: 'n9', to: { kind: 'point', position: null } } }))).not.toContain('lk=')
    expect(toHash(plan([a], { link: { from: 'n1', to: { kind: 'node', id: 'n9' } } }))).not.toContain('lk=')
  })

  it('numbers the link by position in the plan, even when ids have gaps', () => {
    const gapped = [{ ...a, id: 'n1' }, { ...b, id: 'n5' }]
    const s = plan(gapped, { link: { from: 'n1', to: { kind: 'node', id: 'n5' } } })
    expect(toHash(s)).toContain('lk=1:2')
    expect(parseSettings(toHash(s)).link).toEqual({ from: 'n1', to: { kind: 'node', id: 'n2' } })
  })
})
