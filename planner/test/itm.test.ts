import { describe, expect, it } from 'vitest'
import golden from './fixtures/itm-golden.json'
import { itmP2PTls, type ItmParams } from '../src/engine/itm'

interface Golden {
  label: string
  hTx: number
  hRx: number
  climate: number
  N0: number
  f: number
  pol: number
  eps: number
  sigma: number
  mdvar: number
  time: number
  location: number
  situation: number
  np: number
  xi: number
  elev: number[]
  expectedDb?: number
  ref: {
    rtn: number
    warnings: number
    lossDb: number
    mode: number
    aRefDb: number
    aFsDb: number
    deltaH: number
    dHzn0: number
    dHzn1: number
    hE0: number
    hE1: number
    theta0: number
    theta1: number
    Ns: number
  }
}

const cases = golden as Golden[]

function run(c: Golden) {
  const pfl = new Float64Array(c.np + 3)
  pfl[0] = c.np
  pfl[1] = c.xi
  pfl.set(c.elev, 2)
  const p: ItmParams = {
    hTx: c.hTx,
    hRx: c.hRx,
    climate: c.climate,
    n0: c.N0,
    fMhz: c.f,
    pol: c.pol,
    epsilon: c.eps,
    sigma: c.sigma,
    mdvar: c.mdvar,
    time: c.time,
    location: c.location,
    situation: c.situation,
  }
  return itmP2PTls(p, pfl)
}

describe('ITM port matches the NTIA reference implementation', () => {
  it('covers all three propagation modes', () => {
    const modes = new Set(cases.map((c) => c.ref.mode))
    expect(modes).toContain(1)
    expect(modes).toContain(2)
    expect(modes).toContain(3)
  })

  it.each(cases.map((c, i) => [i, c.label, c] as const))('case %i: %s', (_i, _label, c) => {
    const r = run(c)
    expect(r.code).toBe(c.ref.rtn)
    expect(r.warnings).toBe(c.ref.warnings)
    expect(r.mode).toBe(c.ref.mode)
    expect(r.lossDb).toBeCloseTo(c.ref.lossDb, 6)
    expect(r.aRefDb).toBeCloseTo(c.ref.aRefDb, 6)
    expect(r.aFsDb).toBeCloseTo(c.ref.aFsDb, 6)
    expect(r.deltaH).toBeCloseTo(c.ref.deltaH, 6)
    expect(r.dHzn0).toBeCloseTo(c.ref.dHzn0, 4)
    expect(r.dHzn1).toBeCloseTo(c.ref.dHzn1, 4)
    expect(r.hE0).toBeCloseTo(c.ref.hE0, 6)
    expect(r.hE1).toBeCloseTo(c.ref.hE1, 6)
    expect(r.nS).toBeCloseTo(c.ref.Ns, 6)
  })

  it("reproduces NTIA's published p2p.csv expected values (to the 2 decimals they publish)", () => {
    const official = cases.filter((c) => c.expectedDb !== undefined)
    expect(official.length).toBe(5)
    for (const c of official) {
      expect(run(c).lossDb).toBeCloseTo(c.expectedDb as number, 1)
    }
  })

  it('rejects invalid inputs with the reference error codes', () => {
    const base = cases[0]
    expect(run({ ...base, hTx: 0.1 }).code).toBe(1000)
    expect(run({ ...base, hRx: 5000 }).code).toBe(1001)
    expect(run({ ...base, climate: 9 }).code).toBe(1002)
    expect(run({ ...base, N0: 100 }).code).toBe(1008)
    expect(run({ ...base, f: 5 }).code).toBe(1009)
    expect(run({ ...base, mdvar: 5 }).code).toBe(1014)
    expect(run({ ...base, time: 0 }).code).toBe(1003)
  })
})
