/* Interfície del generador de mostres. Depèn de Mostres (engine.js), MostresExport (export.js), ExcelJS i JSZip. */
(function () {
  'use strict';
  const M = window.Mostres;
  const $ = (s, el) => (el || document).querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((k) => { if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k))); });
    return el;
  };
  const fmt = (x, d) => (Number.isFinite(x) ? x.toLocaleString('ca-ES', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }) : '—');
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  const VARS = [['sexe', 'Sexe'], ['edat', 'Edat'], ['origen', 'Origen']];
  const STORE_KEY = 'mostres.cfg.v1';

  let db = null;
  let dbLabel = '';
  let result = null;
  let state = null;

  // ------------------------------------------------------------ estat i persistència
  function defaultState() {
    // l'aplicatiu s'obre en blanc: sense municipi triat (si la base té zones)
    const muni = db.has.zona ? null : db.munis[0];
    return {
      estudi: '', anyEstudi: String(new Date().getFullYear()), titol: '', univers: '', font: '',
      year: db.years[db.years.length - 1], munis: muni ? [muni.name] : [],
      units: muni ? M.defaultZones(db, muni.name).map((z) => Object.assign(z, { inc: true, name: db.units[z.u].name })) : [],
      minAge: 18, maxAge: '', bands: '18, 30, 45, 60',
      origins: defaultOrigins(),
      N: 400, rounding: 'lr', threshold: 2, cawiPct: 0,
      ...defaultDesign(),
      useZonePop: false, zonePop: {}, districts: [],
    };
  }
  function defaultOrigins() {
    const all = db.origins.map((o, i) => i);
    const lab = (i) => String(db.originLabels[i]).toLowerCase();
    if (db.isShare) {
      // en bases de percentatges cal un grup de categories excloents que sumi el 100%
      const nat = all.filter((i) => /^(espanyola|estrangera)$/.test(lab(i)));
      if (nat.length > 1) return nat;
      const birth = all.filter((i) => /nascud.*(catalunya|resta|estranger)/.test(lab(i)));
      if (birth.length > 1) return birth;
      return all;
    }
    const esp = all.filter((i) => /espanyol/.test(lab(i)));
    return esp.length ? esp : all;
  }
  function defaultDesign() {
    const has = db.has;
    const base = ['sexe', 'edat'].filter((v) => has[v]);
    const cols = db.isShare && has.origen ? ['origen'] : base.length ? base : has.origen ? ['origen'] : [];
    return {
      main: { rows: has.zona ? 'zona' : 'cap', cols },
      extras: has.zona && cols.length ? [{ rows: 'cap', cols: cols.slice(), mode: 'derivada' }, { rows: 'zona', cols: [], mode: 'derivada' }] : [],
    };
  }
  /** Treu del disseny les variables que la base actual no té. */
  function sanitize(st) {
    const fix = (t) => Object.assign(t, { cols: (t.cols || []).filter((v) => db.has[v]), rows: db.has.zona ? t.rows : 'cap' });
    fix(st.main);
    st.extras = (st.extras || []).map(fix).filter((t) => t.cols.length || t.rows === 'zona');
    st.origins = (st.origins || []).filter((i) => i < db.origins.length);
    if (!st.origins.length) st.origins = defaultOrigins();
    if (!db.years.includes(String(st.year))) st.year = db.years[db.years.length - 1];
    return st;
  }
  function save() { if (!state.units.some((x) => x.inc)) return; try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* sense emmagatzematge */ } }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && s.units && s.munis && db.years.includes(String(s.year))) {
        // les unitats es desen pel nom: una base nova pot tenir un altre ordre
        s.units = s.units.map((x) => Object.assign({}, x, { u: db.units.findIndex((n) => n.name === x.name) })).filter((x) => x.u >= 0);
        s.munis = s.munis.filter((m) => db.munis.some((x) => x.name === m));
        if (s.units.length && s.munis.length) return sanitize(Object.assign(defaultState(), s));
      }
    } catch (e) { /* configuració antiga o malmesa */ }
    return null;
  }

  const idb = {
    open() { return new Promise((res, rej) => { const r = indexedDB.open('mostres', 1); r.onupgradeneeded = () => r.result.createObjectStore('db'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async get(k) { const d = await this.open(); return new Promise((res, rej) => { const q = d.transaction('db').objectStore('db').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
    async set(k, v) { const d = await this.open(); return new Promise((res, rej) => { const t = d.transaction('db', 'readwrite'); t.objectStore('db').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
    async del(k) { const d = await this.open(); return new Promise((res) => { const t = d.transaction('db', 'readwrite'); t.objectStore('db').delete(k); t.oncomplete = () => res(); t.onerror = () => res(); }); },
  };

  // ------------------------------------------------------------ lectura de fitxers
  async function decode(buf) {
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buf);
    return text;
  }
  async function readFile(file) {
    const name = file.name;
    const buf = await file.arrayBuffer();
    if (/\.zip$/i.test(name)) {
      const zip = await JSZip.loadAsync(buf);
      const entry = Object.values(zip.files).find((f) => /\.(csv|txt)$/i.test(f.name) && !f.dir);
      if (!entry) throw new Error('El ZIP no conté cap fitxer CSV.');
      return M.parseCensusText(await decode(await entry.async('uint8array')), { fileName: entry.name });
    }
    if (/\.xlsx$/i.test(name)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0];
      const lines = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const v = row.values.slice(1).map((c) => (c && typeof c === 'object' ? (c.result != null ? c.result : c.text || '') : c == null ? '' : c));
        lines.push(v.map((x) => String(x).replace(/;/g, ',')).join(';'));
      });
      return M.parseCensusText(lines.join('\n'), { fileName: name });
    }
    return M.parseCensusText(await decode(buf), { fileName: name });
  }

  async function onUpload(file) {
    const st = $('#db-status');
    st.textContent = `Llegint ${file.name}…`;
    try {
      const t0 = performance.now();
      const nd = await readFile(file);
      const oldNames = state ? state.units.map((x) => ({ name: x.name, zona: x.zona, inc: x.inc })) : [];
      const sig = (d) => ['zona', 'sexe', 'edat', 'origen'].map((k) => (d.has[k] ? 1 : 0)).join('') + (d.isShare ? '%' : '');
      const sameShape = db && sig(db) === sig(nd);
      db = nd;
      dbLabel = `${nd.source.file} (carregada ${new Date().toLocaleDateString('ca-ES')})`;
      try { await idb.set('custom', { name: file.name, blob: file, date: Date.now() }); } catch (e) { /* no es pot desar al navegador */ }
      const keep = state;
      state = defaultState();
      if (keep) {
        // el disseny de taules només es conserva si la base nova té les mateixes variables
        ['estudi', 'anyEstudi', 'minAge', 'maxAge', 'bands', 'N', 'rounding', 'threshold', 'cawiPct'].concat(sameShape ? ['main', 'extras'] : [])
          .forEach((k) => { state[k] = keep[k]; });
        const sameMunis = keep.munis.filter((m) => db.munis.some((x) => x.name === m));
        if (sameMunis.length) {
          state.munis = sameMunis;
          state.units = sameMunis.flatMap((m) => M.defaultZones(db, m)).map((z) => {
            const old = oldNames.find((x) => x.name === db.units[z.u].name);
            return Object.assign(z, { inc: true, name: db.units[z.u].name }, old ? { zona: old.zona, inc: old.inc } : {});
          });
        }
      }
      sanitize(state);
      st.textContent = `Base carregada en ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
      renderAll();
    } catch (e) {
      st.textContent = 'No s\'ha pogut llegir el fitxer: ' + e.message;
    }
  }

  // ------------------------------------------------------------ configuració per al motor
  function engineCfg() {
    const bands = String(state.bands).split(/[,;\s]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0 || x === 0);
    const units = state.units.filter((x) => x.inc).map((x) => ({ u: x.u, zona: x.zona }));
    return {
      year: state.year, units, minAge: Number(state.minAge), maxAge: state.maxAge === '' ? null : Number(state.maxAge),
      bands: bands.length ? bands : [Number(state.minAge)], origins: state.origins, N: Number(state.N),
      rounding: state.rounding, threshold: Number(state.threshold), cawiPct: Number(state.cawiPct) || 0,
      main: state.main, extras: state.extras, useZonePop: state.useZonePop, zonePop: state.zonePop,
      municipiLabel: muniLabel(),
    };
  }
  function muniLabel() {
    if (!db.has.zona) return db.territory || db.units[0].name || 'Total';
    return state.munis.length === 1 ? M.niceMuni(state.munis[0]) : 'Total àmbit';
  }
  function autoTexts(res) {
    const o = res ? res.cats.origen : [];
    const labs = o.map((x) => x.toLowerCase());
    const one = o.length === 1 && o.length < db.origins.length ? labs[0] : '';
    const qual = one ? (/^nascud/.test(one) ? ' ' + one : /naixement/i.test(db.originVar || '') ? ' nascuda a ' + one : ' de nacionalitat ' + one) : '';
    const univ = db.has.edat
      ? `Població de ${state.minAge}${state.maxAge !== '' ? ' a ' + state.maxAge : ''} anys${state.maxAge !== '' ? '' : ' i més'}${qual}`
      : `Població total (totes les edats)${qual}`;
    const isAgrup = db.has.zona && db.units.some((u) => u.num > 0);
    let font = isAgrup ? `Cens de població ${state.year} per agrupació censal (Idescat)` : `${db.source.file || 'Dades'}${db.has.any ? ', ' + state.year : ''}`;
    if (db.isShare) font += ' (percentatges)';
    if (res) {
      const part = res.notes.find((n) => n.startsWith('Edat:'));
      if (part) {
        const m = part.match(/«(.+?)».*?proporció de ([\d/.,]+)/);
        if (m) font += `; ${state.minAge}-${m[1].match(/\d+/g)[1]} anys = ${m[2]} de la franja ${m[1].replace(/^de /, '').replace(' anys', '').replace(' a ', '-')}`;
      }
      if (res.ipfApplied) font += '. Pes de zones: població externa informada (ajust iteratiu)';
    }
    return { univers: univ, font };
  }

  // ------------------------------------------------------------ càlcul i render
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { save(); recompute(); }, 120); }

  function recompute() {
    const out = $('#results');
    if (!state.units.some((x) => x.inc)) {
      result = null;
      const saved = load();
      out.replaceChildren(h('section', { class: 'res-block empty' },
        h('h3', {}, 'Tria l\'àmbit de l\'estudi'),
        h('p', {}, 'Escriu un municipi al pas 3 («Àmbit i zones») i prem «Tria». Les zones, les quotes i el diagnòstic apareixeran aquí.'),
        saved ? h('p', {}, h('button', { type: 'button', class: 'btn', onclick: () => { state = saved; renderAll(); } },
          `Recupera l'últim disseny (${saved.munis.map(M.niceMuni).join(', ')}${saved.estudi ? ' · estudi ' + saved.estudi : ''})`)) : null));
      $('#export').disabled = true;
      $('#fname').textContent = '';
      return;
    }
    try {
      result = M.compute(db, engineCfg());
      renderResults();
    } catch (e) {
      result = null;
      out.replaceChildren(h('div', { class: 'alert bad' }, h('strong', {}, 'No es pot calcular la mostra. '), e.message));
    }
    $('#export').disabled = !result;
    const t = autoTexts(result);
    $('#f-univers').placeholder = t.univers;
    $('#f-font').placeholder = t.font;
    $('#f-titol').placeholder = result ? result.main.title : '';
    $('#fname').textContent = fileName();
    const act = document.activeElement;
    if (!act || !act.closest('#units')) renderZones();
    if (!act || !act.closest('#districts') || act.id === 'd-search' || act.type === 'checkbox') renderDistricts();
  }

  function fileName() {
    const mun = state.munis.length === 1 ? M.niceMuni(state.munis[0]) : 'Ambit';
    const camel = mun.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['\u2019]/g, '').split(/[\s-]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : '')).join('');
    return `${state.estudi || 'XXXX'}_Enq${camel}_${state.anyEstudi}_Mostra.xlsx`;
  }

  function renderResults() {
    const r = result, d = r.diag, out = $('#results');
    const thr = d.threshold;
    const kpis = h('div', { class: 'kpis' },
      r.isShare ? kpi('Univers', 'en %', `la base dona percentatges · ${r.year}`, 'warn') : kpi('Univers', fmt(r.Utot), `${r.zones.length} ${r.zones.length === 1 ? 'zona' : 'zones'} · ${r.year}`),
      kpi('Mostra', fmt(r.N), r.main.sum === r.N ? 'la suma de quotes quadra' : `suma ${fmt(r.main.sum)} (${r.main.sum > r.N ? '+' : ''}${r.main.sum - r.N})`, r.main.sum === r.N ? 'ok' : 'warn'),
      kpi('Error mostral', '±' + M.pct1(d.moe), r.isShare ? '95%, p=q=50%, població infinita' : '95%, p=q=50%'),
      kpi(`Cel·les ≤ ${thr}`, `${d.small} de ${d.cells}`, M.pct(d.smallPct) + ' de la taula principal', d.smallPct > 0.2 ? 'bad' : d.smallPct > 0.1 ? 'warn' : 'ok'),
    );
    const alerts = h('div', { class: 'alerts' },
      r.errors.map((e) => h('div', { class: 'alert bad' }, e)),
      r.warnings.map((e) => h('div', { class: 'alert warn' }, e)),
      r.notes.map((e) => h('div', { class: 'alert note' }, e)),
    );
    const dist = h('p', { class: 'dist' }, 'Distribució de quotes a la taula principal: ',
      d.dist.map((n, k) => h('span', { class: 'chip' + (k <= thr ? ' small' : '') }, `${k}: ${n}`)),
      h('span', { class: 'chip' }, `5+: ${d.cells - d.dist.reduce((a, b) => a + b, 0)}`));
    const zoneTbl = d.zoneStats.length ? h('div', { class: 'scroll' }, h('table', { class: 'q zones' },
      h('thead', {}, h('tr', {}, ['Zona', 'Univers (cens)', r.ipfApplied ? 'Univers ajustat' : null, 'Quota', 'Error ±'].filter(Boolean).map((x) => h('th', {}, x)))),
      h('tbody', {}, d.zoneStats.map((z) => h('tr', {}, h('th', {}, z.zona), h('td', {}, fmt(z.censUnivers)), r.ipfApplied ? h('td', {}, fmt(z.univers)) : null,
        h('td', { class: z.quota < 50 ? 'lowz' : '' }, fmt(z.quota)), h('td', {}, M.pct1(z.moe))))))) : null;
    out.replaceChildren(kpis, alerts,
      db.has.zona ? h('section', { class: 'res-block' }, h('h3', {}, 'Mida per zona'), zoneTbl || h('p', { class: 'muted' }, 'La taula principal no té zones.')) : '',
      h('section', { class: 'res-block' }, h('h3', {}, 'Quotes'), dist, r.tables.map((t) => tableView(t, t === r.main ? thr : null))));
  }

  function kpi(label, value, sub, tone) {
    return h('div', { class: 'kpi' + (tone ? ' ' + tone : '') }, h('span', { class: 'k-label' }, label), h('span', { class: 'k-value' }, value), h('span', { class: 'k-sub' }, sub));
  }

  function tableView(t, thr) {
    const plan = t.plan;
    const thead = h('thead');
    for (let lvl = 0; lvl < plan.depth; lvl++) {
      const tr = h('tr');
      if (lvl === 0) tr.append(h('th', { rowspan: plan.depth, class: 'corner' }, t.rows === 'zona' ? 'Zona' : ''));
      let c = 0;
      while (c < plan.cols.length) {
        const lab = plan.cols[c].labels[lvl];
        const key = plan.cols[c].labels.slice(0, lvl + 1).join('\u0001');
        let c2 = c;
        while (c2 + 1 < plan.cols.length && plan.cols[c2 + 1].labels.slice(0, lvl + 1).join('\u0001') === key) c2++;
        if (lab !== '') {
          const down = plan.cols.slice(c, c2 + 1).every((x) => x.labels.slice(lvl + 1).every((y) => y === ''));
          tr.append(h('th', { colspan: c2 - c + 1 > 1 ? c2 - c + 1 : null, rowspan: down && plan.depth - lvl > 1 ? plan.depth - lvl : null,
            class: lab.startsWith('TOTAL') ? 'tot' : lab === 'Total' ? 'sub' : null }, lab));
        }
        c = c2 + 1;
      }
      thead.append(tr);
    }
    const tbody = h('tbody');
    const rowsQ = t.Q.map((r) => t.colValues(t.Q, t.Q.indexOf(r)));
    t.Q.forEach((_, i) => {
      const vals = t.colValues(t.Q, i);
      tbody.append(h('tr', {}, h('th', {}, t.rowLabels[i]), plan.cols.map((c, j) => {
        const v = vals[j];
        const cls = c.kind === 'leaf' ? (thr != null && v <= thr ? 'small' : '') : c.kind === 'total' || c.key.length === 1 ? 'tot' : 'sub';
        return h('td', { class: cls, title: c.kind === 'leaf' ? `Univers: ${fmt(t.U[i][c.leaf], 1)}${t.A[i][c.leaf] ? ` · ajust ${t.A[i][c.leaf] > 0 ? '+' : ''}${t.A[i][c.leaf]}` : ''}` : null }, fmt(v));
      })));
    });
    if (t.nR > 1) {
      const tot = plan.cols.map((c, j) => rowsQ.reduce((a, r) => a + r[j], 0));
      tbody.append(h('tr', { class: 'total' }, h('th', {}, 'TOTAL'), tot.map((v) => h('td', {}, fmt(v)))));
    }
    const badge = t.mode === 'principal' ? 'principal' : t.mode === 'derivada' ? 'suma de la principal' : 'quota independent';
    return h('figure', { class: 'qt' }, h('figcaption', {}, h('span', {}, t.title), h('span', { class: 'badge ' + t.mode }, badge)),
      h('div', { class: 'scroll' }, h('table', { class: 'q' }, thead, tbody)));
  }

  // ------------------------------------------------------------ formulari
  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'f-label' }, label), input, hint ? h('span', { class: 'f-hint' }, hint) : null);
  }
  function bind(el, key, parse) {
    el.value = state[key] == null ? '' : state[key];
    el.addEventListener('input', () => { state[key] = parse ? parse(el.value) : el.value; schedule(); });
    return el;
  }

  function renderForm() {
    // dades
    $('#db-info').replaceChildren(
      h('strong', {}, dbLabel), h('br'),
      db.has.zona ? `${db.munis.length} municipis · ${db.units.length} unitats · ` : `Àmbit: ${muniLabel()} · `,
      db.has.any ? `anys ${db.years[0]}–${db.years[db.years.length - 1]}` : 'sense any',
      db.isShare ? ' · valors en %' : '',
      h('div', { class: 'vars-avail' }, h('span', {}, 'Variables:'),
        [['zona', 'zona'], ['sexe', 'sexe'], ['edat', 'edat'], ['origen', db.originVar || 'origen']].map(([k, l]) => h('span', { class: 'chip' + (db.has[k] ? '' : ' no'), title: db.has[k] ? 'disponible' : 'no és a la base' }, l))));
    document.querySelectorAll('[data-needs]').forEach((el) => { el.hidden = !el.dataset.needs.split(' ').every((k) => db.has[k]); });
    $('#w-year').hidden = !db.has.any;
    const fixed = $('#ambit-fixed');
    fixed.hidden = db.has.zona;
    fixed.textContent = db.has.zona ? '' : `Àmbit: ${muniLabel()}. La base no té desagregació territorial, així que no hi ha zones.`;
    const miss = ['edat', 'origen'].filter((k) => !db.has[k]);
    $('#univ-missing').hidden = !miss.length;
    $('#univ-missing').textContent = miss.length ? `La base no té ${miss.join(' ni ')}: ${miss.includes('edat') ? 'l\'univers inclou totes les edats.' : ''}` : '';
    $('#origins-label').textContent = /concepte/i.test(db.originVar || '') ? 'Categories incloses' : 'Origen inclòs a l\'univers';

    // estudi
    bind($('#f-estudi'), 'estudi');
    bind($('#f-anyestudi'), 'anyEstudi');
    bind($('#f-titol'), 'titol');
    bind($('#f-univers'), 'univers');
    bind($('#f-font'), 'font');

    // àmbit
    const ysel = $('#f-year');
    ysel.replaceChildren(...db.years.map((y) => h('option', { value: y, selected: y === String(state.year) }, y)));
    ysel.onchange = () => { state.year = ysel.value; schedule(); };
    const dl = $('#munis');
    dl.replaceChildren(...db.munis.map((m) => h('option', { value: m.label })));
    renderUnits();

    // univers
    bind($('#f-minage'), 'minAge');
    bind($('#f-maxage'), 'maxAge');
    bind($('#f-bands'), 'bands');
    $('#f-origins').replaceChildren(...db.originLabels.map((o, i) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: state.origins.includes(i), onchange: (e) => {
        state.origins = e.target.checked ? [...new Set(state.origins.concat(i))].sort() : state.origins.filter((x) => x !== i);
        if (!state.origins.length) { state.origins = [i]; e.target.checked = true; }
        schedule();
      } }), M.cap(o))));

    // disseny
    renderDesign();

    // mostra
    bind($('#f-n'), 'N');
    bind($('#f-threshold'), 'threshold');
    bind($('#f-cawi'), 'cawiPct');
    const rs = $('#f-rounding');
    rs.value = state.rounding;
    rs.onchange = () => { state.rounding = rs.value; schedule(); };
  }

  function renderUnits() {
    normalize();
    $('#z-muni').hidden = state.munis.length < 2;
    $('#muni-chips').replaceChildren(...state.munis.map((m) => h('span', { class: 'chip big' }, M.niceMuni(m),
      state.munis.length > 1 ? h('button', { type: 'button', class: 'x', 'aria-label': 'Treu ' + M.niceMuni(m), onclick: () => {
        state.munis = state.munis.filter((x) => x !== m);
        state.units = state.units.filter((x) => db.units[x.u].muni !== m);
        renderUnits(); schedule();
      } }, '×') : null)));
    const zp = $('#f-usezp');
    zp.checked = !!state.useZonePop;
    zp.onchange = () => { state.useZonePop = zp.checked; renderUnits(); schedule(); };
    renderZones();
  }

  // ------------------------------------------------------------ zones i districtes
  // Cada agrupació censal és una zona per si sola («solta») fins que s'afegeix a
  // un districte. Els districtes són noms a state.districts, en ordre.
  const selected = new Set();
  let unitUniv = new Map();
  let univKey = '';
  let focusDistrict = null;

  const zoneList = () => [...new Set(state.units.filter((x) => x.inc).map((x) => x.zona))];
  const districts = () => (state.districts || (state.districts = []));
  const isDistrict = (z) => districts().includes(z);
  const unitLabel = (u) => {
    const x = db.units[u];
    const lab = x.num ? `${x.num}. ${x.desc}` : x.desc;
    return state.munis.length > 1 ? `${M.niceMuni(x.muni)} · ${lab}` : lab;
  };
  /** Nom de zona d'una agrupació solta: la descripció, o el nom complet si es repeteix. */
  function looseName(u, taken) {
    let n = state.munis.length > 1 ? db.units[u].name : cap(db.units[u].desc);
    if (taken && taken.has(n)) n = db.units[u].name;
    return n;
  }
  function newDistrictName() {
    const z = new Set(zoneList().concat(districts()));
    let n = 1;
    while (z.has('Districte ' + n)) n++;
    return 'Districte ' + n;
  }
  /** Ordre de les zones: districtes en el seu ordre, després les soltes, després les excloses. */
  function normalize() {
    const ds = districts();
    // un districte de l'estat antic (zona amb diverses agrupacions) passa a la llista
    zoneList().forEach((z) => {
      if (!ds.includes(z) && state.units.filter((x) => x.inc && x.zona === z).length > 1) ds.push(z);
    });
    const base = new Map();
    state.units.forEach((x, i) => base.set(x.u, i));
    const rank = (x) => (!x.inc ? 2e6 : isDistrict(x.zona) ? ds.indexOf(x.zona) * 1e3 : 1e6);
    state.units.sort((a, b) => rank(a) - rank(b) || db.units[a.u].muni.localeCompare(db.units[b.u].muni) || db.units[a.u].num - db.units[b.u].num || base.get(a.u) - base.get(b.u));
  }
  function changed() { normalize(); selected.clear(); renderZones(); renderDistricts(); schedule(); }

  function moveTo(ids, zona) {
    if (!isDistrict(zona)) districts().push(zona);
    state.units.forEach((x) => { if (ids.has(x.u)) { x.inc = true; x.zona = zona; } });
    changed();
  }
  function newDistrict(ids) {
    const name = newDistrictName();
    focusDistrict = name;
    if (ids && ids.size) moveTo(ids, name);
    else { districts().push(name); changed(); }
  }
  function makeLoose(ids) {
    const taken = new Set(zoneList());
    state.units.forEach((x) => {
      if (!ids.has(x.u)) return;
      x.inc = true;
      if (isDistrict(x.zona) || !x.zona) { taken.delete(x.zona); x.zona = looseName(x.u, taken); taken.add(x.zona); }
    });
    changed();
  }
  function exclude(ids) { state.units.forEach((x) => { if (ids.has(x.u)) x.inc = false; }); changed(); }
  function deleteDistrict(z) {
    const ids = new Set(state.units.filter((x) => x.zona === z).map((x) => x.u));
    state.districts = districts().filter((d) => d !== z);
    delete state.zonePop[z];
    makeLoose(ids);
  }
  function renameDistrict(prev, next) {
    next = next.trim();
    if (!next || next === prev) { renderDistricts(); return; }
    const ds = districts();
    const merges = zoneList().includes(next) || ds.includes(next);
    state.units.forEach((x) => { if (x.zona === prev) x.zona = next; });
    if (merges) state.districts = ds.filter((d) => d !== prev);
    else ds[ds.indexOf(prev)] = next;
    if (!isDistrict(next)) districts().push(next);
    if (state.zonePop[prev] != null) {
      state.zonePop[next] = (merges ? Number(state.zonePop[next]) || 0 : 0) + (Number(state.zonePop[prev]) || 0);
      delete state.zonePop[prev];
    }
    changed();
  }
  function moveDistrict(z, dir) {
    const ds = districts();
    const i = ds.indexOf(z), j = i + dir;
    if (j < 0 || j >= ds.length) return;
    [ds[i], ds[j]] = [ds[j], ds[i]];
    changed();
  }

  /** Univers de cada agrupació amb els filtres actuals (per equilibrar districtes). */
  function refreshUnitUniv() {
    const units = state.units.map((x) => ({ u: x.u, zona: 'u' + x.u }));
    const cfg = Object.assign(engineCfg(), { units, main: { rows: 'zona', cols: [] }, extras: [], useZonePop: false });
    const key = JSON.stringify([cfg.year, cfg.minAge, cfg.maxAge, cfg.origins, units.length, units.map((x) => x.u)]);
    if (key === univKey) return;
    univKey = key;
    unitUniv = new Map();
    if (!units.length) return;
    try { M.compute(db, cfg).diag.zoneStats.forEach((z) => unitUniv.set(Number(z.zona.slice(1)), z.censUnivers)); } catch (e) { /* sense univers */ }
  }

  // ------------------------------------------------------------ resum al panell lateral
  function renderZones() {
    const box = $('#units');
    if (!box) return;
    const stats = new Map(result && result.diag ? result.diag.zoneStats.map((z) => [z.zona, z]) : []);
    const inc = state.units.filter((x) => x.inc);
    if (!state.units.length) { box.replaceChildren(); return; }
    const ds = districts().filter((d) => inc.some((x) => x.zona === d));
    const loose = inc.filter((x) => !isDistrict(x.zona));
    const out = state.units.length - inc.length;
    const row = (z, n) => {
      const st = stats.get(z);
      return h('li', { class: 'zrow' + (isDistrict(z) ? ' dist' : '') },
        h('span', { class: 'zr-name' }, z),
        h('span', { class: 'zr-meta' }, n > 1 ? `${n} agrup.` : ''),
        h('span', { class: 'zr-q', title: 'Quota' }, st ? fmt(st.quota) : ''),
        state.useZonePop ? h('input', { type: 'number', min: 0, class: 'zr-pop', value: state.zonePop[z] || '', 'aria-label': 'Població externa de ' + z, placeholder: 'població',
          oninput: (e) => { state.zonePop[z] = Number(e.target.value) || 0; schedule(); } }) : null);
    };
    box.replaceChildren(
      h('div', { class: 'zsum' },
        h('strong', {}, `${zoneList().length} ${zoneList().length === 1 ? 'zona' : 'zones'}`),
        h('span', {}, ` · ${ds.length} ${ds.length === 1 ? 'districte' : 'districtes'}, ${loose.length} ${loose.length === 1 ? 'agrupació solta' : 'agrupacions soltes'}${out ? `, ${out} fora` : ''}`)),
      h('button', { type: 'button', class: 'btn primary block', onclick: openDistricts }, 'Organitza els districtes'),
      h('ul', { class: 'zlist' }, ds.map((d) => row(d, inc.filter((x) => x.zona === d).length)), loose.map((x) => row(x.zona, 1))),
      state.useZonePop ? h('p', { class: 'f-hint' }, 'Població externa de cada zona (p. ex. padró per nuclis del client). Només se\'n fa servir el pes relatiu.') : '');
  }

  // ------------------------------------------------------------ editor de districtes (arrossegar i deixar anar)
  let dragIds = null;
  function dragUnit(x) {
    const el = h('div', { class: 'du' + (selected.has(x.u) ? ' sel' : '') + (x.inc ? '' : ' off'), draggable: 'true', 'data-u': x.u },
      h('input', { type: 'checkbox', checked: selected.has(x.u), 'aria-label': 'Selecciona ' + db.units[x.u].name,
        onclick: (e) => e.stopPropagation(),
        onchange: (e) => { if (e.target.checked) selected.add(x.u); else selected.delete(x.u); renderDistricts(); } }),
      h('span', { class: 'du-name', title: db.units[x.u].name }, unitLabel(x.u)),
      h('span', { class: 'du-u' }, unitUniv.has(x.u) ? fmt(unitUniv.get(x.u)) : ''));
    el.addEventListener('dragstart', (e) => {
      dragIds = selected.has(x.u) ? new Set(selected) : new Set([x.u]);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', [...dragIds].join(',')); } catch (err) { /* res */ }
      document.body.classList.add('dragging');
      const n = dragIds.size;
      if (n > 1) {
        const ghost = h('div', { class: 'ghost' }, `${n} agrupacions`);
        document.body.append(ghost);
        e.dataTransfer.setDragImage(ghost, 10, 10);
        setTimeout(() => ghost.remove(), 0);
      }
    });
    el.addEventListener('dragend', () => { dragIds = null; document.body.classList.remove('dragging'); document.querySelectorAll('.over').forEach((n) => n.classList.remove('over')); });
    el.addEventListener('click', () => { if (selected.has(x.u)) selected.delete(x.u); else selected.add(x.u); renderDistricts(); });
    return el;
  }
  function dropZone(el, onDrop) {
    el.addEventListener('dragover', (e) => { if (!dragIds) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('over'); });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); if (dragIds) { const ids = dragIds; dragIds = null; document.body.classList.remove('dragging'); onDrop(ids); } });
    return el;
  }

  function openDistricts() {
    const dlg = $('#districts');
    normalize();
    selected.clear();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    renderDistricts();
  }

  function renderDistricts() {
    const dlg = $('#districts');
    if (!dlg || !dlg.open) return;
    refreshUnitUniv();
    const stats = new Map(result && result.diag ? result.diag.zoneStats.map((z) => [z.zona, z]) : []);
    const q = ($('#d-search') && $('#d-search').value || '').trim().toLowerCase();
    const inc = state.units.filter((x) => x.inc);
    const loose = inc.filter((x) => !isDistrict(x.zona));
    const shown = loose.filter((x) => !q || unitLabel(x.u).toLowerCase().includes(q) || db.units[x.u].name.toLowerCase().includes(q));
    const excluded = state.units.filter((x) => !x.inc);
    const sumU = (xs) => xs.reduce((a, x) => a + (unitUniv.get(x.u) || 0), 0);

    // columna esquerra: agrupacions soltes
    const pool = dropZone(h('section', { class: 'pool' },
      h('div', { class: 'pool-head' },
        h('h3', {}, 'Agrupacions soltes'),
        h('span', { class: 'f-hint' }, `${loose.length} · cada una és una zona`)),
      h('div', { class: 'pool-tools' },
        h('input', { type: 'search', id: 'd-search', value: q, placeholder: 'Cerca una agrupació…', 'aria-label': 'Cerca una agrupació',
          oninput: () => { const pos = $('#d-search').selectionStart; renderDistricts(); const s = $('#d-search'); s.focus(); s.setSelectionRange(pos, pos); } }),
        h('button', { type: 'button', class: 'link', onclick: () => { shown.forEach((x) => selected.add(x.u)); renderDistricts(); } }, 'Marca-les')),
      h('div', { class: 'du-list' }, shown.length ? shown.map(dragUnit) : h('p', { class: 'f-hint' }, loose.length ? 'Cap agrupació coincideix amb la cerca.' : 'Totes les agrupacions són en districtes. Arrossega\'n una aquí per deixar-la solta.')),
      dropZone(h('div', { class: 'outbox' },
        h('div', { class: 'pool-head' }, h('h3', {}, 'Fora de l\'estudi'), h('span', { class: 'f-hint' }, excluded.length ? `${excluded.length}` : 'arrossega-hi les que no hi entren')),
        h('div', { class: 'du-list' }, excluded.map(dragUnit))), exclude)), makeLoose);

    // columna dreta: districtes
    const ds = districts();
    const cards = ds.map((d, i) => {
      const members = state.units.filter((x) => x.inc && x.zona === d);
      const st = stats.get(d);
      const name = h('input', { type: 'text', class: 'dc-name', value: d, 'aria-label': 'Nom del districte',
        onchange: (e) => renameDistrict(d, e.target.value), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
      if (focusDistrict === d) setTimeout(() => { name.focus(); name.select(); focusDistrict = null; }, 0);
      return dropZone(h('section', { class: 'dcard' + (members.length ? '' : ' empty') },
        h('div', { class: 'dc-head' }, name,
          h('div', { class: 'dc-tools' },
            h('button', { type: 'button', class: 'icon', 'aria-label': 'Mou ' + d + ' amunt', title: 'Amunt', disabled: i === 0, onclick: () => moveDistrict(d, -1) }, '↑'),
            h('button', { type: 'button', class: 'icon', 'aria-label': 'Mou ' + d + ' avall', title: 'Avall', disabled: i === ds.length - 1, onclick: () => moveDistrict(d, 1) }, '↓'),
            h('button', { type: 'button', class: 'icon', 'aria-label': 'Desfés ' + d, title: 'Desfés el districte', onclick: () => deleteDistrict(d) }, '×'))),
        h('div', { class: 'dc-meta' },
          h('span', {}, `${members.length} ${members.length === 1 ? 'agrupació' : 'agrupacions'}`),
          h('span', {}, `univers ${fmt(sumU(members))}`),
          st ? h('span', { class: 'dc-q' }, `quota ${fmt(st.quota)}`) : null),
        h('div', { class: 'du-list' }, members.length ? members.map(dragUnit) : h('p', { class: 'f-hint drop-hint' }, 'Arrossega-hi agrupacions'))),
      (ids) => moveTo(ids, d));
    });
    const add = dropZone(h('button', { type: 'button', class: 'dcard new', onclick: () => newDistrict(selected.size ? new Set(selected) : null) },
      h('span', { class: 'plus' }, '+'), h('strong', {}, 'Nou districte'),
      h('span', { class: 'f-hint' }, selected.size ? `amb les ${selected.size} marcades` : 'o deixa-hi agrupacions')), newDistrict);

    // barra d'accions per a la selecció (alternativa a arrossegar, també per a pantalles tàctils)
    const n = selected.size;
    const target = h('select', { 'aria-label': 'Mou les marcades a' }, h('option', { value: '' }, 'Mou a…'), ds.map((d) => h('option', { value: d }, d)));
    target.onchange = () => { if (target.value) moveTo(new Set(selected), target.value); };
    const bar = h('div', { class: 'dbar' + (n ? ' on' : '') }, n ? [
      h('strong', {}, `${n} ${n === 1 ? 'marcada' : 'marcades'}`),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => newDistrict(new Set(selected)) }, 'Nou districte'),
      ds.length ? target : null,
      h('button', { type: 'button', class: 'btn small', onclick: () => makeLoose(new Set(selected)) }, 'Deixa-les soltes'),
      h('button', { type: 'button', class: 'btn small', onclick: () => exclude(new Set(selected)) }, 'Treu de l\'estudi'),
      h('button', { type: 'button', class: 'link', onclick: () => { selected.clear(); renderDistricts(); } }, 'Desmarca'),
    ] : h('span', { class: 'f-hint' }, 'Arrossega les agrupacions a un districte o a «Nou districte». També pots marcar-ne diverses i moure-les juntes amb aquesta barra.'));

    $('#d-body').replaceChildren(pool, h('section', { class: 'dgrid' }, cards, add));
    $('#d-bar').replaceChildren(bar);
    $('#d-count').textContent = `${zoneList().length} zones resultants · ${ds.length} ${ds.length === 1 ? 'districte' : 'districtes'}`;
  }

  function addMuni() {
    const inp = $('#f-muni');
    const m = db.munis.find((x) => x.label.toLowerCase() === inp.value.trim().toLowerCase() || x.name.toLowerCase() === inp.value.trim().toLowerCase());
    if (!m) { $('#muni-msg').textContent = 'No trobo aquest municipi a la base de dades.'; return; }
    $('#muni-msg').textContent = '';
    const replace = $('#f-muni-mode').value === 'replace';
    if (replace) { state.munis = [m.name]; state.units = []; state.zonePop = {}; state.districts = []; } else if (state.munis.includes(m.name)) return;
    else state.munis.push(m.name);
    if (!replace && state.munis.length === 2) {
      // en passar a un àmbit de diversos municipis, cada municipi és un districte per defecte
      state.units.forEach((x) => { x.zona = M.niceMuni(db.units[x.u].muni); });
      state.districts = [M.niceMuni(state.munis[0])];
    }
    M.defaultZones(db, m.name).forEach((z) => state.units.push(Object.assign(z, { inc: true, name: db.units[z.u].name },
      state.munis.length > 1 ? { zona: m.label } : {})));
    if (state.munis.length > 1) districts().push(m.label);
    inp.value = '';
    normalize();
    renderUnits(); schedule();
  }

  function zonePreset(kind) {
    const taken = new Set();
    if (kind === 'agrup') { state.districts = []; state.units.forEach((x) => { x.zona = looseName(x.u, taken); taken.add(x.zona); }); }
    if (kind === 'muni') { state.units.forEach((x) => { x.zona = M.niceMuni(db.units[x.u].muni); }); state.districts = [...new Set(state.units.map((x) => x.zona))]; }
    if (kind === 'one') { state.units.forEach((x) => { x.zona = muniLabel(); }); state.districts = [muniLabel()]; }
    state.zonePop = {};
    selected.clear();
    normalize();
    renderUnits(); renderDistricts(); schedule();
  }

  function varSelects(t, onChange) {
    const wrap = h('div', { class: 'vars' });
    for (let lvl = 0; lvl < 3; lvl++) {
      const cur = t.cols[lvl] || '';
      const used = t.cols.filter((_, i) => i !== lvl);
      const sel = h('select', { 'aria-label': `Variable de columna ${lvl + 1}`, disabled: lvl > t.cols.length },
        h('option', { value: '' }, lvl === 0 ? '(cap)' : '—'),
        VARS.filter(([k]) => db.has[k] && (!used.includes(k) || k === cur)).map(([k, l]) => h('option', { value: k, selected: k === cur }, l)));
      sel.onchange = () => {
        const cols = t.cols.slice(0, lvl);
        if (sel.value) cols.push(sel.value, ...t.cols.slice(lvl + 1).filter((v) => v !== sel.value));
        t.cols = cols;
        onChange();
      };
      wrap.append(sel);
      if (lvl < 2) wrap.append(h('span', { class: 'by' }, '×'));
    }
    return wrap;
  }

  function rowsSelect(t, onChange) {
    const sel = h('select', { 'aria-label': 'Files' }, db.has.zona ? h('option', { value: 'zona', selected: t.rows === 'zona' }, 'Zones') : null, h('option', { value: 'cap', selected: t.rows === 'cap' || !db.has.zona }, 'Total àmbit'));
    sel.onchange = () => { t.rows = sel.value; onChange(); };
    return sel;
  }

  function renderDesign() {
    const re = () => { renderDesign(); schedule(); };
    const m = state.main;
    $('#main-design').replaceChildren(
      h('div', { class: 'design-row' }, h('span', { class: 'f-label' }, 'Files'), rowsSelect(m, re)),
      h('div', { class: 'design-row' }, h('span', { class: 'f-label' }, 'Columnes'), varSelects(m, re)),
    );
    $('#extras').replaceChildren(...state.extras.map((t, i) => h('div', { class: 'extra' },
      h('div', { class: 'extra-head' }, h('strong', {}, `Taula ${i + 2}`),
        h('button', { type: 'button', class: 'link', onclick: () => { state.extras.splice(i, 1); re(); } }, 'Elimina')),
      h('div', { class: 'design-row' }, h('span', { class: 'f-label' }, 'Files'), rowsSelect(t, re)),
      h('div', { class: 'design-row' }, h('span', { class: 'f-label' }, 'Columnes'), varSelects(t, re)),
      h('div', { class: 'design-row' }, h('span', { class: 'f-label' }, 'Càlcul'), (() => {
        const s = h('select', { 'aria-label': 'Tipus de càlcul' },
          h('option', { value: 'derivada', selected: t.mode === 'derivada' }, 'Suma de la taula principal'),
          h('option', { value: 'independent', selected: t.mode === 'independent' }, 'Quota independent (marginal)'));
        s.onchange = () => { t.mode = s.value; re(); };
        return s;
      })()),
    )));
  }

  const PRESETS = {
    plantilla: { main: { rows: 'zona', cols: ['sexe', 'edat'] }, extras: [{ rows: 'cap', cols: ['sexe', 'edat'], mode: 'derivada' }, { rows: 'zona', cols: [], mode: 'derivada' }] },
    complet: { main: { rows: 'zona', cols: ['sexe', 'edat', 'origen'] }, extras: [{ rows: 'zona', cols: ['sexe', 'edat'], mode: 'derivada' }, { rows: 'cap', cols: ['origen'], mode: 'derivada' }] },
    marginal: { main: { rows: 'zona', cols: ['sexe', 'edat'] }, extras: [{ rows: 'zona', cols: ['origen'], mode: 'independent' }, { rows: 'cap', cols: ['sexe', 'edat'], mode: 'derivada' }] },
    municipi: { main: { rows: 'cap', cols: ['sexe', 'edat'] }, extras: [] },
  };
  function applyPreset(k) {
    const p = JSON.parse(JSON.stringify(PRESETS[k]));
    state.main = p.main; state.extras = p.extras;
    sanitize(state);
    if ((k === 'complet' || k === 'marginal') && state.origins.length < 2) state.origins = db.origins.map((o, i) => i);
    renderForm(); schedule();
  }

  // ------------------------------------------------------------ exportació
  async function exportXlsx() {
    if (!result) return;
    const btn = $('#export');
    const msg = $('#export-msg');
    btn.disabled = true; msg.textContent = 'Generant l\'Excel…';
    try {
      const cfg = engineCfg();
      const auto = autoTexts(result);
      const meta = {
        estudi: state.estudi, municipi: state.munis.map(M.niceMuni).join(', '),
        univers: state.univers || auto.univers, font: state.font || auto.font,
        titol: state.titol || result.main.title, fitxer: db.source.file,
      };
      const wb = MostresExport.buildWorkbook(ExcelJS, db, cfg, result, meta);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const name = fileName();
      let done = false;
      if (window.claude && window.claude.use) {
        const dl = await window.claude.use('downloads').catch(() => null);
        if (dl) {
          try { await dl.save({ filename: name, data: blob }); msg.textContent = `Desat: ${name}`; done = true; } catch (e) {
            if (e && e.code === 'declined') { msg.textContent = 'Descàrrega cancel·lada.'; done = true; } else if (e && e.code !== 'unavailable' && e.code !== 'not_granted') { msg.textContent = 'No s\'ha pogut desar: ' + (e.message || e.code); done = true; }
          }
        }
      }
      if (!done) {
        const a = h('a', { href: URL.createObjectURL(blob), download: name });
        document.body.append(a); a.click(); a.remove();
        msg.textContent = `Descarregat: ${name}`;
      }
    } catch (e) {
      msg.textContent = 'Error en generar l\'Excel: ' + e.message;
    } finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------ inici
  function renderAll() { renderForm(); recompute(); }

  async function init() {
    db = M.fromCompact(window.CENS_BASE);
    dbLabel = `Base inclosa: ${window.CENS_BASE.source.file} (actualitzada ${window.CENS_BASE.source.loaded || ''})`;
    try {
      const custom = await idb.get('custom');
      if (custom && custom.blob) {
        $('#db-status').textContent = `Recuperant la base desada (${custom.name})…`;
        db = await readFile(new File([custom.blob], custom.name));
        dbLabel = `${db.source.file} (carregada ${new Date(custom.date).toLocaleDateString('ca-ES')})`;
        $('#db-status').textContent = '';
        $('#db-reset').hidden = false;
      }
    } catch (e) { /* sense IndexedDB: es fa servir la base inclosa */ }
    state = defaultState();
    $('#f-file').addEventListener('change', (e) => { if (e.target.files[0]) onUpload(e.target.files[0]).then(() => { $('#db-reset').hidden = false; }); e.target.value = ''; });
    $('#db-reset').addEventListener('click', async () => {
      try { await idb.del('custom'); } catch (e) { /* res */ }
      db = M.fromCompact(window.CENS_BASE);
      dbLabel = `Base inclosa: ${window.CENS_BASE.source.file} (actualitzada ${window.CENS_BASE.source.loaded || ''})`;
      $('#db-reset').hidden = true; $('#db-status').textContent = 'S\'ha tornat a la base inclosa.';
      state = defaultState(); renderAll();
    });
    $('#add-muni').addEventListener('click', addMuni);
    $('#f-muni').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addMuni(); } });
    $('#z-agrup').addEventListener('click', () => zonePreset('agrup'));
    $('#z-muni').addEventListener('click', () => zonePreset('muni'));
    $('#z-one').addEventListener('click', () => zonePreset('one'));
    $('#d-close').addEventListener('click', () => $('#districts').close());
    $('#districts').addEventListener('close', () => { selected.clear(); renderZones(); });
    $('#add-extra').addEventListener('click', () => { state.extras.push({ rows: 'cap', cols: ['sexe'], mode: 'derivada' }); renderDesign(); schedule(); });
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
    $('#export').addEventListener('click', exportXlsx);
    $('#reset-cfg').addEventListener('click', () => {
      // restableix el disseny de la mostra però manté l'àmbit i les zones
      const d = defaultState();
      ['minAge', 'maxAge', 'bands', 'origins', 'N', 'rounding', 'threshold', 'cawiPct', 'main', 'extras'].forEach((k) => { state[k] = d[k]; });
      renderAll(); save();
    });
    renderAll();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
