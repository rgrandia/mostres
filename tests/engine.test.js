// Tests del motor: node tests/engine.test.js [ruta/al/cens.csv]
// Sense CSV, fa servir la base incrustada data/cens-base.js.
// Comprova que es reprodueix la mostra de l'estudi de Sant Pere de Ribes 2026
// (N=400, nacionalitat espanyola 18+, pes de zones ajustat a la població del client).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('../js/engine.js');

function loadDb() {
  const csv = process.argv[2];
  if (csv) return M.parseCensusText(fs.readFileSync(csv, 'utf8'), { fileName: path.basename(csv) });
  const src = fs.readFileSync(path.join(__dirname, '..', 'data', 'cens-base.js'), 'utf8');
  const sandbox = {};
  new Function('window', src)(sandbox);
  return M.fromCompact(sandbox.CENS_BASE);
}

const db = loadDb();
let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('ok -', name); };

t('lectura del cens', () => {
  assert.deepStrictEqual(db.years, ['2021', '2022', '2023', '2024', '2025']);
  assert.strictEqual(db.units.length, 854);
  assert.deepStrictEqual(db.sexes, ['homes', 'dones']);
  assert.deepStrictEqual(db.origins, ['espanyola', 'estrangera']);
  assert.strictEqual(db.ages.length, 18);
  assert.ok(db.munis.find((m) => m.label === "L'Hospitalet de Llobregat"));
});

t('restes majors', () => {
  assert.deepStrictEqual(M.largestRemainder([1.6, 1.3, 2.1], 5), [2, 1, 2]);
  assert.strictEqual(M.largestRemainder([0.4, 0.4, 0.4], 1).reduce((a, b) => a + b), 1);
  assert.strictEqual(M.xround(2.5), 3);
});

const muni = db.munis.find((m) => m.name === 'Sant Pere de Ribes');
const zones = M.defaultZones(db, muni.name);
const names = ['Sant Pere de Ribes', 'Les Roquetes', 'Altres nuclis i urbanitzacions'];
zones.forEach((z, i) => { z.zona = names[i]; });
const base = {
  year: '2025', units: zones, minAge: 18, bands: [18, 30, 45, 60], N: 400,
  origins: [db.origins.indexOf('espanyola')], main: { rows: 'zona', cols: ['sexe', 'edat'] },
  extras: [{ rows: 'cap', cols: ['sexe', 'edat'], mode: 'derivada' }, { rows: 'zona', cols: [], mode: 'derivada' }],
};

t('univers 18+ espanyols de Sant Pere de Ribes', () => {
  const r = M.compute(db, base);
  assert.ok(Math.abs(r.Utot - 21972.6) < 0.01, r.Utot);
});

t('reprodueix els pesos IPF de la plantilla', () => {
  const r = M.compute(db, Object.assign({}, base, {
    useZonePop: true, zonePop: { 'Sant Pere de Ribes': 12993, 'Les Roquetes': 12669, 'Altres nuclis i urbanitzacions': 6026 },
  }));
  assert.ok(r.ipfApplied);
  const tmpl = [0.0341313058625693, 0.0363244467957197, 0.0626270560298506, 0.0634336247451916,
    0.0321859906121758, 0.0384220399139926, 0.067471834208079, 0.0754327349048778];
  r.main.U[0].forEach((u, i) => assert.ok(Math.abs(u / r.Utot - tmpl[i]) < 5e-5, `cel·la ${i}`));
  // quotes finals de la plantilla (ROUND + ajust manual -1/+1 a Altres nuclis, dones)
  assert.deepStrictEqual(r.main.Q, [
    [14, 15, 25, 25, 13, 15, 27, 30],
    [14, 17, 25, 22, 14, 17, 24, 27],
    [6, 7, 13, 12, 6, 7, 13, 12],
  ]);
  assert.strictEqual(r.main.sum, 400);
  assert.deepStrictEqual(r.tables[1].Q[0], [34, 39, 63, 59, 33, 39, 64, 69]);
  assert.deepStrictEqual(r.tables[2].Q.map((x) => x[0]), [164, 160, 76]);
});

t('creuament complet amb origen i taula independent', () => {
  const r = M.compute(db, Object.assign({}, base, {
    origins: [0, 1], N: 802, rounding: 'lr',
    main: { rows: 'zona', cols: ['sexe', 'edat', 'origen'] },
    extras: [{ rows: 'zona', cols: ['origen'], mode: 'independent' }],
  }));
  assert.strictEqual(r.main.sum, 802);
  assert.strictEqual(r.main.plan.leaves.length, 16);
  assert.strictEqual(r.main.plan.cols.length, 16 + 8 + 2 + 1);
  r.tables[1].rowTotals.forEach((v, i) => assert.strictEqual(v, r.main.rowTotals[i]));
});

t('rebutja talls d\'edat que no quadren amb el cens', () => {
  assert.throws(() => M.compute(db, Object.assign({}, base, { bands: [18, 33] })), /no coincideixen/);
});

console.log(`\n${ok} tests superats`);
