/*
 * Irregular Terrain Model (ITM / Longley-Rice), point-to-point mode.
 *
 * This is a TypeScript port of the reference implementation published by the
 * National Telecommunications and Information Administration (NTIA),
 * Institute for Telecommunication Sciences: https://github.com/NTIA/itm
 *
 * The NTIA software was developed by US Federal Government employees and is
 * not subject to copyright protection in the United States; NTIA grants the
 * right to prepare derivative works worldwide on a royalty-free basis. Per
 * its terms we acknowledge NTIA as the creator of the original software and
 * note our changes:
 *
 *   Modified: ported from C++ to TypeScript; area-prediction mode omitted;
 *   error/warning codes kept; the result is returned in a struct instead of
 *   through output pointers. Behaviour is checked against the NTIA reference
 *   by test/itm.test.ts using values generated from the original code.
 *
 * NTIA MAKES NO WARRANTY OF ANY KIND regarding this software or the accuracy
 * of its results. The model is a statistical *estimate*; see the planner's
 * "what this does not model" notes.
 *
 * Terrain profile format ("PFL", as in the reference):
 *   pfl[0] = np          number of intervals (np + 1 elevation points)
 *   pfl[1] = xi          spacing between points, metres
 *   pfl[2 + i]           ground elevation of point i, metres above sea level
 */

// ---- Constants --------------------------------------------------------------

const PI = Math.PI
const SQRT2 = Math.SQRT2
const A_0 = 6370e3 // earth radius used by the smooth-earth diffraction curves
const A_9000 = 9000e3
const THIRD = 1.0 / 3.0

export const Polarization = { HORIZONTAL: 0, VERTICAL: 1 } as const

export const Climate = {
  EQUATORIAL: 1,
  CONTINENTAL_SUBTROPICAL: 2,
  MARITIME_SUBTROPICAL: 3,
  DESERT: 4,
  CONTINENTAL_TEMPERATE: 5,
  MARITIME_TEMPERATE_OVER_LAND: 6,
  MARITIME_TEMPERATE_OVER_SEA: 7,
} as const

/** Modes of variability. Add 10 to drop location variability, 20 to drop situation variability. */
export const Mdvar = { SINGLE_MESSAGE: 0, ACCIDENTAL: 1, MOBILE: 2, BROADCAST: 3 } as const

export const PropMode = { NOT_SET: 0, LINE_OF_SIGHT: 1, DIFFRACTION: 2, TROPOSCATTER: 3 } as const

export const ItmCode = {
  SUCCESS: 0,
  SUCCESS_WITH_WARNINGS: 1,
  ERROR_TX_TERMINAL_HEIGHT: 1000,
  ERROR_RX_TERMINAL_HEIGHT: 1001,
  ERROR_INVALID_RADIO_CLIMATE: 1002,
  ERROR_INVALID_TIME: 1003,
  ERROR_INVALID_LOCATION: 1004,
  ERROR_INVALID_SITUATION: 1005,
  ERROR_INVALID_CONFIDENCE: 1006,
  ERROR_INVALID_RELIABILITY: 1007,
  ERROR_REFRACTIVITY: 1008,
  ERROR_FREQUENCY: 1009,
  ERROR_POLARIZATION: 1010,
  ERROR_EPSILON: 1011,
  ERROR_SIGMA: 1012,
  ERROR_GROUND_IMPEDANCE: 1013,
  ERROR_MDVAR: 1014,
  ERROR_EFFECTIVE_EARTH: 1016,
  ERROR_PATH_DISTANCE: 1017,
  ERROR_DELTA_H: 1018,
  ERROR_SURFACE_REFRACTIVITY_SMALL: 1021,
  ERROR_SURFACE_REFRACTIVITY_LARGE: 1022,
} as const

/** Warning bit flags (returned in `warnings`). */
export const Warn = {
  TX_TERMINAL_HEIGHT: 0x0001,
  RX_TERMINAL_HEIGHT: 0x0002,
  FREQUENCY: 0x0004,
  PATH_DISTANCE_TOO_BIG_1: 0x0008,
  PATH_DISTANCE_TOO_BIG_2: 0x0010,
  PATH_DISTANCE_TOO_SMALL_1: 0x0020,
  PATH_DISTANCE_TOO_SMALL_2: 0x0040,
  TX_HORIZON_ANGLE: 0x0080,
  RX_HORIZON_ANGLE: 0x0100,
  TX_HORIZON_DISTANCE_1: 0x0200,
  RX_HORIZON_DISTANCE_1: 0x0400,
  TX_HORIZON_DISTANCE_2: 0x0800,
  RX_HORIZON_DISTANCE_2: 0x1000,
  EXTREME_VARIABILITIES: 0x2000,
  SURFACE_REFRACTIVITY: 0x4000,
} as const

// ---- Public types -----------------------------------------------------------

export interface ItmParams {
  /** Structural height of the transmitter above local ground, metres. */
  hTx: number
  /** Structural height of the receiver above local ground, metres. */
  hRx: number
  /** Radio climate, 1-7 (see Climate). */
  climate: number
  /** Surface refractivity, N-units (typically 301). */
  n0: number
  /** Frequency, MHz. */
  fMhz: number
  /** 0 horizontal, 1 vertical. */
  pol: number
  /** Relative permittivity of ground (15 = average ground). */
  epsilon: number
  /** Ground conductivity, S/m (0.005 = average ground). */
  sigma: number
  /** Mode of variability (see Mdvar). */
  mdvar: number
  /** Time, location and situation percentages, 0 < x < 100. */
  time: number
  location: number
  situation: number
}

export interface ItmResult {
  /** 0 success, 1 success with warnings, >= 1000 an error (see ItmCode). */
  code: number
  /** Basic transmission loss, dB (free-space loss included). Valid when code is 0 or 1. */
  lossDb: number
  /** Bit flags (see Warn). */
  warnings: number
  /** Propagation mode (see PropMode). */
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
  nS: number
}

export function newItmResult(): ItmResult {
  return {
    code: 0,
    lossDb: 0,
    warnings: 0,
    mode: 0,
    aRefDb: 0,
    aFsDb: 0,
    deltaH: 0,
    dHzn0: 0,
    dHzn1: 0,
    hE0: 0,
    hE1: 0,
    theta0: 0,
    theta1: 0,
    nS: 0,
  }
}

