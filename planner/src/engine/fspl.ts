/** Free-space path loss, dB, for a distance in metres and a frequency in MHz. */
export function fspl(distanceM: number, fMhz: number): number {
  return 32.45 + 20 * Math.log10(fMhz) + 20 * Math.log10(distanceM / 1000)
}
