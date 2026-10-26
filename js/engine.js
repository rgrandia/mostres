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
    zona: ['agrupaci', 'secci', 'districte', 'barri', 'zona', 'municipi'],
    edat: ['edat', 'edad', 'age'],
    origen: ['nacionalitat', 'nacionalidad', 'lloc de naixement', 'naixement', 'nacimiento', 'origen'],
    sexe: ['sexe', 'sexo', 'gènere', 'genere'],
    valor: ['valor', 'value', 'població', 'poblacio'],
    estat: ['estat', 'estado', 'flag'],
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

  /**
   * Llegeix un CSV del cens en format llarg (una fila per combinació) i el
   * converteix en el cub intern. Les files de totals s'eliminen.
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
    for (const r of ['zona', 'edat', 'sexe', 'valor']) {
      if (col[r] == null) throw new Error(`No trobo la columna de «${r}» a la capçalera: ${header.join(' | ')}`);
    }
    const dims = { any: new Map(), zona: new Map(), edat: new Map(), origen: new Map(), sexe: new Map() };
    const add = (m, k) => { let i = m.get(k); if (i == null) { i = m.size; m.set(k, i); } return i; };
    const recs = [];
    let nRows = 0;
    for (let li = 1; li < lines.length; li++) {
      const line = lines[li];
      if (!line) continue;
      const f = splitLine(line, delim);
      nRows++;
      const z = norm(f[col.zona]), e = norm(f[col.edat]), s = norm(f[col.sexe]);
      const o = col.origen != null ? norm(f[col.origen]) : 'Tots';
      const y = col.any != null ? norm(f[col.any]) : '—';
      if (!z || isTotal(e) || isTotal(s) || (col.origen != null && isTotal(o))) continue;
      let v = parseNumber(f[col.valor]);
      if (col.estat != null && norm(f[col.estat]) === '..') v = NaN;
      recs.push(add(dims.any, y), add(dims.zona, z), add(dims.edat, e), add(dims.origen, o), add(dims.sexe, s), v);
    }
    if (!recs.length) throw new Error('El fitxer no té cap fila de dades aprofitable.');
    const ages = [...dims.edat.keys()].map((label) => Object.assign({ label }, parseAge(label)));
    const bad = ages.filter((a) => a.lo == null);
    if (bad.length) throw new Error('Etiquetes d\'edat que no sé interpretar: ' + bad.map((a) => a.label).join(', '));

    // ordre: anys numèric, edats per límit inferior; la resta, ordre d'aparició
    const yearsRaw = [...dims.any.keys()];
    const yOrder = yearsRaw.map((y, i) => i).sort((a, b) => Number(yearsRaw[a]) - Number(yearsRaw[b]));
    const aOrder = ages.map((a, i) => i).sort((a, b) => ages[a].lo - ages[b].lo);
    const remap = (order) => { const r = new Array(order.length); order.forEach((old, nw) => { r[old] = nw; }); return r; };
    const yMap = remap(yOrder), aMap = remap(aOrder);

    const db = makeDb({
      years: yOrder.map((i) => yearsRaw[i]),
      units: [...dims.zona.keys()],
      ages: aOrder.map((i) => ages[i]),
      origins: [...dims.origen.keys()],
      sexes: [...dims.sexe.keys()],
      originVar: col.origen != null ? header[col.origen] : null,
      source: { file: opts.fileName || 'cens.csv', rows: nRows, columns: header },
    });
    for (let i = 0; i < recs.length; i += 6) {
      const k = db.idx(yMap[recs[i]], recs[i + 1], aMap[recs[i + 2]], recs[i + 3], recs[i + 4]);
      db.val[k] = recs[i + 5];
    }
    return db;
  }

  function makeDb(d) {
    const nY = d.years.length, nU = d.units.length, nA = d.ages.length, nO = d.origins.length, nS = d.sexes.length;
    const db = {
      years: d.years.map(String),
      units: d.units.map(parseUnit),
      ages: d.ages.map((a) => (typeof a === 'string' ? Object.assign({ label: a }, parseAge(a)) : a)),
      origins: d.origins,
      sexes: d.sexes,
      originVar: d.originVar,
      source: d.source || {},
      val: d.val || new Float64Array(nY * nU * nA * nO * nS).fill(NaN),
      idx: (y, u, a, o, s) => ((((y * nU + u) * nA + a) * nO + o) * nS + s),
    };
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
      origins: db.origins, sexes: db.sexes, originVar: db.originVar, source: db.source,
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
    const y = db.years.indexOf(String(cfg.year));
    if (y < 0) throw new Error('Any no disponible a la base de dades: ' + cfg.year);
    if (!cfg.units || !cfg.units.length) throw new Error('Cal seleccionar com a mínim una unitat territorial.');
    const N = Math.max(1, Math.round(Number(cfg.N) || 0));

    const zones = [];
    cfg.units.forEach((x) => { const z = norm(x.zona) || db.units[x.u].name; if (!zones.includes(z)) zones.push(z); });
    const zoneOf = cfg.units.map((x) => zones.indexOf(norm(x.zona) || db.units[x.u].name));

    // --- edats: franges de quota sobre les franges del cens
    const minAge = Number(cfg.minAge) || 0;
    const maxAge = cfg.maxAge == null || cfg.maxAge === '' ? Infinity : Number(cfg.maxAge);
    const bands = (cfg.bands && cfg.bands.length ? cfg.bands : [minAge]).map(Number).sort((a, b) => a - b);
    if (bands[0] !== minAge) bands[0] = minAge;
    const censusLows = db.ages.map((a) => a.lo);
    const misaligned = bands.slice(1).filter((b) => !censusLows.includes(b));
    if (misaligned.length) {
      throw new Error(`Els talls d'edat ${misaligned.join(', ')} no coincideixen amb l'inici de cap franja del cens (${censusLows.join(', ')}).`);
    }
    if (Number.isFinite(maxAge) && !db.ages.some((a) => a.hi === maxAge)) {
      throw new Error(`L'edat màxima ${maxAge} no coincideix amb el final de cap franja del cens.`);
    }
    const ageMap = db.ages.map((a) => {
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
    const labels = cfg.bandLabels && cfg.bandLabels.length === bands.length ? cfg.bandLabels : bandLabels(bands, maxAge);

    const oIdx = (cfg.origins && cfg.origins.length ? cfg.origins : db.origins.map((o, i) => i)).slice().sort((a, b) => a - b);
    const cats = {
      sexe: db.sexes.map(cap),
      edat: labels,
      origen: oIdx.map((o) => cap(db.origins[o])),
    };
    const nZ = zones.length, nS = cats.sexe.length, nB = bands.length, nO = oIdx.length;

    // --- cub de l'univers: zona × sexe × franja × origen
    const cube = new Float64Array(nZ * nS * nB * nO);
    const ci = (z, s, b, o) => ((z * nS + s) * nB + b) * nO + o;
    let confidential = 0;
    const confUnits = new Set();
    cfg.units.forEach((x, k) => {
      const z = zoneOf[k];
      ageMap.forEach((m, a) => {
        if (!m) return;
        oIdx.forEach((o, oi) => {
          for (let s = 0; s < nS; s++) {
            const v = db.val[db.idx(y, x.u, a, o, s)];
            if (Number.isNaN(v)) { confidential++; confUnits.add(db.units[x.u].name); continue; }
            cube[ci(z, s, m.band, oi)] += v * m.frac;
          }
        });
      });
    });
    if (confidential) {
      warnings.push(`Hi ha ${confidential} cel·les del cens sense dada (secret estadístic «..» o inexistents) a: ${[...confUnits].join('; ')}. S'han comptat com a 0, de manera que aquestes zones queden infrarepresentades.`);
    }
    const census = Float64Array.from(cube);
    const Utot = cube.reduce((a, b) => a + b, 0);
    if (!(Utot > 0)) throw new Error('L\'univers seleccionat és buit (0 persones). Revisa l\'any, les zones i els filtres.');

    // --- ajust iteratiu dels pesos de zona amb una població externa
    let ipfApplied = false;
    const zp = cfg.zonePop || {};
    const zpVals = zones.map((z) => Number(zp[z]) || 0);
    if (cfg.useZonePop && zpVals.some((v) => v > 0)) {
      if (zpVals.some((v) => !(v > 0))) errors.push('Per ajustar el pes de les zones cal informar la població de totes les zones.');
      else if (nZ < 2) warnings.push('L\'ajust de pes de zones no té efecte amb una sola zona.');
      else {
        const C = nS * nB * nO;
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
      const pos = { sexe: -1, edat: -1, origen: -1 };
      vars.forEach((v, i) => { pos[v] = i; });
      const strides = vars.map((v) => cats[v].length);
      for (let z = 0; z < nZ; z++) for (let s = 0; s < nS; s++) for (let b = 0; b < nB; b++) for (let o = 0; o < nO; o++) {
        const v = cube[ci(z, s, b, o)];
        if (!v) continue;
        const coords = { sexe: s, edat: b, origen: o };
        let leaf = 0;
        vars.forEach((vn, i) => { leaf = leaf * strides[i] + coords[vn]; });
        U[rows === 'zona' ? z : 0][leaf] += v;
      }
      return { plan, U, nR };
    }

    const round = cfg.rounding === 'directe' ? 'directe' : 'lr';
    const tables = [];
    const mainCfg = cfg.main || { rows: 'zona', cols: ['sexe', 'edat'] };
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
        warnings.push(`Taula ${k + 2}: creua variables que no són a la taula principal (${vars.filter((v) => !main.vars.includes(v)).map((v) => VAR_NAMES[v]).join(', ')}); es calcula com a quota independent.`);
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
      const parts = (t.rows === 'zona' ? ['ZONA'] : []).concat(t.vars.map((v) => VAR_NAMES[v].toUpperCase()));
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
    const moe = (n, U) => (n > 0 && U > 1 ? 1.96 * Math.sqrt(0.25 / n) * Math.sqrt(Math.max(0, U - n) / (U - 1)) : NaN);
    const zoneStats = main.rows === 'zona' ? zones.map((z, i) => {
      const u = main.U[i].reduce((a, b) => a + b, 0);
      const cu = census.slice(i * nS * nB * nO, (i + 1) * nS * nB * nO).reduce((a, b) => a + b, 0);
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

    const included = oIdx.map((o) => low(db.origins[o]));
    const varName = low(db.originVar || '');
    if (/nacionalitat|nacionalidad/.test(varName)) {
      if (included.length === 1 && /espanyol/.test(included[0])) {
        notes.push('Univers de nacionalitat espanyola: s\'aproxima a l\'electorat de les eleccions generals i autonòmiques, però a les municipals també voten els residents de la UE (i d\'alguns països amb conveni), que aquí queden fora.');
      } else if (included.length > 1 && !mainCfg.cols.includes('origen')) {
        notes.push('L\'univers inclou residents de nacionalitat estrangera. Si l\'estudi és de clima electoral, una part d\'aquest univers no té dret a vot.');
      }
    } else if (/naixement|nacimiento/.test(varName)) {
      warnings.push('Les dades són per lloc de naixement, no per nacionalitat: excloure els nascuts a l\'estranger infraestima els espanyols (deixa fora els nacionalitzats) i incloure\'ls sobreestima l\'electorat.');
    }

    return {
      N, Utot, zones, cats, bands, bandLabels: labels, origins: oIdx, tables, main, cube, census,
      ipfApplied, year: db.years[y], minAge, maxAge,
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
        const v = db.val[db.idx(y, x.u, ai, oi, si)];
        out.push([db.years[y], db.units[x.u].name, a.label, o, s, Number.isNaN(v) ? null : v, Number.isNaN(v) ? '..' : '']);
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