// ---- Small helpers ----------------------------------------------------------

/** C's fdim: positive difference. */
function fdim(x: number, y: number): number {
  return x > y ? x - y : 0
}

/** The reference's DIM macro. */
function dim(x: number, y: number): number {
  return x > y ? x - y : 0
}

// Complex numbers are used only for the ground impedance and reflection coefficient.
interface Cx {
  re: number
  im: number
}

function cxSqrt(z: Cx): Cx {
  // Principal square root (matches std::sqrt for complex<double>)
  const r = Math.hypot(z.re, z.im)
  const re = Math.sqrt((r + z.re) / 2)
  const im = Math.sqrt(Math.max(0, (r - z.re) / 2))
  return { re, im: z.im < 0 || Object.is(z.im, -0) ? -im : im }
}

function cxDiv(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}

// ---- Terrain helpers --------------------------------------------------------

/** Least-squares line through part of a profile; returns fitted values at the profile ends. */
function linearLeastSquaresFit(pfl: Float64Array, dStart: number, dEnd: number, out: { y1: number; y2: number }): void {
  const np = Math.trunc(pfl[0])

  let iStart = Math.trunc(fdim(dStart / pfl[1], 0.0))
  let iEnd = np - Math.trunc(fdim(np, dEnd / pfl[1]))

  if (iEnd <= iStart) {
    iStart = Math.trunc(fdim(iStart, 1.0))
    iEnd = np - Math.trunc(fdim(np, iEnd + 1.0))
  }

  const xLength = iEnd - iStart

  let midShiftedIndex = -0.5 * xLength
  const midShiftedEnd = iEnd + midShiftedIndex

  let sumY = 0.5 * (pfl[iStart + 2] + pfl[iEnd + 2])
  let scaledSumY = 0.5 * (pfl[iStart + 2] - pfl[iEnd + 2]) * midShiftedIndex

  for (let i = 2; i <= xLength; i++) {
    iStart++
    midShiftedIndex++

    sumY += pfl[iStart + 2]
    scaledSumY += pfl[iStart + 2] * midShiftedIndex
  }

  sumY = sumY / xLength
  scaledSumY = (scaledSumY * 12.0) / ((xLength * xLength + 2.0) * xLength)

  out.y1 = sumY - scaledSumY * midShiftedEnd
  out.y2 = sumY + scaledSumY * (np - midShiftedEnd)
}

const sScratch = new Float64Array(247) // resampled profile used by computeDeltaH
const diffScratch = new Float64Array(245)
const fitScratch = { y1: 0, y2: 0 }

/** Terrain irregularity parameter, delta h. */
function computeDeltaH(pfl: Float64Array, dStart: number, dEnd: number): number {
  const s = sScratch
  const np = Math.trunc(pfl[0])
  let xStart = dStart / pfl[1]
  let xEnd = dEnd / pfl[1]

  // fewer than 2 terrain points: delta_h = 0
  if (xEnd - xStart < 2.0) return 0

  let p10 = Math.trunc(0.1 * (xEnd - xStart + 8.0))
  p10 = Math.min(Math.max(4, p10), 25)

  const n = 10 * p10 - 5
  const p90 = n - p10

  const npS = n - 1
  s[0] = npS
  s[1] = 1.0

  xEnd = (xEnd - xStart) / npS
  let i = Math.trunc(xStart)
  xStart -= Math.fround(i + 1.0)

  for (let j = 0; j < n; j++) {
    while (xStart > 0.0 && i + 1 < np) {
      xStart--
      i++
    }

    s[j + 2] = pfl[i + 3] + (pfl[i + 3] - pfl[i + 2]) * xStart

    xStart += xEnd
  }

  linearLeastSquaresFit(s, 0.0, npS, fitScratch)
  let fitY1 = fitScratch.y1
  const fitSlope = (fitScratch.y2 - fitScratch.y1) / npS

  // difference between fitted line and actual data
  const diffs = diffScratch.subarray(0, n)
  for (let j = 0; j < n; j++) {
    diffs[j] = s[j + 2] - fitY1
    fitY1 += fitSlope
  }

  // The reference selects the p10-th and p90-th values in descending order.
  diffs.sort() // ascending
  const q10 = diffs[n - p10]
  const q90 = diffs[n - 1 - p90]

  const deltaHd = q10 - q90

  // [ERL 79-ITS 67, Eqn 3], inverted
  return deltaHd / (1.0 - 0.8 * Math.exp(-(dEnd - dStart) / 50e3))
}

function findHorizons(
  pfl: Float64Array,
  aE: number,
  h0: number,
  h1: number,
  thetaHzn: Float64Array,
  dHzn: Float64Array,
): void {
  const np = Math.trunc(pfl[0])
  const xi = pfl[1]

  const d = pfl[0] * pfl[1]

  const zTx = pfl[2] + h0
  const zRx = pfl[np + 2] + h1

  // treat the terminals as line-of-sight to begin with [TN101, Eq 6.15]
  thetaHzn[0] = (zRx - zTx) / d - d / (2 * aE)
  thetaHzn[1] = -(zRx - zTx) / d - d / (2 * aE)

  dHzn[0] = d
  dHzn[1] = d

  let dTx = 0.0
  let dRx = d

  for (let i = 1; i < np; i++) {
    dTx = dTx + xi
    dRx = dRx - xi

    const thetaTx = (pfl[i + 2] - zTx) / dTx - dTx / (2 * aE)
    const thetaRx = -(zRx - pfl[i + 2]) / dRx - dRx / (2 * aE)

    if (thetaTx > thetaHzn[0]) {
      thetaHzn[0] = thetaTx
      dHzn[0] = dTx
    }

    if (thetaRx > thetaHzn[1]) {
      thetaHzn[1] = thetaRx
      dHzn[1] = dRx
    }
  }
}

// ---- Propagation components -------------------------------------------------

function freeSpaceLoss(d: number, fMhz: number): number {
  return 32.45 + 20.0 * Math.log10(fMhz) + 20.0 * Math.log10(d / 1000.0)
}

function terrainRoughness(d: number, deltaH: number): number {
  // [ERL 79-ITS 67, Eqn 3], distance in metres
  return deltaH * (1.0 - 0.8 * Math.exp(-d / 50e3))
}

