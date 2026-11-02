import { parseSFZ } from '../src/sfz-parser.js';
import fs from 'fs';

const sfzText = fs.readFileSync('public/library/kamoepiano/kamoepiano.sfz', 'utf8');
const result = parseSFZ(sfzText);

let totalRegions = 0;
let missingFile = 0;
let badMidi = 0;

result.groups.forEach((g, gi) => {
  g.regions.forEach((r, ri) => {
    totalRegions++;
    const file = r.opcodes.sample;
    const midi = r.opcodes.pitch_keycenter ?? r.opcodes.key;
    if (!file) { missingFile++; console.log(`Group ${gi} Region ${ri}: MISSING sample`); }
    if (midi === undefined) { badMidi++; console.log(`Group ${gi} Region ${ri}: MISSING pitch_keycenter, file=${file}`); }
  });
});

console.log(`Total groups: ${result.groups.length}`);
console.log(`Total regions: ${totalRegions}`);
console.log(`Missing sample: ${missingFile}`);
console.log(`Missing midi: ${badMidi}`);
console.log('\n--- First 3 regions of group 0 ---');
result.groups[0]?.regions.slice(0, 3).forEach(r => console.log(r.opcodes));
console.log('\n--- First region of group 1 ---');
console.log(result.groups[1]?.regions[0]?.opcodes);
console.log('\n--- First region of group 2 ---');
console.log(result.groups[2]?.regions[0]?.opcodes);
