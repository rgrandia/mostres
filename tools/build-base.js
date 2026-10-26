// Regenera la base incrustada a partir d'un CSV o ZIP del cens d'Idescat.
//   node tools/build-base.js ruta/censph16354ac.zip   (o .csv)
// Escriu data/cens-base.js, que l'aplicatiu carrega per defecte.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const M = require('../js/engine.js');

const input = process.argv[2];
if (!input) { console.error('Ús: node tools/build-base.js <cens.csv|cens.zip>'); process.exit(1); }
let text, name = path.basename(input);
if (/\.zip$/i.test(input)) {
  const list = execFileSync('unzip', ['-Z1', input], { encoding: 'utf8' }).split('\n').filter((f) => /\.csv$/i.test(f));
  if (!list.length) throw new Error('El ZIP no conté cap CSV');
  name = list[0];
  text = execFileSync('unzip', ['-p', input, list[0]], { encoding: 'utf8', maxBuffer: 1 << 30 });
} else text = fs.readFileSync(input, 'utf8');

const db = M.parseCensusText(text, { fileName: name });
const c = M.toCompact(db);
c.source.loaded = new Date().toISOString().slice(0, 10);
const out = path.join(__dirname, '..', 'data', 'cens-base.js');
fs.writeFileSync(out, '// Generat per tools/build-base.js. No editar a mà.\nwindow.CENS_BASE = ' + JSON.stringify(c) + ';\n');
console.log(`${out}: ${db.units.length} unitats, ${db.munis.length} municipis, anys ${db.years.join(', ')}, ` +
  `${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