function sigmaHFunction(deltaH: number): number {
  // [ERL 79-ITS 67, Eqn 3.6a]
  return 0.78 * deltaH * Math.exp(-0.5 * Math.pow(deltaH, 0.25))
}

function inverseComplementaryCumulativeDistribution(q: number): number {
  const C0 = 2.515516
  const C1 = 0.802853
  const C2 = 0.010328
  const D1 = 1.432788
  const D2 = 0.189269
  const D3 = 0.001308

  let x = q
  if (q > 0.5) x = 1.0 - x

  const Tx = Math.sqrt(-2.0 * Math.log(x))

  const zetaX = ((C2 * Tx + C1) * Tx + C0) / (((D3 * Tx + D2) * Tx + D1) * Tx + 1.0)

  let Qq = Tx - zetaX
  if (q > 0.5) Qq = -Qq

  return Qq
}

function fresnelIntegral(v2: number): number {
  // v2 is v squared, so 5.76 compares v to 2.4
  if (v2 < 5.76) return 6.02 + 9.11 * Math.sqrt(v2) - 1.27 * v2
  return 12.953 + 10 * Math.log10(v2)
}

function knifeEdgeDiffraction(d: number, fMhz: number, aE: number, thetaLos: number, dHzn0: number, dHzn1: number): number {
  const dML = dHzn0 + dHzn1
  const thetaNlos = d / aE - thetaLos

  const dNlos = d - dML

  // 1 / (4 pi) = 0.0795775, [TN101, Eqn I.7]
  const v1 = 0.0795775 * (fMhz / 47.7) * Math.pow(thetaNlos, 2) * ((dHzn0 * dNlos) / (dNlos + dHzn0))
  const v2 = 0.0795775 * (fMhz / 47.7) * Math.pow(thetaNlos, 2) * ((dHzn1 * dNlos) / (dNlos + dHzn1))

  return fresnelIntegral(v1) + fresnelIntegral(v2)
}

function heightFunction(xKm: number, K: number): number {
  let w: number
  let result: number

  if (xKm < 200.0) {
    w = -Math.log(K)

    if (K < 1e-5 || xKm * Math.pow(w, 3) > 5495.0) {
      result = -117.0
      if (xKm > 1.0) result = 17.372 * Math.log(xKm) + result
    } else {
      result = (2.5e-5 * Math.pow(xKm, 2)) / K - 8.686 * w - 15.0
    }
  } else {
    result = 0.05751 * xKm - 4.343 * Math.log(xKm)

    if (xKm < 2000) {
      w = 0.0134 * xKm * Math.exp(-0.005 * xKm)
      result = (1.0 - w) * result + w * (17.372 * Math.log(xKm) - 117.0)
    }
  }

  return result
}

function smoothEarthDiffraction(
  d: number,
  fMhz: number,
  aE: number,
  thetaLos: number,
  dHzn0: number,
  dHzn1: number,
  hE0: number,
  hE1: number,
  zg: Cx,
): number {
  const dML = dHzn0 + dHzn1
  const thetaNlos = d / aE - thetaLos

  // three radii
  const a0 = (d - dML) / (d / aE - thetaLos)
  const a1 = (0.5 * Math.pow(dHzn0, 2)) / hE0
  const a2 = (0.5 * Math.pow(dHzn1, 2)) / hE1

  const dKm0 = (a0 * thetaNlos) / 1000.0
  const dKm1 = dHzn0 / 1000.0
  const dKm2 = dHzn1 / 1000.0

  const absZg = Math.hypot(zg.re, zg.im)
  const fThird = Math.pow(fMhz, THIRD)
  const fMinusThird = Math.pow(fMhz, -THIRD)

  // C_0 = (4 / 3k)^(1/3) [Vogler 1964, Eqn 2]
  const C0_0 = Math.pow(((4.0 / 3.0) * A_0) / a0, THIRD)
  const C0_1 = Math.pow(((4.0 / 3.0) * A_0) / a1, THIRD)
  const C0_2 = Math.pow(((4.0 / 3.0) * A_0) / a2, THIRD)

  // [Vogler 1964, Eqn 6a / 7a]
  const K0 = (0.017778 * C0_0 * fMinusThird) / absZg
  const K1 = (0.017778 * C0_1 * fMinusThird) / absZg
  const K2 = (0.017778 * C0_2 * fMinusThird) / absZg

  // [Vogler 1964, Fig 4]
  const B0_0 = 1.607 - K0
  const B0_1 = 1.607 - K1
  const B0_2 = 1.607 - K2

  // [Vogler 1964, Eqn 2]
  const x1 = B0_1 * Math.pow(C0_1, 2) * fThird * dKm1
  const x2 = B0_2 * Math.pow(C0_2, 2) * fThird * dKm2
  const x0 = B0_0 * Math.pow(C0_0, 2) * fThird * dKm0 + x1 + x2

  // height gain functions
  const F0 = heightFunction(x1, K1)
  const F1 = heightFunction(x2, K2)

  // distance function [TN101, Eqn 8.4]
  const Gx = 0.05751 * x0 - 10.0 * Math.log10(x0)

  return Gx - F0 - F1 - 20
}

function diffractionLoss(
  d: number,
  dHzn0: number,
  dHzn1: number,
  hE0: number,
  hE1: number,
  zg: Cx,
  aE: number,
  deltaH: number,
  h0: number,
  h1: number,
  thetaLos: number,
  dSML: number,
  fMhz: number,
): number {
  const Ak = knifeEdgeDiffraction(d, fMhz, aE, thetaLos, dHzn0, dHzn1)

  const Ase = smoothEarthDiffraction(d, fMhz, aE, thetaLos, dHzn0, dHzn1, hE0, hE1, zg)

  // Terrain clutter: roughness term using dSML [ERL 79-ITS 67, page 3-13]
  const deltaHdSML = terrainRoughness(dSML, deltaH)
  const sigmaHd = sigmaHFunction(deltaHdSML)

  // Clutter factor [ERL 79-ITS 67, Eqn 3.38c]
  const Afo = Math.min(15.0, 5 * Math.log10(1.0 + 1e-5 * h0 * h1 * fMhz * sigmaHd))

  // weighting factor for the combined diffraction loss
  const deltaHd = terrainRoughness(d, deltaH)

  let q = h0 * h1
  const qk = hE0 * hE1 - q

  // point-to-point mode: C ~= 10 for low antennas with known path parameters [ERL 79-ITS 67, page 3-8]
  q += 10.0

  const term1 = Math.sqrt(1.0 + qk / q)

  const dML = dHzn0 + dHzn1
  q = (term1 + (-thetaLos * aE + dML) / d) * Math.min((deltaHd * fMhz) / 47.7, 6283.2)

  // [ERL 17-ITS 67, Eqn 3.23]
  const w = 25.1 / (25.1 + Math.sqrt(q))

  return w * Ase + (1.0 - w) * Ak + Afo
}

