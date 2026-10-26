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
  const VARS = [['sexe', 'Sexe'], ['edat', 'Edat'], ['origen', 'Origen']];
  const STORE_KEY = 'mostres.cfg.v1';

  let db = null;
  let dbLabel = '';
  let result = null;
  let state = null;

  // ------------------------------------------------------------ estat i persistència
  function defaultState() {
    const muni = db.munis.find((m) => m.name === 'Sant Pere de Ribes') || db.munis[0];
    return {
      estudi: 'XXXX', anyEstudi: String(new Date().getFullYear()), titol: '', univers: '', font: '',
      year: db.years[db.years.length - 1], munis: [muni.name],
      units: M.defaultZones(db, muni.name).map((z) => Object.assign(z, { inc: true, name: db.units[z.u].name })),
      minAge: 18, maxAge: '', bands: '18, 30, 45, 60',
      origins: db.origins.map((o, i) => i).filter((i) => /espanyol/i.test(db.origins[i])).length
        ? db.origins.map((o, i) => i).filter((i) => /espanyol/i.test(db.origins[i])) : db.origins.map((o, i) => i),
      N: 400, rounding: 'lr', threshold: 2, cawiPct: 0,
      main: { rows: 'zona', cols: ['sexe', 'edat'] },
      extras: [{ rows: 'cap', cols: ['sexe', 'edat'], mode: 'derivada' }, { rows: 'zona', cols: [], mode: 'derivada' }],
      useZonePop: false, zonePop: {},
    };
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* sense emmagatzematge */ } }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && s.units && s.munis && db.years.includes(String(s.year))) {
        // les unitats es desen pel nom: una base nova pot tenir un altre ordre
        s.units = s.units.map((x) => Object.assign({}, x, { u: db.units.findIndex((n) => n.name === x.name) })).filter((x) => x.u >= 0);
        s.munis = s.munis.filter((m) => db.munis.some((x) => x.name === m));
        if (s.units.length && s.munis.length) return Object.assign(defaultState(), s);
      }
    } catch (e) { /* configuració antiga o malmesa */ }
    return defaultState();
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
      db = nd;
      dbLabel = `${nd.source.file} (carregada ${new Date().toLocaleDateString('ca-ES')})`;
      try { await idb.set('custom', { name: file.name, blob: file, date: Date.now() }); } catch (e) { /* no es pot desar al navegador */ }
      const keep = state;
      state = defaultState();
      if (keep) {
        ['estudi', 'anyEstudi', 'minAge', 'maxAge', 'bands', 'N', 'rounding', 'threshold', 'cawiPct', 'main', 'extras'].forEach((k) => { state[k] = keep[k]; });
        const sameMunis = keep.munis.filter((m) => db.munis.some((x) => x.name === m));
        if (sameMunis.length) {
          state.munis = sameMunis;
          state.units = sameMunis.flatMap((m) => M.defaultZones(db, m)).map((z) => {
            const old = oldNames.find((x) => x.name === db.units[z.u].name);
            return Object.assign(z, { inc: true, name: db.units[z.u].name }, old ? { zona: old.zona, inc: old.inc } : {});
          });
        }
      }
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
    return state.munis.length === 1 ? M.niceMuni(state.munis[0]) : 'Total àmbit';
  }
  function autoTexts(res) {
    const o = res ? res.cats.origen : [];
    const nat = /naixement/i.test(db.originVar || '') ? 'nascuda a' : 'de nacionalitat';
    const univ = `Població de ${state.minAge}${state.maxAge !== '' ? ' a ' + state.maxAge : ''} anys${state.maxAge !== '' ? '' : ' i més'}` +
      (o.length === 1 && o.length < db.origins.length ? ` ${nat} ${o[0].toLowerCase()}` : '');
    let font = `Cens de població ${state.year} per agrupació censal (Idescat)`;
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
      kpi('Univers', fmt(r.Utot), `${r.zones.length} ${r.zones.length === 1 ? 'zona' : 'zones'} · cens ${r.year}`),
      kpi('Mostra', fmt(r.N), r.main.sum === r.N ? 'la suma de quotes quadra' : `suma ${fmt(r.main.sum)} (${r.main.sum > r.N ? '+' : ''}${r.main.sum - r.N})`, r.main.sum === r.N ? 'ok' : 'warn'),
      kpi('Error mostral', '±' + M.pct1(d.moe), '95%, p=q=50%'),
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
      h('section', { class: 'res-block' }, h('h3', {}, 'Mida per zona'), zoneTbl || h('p', { class: 'muted' }, 'La taula principal no té zones.')),
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
      `${db.munis.length} municipis · ${db.units.length} unitats · anys ${db.years[0]}–${db.years[db.years.length - 1]} · origen: ${db.originVar || '—'} (${db.origins.join(', ')})`);

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
    $('#f-origins').replaceChildren(...db.origins.map((o, i) => h('label', { class: 'check' },
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
    const zonesNow = [...new Set(state.units.filter((x) => x.inc).map((x) => x.zona))];
    const list = h('div', { class: 'units' }, state.units.map((x, i) => h('div', { class: 'unit' + (x.inc ? '' : ' off') },
      h('input', { type: 'checkbox', checked: x.inc, 'aria-label': 'Inclou ' + db.units[x.u].name, onchange: (e) => { x.inc = e.target.checked; renderUnits(); schedule(); } }),
      h('div', { class: 'u-name' }, h('span', { class: 'u-code' }, db.units[x.u].name)),
      h('input', { type: 'text', id: 'zona-' + i, value: x.zona, list: 'zone-names', 'aria-label': 'Nom de zona', oninput: (e) => {
        const prev = x.zona;
        x.zona = e.target.value;
        // la població externa segueix la zona quan se li canvia el nom
        if (state.zonePop[prev] && !state.units.some((y) => y.zona === prev) && !state.zonePop[x.zona]) { state.zonePop[x.zona] = state.zonePop[prev]; delete state.zonePop[prev]; }
        schedule();
      }, onchange: () => renderUnits() }),
    )));
    const zl = h('datalist', { id: 'zone-names' }, zonesNow.map((z) => h('option', { value: z })));
    const pops = state.useZonePop ? h('div', { class: 'zonepop' }, h('p', { class: 'f-hint' }, 'Població de cada zona segons la font externa (p. ex. el padró per nuclis que facilita el client). Només se\'n fa servir el pes relatiu.'),
      zonesNow.map((z) => h('label', { class: 'field row' }, h('span', { class: 'f-label' }, z),
        h('input', { type: 'number', min: 0, value: state.zonePop[z] || '', oninput: (e) => { state.zonePop[z] = Number(e.target.value) || 0; schedule(); } })))) : null;
    $('#units').replaceChildren(list, zl, pops || '');
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
    renderUnits(); schedule();
  }

  function varSelects(t, onChange) {
    const wrap = h('div', { class: 'vars' });
    for (let lvl = 0; lvl < 3; lvl++) {
      const cur = t.cols[lvl] || '';
      const used = t.cols.filter((_, i) => i !== lvl);
      const sel = h('select', { 'aria-label': `Variable de columna ${lvl + 1}`, disabled: lvl > t.cols.length },
        h('option', { value: '' }, lvl === 0 ? '(cap)' : '—'),
        VARS.filter(([k]) => !used.includes(k) || k === cur).map(([k, l]) => h('option', { value: k, selected: k === cur }, l)));
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
    const sel = h('select', { 'aria-label': 'Files' }, h('option', { value: 'zona', selected: t.rows === 'zona' }, 'Zones'), h('option', { value: 'cap', selected: t.rows === 'cap' }, 'Total àmbit'));
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
    state = load();
    $('#f-file').addEventListener('change', (e) => { if (e.target.files[0]) onUpload(e.target.files[0]).then(() => { $('#db-reset').hidden = false; }); e.target.value = ''; });
    $('#db-reset').addEventListener('click', async () => {
      try { await idb.del('custom'); } catch (e) { /* res */ }
      db = M.fromCompact(window.CENS_BASE);
      dbLabel = `Base inclosa: ${window.CENS_BASE.source.file} (actualitzada ${window.CENS_BASE.source.loaded || ''})`;
      $('#db-reset').hidden = true; $('#db-status').textContent = 'S\'ha tornat a la base inclosa.';
      state = load(); renderAll();
    });
    $('#add-muni').addEventListener('click', addMuni);
    $('#f-muni').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addMuni(); } });
    $('#z-agrup').addEventListener('click', () => zonePreset('agrup'));
    $('#z-muni').addEventListener('click', () => zonePreset('muni'));
    $('#add-extra').addEventListener('click', () => { state.extras.push({ rows: 'cap', cols: ['sexe'], mode: 'derivada' }); renderDesign(); schedule(); });
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
    $('#export').addEventListener('click', exportXlsx);
    $('#reset-cfg').addEventListener('click', () => { state = defaultState(); renderAll(); save(); });
    renderAll();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
