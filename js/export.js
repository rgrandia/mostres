/*
 * Exportació del llibre de quotes a Excel amb ExcelJS.
 *
 * El llibre és viu: totes les quotes pengen de Resum!B4 (la N) amb fórmules.
 * L'ajust d'arrodoniment (restes majors) va en cel·les grogues editables al
 * full Càlcul, calculat per a la N de l'aplicatiu; si es canvia la N a l'Excel,
 * Resum avisa que l'ajust s'ha de revisar.
 *
 * Cada fórmula porta també el resultat calculat, perquè el llibre es vegi bé
 * fins i tot en visors que no recalculen.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.MostresExport = factory(root.Mostres);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const L = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const A = (r, c) => L(c) + r;
  const AA = (r, c) => '$' + L(c) + '$' + r;
  const CALC = "'Càlcul'";

  const THIN = { style: 'thin', color: { argb: 'FF808080' } };
  const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const GREY = fill('FFD9D9D9'), LGREY = fill('FFF2F2F2'), YEL = fill('FFFFFF00');
  const font = (bold, color) => ({ name: 'Arial', size: 9, bold: !!bold, color: color ? { argb: color } : undefined });
  const CEN = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const LEFT = { horizontal: 'left', vertical: 'middle' };

  function put(ws, r, c, v, o) {
    o = o || {};
    const cell = ws.getCell(r, c);
    if (v !== undefined) cell.value = v;
    cell.font = font(o.bold, o.color);
    cell.alignment = o.al || CEN;
    if (o.border !== false) cell.border = BOX;
    if (o.fill) cell.fill = o.fill;
    if (o.num) cell.numFmt = o.num;
    return cell;
  }
  const f = (formula, result) => ({ formula, result });

  /** Capçalera de diversos nivells amb cel·les fusionades. */
  function header(ws, r0, plan, rowTitle) {
    const cols = plan.cols, depth = plan.depth;
    for (let lvl = 0; lvl < depth; lvl++) {
      let c = 0;
      while (c < cols.length) {
        const lab = cols[c].labels[lvl];
        const key = cols[c].labels.slice(0, lvl + 1).join('\u0001');
        let c2 = c;
        while (c2 + 1 < cols.length && cols[c2 + 1].labels.slice(0, lvl + 1).join('\u0001') === key) c2++;
        if (lab !== '') {
          const down = cols.slice(c, c2 + 1).every((x) => x.labels.slice(lvl + 1).every((y) => y === ''));
          const rEnd = down ? r0 + depth - 1 : r0 + lvl;
          const isTot = lab.startsWith('TOTAL');
          const fl = lvl === 0 || isTot ? GREY : lab === 'Total' || lvl < depth - 1 ? LGREY : undefined;
          for (let rr = r0 + lvl; rr <= rEnd; rr++) for (let cc = c; cc <= c2; cc++) {
            put(ws, rr, cc + 2, rr === r0 + lvl && cc === c ? lab : undefined, { bold: true, fill: fl });
          }
          if (rEnd > r0 + lvl || c2 > c) ws.mergeCells(r0 + lvl, c + 2, rEnd, c2 + 2);
        }
        c = c2 + 1;
      }
    }
    for (let rr = r0; rr < r0 + depth; rr++) put(ws, rr, 1, rr === r0 ? rowTitle : undefined, { bold: true, fill: GREY, al: LEFT });
    if (depth > 1) ws.mergeCells(r0, 1, r0 + depth - 1, 1);
  }

  /**
   * Escriu un bloc (capçalera + files + TOTAL). `leaf(r, leafIdx)` retorna el
   * valor o la fórmula de cada cel·la de detall; subtotals i totals són sumes.
   */
  function block(ws, b0, t, leaf, o) {
    o = o || {};
    const plan = t.plan;
    header(ws, b0, plan, o.rowTitle || (t.rows === 'zona' ? 'Zona' : ''));
    const d0 = b0 + plan.depth;
    const leafCol = [];
    plan.cols.forEach((c, i) => { if (c.kind === 'leaf') leafCol[c.leaf] = i + 2; });
    const vals = [];
    for (let r = 0; r < t.nR; r++) {
      const row = d0 + r;
      put(ws, row, 1, t.rowLabels[r], { bold: true, al: LEFT });
      const lv = [];
      for (let l = 0; l < plan.leaves.length; l++) {
        const x = leaf(r, l, row);
        lv[l] = x && typeof x === 'object' ? x.result : x;
        put(ws, row, leafCol[l], x, { num: o.num, fill: o.leafFill, color: o.leafColor });
      }
      vals.push(lv);
      plan.cols.forEach((c, i) => {
        if (c.kind === 'leaf') return;
        const res = c.members.reduce((a, m) => a + lv[m], 0);
        put(ws, row, i + 2, f(c.members.map((m) => A(row, leafCol[m])).join('+'), res),
          { bold: true, fill: c.key.length > 1 ? LGREY : GREY, num: o.num });
      });
    }
    if (t.nR === 1) return { d0, tr: d0, leafCol, totCol: plan.cols.length + 1, vals };
    const tr = d0 + t.nR;
    put(ws, tr, 1, 'TOTAL', { bold: true, fill: GREY, al: LEFT });
    plan.cols.forEach((c, i) => {
      const res = vals.reduce((a, lv) => a + c.members.reduce((s, m) => s + lv[m], 0), 0);
      put(ws, tr, i + 2, f(`SUM(${A(d0, i + 2)}:${A(tr - 1, i + 2)})`, res), { bold: true, fill: GREY, num: o.num });
    });
    return { d0, tr, leafCol, totCol: plan.cols.length + 1, vals };
  }

  const height = (t) => t.plan.depth + t.nR + (t.nR > 1 ? 1 : 0);

  function titleCell(ws, r, text) { put(ws, r, 1, text, { bold: true, al: LEFT, border: false }); }

  /**
   * meta = {estudi, municipi, univers, font, fitxer}
   * Retorna un ExcelJS.Workbook.
   */
  function buildWorkbook(ExcelJS, db, cfg, res, meta) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Generador de mostres';
    wb.calcProperties = { fullCalcOnLoad: true };
    const resum = wb.addWorksheet('Resum', { views: [{ showGridLines: false }] });
    const calc = wb.addWorksheet('Càlcul', { views: [{ showGridLines: false }] });
    const N = res.N;
    const main = res.main;
    const maxCols = Math.max(...res.tables.map((t) => t.plan.cols.length)) + 1;
    for (const ws of [resum, calc]) {
      [meta.estudi, meta.univers, meta.font].forEach((v, i) => put(ws, i + 1, 1, v || '', { bold: true, al: LEFT, border: false }));
      ws.getColumn(1).width = Math.max(26, Math.min(48, Math.max(...res.zones.map((z) => z.length), 10) + 4));
      for (let c = 2; c <= Math.max(maxCols, 12); c++) ws.getColumn(c).width = 8;
    }
    const computed = res.tables.filter((t) => t.mode !== 'derivada');

    // ---------------- disposició (files) de les dues fulles, abans d'escriure fórmules creuades
    const lay = new Map();
    let r = 6;
    computed.forEach((t) => {
      const s = {};
      if (t === main && res.ipfApplied) { s.zp = r + 1; r = s.zp + 1 + res.zones.length + 1 + 2; }
      s.uT = r; s.u0 = r + 1; r = s.u0 + height(t) + 2;
      s.nRow = r; s.mT = r + 1; s.m0 = r + 2; r = s.m0 + height(t) + 2;
      s.aT = r; s.a0 = r + 1; r = s.a0 + height(t) + 2;
      s.fT = r; s.f0 = r + 1; r = s.f0 + height(t) + 4;
      lay.set(t, s);
    });
    const rl = new Map();
    r = 9;
    res.tables.forEach((t) => {
      const s = { T: r, b0: r + 2 };
      r = s.b0 + height(t) + 3;
      if (t === main && cfg.cawiPct > 0) { s.cawiT = r; s.cawiPctRow = r + 1; s.cawi0 = r + 3; r = s.cawi0 + height(t) + 3; s.catiT = r; s.cati0 = r + 2; r = s.cati0 + height(t) + 3; }
      rl.set(t, s);
    });
    const notesRow = r;
    const leafColOf = (t) => { const a = []; t.plan.cols.forEach((c, i) => { if (c.kind === 'leaf') a[c.leaf] = i + 2; }); return a; };
    const totColOf = (t) => t.plan.cols.length + 1;
    const mainResumRow = (i) => rl.get(main).b0 + main.plan.depth + i;

    // ---------------- Càlcul
    computed.forEach((t) => {
      const s = lay.get(t);
      const lc = leafColOf(t);
      const isMain = t === main;
      if (s.zp) {
        titleCell(calc, s.zp - 1, 'Població per zones (font externa): pes de cada zona');
        ['Zona', 'Població', '%'].forEach((h, i) => put(calc, s.zp, i + 1, h, { bold: true, fill: GREY }));
        const pops = res.zones.map((z) => Number(cfg.zonePop[z]) || 0);
        const tot = pops.reduce((a, b) => a + b, 0);
        const tr = s.zp + res.zones.length + 1;
        res.zones.forEach((z, i) => {
          const rr = s.zp + 1 + i;
          put(calc, rr, 1, z, { bold: true, al: LEFT });
          put(calc, rr, 2, pops[i], { num: '#,##0' });
          put(calc, rr, 3, f(`B${rr}/$B$${tr}`, pops[i] / tot), { num: '0.0%' });
        });
        put(calc, tr, 1, 'TOTAL', { bold: true, fill: GREY, al: LEFT });
        put(calc, tr, 2, f(`SUM(B${s.zp + 1}:B${tr - 1})`, tot), { bold: true, fill: GREY, num: '#,##0' });
        put(calc, tr, 3, f(`SUM(C${s.zp + 1}:C${tr - 1})`, 1), { bold: true, fill: GREY, num: '0.0%' });
      }
      const label = isMain ? 'Taula principal' : t.title;
      titleCell(calc, s.uT, `${label} · Univers${s.zp ? ' ajustat (estructura del cens, pes de zones de la font externa; ajust iteratiu)' : ''}`);
      const ub = block(calc, s.u0, t, (rr, l) => t.U[rr][l], { num: '#,##0.0' });
      const uTot = AA(ub.tr, ub.totCol);
      s.ub = ub;

      put(calc, s.nRow, 1, 'Mida de la mostra (N):', { bold: true, al: { horizontal: 'right' }, border: false });
      put(calc, s.nRow, 2, f('Resum!B4', N), { bold: true, color: 'FF008000', num: '0' });
      const byZone = !isMain && t.ref === 'zona';
      titleCell(calc, s.mT, byZone
        ? 'Mostra: ROUND(univers de la cel·la / univers de la zona × quota de la zona a la taula principal)'
        : 'Mostra: ROUND(univers de la cel·la / univers total × N)');
      const mb = block(calc, s.m0, t, (rr, l) => {
        const uc = A(ub.d0 + rr, lc[l]);
        if (byZone) {
          const zr = AA(mainResumRow(rr), totColOf(main));
          return f(`IF($${L(ub.totCol)}$${ub.d0 + rr}=0,0,ROUND(${uc}/$${L(ub.totCol)}$${ub.d0 + rr}*Resum!${zr},0))`, t.R[rr][l]);
        }
        return f(`ROUND(${uc}/${uTot}*$B$${s.nRow},0)`, t.R[rr][l]);
      }, { num: '0' });

      titleCell(calc, s.aT, cfg.rounding === 'directe'
        ? 'Ajust d\'arrodoniment manual (cel·les grogues editables; inicialment a 0)'
        : `Ajust d'arrodoniment per restes majors, fixat per a N=${N} (cel·les grogues editables)`);
      const ab = block(calc, s.a0, t, (rr, l) => t.A[rr][l], { num: '0', leafFill: YEL, leafColor: 'FF0000FF' });
      titleCell(calc, s.fT, 'Quota final = mostra + ajust');
      s.fb = block(calc, s.f0, t, (rr, l) => f(`${A(mb.d0 + rr, lc[l])}+${A(ab.d0 + rr, lc[l])}`, t.Q[rr][l]), { num: '0' });
    });
    calc.views = [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 0 }];

    // ---------------- Resum
    put(resum, 4, 1, 'Mida de la mostra (N):', { bold: true, al: { horizontal: 'right' }, border: false });
    const nCell = put(resum, 4, 2, N, { bold: true, fill: YEL, color: 'FF0000FF', num: '0' });
    nCell.note = 'Cel·la editable. Totes les quotes del llibre es recalculen a partir d\'aquí.';
    const mainS = rl.get(main);
    const mainTot = A(mainS.b0 + height(main) - 1, totColOf(main)); // fila TOTAL (o l'única fila)
    put(resum, 4, 4, 'Suma quotes:', { bold: true, border: false });
    put(resum, 4, 6, f(mainTot, main.sum), { bold: true, border: false });
    put(resum, 4, 8, 'Diferència:', { bold: true, border: false });
    put(resum, 4, 10, f('F4-B4', main.sum - N), { bold: true, border: false });
    const hasAdj = res.tables.some((t) => t.A.some((row) => row.some((v) => v !== 0)));
    if (hasAdj) {
      put(resum, 5, 1, f(`IF(B4<>${N},"Atenció: l'ajust d'arrodoniment del full Càlcul està calculat per a N=${N}. Revisa'l o torna a generar el llibre amb la nova N.","")`, ''),
        { bold: true, color: 'FFC00000', al: LEFT, border: false });
    }
    const uMain = lay.get(main).ub;
    put(resum, 6, 1, 'Error mostral màxim (95%, p=q=50%, m.a.s.):', { bold: true, al: { horizontal: 'right' }, border: false });
    put(resum, 6, 2, f(`1.96*SQRT(0.25/B4)*SQRT((${CALC}!${AA(uMain.tr, uMain.totCol)}-B4)/(${CALC}!${AA(uMain.tr, uMain.totCol)}-1))`, res.diag.moe),
      { bold: true, num: '0.0%', border: false });
    put(resum, 7, 1, `Univers: ${fmtInt(res.Utot)} persones`, { al: LEFT, border: false });

    res.tables.forEach((t) => {
      const s = rl.get(t);
      titleCell(resum, s.T, (t === main ? (meta.titol || t.title) : t.title));
      if (t.mode === 'derivada') {
        const mlc = leafColOf(main);
        const map = t.plan.leaves.map((l) => main.plan.leaves
          .filter((ml) => t.vars.every((v, i) => ml.key[main.vars.indexOf(v)] === l.key[i])).map((ml) => ml.leaf));
        block(resum, s.b0, t, (rr, l) => {
          const rows = t.rows === 'zona' ? [rr] : main.rowLabels.map((_, i) => i);
          const refs = [];
          rows.forEach((zr) => map[l].forEach((m) => refs.push(A(mainResumRow(zr), mlc[m]))));
          return f(refs.length > 12 && t.rows !== 'zona' && map[l].length === 1
            ? `SUM(${A(mainResumRow(0), mlc[map[l][0]])}:${A(mainResumRow(main.nR - 1), mlc[map[l][0]])})`
            : refs.join('+'), t.Q[rr][l]);
        }, { num: '0' });
      } else {
        const c = lay.get(t);
        const lc = leafColOf(t);
        block(resum, s.b0, t, (rr, l) => f(`${CALC}!${A(c.fb.d0 + rr, lc[l])}`, t.Q[rr][l]), { num: '0' });
      }
      if (t === main && s.cawiT) {
        const lc = leafColOf(main);
        titleCell(resum, s.cawiT, 'CAWI: quotes en línia (% editable; cel·les grogues editables)');
        put(resum, s.cawiPctRow, 1, '% de la mostra en CAWI:', { bold: true, al: { horizontal: 'right' }, border: false });
        put(resum, s.cawiPctRow, 2, cfg.cawiPct / 100, { bold: true, fill: YEL, color: 'FF0000FF', num: '0%' });
        const cawiQ = main.Q.map((row) => row.map((q) => M.xround(q * cfg.cawiPct / 100)));
        const cb = block(resum, s.cawi0, main, (rr, l) => f(`ROUND(${A(mainResumRow(rr), lc[l])}*$B$${s.cawiPctRow},0)`, cawiQ[rr][l]),
          { num: '0', leafFill: YEL, leafColor: 'FF0000FF' });
        titleCell(resum, s.catiT, 'CATI: quota total − CAWI');
        block(resum, s.cati0, main, (rr, l) => f(`${A(mainResumRow(rr), lc[l])}-${A(cb.d0 + rr, lc[l])}`, main.Q[rr][l] - cawiQ[rr][l]), { num: '0' });
      }
    });

    let nr = notesRow;
    const notes = [].concat(meta.notes || [], res.notes, res.warnings);
    if (notes.length) {
      titleCell(resum, nr++, 'Notes:');
      notes.forEach((n) => { put(resum, nr++, 1, '- ' + n, { al: LEFT, border: false }); });
    }
    resum.views = [{ showGridLines: false, state: 'frozen', xSplit: 1, ySplit: 0 }];

    // ---------------- Disseny (per poder reproduir el llibre)
    const dz = wb.addWorksheet('Disseny', { views: [{ showGridLines: false }] });
    dz.getColumn(1).width = 34; dz.getColumn(2).width = 90;
    const rows = [
      ['Estudi', meta.estudi], ['Municipi / àmbit', meta.municipi], ['Any del cens', res.year],
      ['Fitxer de dades', meta.fitxer], ['Univers', meta.univers], ['Edat', `${res.minAge}${Number.isFinite(res.maxAge) ? '-' + res.maxAge : ' i més'} anys`],
      ['Franges d\'edat', res.bandLabels.join(', ')], ['Origen inclòs', res.cats.origen.join(', ')],
      ['Taula principal', main.title], ['Arrodoniment', cfg.rounding === 'directe' ? 'ROUND directe cel·la a cel·la' : 'Restes majors (primer per zona, després dins de cada zona)'],
      ['Pes de zones', res.ipfApplied ? 'Ajustat a població externa (IPF)' : 'Proporcional al cens'],
      ['Zones', cfg.units.map((x) => `${db.units[x.u].name} → ${x.zona}`).join('\n')],
      ['Configuració (JSON)', JSON.stringify(cfg)],
    ];
    rows.forEach(([k, v], i) => {
      put(dz, i + 1, 1, k, { bold: true, al: LEFT, fill: LGREY });
      put(dz, i + 1, 2, v == null ? '' : String(v), { al: { horizontal: 'left', vertical: 'top', wrapText: true } });
    });

    // ---------------- traçabilitat: files del cens utilitzades
    const fs = wb.addWorksheet(('Font - cens ' + res.year).slice(0, 31), { properties: { tabColor: { argb: 'FFBFBFBF' } } });
    fs.addRow(['any', 'unitat', 'edat', db.originVar || 'origen', 'sexe', 'valor', 'estat']);
    fs.getRow(1).font = font(true);
    M.sourceRows(db, cfg).forEach((row) => fs.addRow(row));
    [8, 60, 18, 14, 10, 10, 8].forEach((w, i) => { fs.getColumn(i + 1).width = w; });
    return wb;
  }

  function fmtInt(x) { return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  return { buildWorkbook };
});