function lineOfSightLoss(
  d: number,
  hE0: number,
  hE1: number,
  zg: Cx,
  deltaH: number,
  Md: number,
  Ad0: number,
  dSML: number,
  fMhz: number,
): number {
  const deltaHd = terrainRoughness(d, deltaH)
  const sigmaHd = sigmaHFunction(deltaHd)

  // wavenumber
  const wn = fMhz / 47.7

  // [Algorithm, Eqn 4.46]
  const sinPsi = (hE0 + hE1) / Math.sqrt(Math.pow(d, 2) + Math.pow(hE0 + hE1, 2))

  // [Algorithm, Eqn 4.47]
  const refl = cxDiv({ re: sinPsi - zg.re, im: -zg.im }, { re: sinPsi + zg.re, im: zg.im })
  const damp = Math.exp(-Math.min(10.0, wn * sigmaHd * sinPsi))
  let reRe = refl.re * damp
  let reIm = refl.im * damp

  // q = magnitude of R_e', [Algorithm, Eqn 4.48]
  const q = Math.pow(reRe, 2) + Math.pow(reIm, 2)
  if (q < 0.25 || q < sinPsi) {
    const scale = Math.sqrt(sinPsi / q)
    reRe *= scale
    reIm *= scale
  }

  // phase difference between rays [Algorithm, Eqn 4.49]
  let deltaPhi = (wn * 2.0 * hE0 * hE1) / d

  // [Algorithm, Eqn 4.50]
  if (deltaPhi > PI / 2.0) deltaPhi = PI - Math.pow(PI / 2.0, 2) / deltaPhi

  // two-ray attenuation
  const rrRe = Math.cos(deltaPhi) + reRe
  const rrIm = -Math.sin(deltaPhi) + reIm
  const At = -10 * Math.log10(Math.pow(rrRe, 2) + Math.pow(rrIm, 2))

  // extended diffraction attenuation
  const Ad = Md * d + Ad0

  // weighting factor
  const w = 1 / (1 + (fMhz * deltaH) / Math.max(10e3, dSML))

  return w * At + (1 - w) * Ad
}

function fFunction(td: number): number {
  // constants from [Algorithm, 6.9]
  const a = [133.4, 104.6, 71.8]
  const b = [0.332e-3, 0.212e-3, 0.157e-3]
  const c = [-10, -2.5, 5]

  let i: number
  if (td <= 10e3) i = 0
  else if (td <= 70e3) i = 1
  else i = 2

  return a[i] + b[i] * td + c[i] * Math.log10(td)
}

const H0_A = [25.0, 80.0, 177.0, 395.0, 705.0]
const H0_B = [24.0, 45.0, 68.0, 80.0, 105.0]

function h0Curve(j: number, r: number): number {
  // values from [Algorithm, 6.13]
  return 10 * Math.log10(1 + H0_A[j] * Math.pow(1 / r, 4) + H0_B[j] * Math.pow(1.0 / r, 2))
}

function h0Function(r: number, etaS: number): number {
  etaS = Math.min(Math.max(etaS, 1), 5)

  const i = Math.trunc(etaS)
  const q = etaS - i

  let result = h0Curve(i - 1, r)

  if (q !== 0.0) result = (1.0 - q) * result + q * h0Curve(i, r)

  return result
}

/** Troposcatter loss. `h0Ref.h0` carries H_0 between the two calls, as the reference's pointer argument. */
function troposcatterLoss(
  d: number,
  thetaHzn0: number,
  thetaHzn1: number,
  dHzn0: number,
  dHzn1: number,
  hE0: number,
  hE1: number,
  aE: number,
  Ns: number,
  fMhz: number,
  thetaLos: number,
  h0Ref: { h0: number },
): number {
  let H0: number

  const wn = fMhz / 47.7

  if (h0Ref.h0 > 15.0) {
    // short-circuit calculations if already greater than 15 dB
    H0 = h0Ref.h0
  } else {
    let ad = dHzn0 - dHzn1
    let rr = hE1 / hE0

    if (ad < 0.0) {
      ad = -ad
      rr = 1.0 / rr
    }

    const theta = thetaHzn0 + thetaHzn1 + d / aE

    // [TN101, Eqn 9.4a]
    const r1 = 2.0 * wn * theta * hE0
    const r2 = 2.0 * wn * theta * hE1

    // if both are below 0.2 the scatter function is undefined [Algorithm, page 11]
    if (r1 < 0.2 && r2 < 0.2) return 1001

    let s = (d - ad) / (d + ad) // asymmetry parameter

    // truncate s and q at 0.1 and 10 [Algorithm, page 16]
    const q = Math.min(Math.max(0.1, rr / s), 10.0)
    s = Math.max(0.1, s)

    const h0Meter = ((d - ad) * (d + ad) * theta * 0.25) / d // height of cross-over

    const Z0 = 1.7556e3
    const Z1 = 8.0e3
    const etaS =
      (h0Meter / Z0) *
      (1.0 + (0.031 - Ns * 2.32e-3 + Math.pow(Ns, 2) * 5.67e-6) * Math.exp(-Math.pow(Math.min(1.7, h0Meter / Z1), 6)))

    const H00 = (h0Function(r1, etaS) + h0Function(r2, etaS)) / 2
    const deltaH0 = Math.min(H00, 6.0 * (0.6 - Math.log10(Math.max(etaS, 1.0))) * Math.log10(s) * Math.log10(q))

    H0 = H00 + deltaH0
    H0 = Math.max(H0, 0.0)

    if (etaS < 1.0) {
      H0 =
        etaS * H0 +
        (1.0 - etaS) *
          10 *
          Math.log10(
            (Math.pow((1.0 + SQRT2 / r1) * (1.0 + SQRT2 / r2), 2) * (r1 + r2)) / (r1 + r2 + 2 * SQRT2),
          )
    }

    // if H_0 would exceed 15 dB at d_5, use the value it has at d_6 [Algorithm, page 12]
    if (H0 > 15.0 && h0Ref.h0 >= 0.0) H0 = h0Ref.h0
  }

  h0Ref.h0 = H0
  const th = d / aE - thetaLos

  const D0 = 40e3
  const H = 47.7
  return (
    fFunction(th * d) + 10 * Math.log10(wn * H * Math.pow(th, 4)) - 0.1 * (Ns - 301.0) * Math.exp((-th * d) / D0) + H0
  )
}

