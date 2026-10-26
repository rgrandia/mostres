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
      useZonePop: false, zonePop: {},
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
    if (!document.activeElement || !document.activeElement.closest('#units')) renderZones();
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

  // ------------------------------------------------------------ editor de zones (districtes)
  const selected = new Set();
  const zoneList = () => [...new Set(state.units.filter((x) => x.inc).map((x) => x.zona))];
  const unitLabel = (u) => {
    const x = db.units[u];
    const lab = x.num ? `${x.num}. ${x.desc}` : x.desc;
    return state.munis.length > 1 ? `${M.niceMuni(x.muni)} ${lab}` : lab;
  };
  function newZoneName() {
    const z = zoneList();
    let n = z.length + 1;
    while (z.includes('Districte ' + n)) n++;
    return 'Districte ' + n;
  }
  function moveUnits(units, zona) {
    const before = zoneList();
    state.units.forEach((x) => { if (units.has(x.u)) { if (!x.inc) x.inc = true; x.zona = zona; } });
    // la població externa d'una zona que desapareix es descarta
    before.filter((z) => !zoneList().includes(z)).forEach((z) => { delete state.zonePop[z]; });
    selected.clear();
    renderZones(); schedule();
  }
  function excludeUnits(units) {
    state.units.forEach((x) => { if (units.has(x.u)) x.inc = false; });
    selected.clear();
    renderZones(); schedule();
  }
  function renameZone(prev, next) {
    next = next.trim();
    if (!next || next === prev) { renderZones(); return; }
    const merges = zoneList().includes(next);
    state.units.forEach((x) => { if (x.inc && x.zona === prev) x.zona = next; });
    if (state.zonePop[prev] != null) {
      if (merges) state.zonePop[next] = (Number(state.zonePop[next]) || 0) + (Number(state.zonePop[prev]) || 0);
      else state.zonePop[next] = state.zonePop[prev];
      delete state.zonePop[prev];
    }
    renderZones(); schedule();
  }
  function moveZone(z, dir) {
    const order = zoneList();
    const i = order.indexOf(z), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const rank = (x) => (x.inc ? order.indexOf(x.zona) : order.length);
    state.units = state.units.map((x, k) => [x, k]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((p) => p[0]);
    renderZones(); schedule();
  }

  function renderZones() {
    const zones = zoneList();
    const stats = new Map(result && result.diag ? result.diag.zoneStats.map((z) => [z.zona, z]) : []);
    const unitRow = (x) => h('label', { class: 'unit' + (selected.has(x.u) ? ' sel' : '') },
      h('input', { type: 'checkbox', checked: selected.has(x.u), 'aria-label': 'Selecciona ' + db.units[x.u].name,
        onchange: (e) => { if (e.target.checked) selected.add(x.u); else selected.delete(x.u); renderZones(); } }),
      h('span', { class: 'u-name', title: db.units[x.u].name }, unitLabel(x.u)));

    const cards = zones.map((z, zi) => {
      const members = state.units.filter((x) => x.inc && x.zona === z);
      const st = stats.get(z);
      const allSel = members.every((x) => selected.has(x.u));
      return h('div', { class: 'zone' + (members.length > 1 ? ' merged' : '') },
        h('div', { class: 'zone-head' },
          h('input', { type: 'text', class: 'zone-name', value: z, 'aria-label': 'Nom de la zona', id: 'zona-' + zi,
            onchange: (e) => renameZone(z, e.target.value), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } }),
          h('div', { class: 'zone-tools' },
            h('button', { type: 'button', class: 'icon', title: 'Puja', 'aria-label': 'Puja ' + z, disabled: zi === 0, onclick: () => moveZone(z, -1) }, '↑'),
            h('button', { type: 'button', class: 'icon', title: 'Baixa', 'aria-label': 'Baixa ' + z, disabled: zi === zones.length - 1, onclick: () => moveZone(z, 1) }, '↓'),
            members.length > 1 ? h('button', { type: 'button', class: 'link', onclick: () => {
              // desfà el districte: cada agrupació torna a ser una zona amb el seu nom
              const names = new Set(zoneList());
              state.units.forEach((x) => {
                if (!(x.inc && x.zona === z)) return;
                let n = cap(db.units[x.u].desc); if (names.has(n)) n = db.units[x.u].name;
                x.zona = n; names.add(n);
              });
              delete state.zonePop[z]; selected.clear(); renderZones(); schedule();
            } }, 'Separa') : null)),
        h('div', { class: 'zone-meta' },
          h('span', {}, `${members.length} ${members.length === 1 ? 'agrupació' : 'agrupacions'}`),
          st ? h('span', {}, `univers ${fmt(st.censUnivers)} · quota ${fmt(st.quota)}`) : null,
          h('button', { type: 'button', class: 'link', onclick: () => { members.forEach((x) => (allSel ? selected.delete(x.u) : selected.add(x.u))); renderZones(); } }, allSel ? 'Desmarca' : 'Marca-les')),
        state.useZonePop ? h('label', { class: 'field row zp' }, h('span', { class: 'f-hint' }, 'Població externa'),
          h('input', { type: 'number', min: 0, value: state.zonePop[z] || '', 'aria-label': 'Població externa de ' + z,
            oninput: (e) => { state.zonePop[z] = Number(e.target.value) || 0; schedule(); } })) : null,
        h('div', { class: 'members' }, members.map(unitRow)));
    });

    const excluded = state.units.filter((x) => !x.inc);
    const exBox = excluded.length ? h('div', { class: 'zone excluded' },
      h('div', { class: 'zone-head' }, h('strong', {}, 'Fora de l\'estudi'), h('span', { class: 'f-hint' }, 'no compten a l\'univers')),
      h('div', { class: 'members' }, excluded.map(unitRow))) : null;

    const n = selected.size;
    const target = h('select', { 'aria-label': 'Zona de destinació' },
      h('option', { value: '' }, 'Mou a…'), zones.map((z) => h('option', { value: z }, z)));
    target.onchange = () => { if (target.value) moveUnits(new Set(selected), target.value); };
    const nameIn = h('input', { type: 'text', value: newZoneName(), 'aria-label': 'Nom del nou districte' });
    const bar = h('div', { class: 'selbar' + (n ? ' on' : '') },
      n ? [
        h('strong', {}, `${n} ${n === 1 ? 'agrupació seleccionada' : 'agrupacions seleccionades'}`),
        h('div', { class: 'selrow' }, nameIn,
          h('button', { type: 'button', class: 'btn small primary', onclick: () => moveUnits(new Set(selected), nameIn.value.trim() || newZoneName()) }, n > 1 ? 'Agrupa en un districte' : 'Crea una zona nova')),
        h('div', { class: 'selrow' }, target,
          h('button', { type: 'button', class: 'btn small', onclick: () => excludeUnits(new Set(selected)) }, 'Treu de l\'estudi'),
          h('button', { type: 'button', class: 'link', onclick: () => { selected.clear(); renderZones(); } }, 'Cancel·la')),
      ] : h('span', { class: 'f-hint' }, 'Marca agrupacions per agrupar-les en un districte, moure-les a una altra zona o treure-les de l\'estudi.'));

    $('#units').replaceChildren(bar, h('div', { class: 'zones-list' }, cards, exBox || ''),
      state.useZonePop ? h('p', { class: 'f-hint' }, 'Població externa: la de cada zona segons el client (p. ex. padró per nuclis). Només se\'n fa servir el pes relatiu.') : '');
  }

  function addMuni() {
    const inp = $('#f-muni');
    const m = db.munis.find((x) => x.label.toLowerCase() === inp.value.trim().toLowerCase() || x.name.toLowerCase() === inp.value.trim().toLowerCase());
    if (!m) { $('#muni-msg').textContent = 'No trobo aquest municipi a la base de dades.'; return; }
    $('#muni-msg').textContent = '';
    const replace = $('#f-muni-mode').value === 'replace';
    if (replace) { state.munis = [m.name]; state.units = []; state.zonePop = {}; } else if (state.munis.includes(m.name)) return;
    else state.munis.push(m.name);
    if (!replace && state.munis.length === 2) {
      // en passar a un àmbit de diversos municipis, cada municipi és una zona per defecte
      state.units.forEach((x) => { x.zona = M.niceMuni(db.units[x.u].muni); });
    }
    M.defaultZones(db, m.name).forEach((z) => state.units.push(Object.assign(z, { inc: true, name: db.units[z.u].name },
      state.munis.length > 1 ? { zona: m.label } : {})));
    inp.value = '';
    renderUnits(); schedule();
  }

  function zonePreset(kind) {
    if (kind === 'agrup') state.units.forEach((x) => { x.zona = state.munis.length > 1 ? db.units[x.u].name : M.defaultZones(db, db.units[x.u].muni).find((z) => z.u === x.u).zona; });
    if (kind === 'muni') state.units.forEach((x) => { x.zona = M.niceMuni(db.units[x.u].muni); });
    if (kind === 'one') state.units.forEach((x) => { x.zona = muniLabel(); });
    state.zonePop = {};
    selected.clear();
    renderUnits(); schedule();
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
