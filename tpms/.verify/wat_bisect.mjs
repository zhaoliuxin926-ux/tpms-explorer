import { readFileSync } from 'node:fs';
import initWabt from 'wabt';
const wabt = await initWabt();
let src = readFileSync('../tpms-platform/src/physics/shaders/navier-stokes.wat', 'utf8').replace(/[^\x00-\x7F]/g, ' ');
const nbStart = src.indexOf('(func $nbidx');
const doDirStart = src.indexOf('(func $doDir');
const sweepStart = src.indexOf('(func (export "sweep")');
const nbPart = src.slice(nbStart, doDirStart);
const doPart = src.slice(doDirStart, sweepStart);
const try1 = '(module (memory 1) ' + nbPart + ')';
try { wabt.parseWat('t', try1).toBinary({}); console.log('nbidx: OK'); }
catch (e) { console.log('nbidx FAIL:', e.message.split('\n')[0]); }
const try2 = '(module (memory 1) ' + nbPart + doPart + ')';
try { wabt.parseWat('t', try2).toBinary({}); console.log('nbidx+doDir: OK'); }
catch (e) { console.log('nbidx+doDir FAIL:', e.message.split('\n')[0]); }