// ---- Longley-Rice reference attenuation --------------------------------------

interface LrOut {
  aRef: number
  propmode: number
  warnings: number
}

/** The core reference-attenuation calculation (point-to-point). Returns an ItmCode. */
function longleyRice(
  thetaHzn0: number,
  thetaHzn1: number,
  fMhz: number,
  zg: Cx,
  dHzn0: number,
  dHzn1: number,
  hE0: number,
  hE1: number,
  gammaE: number,
  Ns: number,
  deltaH: number,
  h0: number,
  h1: number,
  d: number,
  out: LrOut,
): number {
  const aE = 1 / gammaE

  // terrestrial smooth-earth horizon distance approximation
  const dHznS0 = Math.sqrt(2.0 * hE0 * aE)
  const dHznS1 = Math.sqrt(2.0 * hE1 * aE)

  // maximum line-of-sight distance for smooth earth
  const dSML = dHznS0 + dHznS1

  // maximum line-of-sight distance for actual path
  const dML = dHzn0 + dHzn1

  // angular distance of line-of-sight region
  const thetaLos = -Math.max(thetaHzn0 + thetaHzn1, -dML / aE)

  // validity of small-angle approximation
  if (Math.abs(thetaHzn0) > 200e-3) out.warnings |= Warn.TX_HORIZON_ANGLE
  if (Math.abs(thetaHzn1) > 200e-3) out.warnings |= Warn.RX_HORIZON_ANGLE

  // actual horizon distance can't be less than 1/10 of the smooth-earth one
  if (dHzn0 < 0.1 * dHznS0) out.warnings |= Warn.TX_HORIZON_DISTANCE_1
  if (dHzn1 < 0.1 * dHznS1) out.warnings |= Warn.RX_HORIZON_DISTANCE_1

  // ... or greater than 3 times
  if (dHzn0 > 3.0 * dHznS0) out.warnings |= Warn.TX_HORIZON_DISTANCE_2
  if (dHzn1 > 3.0 * dHznS1) out.warnings |= Warn.RX_HORIZON_DISTANCE_2

  // surface refractivity
  if (Ns < 150) return ItmCode.ERROR_SURFACE_REFRACTIVITY_SMALL
  if (Ns > 400) return ItmCode.ERROR_SURFACE_REFRACTIVITY_LARGE
  if (Ns < 250) out.warnings |= Warn.SURFACE_REFRACTIVITY

  // effective earth size
  if (aE < 4000000 || aE > 13333333) return ItmCode.ERROR_EFFECTIVE_EARTH

  // ground impedance
  if (zg.re <= Math.abs(zg.im)) return ItmCode.ERROR_GROUND_IMPEDANCE

  // two distances far in the diffraction region
  const scale = Math.pow(Math.pow(aE, 2) / fMhz, 1.0 / 3.0)
  const d3 = Math.max(dSML, dML + 5.0 * scale)
  const d4 = d3 + 10.0 * scale

  // diffraction loss at the two distances
  const A3 = diffractionLoss(d3, dHzn0, dHzn1, hE0, hE1, zg, aE, deltaH, h0, h1, thetaLos, dSML, fMhz)
  const A4 = diffractionLoss(d4, dHzn0, dHzn1, hE0, hE1, zg, aE, deltaH, h0, h1, thetaLos, dSML, fMhz)

  // slope and intercept of the diffraction line
  const Md = (A4 - A3) / (d4 - d3)
  const Ad0 = A3 - Md * d3

  const dMin = Math.abs(hE0 - hE1) / 200e-3

  if (d < dMin) out.warnings |= Warn.PATH_DISTANCE_TOO_SMALL_1
  if (d < 1e3) out.warnings |= Warn.PATH_DISTANCE_TOO_SMALL_2
  if (d > 1000e3) out.warnings |= Warn.PATH_DISTANCE_TOO_BIG_1
  if (d > 2000e3) out.warnings |= Warn.PATH_DISTANCE_TOO_BIG_2

  if (d < dSML) {
    // line-of-sight region: diffraction loss at the maximum smooth-earth LOS distance
    const AsML = dSML * Md + Ad0

    // [ERL 79-ITS 67, Eqn 3.16a], in metres
    let d0 = 0.04 * fMhz * hE0 * hE1

    let d1: number
    if (Ad0 >= 0.0) {
      d0 = Math.min(d0, 0.5 * dML)
      d1 = d0 + 0.25 * (dML - d0) // [ERL 79-ITS 67, Eqn 3.16d]
    } else {
      d1 = Math.max(-Ad0 / Md, 0.25 * dML)
    }

    const A1 = lineOfSightLoss(d1, hE0, hE1, zg, deltaH, Md, Ad0, dSML, fMhz)

    let flag = false
    let k1 = 0
    let k2 = 0

    if (d0 < d1) {
      const A0 = lineOfSightLoss(d0, hE0, hE1, zg, deltaH, Md, Ad0, dSML, fMhz)

      const q = Math.log(dSML / d0)

      // [ERL 79-ITS 67, Eqn 3.20]
      k2 = Math.max(
        0.0,
        ((dSML - d0) * (A1 - A0) - (d1 - d0) * (AsML - A0)) / ((dSML - d0) * Math.log(d1 / d0) - (d1 - d0) * q),
      )

      flag = Ad0 > 0.0 || k2 > 0.0

      if (flag) {
        // [ERL 79-ITS 67, Eqn 3.21]
        k1 = (AsML - A0 - k2 * q) / (dSML - d0)

        if (k1 < 0.0) {
          k1 = 0.0
          k2 = dim(AsML, A0) / q

          if (k2 === 0.0) k1 = Md
        }
      }
    }

    if (!flag) {
      k1 = dim(AsML, A1) / (dSML - d1)
      k2 = 0.0

      if (k1 === 0.0) k1 = Md
    }

    const Ao = AsML - k1 * dSML - k2 * Math.log(dSML)

    // [ERL 79-ITS 67, Eqn 3.19]
    out.aRef = Ao + k1 * d + k2 * Math.log(d)
    out.propmode = PropMode.LINE_OF_SIGHT
  } else {
    // trans-horizon path: two points far into the troposcatter region
    const d5 = dML + 200e3
    const d6 = dML + 400e3

    const h0Ref = { h0: -1 }
    const A6 = troposcatterLoss(d6, thetaHzn0, thetaHzn1, dHzn0, dHzn1, hE0, hE1, aE, Ns, fMhz, thetaLos, h0Ref)
    const A5 = troposcatterLoss(d5, thetaHzn0, thetaHzn1, dHzn0, dHzn1, hE0, hE1, aE, Ns, fMhz, thetaLos, h0Ref)

    let Ms: number
    let As0: number
    let dx: number

    if (A5 < 1000.0) {
      // slope of the troposcatter line
      Ms = (A6 - A5) / 200e3

      // diffraction-troposcatter transition distance
      dx = Math.max(
        Math.max(dSML, dML + 1.088 * Math.pow(Math.pow(aE, 2) / fMhz, 1.0 / 3.0) * Math.log(fMhz)),
        (A5 - Ad0 - Ms * d5) / (Md - Ms),
      )

      // intercept of the troposcatter line
      As0 = (Md - Ms) * dx + Ad0
    } else {
      // troposcatter gives no real result: reuse the diffraction line
      Ms = Md
      As0 = Ad0
      dx = 10e6
    }

    if (d > dx) {
      out.aRef = Ms * d + As0
      out.propmode = PropMode.TROPOSCATTER
    } else {
      out.aRef = Md * d + Ad0
      out.propmode = PropMode.DIFFRACTION
    }
  }

  // don't allow a negative loss
  out.aRef = Math.max(out.aRef, 0.0)

  return ItmCode.SUCCESS
}

