/*
 * Motor de càlcul de quotes de mostra.
 *
 * Funciona igual al navegador (global `Mostres`) i a Node (`require`), perquè
 * els tests puguin comprovar els càlculs amb les mateixes funcions que fa
 * servir l'aplicatiu.
 *
 * Base de dades interna: un cub dens any × unitat × edat × origen × sexe amb
 * els valors del cens (NaN = dada confidencial o inexistent).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mostres = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const norm = (s) => String(s == null ? '' : s).trim();
  const low = (s) => norm(s).toLowerCase();
  const cap = (s) => { const t = norm(s); return t ? t[0].toUpperCase() + t.slice(1) : t; };
  const TOTALS = ['total', 'totals', 'ambdós sexes', 'ambdos sexes', 'ambos sexos', 'tots', 'totes', 'tots els', 'todas', 'todos'];
  const isTotal = (s) => { const v = low(s); return TOTALS.includes(v) || v.startsWith('total '); };

  // ---------------------------------------------------------------- lectura

  const KEYS = {
    any: ['any', 'year', 'año', 'periode', 'període'],
    zona: ['agrupaci', 'secci', 'districte', 'barri', 'zona', 'municipi', 'comarca', 'província', 'provincia', 'territori', 'àmbit', 'ambit', 'vegueria'],
    edat: ['edat', 'edad', 'age'],
    origen: ['nacionalitat', 'nacionalidad', 'lloc de naixement', 'naixement', 'nacimiento', 'origen'],
    sexe: ['sexe', 'sexo', 'gènere', 'genere'],
    valor: ['valor', 'value'],
    estat: ['estat', 'estado', 'flag'],
    concepte: ['concepte', 'concepto', 'indicador', 'variable'],
  };

  function detectColumns(header) {
    const h = header.map(low);
    const used = new Set();
    const out = {};
    for (const role of Object.keys(KEYS)) {
      for (const k of KEYS[role]) {
        const i = h.findIndex((c, j) => !used.has(j) && c.includes(k));
        if (i >= 0) { out[role] = i; used.add(i); break; }
      }
    }
    return out;
  }

  function splitLine(line, d) {
    if (line.indexOf('"') < 0) return line.split(d);
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseNumber(v) {
    const t = norm(v);
    if (!t || t === '..' || t === '-' || t === ':') return NaN;
    if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
    return Number(t.replace(',', '.'));
  }

  /** Interpreta etiquetes d'edat com "de 15 a 19 anys", "85 anys o més", "menys de 5". */
  function parseAge(label) {
    const t = low(label);
    const nums = (t.match(/\d+/g) || []).map(Number);
    if (!nums.length) return null;
    if (nums.length >= 2) return { lo: nums[0], hi: nums[1] };
    if (/(més|mes|más|mas|\+|i majors|o majors|y más)/.test(t)) return { lo: nums[0], hi: Infinity };
    if (/(menys|menos|menor)/.test(t)) return { lo: 0, hi: nums[0] - 1 };
    return { lo: nums[0], hi: nums[0] };
  }

  /** "Hospitalet de Llobregat 3 (Centre - la Farga), l'" -> municipi, número i descripció. */
  function parseUnit(name) {
    const m = norm(name).match(/^(.+?)\s+(\d+)\s*\((.*)\)\s*,?\s*(l'|la|les|el|els)?\s*$/i);
    if (!m) return { name, muni: norm(name), num: 0, desc: norm(name) };
    const muni = m[1] + (m[4] ? ', ' + m[4] : '');
    return { name, muni, num: Number(m[2]), desc: m[3] };
  }

  /** Nom de municipi llegible: "Hospitalet de Llobregat, l'" -> "L'Hospitalet de Llobregat". */
  function niceMuni(muni) {
    const m = norm(muni).match(/^(.*),\s*(l'|la|les|el|els)$/i);
    if (!m) return muni;
    const art = cap(m[2]);
    return art.endsWith("'") ? art + m[1] : art + ' ' + m[1];
  }

  /** "proporció de població nascuda a Catalunya (%)" -> "nascuda a Catalunya". */
  function niceCategory(label) {
    return norm(label).replace(/^(proporció|percentatge|taxa|nombre)\s+de\s+(la\s+)?(població\s+)?/i, '').replace(/\s*\((%|‰)\)\s*$/, '');
  }

  /**
   * Llegeix un CSV en format llarg (una fila per combinació) i el converteix en
   * el cub intern. Només calen una columna de valor i alguna variable: si falta
   * la zona, l'edat, l'origen o el sexe, aquella variable simplement no s'ofereix.
   * Les files de totals s'eliminen quan la variable té categories de detall.
   */
  function parseCensusText(text, opts) {
    opts = opts || {};
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r?\n/);
    const first = lines[0];
    const cand = [';', ',', '\t'];
    const delim = cand.reduce((a, b) => (first.split(b).length > first.split(a).length ? b : a));
    const header = splitLine(first, delim).map(norm);
    const col = Object.assign(detectColumns(header), opts.columns || {});
    if (col.valor == null) {
      // sense capçalera «valor»: l'última columna numèrica
      const sample = splitLine(lines[1] || '', delim);
      for (let i = header.length - 1; i >= 0; i--) if (!Object.values(col).includes(i) && Number.isFinite(parseNumber(sample[i]))) { col.valor = i; break; }
    }
    if (col.valor == null) throw new Error(`No trobo la columna de valors a la capçalera: ${header.join(' | ')}`);
    const assigned = new Set(Object.values(col));

    // lectura: cada columna (menys la de valor) es codifica per categories
    const nC = header.length;
    const maps = header.map(() => new Map());
    const add = (m, k) => { let i = m.get(k); if (i == null) { i = m.size; m.set(k, i); } return i; };
    const ids = new Int32Array(Math.max(1, lines.length) * nC);
    const vals = new Float64Array(Math.max(1, lines.length));
    let nRows = 0;
    for (let li = 1; li < lines.length; li++) {
      const line = lines[li];
      if (!line) continue;
      const f = splitLine(line, delim);
      for (let c = 0; c < nC; c++) if (c !== col.valor) ids[nRows * nC + c] = add(maps[c], norm(f[c]));
      let v = parseNumber(f[col.valor]);
      if (col.estat != null && norm(f[col.estat]) === '..') v = NaN;
      vals[nRows++] = v;
    }
    if (!nRows) throw new Error('El fitxer no té cap fila de dades.');
    const notes = [];
    const keysOf = (c) => [...maps[c].keys()];
    const detailOf = (c) => keysOf(c).filter((k) => k !== '' && !isTotal(k));
    const get = (c, r) => ids[r * nC + c];

    // una columna sense nom conegut i amb un sol valor (p. ex. «Catalunya») és el territori
    let unknown = header.map((x, i) => i).filter((i) => !assigned.has(i));
    if (col.zona == null) {
      const t = unknown.find((c) => detailOf(c).length <= 1);
      if (t != null) { col.zona = t; unknown = unknown.filter((c) => c !== t); }
    }

    // concepte amb diverses categories: fa d'origen si no n'hi ha; si no, se'n tria una
    const concepts = col.concepte != null ? keysOf(col.concepte).filter((c) => c !== '') : [];
    let conceptKeep = null;
    let originFromConcept = false;
    if (concepts.length > 1) {
      if (col.origen == null) originFromConcept = true;
      else {
        conceptKeep = concepts.find((c) => /poblaci/i.test(c)) || concepts[0];
        notes.push(`La columna «${header[col.concepte]}» té diverses categories; es fa servir «${conceptKeep}».`);
      }
    }
    const isShare = /%|proporci|percentatge|taxa/i.test(concepts.join(' ') + ' ' + header[col.valor]);
    const oCol = originFromConcept ? col.concepte : col.origen;

    // la resta de columnes amb categories són variables de creuament addicionals
    const zoneAttr = (c) => {
      if (col.zona == null || maps[col.zona].size < 2) return false;
      const rev = keysOf(c), seen = new Map();
      for (let r = 0; r < nRows; r++) {
        const val = get(c, r);
        if (isTotal(rev[val])) continue;
        const z = get(col.zona, r);
        if (seen.has(z) && seen.get(z) !== val) return false;
        seen.set(z, val);
      }
      return true;
    };
    const extraCols = [];
    unknown.forEach((c) => {
      const det = detailOf(c);
      if (det.length <= 1) return;
      if (det.length > 40) { notes.push(`La columna «${header[c]}» té ${det.length} categories: massa per fer-ne quotes, no s'ofereix.`); return; }
      if (det.every((k) => /^[\d\s.,/-]+$/.test(k))) { notes.push(`La columna «${header[c]}» sembla un codi numèric: no s'ofereix com a variable.`); return; }
      if (zoneAttr(c)) { notes.push(`La columna «${header[c]}» descriu la zona (un sol valor per zona): no s'ofereix com a variable.`); return; }
      extraCols.push(c);
    });

    // categories de cada variable: les de detall (sense totals) o, si només hi ha totals, una de sola
    const sel = (c, order, only) => {
      if (c == null) return { keys: [''], pos: null };
      const keys = keysOf(c), det = keys.filter((k) => k !== '' && !isTotal(k));
      let use = only != null ? [only] : det.length ? det : keys;
      if (order) use = order(use);
      const pos = new Map(); use.forEach((k, i) => pos.set(maps[c].get(k), i));
      return { keys: use, pos };
    };
    const S = {
      any: sel(col.any, (ks) => ks.slice().sort((a, b) => Number(a) - Number(b))),
      zona: sel(col.zona),
      origen: sel(oCol),
      sexe: sel(col.sexe),
      concepte: conceptKeep != null ? sel(col.concepte, null, conceptKeep) : { keys: [''], pos: null },
    };
    let ages = sel(col.edat).keys.map((label) => Object.assign({ label }, parseAge(label) || { lo: null, hi: null }));
    const hasAge = col.edat != null && ages.length > 1;
    if (hasAge) {
      const bad = ages.filter((a) => a.lo == null);
      if (bad.length) throw new Error('Etiquetes d\'edat que no sé interpretar: ' + bad.map((a) => a.label).join(', '));
      ages = ages.sort((a, b) => a.lo - b.lo);
      S.edat = sel(col.edat, () => ages.map((a) => a.label));
    } else {
      ages = [{ label: col.edat != null ? ages[0].label : 'Totes les edats', lo: null, hi: null }];
      S.edat = { keys: [ages[0].label], pos: null };
      if (col.edat != null) S.edat = sel(col.edat);
    }
    const extra = extraCols.map((c, k) => {
      const x = sel(c);
      return { key: 'x' + k, col: c, label: cap(header[c]), cats: x.keys, labels: x.keys.map(cap), pos: x.pos };
    });

    const territory = S.zona.keys.length === 1 ? (S.zona.keys[0] || header[col.zona] || '') : null;
    const origins = S.origen.keys.map((o) => o || 'Tots');
    const db = makeDb({
      years: S.any.keys.map((y) => y || '—'),
      units: S.zona.keys.map((z) => z || territory || 'Total'),
      ages,
      origins,
      originLabels: originFromConcept ? origins.map(niceCategory) : origins,
      sexes: S.sexe.keys.map((x) => x || 'Total'),
      originVar: oCol != null && S.origen.keys.length > 1 ? header[oCol] : null,
      extra: extra.map(({ key, label, cats, labels }) => ({ key, label, cats, labels })),
      isShare,
      territory,
      source: { file: opts.fileName || 'dades.csv', rows: nRows, columns: header, notes },
    });
    const at = (x, c, r) => (x.pos ? x.pos.get(get(c, r)) : 0);
    const exSizes = extra.map((e) => e.cats.length);
    for (let r = 0; r < nRows; r++) {
      const iy = at(S.any, col.any, r), iz = at(S.zona, col.zona, r), ia = hasAge ? at(S.edat, col.edat, r) : 0;
      const io = at(S.origen, oCol, r), is = at(S.sexe, col.sexe, r);
      if (iy == null || iz == null || ia == null || io == null || is == null) continue;
      if (S.concepte.pos && !S.concepte.pos.has(get(col.concepte, r))) continue;
      if (!hasAge && S.edat.pos && !S.edat.pos.has(get(col.edat, r))) continue;
      let e = 0, ok = true;
      for (let k = 0; k < extra.length; k++) {
        const ie = extra[k].pos.get(get(extra[k].col, r));
        if (ie == null) { ok = false; break; }
        e = e * exSizes[k] + ie;
      }
      if (!ok) continue;
      const i = db.idx(iy, iz, ia, io, is, e);
      db.val[i] = Number.isNaN(db.val[i]) ? vals[r] : db.val[i] + (Number.isNaN(vals[r]) ? 0 : vals[r]);
    }
    return db;
  }

  function makeDb(d) {
    const nY = d.years.length, nU = d.units.length, nA = d.ages.length, nO = d.origins.length, nS = d.sexes.length;
    const extra = d.extra || [];
    const E = extra.reduce((a, e) => a * e.cats.length, 1);
    if (nY * nU * nA * nO * nS * E > 6e7) throw new Error('El fitxer té massa combinacions de categories per treballar-hi al navegador. Treu alguna columna o filtra\'l abans.');
    const db = {
      years: d.years.map(String),
      units: d.units.map(parseUnit),
      ages: d.ages.map((a) => (typeof a === 'string' ? Object.assign({ label: a }, parseAge(a)) : a)),
      origins: d.origins,
      sexes: d.sexes,
      originVar: d.originVar,
      originLabels: d.originLabels || d.origins,
      isShare: !!d.isShare,
      territory: d.territory || null,
      source: d.source || {},
      extra, E,
      val: d.val || new Float64Array(nY * nU * nA * nO * nS * E).fill(NaN),
      idx: (y, u, a, o, s, e) => (((((y * nU + u) * nA + a) * nO + o) * nS + s) * E + (e || 0)),
    };
    db.has = {
      any: !(db.years.length === 1 && db.years[0] === '—'),
      zona: nU > 1,
      edat: nA > 1 && db.ages.every((a) => a.lo != null),
      origen: nO > 1,
      sexe: nS > 1,
    };
    extra.forEach((e) => { db.has[e.key] = e.cats.length > 1; });
    const munis = new Map();
    db.units.forEach((u, i) => { if (!munis.has(u.muni)) munis.set(u.muni, []); munis.get(u.muni).push(i); });
    db.munis = [...munis.entries()].map(([name, units]) => ({ name, label: niceMuni(name), units }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ca'));
    return db;
  }

  /** Base compacta incrustada (data/cens-base.js): valors en ordre any, unitat, edat, origen, sexe; -1 = confidencial. */
  function fromCompact(c) {
    const val = new Float64Array(c.values.length);
    for (let i = 0; i < val.length; i++) val[i] = c.values[i] < 0 ? NaN : c.values[i];
    return makeDb(Object.assign({}, c, { val }));
  }

  function toCompact(db) {
    return {
      years: db.years, units: db.units.map((u) => u.name), ages: db.ages.map((a) => a.label),
      origins: db.origins, originLabels: db.originLabels, sexes: db.sexes, originVar: db.originVar,
      isShare: db.isShare, territory: db.territory, source: db.source, extra: db.extra,
      values: Array.from(db.val, (v) => (Number.isNaN(v) ? -1 : Math.round(v * 100) / 100)),
    };
  }

  // ---------------------------------------------------------------- utilitats de càlcul

  /** ROUND d'Excel: arrodoneix les meitats lluny del zero. */
  function xround(x) {
    const a = Math.abs(x);
    const r = Math.floor(a + 0.5 + 1e-9);
    return x < 0 ? -r : r;
  }

  /** Repartiment per restes majors: enters que sumen exactament `target`. */
  function largestRemainder(raw, target) {
    const fl = raw.map((v) => Math.floor(v + 1e-9));
    let diff = target - fl.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => i).sort((a, b) => (raw[b] - fl[b]) - (raw[a] - fl[a]) || raw[b] - raw[a] || a - b);
    for (let k = 0; diff > 0 && order.length; k = (k + 1) % order.length) { fl[order[k]]++; diff--; }
    for (let k = order.length - 1; diff < 0 && k >= 0; k--) { if (fl[order[k]] > 0) { fl[order[k]]--; diff++; } }
    return fl;
  }

  const VAR_NAMES = { zona: 'Zona', sexe: 'Sexe', edat: 'Edat', origen: 'Origen' };

  function bandLabels(bands, maxAge) {
    return bands.map((lo, i) => {
      const hi = i + 1 < bands.length ? bands[i + 1] - 1 : maxAge;
      return hi == null || !Number.isFinite(hi) ? `${lo} i més` : `${lo}-${hi}`;
    });
  }

  /** Columnes d'una taula: fulles, subtotals per nivell i total, com a les plantilles. */
  function planColumns(vars, cats) {
    const depth = Math.max(1, vars.length);
    const cols = [];
    const pad = (arr) => arr.concat(new Array(depth - arr.length).fill(''));
    function rec(prefix, labels) {
      const lvl = prefix.length;
      const values = cats[vars[lvl]];
      values.forEach((lab, i) => {
        const key = prefix.concat(i), labs = labels.concat(lab);
        if (lvl === vars.length - 1) cols.push({ kind: 'leaf', key, labels: pad(labs) });
        else {
          rec(key, labs);
          cols.push({ kind: 'sub', key, labels: pad(labs.concat(lvl === 0 ? 'TOTAL ' + lab.toUpperCase() : 'Total')) });
        }
      });
    }
    if (vars.length) {
      rec([], []);
      cols.push({ kind: 'total', key: [], labels: pad(['TOTAL']) });
    } else cols.push({ kind: 'leaf', key: [], labels: ['TOTAL'] });
    const leaves = cols.filter((c) => c.kind === 'leaf');
    leaves.forEach((c, i) => { c.leaf = i; });
    cols.forEach((c) => {
      c.members = c.kind === 'leaf' ? [c.leaf]
        : leaves.filter((l) => c.key.every((v, i) => l.key[i] === v)).map((l) => l.leaf);
    });
    return { cols, leaves, depth };
  }

  function ipf(M, rowT, colT, iters) {
    const R = M.length, C = M[0].length;
    const W = M.map((r) => r.slice());
    for (let it = 0; it < (iters || 2000); it++) {
      let delta = 0;
      for (let r = 0; r < R; r++) {
        const s = W[r].reduce((a, b) => a + b, 0);
        const f = s > 0 ? rowT[r] / s : 0;
        for (let c = 0; c < C; c++) W[r][c] *= f;
      }
      for (let c = 0; c < C; c++) {
        let s = 0; for (let r = 0; r < R; r++) s += W[r][c];
        const f = s > 0 ? colT[c] / s : 0;
        for (let r = 0; r < R; r++) W[r][c] *= f;
      }
      for (let r = 0; r < R; r++) delta = Math.max(delta, Math.abs(W[r].reduce((a, b) => a + b, 0) - rowT[r]));
      if (delta < 1e-9) break;
    }
    return W;
  }

  // ---------------------------------------------------------------- càlcul principal

  /**
   * cfg = {
   *   year, units: [{u, zona}], minAge, maxAge, bands: [18,30,45,60], bandLabels?,
   *   origins: [índexs inclosos], N, rounding: 'lr'|'directe',
   *   main: {rows: 'zona'|'cap', cols: ['sexe','edat',...]},
   *   extras: [{rows, cols, mode: 'derivada'|'independent', title?}],
   *   zonePop: {zona: població} (opcional: ajust iteratiu dels pesos de zona),
   *   threshold, cawiPct
   * }
   */
  function compute(db, cfg) {
    const errors = [], warnings = [], notes = [];
    (db.source.notes || []).forEach((n) => notes.push(n));
    const y = db.years.indexOf(String(cfg.year));
    if (y < 0) throw new Error('Any no disponible a la base de dades: ' + cfg.year);
    if (!cfg.units || !cfg.units.length) throw new Error('Cal seleccionar com a mínim una unitat territorial.');
    const N = Math.max(1, Math.round(Number(cfg.N) || 0));

    const zones = [];
    cfg.units.forEach((x) => { const z = norm(x.zona) || db.units[x.u].name; if (!zones.includes(z)) zones.push(z); });
    const zoneOf = cfg.units.map((x) => zones.indexOf(norm(x.zona) || db.units[x.u].name));

    // --- edats: franges de quota sobre les franges del cens (si la base en té)
    let minAge, maxAge, bands, ageMap, labels;
    if (!db.has.edat) {
      minAge = null; maxAge = Infinity; bands = [0];
      ageMap = db.ages.map((a) => ({ band: 0, frac: 1, label: a.label }));
      labels = ['Totes les edats'];
      warnings.push('La base no té edat: l\'univers inclou totes les edats, també els menors de 18 anys. Si l\'enquesta és a majors d\'edat, les proporcions poden estar esbiaixades (sobretot l\'origen, perquè la població estrangera és més jove).');
    } else {
      minAge = Number(cfg.minAge) || 0;
      maxAge = cfg.maxAge == null || cfg.maxAge === '' ? Infinity : Number(cfg.maxAge);
      bands = (cfg.bands && cfg.bands.length ? cfg.bands : [minAge]).map(Number).sort((a, b) => a - b);
      if (bands[0] !== minAge) bands[0] = minAge;
      const censusLows = db.ages.map((a) => a.lo);
      const misaligned = bands.slice(1).filter((b) => !censusLows.includes(b));
      if (misaligned.length) {
        throw new Error(`Els talls d'edat ${misaligned.join(', ')} no coincideixen amb l'inici de cap franja del cens (${censusLows.join(', ')}).`);
      }
      if (Number.isFinite(maxAge) && !db.ages.some((a) => a.hi === maxAge)) {
        throw new Error(`L'edat màxima ${maxAge} no coincideix amb el final de cap franja del cens.`);
      }
      ageMap = db.ages.map((a) => {
        const lo = Math.max(a.lo, minAge), hi = Math.min(a.hi, maxAge);
        if (hi < lo) return null;
        let frac = 1;
        if (a.lo < minAge) {
          if (!Number.isFinite(a.hi)) throw new Error(`La franja oberta «${a.label}» no es pot tallar a ${minAge} anys.`);
          frac = (hi - lo + 1) / (a.hi - a.lo + 1);
        }
        let band = 0;
        bands.forEach((b, i) => { if (lo >= b) band = i; });
        return { band, frac, label: a.label };
      });
      const partial = ageMap.filter((m) => m && m.frac < 1);
      partial.forEach((m) => notes.push(`Edat: la franja «${m.label}» del cens entra a l'univers en una proporció de ${fmtFrac(m.frac)} (suposa distribució uniforme dins la franja).`));
      labels = cfg.bandLabels && cfg.bandLabels.length === bands.length ? cfg.bandLabels : bandLabels(bands, maxAge);
    }

    const oIdx = (cfg.origins && cfg.origins.length ? cfg.origins : db.origins.map((o, i) => i)).slice().sort((a, b) => a - b);
    const cats = {
      sexe: db.sexes.map(cap),
      edat: labels,
      origen: oIdx.map((o) => cap(db.originLabels[o])),
    };
    const vl = (v) => VAR_NAMES[v] || (db.extra.find((e) => e.key === v) || {}).label || v;
    db.extra.forEach((e) => { cats[e.key] = e.labels; });
    const nZ = zones.length, nS = cats.sexe.length, nB = bands.length, nO = oIdx.length, E = db.E;
    const exSizes = db.extra.map((e) => e.cats.length);

    // --- cub de l'univers: zona × sexe × franja × origen × variables addicionals
    const C = nS * nB * nO * E;
    const cube = new Float64Array(nZ * C);
    const ci = (z, s, b, o, e) => (((z * nS + s) * nB + b) * nO + o) * E + (e || 0);
    // coordenades de cada cel·la (per a les taules)
    const coordsOf = Array.from({ length: C }, (_, c) => {
      const out = {};
      let r = c;
      for (let k = db.extra.length - 1; k >= 0; k--) { out[db.extra[k].key] = r % exSizes[k]; r = Math.floor(r / exSizes[k]); }
      out.origen = r % nO; r = Math.floor(r / nO);
      out.edat = r % nB; r = Math.floor(r / nB);
      out.sexe = r;
      return out;
    });
    let confidential = 0;
    const confUnits = new Set();
    cfg.units.forEach((x, k) => {
      const z = zoneOf[k];
      ageMap.forEach((m, a) => {
        if (!m) return;
        oIdx.forEach((o, oi) => {
          for (let s = 0; s < nS; s++) for (let e = 0; e < E; e++) {
            const v = db.val[db.idx(y, x.u, a, o, s, e)];
            if (Number.isNaN(v)) { confidential++; confUnits.add(db.units[x.u].name); continue; }
            cube[ci(z, s, m.band, oi, e)] += v * m.frac;
          }
        });
      });
    });
    if (confidential) {
      warnings.push(`Hi ha ${confidential} cel·les del cens sense dada (secret estadístic «..» o inexistents) a: ${[...confUnits].join('; ')}. S'han comptat com a 0, de manera que aquestes zones queden infrarepresentades.`);
    }
    const census = Float64Array.from(cube);
    const Utot = cube.reduce((a, b) => a + b, 0);
    if (!(Utot > 0)) throw new Error('L\'univers seleccionat és buit. Revisa l\'any, les zones i els filtres.');
    if (db.isShare) {
      warnings.push('La base dona percentatges, no persones: les quotes reprodueixen aquestes proporcions i no hi ha un univers en nombre de persones. Quan una variable no es creua (p. ex. el sexe), els seus percentatges es combinen amb el mateix pes.');
      // les categories triades han de ser excloents i cobrir el total
      const per = new Map();
      cfg.units.forEach((x) => db.ages.forEach((a, ai) => db.sexes.forEach((sx, si) => {
        for (let e = 0; e < E; e++) {
          let sum = 0, any = false;
          oIdx.forEach((o) => { const v = db.val[db.idx(y, x.u, ai, o, si, e)]; if (!Number.isNaN(v)) { sum += v; any = true; } });
          if (any) per.set(`${x.u}|${ai}|${si}|${e}`, sum);
        }
      })));
      const sums = [...per.values()];
      if (sums.length && sums.some((v) => Math.abs(v - 100) > 1.5)) {
        warnings.push(`Les categories triades sumen ${fmtNum(Math.min(...sums))}${Math.max(...sums) - Math.min(...sums) > 0.5 ? '-' + fmtNum(Math.max(...sums)) : ''}%, no 100%: no són excloents o no cobreixen tota la població. Tria un sol grup complet (p. ex. espanyola + estrangera, o els tres llocs de naixement).`);
      }
    }

    // --- ajust iteratiu dels pesos de zona amb una població externa
    let ipfApplied = false;
    const zp = cfg.zonePop || {};
    const zpVals = zones.map((z) => Number(zp[z]) || 0);
    if (cfg.useZonePop && zpVals.some((v) => v > 0)) {
      if (zpVals.some((v) => !(v > 0))) errors.push('Per ajustar el pes de les zones cal informar la població de totes les zones.');
      else if (nZ < 2) warnings.push('L\'ajust de pes de zones no té efecte amb una sola zona.');
      else {
        const M = zones.map((_, z) => Array.from({ length: C }, (_, c) => cube[z * C + c]));
        const zsum = zpVals.reduce((a, b) => a + b, 0);
        const rowT = zpVals.map((v) => (v / zsum) * Utot);
        const colT = Array.from({ length: C }, (_, c) => M.reduce((a, r) => a + r[c], 0));
        const W = ipf(M, rowT, colT);
        W.forEach((r, z) => r.forEach((v, c) => { cube[z * C + c] = v; }));
        ipfApplied = true;
        const censShare = zones.map((_, z) => M[z].reduce((a, b) => a + b, 0) / Utot);
        const gap = zones.map((z, i) => `${z} ${pct(censShare[i])} → ${pct(rowT[i] / Utot)}`).join('; ');
        notes.push(`Pes de zones ajustat per iteració (IPF) a la població externa informada: ${gap}. L'estructura de sexe, edat i origen del municipi es manté.`);
        warnings.push('La població per zones informada s\'aplica com a pes relatiu. Si inclou tota la població (totes les edats i nacionalitats) i l\'univers és més restringit, se suposa que totes les zones tenen la mateixa proporció d\'univers: si una zona és més jove o té més estrangers, el seu pes quedarà sobreestimat.');
      }
    }

    // --- taules
    function tableUniv(rows, vars) {
      const plan = planColumns(vars, cats);
      const nR = rows === 'zona' ? nZ : 1;
      const U = Array.from({ length: nR }, () => new Array(plan.leaves.length).fill(0));
      const strides = vars.map((v) => cats[v].length);
      for (let z = 0; z < nZ; z++) for (let c = 0; c < C; c++) {
        const v = cube[z * C + c];
        if (!v) continue;
        const coords = coordsOf[c];
        let leaf = 0;
        vars.forEach((vn, i) => { leaf = leaf * strides[i] + coords[vn]; });
        U[rows === 'zona' ? z : 0][leaf] += v;
      }
      return { plan, U, nR };
    }

    const round = cfg.rounding === 'directe' ? 'directe' : 'lr';
    const tables = [];
    // les variables que la base no té no s'ofereixen: es treuen del disseny
    const avail = { sexe: db.has.sexe, edat: db.has.edat, origen: db.has.origen };
    db.extra.forEach((e) => { avail[e.key] = db.has[e.key]; });
    const clean = (t) => {
      const lost = (t.cols || []).filter((v) => !avail[v]);
      if (lost.length) notes.push(`La base no té ${lost.map((v) => vl(v).toLowerCase()).join(' ni ')}: s'ha tret del creuament.`);
      return Object.assign({}, t, { cols: (t.cols || []).filter((v) => avail[v]), rows: db.has.zona ? t.rows : 'cap' });
    };
    const mainCfg = clean(cfg.main || { rows: 'zona', cols: ['sexe', 'edat'] });
    cfg = Object.assign({}, cfg, { extras: (cfg.extras || []).map(clean) });
    const main = buildMain(mainCfg);
    tables.push(main);

    function buildMain(t) {
      const { plan, U, nR } = tableUniv(t.rows, t.cols);
      const raw = U.map((r) => r.map((u) => (u / Utot) * N));
      const R = raw.map((r) => r.map(xround));
      let Q = R;
      if (round === 'lr') {
        if (nR > 1) {
          const rowRaw = raw.map((r) => r.reduce((a, b) => a + b, 0));
          const rowT = largestRemainder(rowRaw, N);
          Q = raw.map((r, i) => largestRemainder(r, rowT[i]));
        } else Q = [largestRemainder(raw[0], N)];
      }
      return finish({ id: 'principal', mode: 'principal', rows: t.rows, vars: t.cols, plan, U, R, Q, nR });
    }

    (cfg.extras || []).forEach((t, k) => {
      const vars = t.cols || [];
      if (t.rows === 'zona' && main.rows !== 'zona' && t.mode === 'derivada') {
        errors.push(`Taula ${k + 2}: no es pot derivar per zona d'una taula principal sense zones; es calcula com a independent.`);
        t = Object.assign({}, t, { mode: 'independent' });
      }
      const subset = vars.every((v) => main.vars.includes(v));
      let mode = t.mode || 'derivada';
      if (mode === 'derivada' && !subset) {
        warnings.push(`Taula ${k + 2}: creua variables que no són a la taula principal (${vars.filter((v) => !main.vars.includes(v)).map(vl).join(', ')}); es calcula com a quota independent.`);
        mode = 'independent';
      }
      if (mode === 'independent' && t.rows === 'zona' && main.rows !== 'zona') {
        warnings.push(`Taula ${k + 2}: la taula principal no té zones; aquesta taula per zona es reparteix sobre la N total.`);
      }
      const { plan, U, nR } = tableUniv(t.rows, vars);
      let R, Q, ref = null;
      if (mode === 'derivada') {
        const map = plan.leaves.map((l) => main.plan.leaves
          .filter((ml) => vars.every((v, i) => ml.key[main.vars.indexOf(v)] === l.key[i]))
          .map((ml) => ml.leaf));
        Q = Array.from({ length: nR }, (_, r) => map.map((ms) => {
          const rows = t.rows === 'zona' ? [r] : main.Q.map((_, i) => i);
          return rows.reduce((acc, rr) => acc + ms.reduce((a, m) => a + main.Q[rr][m], 0), 0);
        }));
        R = Q;
        ref = map;
      } else {
        const byZone = t.rows === 'zona' && main.rows === 'zona';
        const raw = U.map((r, i) => {
          const urow = byZone ? r.reduce((a, b) => a + b, 0) : Utot;
          const target = byZone ? main.rowTotals[i] : N;
          return r.map((u) => (urow > 0 ? (u / urow) * target : 0));
        });
        R = raw.map((r) => r.map(xround));
        Q = R;
        if (round === 'lr') {
          if (byZone) Q = raw.map((r, i) => largestRemainder(r, main.rowTotals[i]));
          else if (nR > 1) {
            const rowT = largestRemainder(raw.map((r) => r.reduce((a, b) => a + b, 0)), N);
            Q = raw.map((r, i) => largestRemainder(r, rowT[i]));
          } else Q = [largestRemainder(raw[0], N)];
        }
        ref = byZone ? 'zona' : 'N';
      }
      tables.push(finish({ id: 'taula' + (k + 2), mode, rows: t.rows, vars, plan, U, R, Q, nR, ref, title: t.title }));
    });

    function finish(t) {
      t.A = t.Q.map((r, i) => r.map((q, j) => q - t.R[i][j]));
      t.rowLabels = t.rows === 'zona' ? zones.slice() : [cfg.municipiLabel || 'Total'];
      t.rowTotals = t.Q.map((r) => r.reduce((a, b) => a + b, 0));
      t.sum = t.rowTotals.reduce((a, b) => a + b, 0);
      t.colValues = (M, r) => t.plan.cols.map((c) => c.members.reduce((a, m) => a + M[r][m], 0));
      t.title = t.title || defaultTitle(t);
      return t;
    }

    function defaultTitle(t) {
      const parts = (t.rows === 'zona' ? ['ZONA'] : []).concat(t.vars.map((v) => vl(v).toUpperCase()));
      const what = parts.length ? 'QUOTES PER ' + joinCa(parts) : 'QUOTA TOTAL';
      const extra = t.mode === 'derivada' ? ' (suma de la taula principal)' : t.mode === 'independent' ? ' (quota independent)' : '';
      return what + (t.rows === 'cap' ? ', TOTAL ÀMBIT' : '') + extra;
    }

    // --- diagnòstic de la taula principal
    const thr = cfg.threshold == null ? 2 : Number(cfg.threshold);
    const cells = main.Q.flat();
    const small = cells.filter((v) => v <= thr).length;
    const zeroCols = main.plan.leaves.filter((l) => main.Q.every((r) => r[l.leaf] === 0)).map((l) => l.labels.filter(Boolean).join(' · '));
    const zeroCells = [];
    main.Q.forEach((r, i) => r.forEach((v, j) => { if (v === 0 && main.U[i][j] > 0) zeroCells.push(`${main.rowLabels[i]}: ${main.plan.leaves[j].labels.filter(Boolean).join(' · ')}`); }));
    const moe = (n, U) => (db.isShare ? (n > 0 ? 1.96 * Math.sqrt(0.25 / n) : NaN) : n > 0 && U > 1 ? 1.96 * Math.sqrt(0.25 / n) * Math.sqrt(Math.max(0, U - n) / (U - 1)) : NaN);
    const zoneStats = main.rows === 'zona' ? zones.map((z, i) => {
      const u = main.U[i].reduce((a, b) => a + b, 0);
      const cu = census.slice(i * C, (i + 1) * C).reduce((a, b) => a + b, 0);
      return { zona: z, univers: u, censUnivers: cu, quota: main.rowTotals[i], moe: moe(main.rowTotals[i], cu) };
    }) : [];

    if (main.sum !== N) warnings.push(`La suma de quotes (${main.sum}) no coincideix amb la N (${N}): diferència de ${signed(main.sum - N)} per l'arrodoniment directe. ${suggestAdjust(main, N)}`);
    if (cells.length && small / cells.length > 0.2) {
      warnings.push(`${small} de ${cells.length} cel·les de la taula principal (${pct(small / cells.length)}) tenen una quota de ${thr} o menys: no són operatives a camp. Redueix el creuament, passa alguna variable a quota marginal (taula independent) o acorda una tolerància.`);
    }
    if (zeroCols.length) warnings.push(`Categories que queden a 0 a tot l'àmbit: ${zeroCols.join('; ')}.`);
    const thin = zoneStats.filter((z) => z.quota < 50);
    if (thin.length > 3) {
      notes.push(`${thin.length} de ${zoneStats.length} zones tenen menys de 50 entrevistes (entre ${Math.min(...thin.map((z) => z.quota))} i ${Math.max(...thin.map((z) => z.quota))}): serveixen per controlar la distribució territorial, però els seus resultats no són llegibles per separat. Si cal llegir-les, agrupa zones o augmenta la N.`);
    } else thin.forEach((z) => notes.push(`${z.zona}: ${z.quota} entrevistes (error ±${pct1(z.moe)}). Els resultats d'aquesta zona no són llegibles per separat.`));

    if (db.isShare && db.has.sexe && tables.some((t) => t.vars.includes('sexe'))) {
      warnings.push('Amb una base de percentatges, el repartiment entre sexes no surt de les dades: es dona el mateix pes a cada sexe (50%). Si la quota de sexe ha de ser exacta, fes servir una base amb població absoluta.');
    }
    const included = oIdx.map((o) => low(db.originLabels[o]));
    const ovar = low(db.originVar || '');
    const byBirth = /naixement|nacimiento/.test(ovar) || included.some((x) => /nascud/.test(x));
    const byNat = /nacionalitat|nacionalidad/.test(ovar) || included.some((x) => /^(espanyola|estrangera)$/.test(x));
    if (byBirth && !byNat) {
      warnings.push('Les dades són per lloc de naixement, no per nacionalitat: excloure els nascuts a l\'estranger infraestima els espanyols (deixa fora els nacionalitzats) i incloure\'ls sobreestima l\'electorat.');
    } else if (byNat && !byBirth) {
      if (included.length === 1 && /espanyol/.test(included[0])) {
        notes.push('Univers de nacionalitat espanyola: s\'aproxima a l\'electorat de les eleccions generals i autonòmiques, però a les municipals també voten els residents de la UE (i d\'alguns països amb conveni), que aquí queden fora.');
      } else if (included.length > 1 && !mainCfg.cols.includes('origen')) {
        notes.push('L\'univers inclou residents de nacionalitat estrangera. Si l\'estudi és de clima electoral, una part d\'aquest univers no té dret a vot.');
      }
    }

    return {
      N, Utot, zones, cats, bands, bandLabels: labels, origins: oIdx, tables, main, cube, census,
      ipfApplied, year: db.years[y], minAge, maxAge, isShare: db.isShare, has: db.has,
      varLabels: Object.fromEntries(Object.keys(cats).map((k) => [k, vl(k)])),
      diag: {
        cells: cells.length, small, smallPct: cells.length ? small / cells.length : 0, threshold: thr,
        zeroCols, zeroCells, zoneStats, moe: moe(N, Utot), confidential,
        dist: [0, 1, 2, 3, 4].map((k) => cells.filter((v) => v === k).length),
      },
      errors, warnings, notes,
    };
  }

  function suggestAdjust(t, N) {
    const diff = t.sum - N;
    if (!diff || t.nR < 2) return '';
    const rawRow = t.U.map((r) => r.reduce((a, b) => a + b, 0));
    const tot = rawRow.reduce((a, b) => a + b, 0);
    const gap = t.rowTotals.map((q, i) => q - (rawRow[i] / tot) * N);
    const i = diff > 0 ? gap.indexOf(Math.max(...gap)) : gap.indexOf(Math.min(...gap));
    return `On més s'ha ${diff > 0 ? 'inflat' : 'reduït'} la quota per l'arrodoniment és a ${t.rowLabels[i]} (${signed(Math.round(gap[i] * 10) / 10)}).`;
  }

  function joinCa(parts) { return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' I ' + parts[parts.length - 1]; }
  function fmtNum(x) { return (Math.round(x * 10) / 10).toString().replace('.', ','); }
  function pct(x) { return (x * 100).toFixed(0).replace('.', ',') + '%'; }
  function pct1(x) { return Number.isFinite(x) ? (x * 100).toFixed(1).replace('.', ',') + '%' : '—'; }
  function signed(x) { return (x > 0 ? '+' : '') + String(x).replace('.', ','); }
  function fmtFrac(f) {
    for (let d = 2; d <= 10; d++) { const n = Math.round(f * d); if (Math.abs(n / d - f) < 1e-9) return `${n}/${d}`; }
    return f.toFixed(3);
  }

  /** Files del cens utilitzades (any i unitats seleccionades), per al full de traçabilitat. */
  function sourceRows(db, cfg) {
    const y = db.years.indexOf(String(cfg.year));
    const out = [];
    cfg.units.forEach((x) => {
      db.ages.forEach((a, ai) => db.origins.forEach((o, oi) => db.sexes.forEach((s, si) => {
        for (let e = 0; e < db.E; e++) {
          const v = db.val[db.idx(y, x.u, ai, oi, si, e)];
          const ex = [];
          let r = e;
          for (let k = db.extra.length - 1; k >= 0; k--) { ex.unshift(db.extra[k].cats[r % db.extra[k].cats.length]); r = Math.floor(r / db.extra[k].cats.length); }
          out.push([db.years[y], db.units[x.u].name, a.label, o, s, ...ex, Number.isNaN(v) ? null : v, Number.isNaN(v) ? '..' : '']);
        }
      })));
    });
    return out;
  }

  /** Zones per defecte d'un municipi: cada agrupació censal, amb el nom del parèntesi. */
  function defaultZones(db, muniName) {
    const m = db.munis.find((x) => x.name === muniName);
    if (!m) return [];
    const single = m.units.length === 1;
    return m.units.slice().sort((a, b) => db.units[a].num - db.units[b].num).map((u) => ({
      u, zona: single ? niceMuni(db.units[u].muni) : cap(db.units[u].desc),
    }));
  }

  return {
    parseCensusText, fromCompact, toCompact, compute, planColumns, largestRemainder, xround,
    sourceRows, defaultZones, parseUnit, niceMuni, parseAge, bandLabels, cap, VAR_NAMES, joinCa,
    pct, pct1,
  };
});
