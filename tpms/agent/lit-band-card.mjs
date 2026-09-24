#!/usr/bin/env node
// lit-band-card.mjs - literature band vs platform one-shot card
// Align BENCHMARKS.md vs-lit table:
//   E_rel = C1 * rho^2   (C1 cal band 0.35-0.44; printed open-cell 0.1-1)
//   S_rel = C2 * rho^1.5 (C2=0.3; classic open-cell 0.23 lower edge)
//   E scaling n=2 in literature 1.5-2.5
// NOT FEA. See docs/HONESTY_BOUNDARIES.md
//
// Usage: node tpms/agent/lit-band-card.mjs [--porosity 0.6] [--c1 0.38] [--c2 0.3]

const args = process.argv.slice(2);
function num(flag, def) {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : def;
}
const porosity = Math.min(0.98, Math.max(0.02, num('--porosity', 0.6)));
const c1 = num('--c1', 0.38);
const c2 = num('--c2', 0.3);
const rho = 1 - porosity;

const BANDS = {
  nE: { lo: 1.5, hi: 2.5, name: 'E* scale n' },
  c1Cal: { lo: 0.35, hi: 0.44, name: 'C1 cal band' },
  c1Print: { lo: 0.1, hi: 1.0, name: 'C1 print band' },
  c2: { lo: 0.23, hi: 0.3, name: 'C2 band' },
};
function inBand(v, b) {
  return v >= b.lo && v <= b.hi ? 'IN' : 'OUT';
}
const nE = 2;
const Erel = c1 * rho ** nE;
const Srel = c2 * rho ** 1.5;
const rows = [
  ['metric', 'platform', 'literature', 'verdict'],
  [BANDS.nE.name, String(nE), BANDS.nE.lo + '-' + BANDS.nE.hi, inBand(nE, BANDS.nE)],
  [BANDS.c1Cal.name, c1.toFixed(3), BANDS.c1Cal.lo + '-' + BANDS.c1Cal.hi, inBand(c1, BANDS.c1Cal)],
  [BANDS.c1Print.name, c1.toFixed(3), BANDS.c1Print.lo + '-' + BANDS.c1Print.hi, inBand(c1, BANDS.c1Print)],
  ['S* scale n', '1.5', '1.5 classic', 'MATCH'],
  [BANDS.c2.name, c2.toFixed(3), BANDS.c2.lo + '-' + BANDS.c2.hi, inBand(c2, BANDS.c2)],
  ['Erel @rho=' + rho.toFixed(3), Erel.toFixed(4), 'engineering', 'not FEA'],
  ['Srel @rho=' + rho.toFixed(3), Srel.toFixed(4), 'engineering', 'not FEA'],
];
const w = [22, 14, 16, 10];
console.log('LIT-BAND-CARD  porosity=' + porosity + '  C1=' + c1 + '  C2=' + c2);
for (const r of rows) {
  console.log(r.map((c, i) => String(c).padEnd(w[i])).join(''));
}
console.log('');
console.log('Scope: Gibson-Ashby analytic estimate, NOT FEA.');
console.log('Source: BENCHMARKS.md vs-lit table / docs/LIT_BAND_CARD.md');
const allIn =
  inBand(nE, BANDS.nE) === 'IN' &&
  inBand(c1, BANDS.c1Cal) === 'IN' &&
  inBand(c2, BANDS.c2) === 'IN';
process.exit(allIn ? 0 : 1);