// ---- Variability ---------------------------------------------------------------

function curve(c1: number, c2: number, x1: number, x2: number, x3: number, dE: number): number {
  return ((c1 + c2 / (1.0 + Math.pow((dE - x2) / x3, 2))) * Math.pow(dE / x1, 2)) / (1.0 + Math.pow(dE / x1, 2))
}

// Asymptotic values from TN101, Fig 10.13, per climate
const ALL_YEAR = [
  [-9.67, -0.62, 1.26, -9.21, -0.62, -0.39, 3.15],
  [12.7, 9.19, 15.5, 9.05, 9.19, 2.86, 857.9],
  [144.9e3, 228.9e3, 262.6e3, 84.1e3, 228.9e3, 141.7e3, 2222e3],
  [190.3e3, 205.2e3, 185.2e3, 101.1e3, 205.2e3, 315.9e3, 164.8e3],
  [133.8e3, 143.6e3, 99.8e3, 98.6e3, 143.6e3, 167.4e3, 116.3e3],
]

const BSM1 = [2.13, 2.66, 6.11, 1.98, 2.68, 6.86, 8.51]
const BSM2 = [159.5, 7.67, 6.65, 13.11, 7.16, 10.38, 169.8]
const XSM1 = [762.2e3, 100.4e3, 138.2e3, 139.1e3, 93.7e3, 187.8e3, 609.8e3]
const XSM2 = [123.6e3, 172.5e3, 242.2e3, 132.7e3, 186.8e3, 169.6e3, 119.9e3]
const XSM3 = [94.5e3, 136.4e3, 178.6e3, 193.5e3, 133.5e3, 108.9e3, 106.6e3]

const BSP1 = [2.11, 6.87, 10.08, 3.68, 4.75, 8.58, 8.43]
const BSP2 = [102.3, 15.53, 9.6, 159.3, 8.12, 13.97, 8.19]
const XSP1 = [636.9e3, 138.7e3, 165.3e3, 464.4e3, 93.2e3, 216.0e3, 136.2e3]
const XSP2 = [134.8e3, 143.7e3, 225.7e3, 93.1e3, 135.9e3, 152.0e3, 188.5e3]
const XSP3 = [95.6e3, 98.6e3, 129.7e3, 94.2e3, 113.4e3, 122.7e3, 122.9e3]

const C_D = [1.224, 0.801, 1.38, 1.0, 1.224, 1.518, 1.518] // [Algorithm, Table 5.1]
const Z_D = [1.282, 2.161, 1.282, 20.0, 1.282, 1.282, 1.282]

const BFM1 = [1.0, 1.0, 1.0, 1.0, 0.92, 1.0, 1.0]
const BFM2 = [0.0, 0.0, 0.0, 0.0, 0.25, 0.0, 0.0]
const BFM3 = [0.0, 0.0, 0.0, 0.0, 1.77, 0.0, 0.0]

const BFP1 = [1.0, 0.93, 1.0, 0.93, 0.93, 1.0, 1.0]
const BFP2 = [0.0, 0.31, 0.0, 0.19, 0.31, 0.0, 0.0]
const BFP3 = [0.0, 2.0, 0.0, 1.79, 2.0, 0.0, 0.0]

/** Applies time/location/situation variability to the reference attenuation; returns dB (without free-space loss). */
function variability(
  time: number,
  location: number,
  situation: number,
  hE0: number,
  hE1: number,
  deltaH: number,
  fMhz: number,
  d: number,
  aRef: number,
  climate: number,
  mdvar: number,
  lr: LrOut,
): number {
  let zT = inverseComplementaryCumulativeDistribution(time / 100)
  let zL = inverseComplementaryCumulativeDistribution(location / 100)
  const zS = inverseComplementaryCumulativeDistribution(situation / 100)

  const ci = climate - 1 // 0-based

  const wn = fMhz / 47.7

  // effective distance [Algorithm, Eqn 5.3]
  const dEx = Math.sqrt(2 * A_9000 * hE0) + Math.sqrt(2 * A_9000 * hE1) + Math.pow(575.7e12 / wn, THIRD)

  let dE: number
  if (d < dEx) dE = (130e3 * d) / dEx
  else dE = 130e3 + d - dEx

  // situation variability. mdvar >= 20 removes direct situation variability.
  let mv = mdvar
  const plus20 = mv >= 20
  if (plus20) mv -= 20

  let sigmaS: number
  if (plus20) sigmaS = 0.0
  else {
    const D = 100e3
    sigmaS = 5.0 + 3.0 * Math.exp(-dE / D) // [Algorithm, Eqn 5.10]
  }

  const plus10 = mv >= 10
  if (plus10) mv -= 10

  const Vmed = curve(ALL_YEAR[0][ci], ALL_YEAR[1][ci], ALL_YEAR[2][ci], ALL_YEAR[3][ci], ALL_YEAR[4][ci], dE)

  if (mv === 0) {
    // single message mode
    zT = zS
    zL = zS
  } else if (mv === 1) {
    zL = zS
  } else if (mv === 2) {
    zL = zT
  }
  // else broadcast mode: no additional operations

  if (Math.abs(zT) > 3.1 || Math.abs(zL) > 3.1 || Math.abs(zS) > 3.1) lr.warnings |= Warn.EXTREME_VARIABILITIES

  // location variability
  let sigmaL: number
  if (plus10) sigmaL = 0.0
  else {
    const deltaHd = terrainRoughness(d, deltaH)
    sigmaL = (10.0 * wn * deltaHd) / (wn * deltaHd + 13.0)
  }
  const YL = sigmaL * zL

  // time variability
  const q = Math.log(0.133 * wn)
  const gMinus = BFM1[ci] + BFM2[ci] / (Math.pow(BFM3[ci] * q, 2) + 1.0)
  const gPlus = BFP1[ci] + BFP2[ci] / (Math.pow(BFP3[ci] * q, 2) + 1.0)

  const sigmaTMinus = curve(BSM1[ci], BSM2[ci], XSM1[ci], XSM2[ci], XSM3[ci], dE) * gMinus
  const sigmaTPlus = curve(BSP1[ci], BSP2[ci], XSP1[ci], XSP2[ci], XSP3[ci], dE) * gPlus

  const sigmaTD = C_D[ci] * sigmaTPlus
  const tgtd = (sigmaTPlus - sigmaTD) * Z_D[ci]

  let sigmaT: number
  if (zT < 0.0) sigmaT = sigmaTMinus
  else if (zT <= Z_D[ci]) sigmaT = sigmaTPlus
  else sigmaT = sigmaTD + tgtd / zT
  const YT = sigmaT * zT

  const YSTemp = Math.pow(sigmaS, 2) + Math.pow(YT, 2) / (7.8 + Math.pow(zS, 2)) + Math.pow(YL, 2) / (24.0 + Math.pow(zS, 2))

  let YR: number
  let YS: number
  if (mv === 0) {
    YR = 0.0
    YS = Math.sqrt(Math.pow(sigmaT, 2) + Math.pow(sigmaL, 2) + YSTemp) * zS
  } else if (mv === 1) {
    YR = YT
    YS = Math.sqrt(Math.pow(sigmaL, 2) + YSTemp) * zS
  } else if (mv === 2) {
    YR = Math.sqrt(Math.pow(sigmaT, 2) + Math.pow(sigmaL, 2)) * zT
    YS = Math.sqrt(YSTemp) * zS
  } else {
    YR = YT + YL
    YS = Math.sqrt(YSTemp) * zS
  }

  let result = aRef - Vmed - YR - YS

  // [Algorithm, Eqn 52]
  if (result < 0.0) result = (result * (29.0 - result)) / (29.0 - 10.0 * result)

  return result
}

// ---- Entry points ----------------------------------------------------------------

function validateInputs(p: ItmParams, lr: LrOut): number {
  if (p.hTx < 1.0 || p.hTx > 1000.0) lr.warnings |= Warn.TX_TERMINAL_HEIGHT
  if (p.hTx < 0.5 || p.hTx > 3000.0) return ItmCode.ERROR_TX_TERMINAL_HEIGHT

  if (p.hRx < 1.0 || p.hRx > 1000.0) lr.warnings |= Warn.RX_TERMINAL_HEIGHT
  if (p.hRx < 0.5 || p.hRx > 3000.0) return ItmCode.ERROR_RX_TERMINAL_HEIGHT

  if (!Number.isInteger(p.climate) || p.climate < 1 || p.climate > 7) return ItmCode.ERROR_INVALID_RADIO_CLIMATE

  if (p.n0 < 250 || p.n0 > 400) return ItmCode.ERROR_REFRACTIVITY

  if (p.fMhz < 40.0 || p.fMhz > 10000.0) lr.warnings |= Warn.FREQUENCY
  if (p.fMhz < 20 || p.fMhz > 20000) return ItmCode.ERROR_FREQUENCY

  if (p.pol !== 0 && p.pol !== 1) return ItmCode.ERROR_POLARIZATION

  if (p.epsilon < 1) return ItmCode.ERROR_EPSILON
  if (p.sigma <= 0) return ItmCode.ERROR_SIGMA

  const m = p.mdvar
  if (m < 0 || (m > 3 && m < 10) || (m > 13 && m < 20) || (m > 23 && m < 30) || m > 33) return ItmCode.ERROR_MDVAR

  if (p.situation <= 0 || p.situation >= 100) return ItmCode.ERROR_INVALID_SITUATION
  if (p.time <= 0 || p.time >= 100) return ItmCode.ERROR_INVALID_TIME
  if (p.location <= 0 || p.location >= 100) return ItmCode.ERROR_INVALID_LOCATION

  return ItmCode.SUCCESS
}

const thetaScratch = new Float64Array(2)
const dHznScratch = new Float64Array(2)

/**
 * Point-to-point prediction with variability given as time/location/situation percentages.
 * `result` may be reused between calls to avoid allocation in tight loops.
 */
export function itmP2PTls(p: ItmParams, pfl: Float64Array, result: ItmResult = newItmResult()): ItmResult {
  const lr: LrOut = { aRef: 0, propmode: PropMode.NOT_SET, warnings: 0 }
  result.warnings = 0
  result.lossDb = 0
  result.mode = PropMode.NOT_SET

  const rtn = validateInputs(p, lr)
  if (rtn !== ItmCode.SUCCESS) {
    result.code = rtn
    result.warnings = lr.warnings
    return result
  }

  const np = Math.trunc(pfl[0])

  // average path height, ignoring first and last 10%
  const p10 = Math.trunc(0.1 * np)
  let hSys = 0
  for (let i = p10; i <= np - p10; i++) hSys += pfl[i + 2]
  hSys = hSys / (np - 2 * p10 + 1)

  // InitializePointToPoint
  const gammaA = 157e-9 // curvature of the actual earth, ~1 / 6370 km
  const Ns = hSys === 0.0 ? p.n0 : p.n0 * Math.exp(-hSys / 9460.0) // [TN101, Eq 4.3]
  const gammaE = gammaA * (1.0 - 0.04665 * Math.exp(Ns / 179.3)) // [TN101, Eq 4.4], reworked
  const epR: Cx = { re: p.epsilon, im: (18000 * p.sigma) / p.fMhz }
  let zg = cxSqrt({ re: epR.re - 1.0, im: epR.im })
  if (p.pol === Polarization.VERTICAL) zg = cxDiv(zg, epR)

  // QuickPfl
  const thetaHzn = thetaScratch
  const dHzn = dHznScratch
  const dTotal = pfl[0] * pfl[1]
  const aE = 1 / gammaE

  findHorizons(pfl, aE, p.hTx, p.hRx, thetaHzn, dHzn)

  // consider terrain from about 15 antenna heights out [Hufford, 1982] page 25
  const dStart = Math.min(15.0 * p.hTx, 0.1 * dHzn[0])
  const dEnd = dTotal - Math.min(15.0 * p.hRx, 0.1 * dHzn[1])

  const deltaH = computeDeltaH(pfl, dStart, dEnd)

  let hE0: number
  let hE1: number

  if (dHzn[0] + dHzn[1] > 1.5 * dTotal) {
    // well within line-of-sight range
    linearLeastSquaresFit(pfl, dStart, dEnd, fitScratch)
    hE0 = p.hTx + fdim(pfl[2], fitScratch.y1)
    hE1 = p.hRx + fdim(pfl[np + 2], fitScratch.y2)

    dHzn[0] = Math.sqrt(2.0 * hE0 * aE) * Math.exp(-0.07 * Math.sqrt(deltaH / Math.max(hE0, 5.0)))
    dHzn[1] = Math.sqrt(2.0 * hE1 * aE) * Math.exp(-0.07 * Math.sqrt(deltaH / Math.max(hE1, 5.0)))

    const combined = dHzn[0] + dHzn[1]
    if (combined <= dTotal) {
      const q = Math.pow(dTotal / combined, 2)
      hE0 = hE0 * q
      hE1 = hE1 * q
      dHzn[0] = Math.sqrt(2.0 * hE0 * aE) * Math.exp(-0.07 * Math.sqrt(deltaH / Math.max(hE0, 5.0)))
      dHzn[1] = Math.sqrt(2.0 * hE1 * aE) * Math.exp(-0.07 * Math.sqrt(deltaH / Math.max(hE1, 5.0)))
    }

    let q = Math.sqrt(2.0 * hE0 * aE)
    thetaHzn[0] = (0.65 * deltaH * (q / dHzn[0] - 1.0) - 2.0 * hE0) / q
    q = Math.sqrt(2.0 * hE1 * aE)
    thetaHzn[1] = (0.65 * deltaH * (q / dHzn[1] - 1.0) - 2.0 * hE1) / q
  } else {
    linearLeastSquaresFit(pfl, dStart, 0.9 * dHzn[0], fitScratch)
    hE0 = p.hTx + fdim(pfl[2], fitScratch.y1)

    linearLeastSquaresFit(pfl, dTotal - 0.9 * dHzn[1], dEnd, fitScratch)
    hE1 = p.hRx + fdim(pfl[np + 2], fitScratch.y2)
  }

  // reference attenuation
  const code = longleyRice(
    thetaHzn[0],
    thetaHzn[1],
    p.fMhz,
    zg,
    dHzn[0],
    dHzn[1],
    hE0,
    hE1,
    gammaE,
    Ns,
    deltaH,
    p.hTx,
    p.hRx,
    dTotal,
    lr,
  )
  if (code !== ItmCode.SUCCESS) {
    result.code = code
    result.warnings = lr.warnings
    return result
  }

  const aFs = freeSpaceLoss(dTotal, p.fMhz)

  result.lossDb =
    variability(p.time, p.location, p.situation, hE0, hE1, deltaH, p.fMhz, dTotal, lr.aRef, p.climate, p.mdvar, lr) + aFs

  result.aRefDb = lr.aRef
  result.aFsDb = aFs
  result.deltaH = deltaH
  result.dHzn0 = dHzn[0]
  result.dHzn1 = dHzn[1]
  result.hE0 = hE0
  result.hE1 = hE1
  result.theta0 = thetaHzn[0]
  result.theta1 = thetaHzn[1]
  result.nS = Ns
  result.mode = lr.propmode
  result.warnings = lr.warnings
  result.code = lr.warnings !== 0 ? ItmCode.SUCCESS_WITH_WARNINGS : ItmCode.SUCCESS
  return result
}

/**
 * Point-to-point prediction with variability given as confidence and reliability percentages
 * (reliability maps to time, confidence to situation, location fixed at 50%).
 */
export function itmP2PCr(
  p: Omit<ItmParams, 'time' | 'location' | 'situation'>,
  confidence: number,
  reliability: number,
  pfl: Float64Array,
  result: ItmResult = newItmResult(),
): ItmResult {
  const full: ItmParams = { ...p, time: reliability, location: 50, situation: confidence }
  const r = itmP2PTls(full, pfl, result)
  // convert TLS error codes into CR error codes
  if (r.code === ItmCode.ERROR_INVALID_TIME) r.code = ItmCode.ERROR_INVALID_RELIABILITY
  else if (r.code === ItmCode.ERROR_INVALID_SITUATION) r.code = ItmCode.ERROR_INVALID_CONFIDENCE
  return r
}
