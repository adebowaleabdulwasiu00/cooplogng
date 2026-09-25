/**
 * weeklyChart.js � click-a-card weekly trend charts for the dashboard.
 *
 * Data: approved remittance flows already loaded by AccountBalance
 * (remittance_date + detail amounts per enterprise). No new dependency:
 * charts are dependency-free inline SVG (offline-safe, theme-aware).
 *
 * Two chart kinds:
 *  - balance: current total minus future weekly flows reconstructs the
 *    historical balance line (exact when dated history is complete).
 *  - flow/count: raw weekly sums or counts.
 */

export const CHART_WEEKS = 12;

function isIncomeCat(cls) {
  return cls === 'Revenue' || cls === 'Operating Income' || cls === 'Loan Income' || cls === 'Other Income';
}

function isExpenseCat(cls) {
  return cls === 'Expense' || cls === 'Expenses' || cls === 'Operating Expense' || cls === 'Administrative Expense' || cls === 'Finance Expense' || cls === 'Welfare Expense' || cls === 'Other Operating Expense' || cls === 'Other Expenses';
}

function entType(entObj) {
  return String((entObj && entObj.account_type) || '').toLowerCase();
}

function isRevenueEnt(entObj) {
  return !!entObj && (entObj.revenue == 1 || entObj.revenue === '1' || entObj.revenue === 'true' || entObj.revenue === true || entObj.account_type === 'revenue');
}

function isPenaltyEnt(entObj) {
  return !!entObj && (entObj.is_penalty == 1 || entObj.is_penalty === '1' || entObj.is_penalty === 'true' || entObj.is_penalty === true);
}

// Dues & penalties are member obligations: like the dashboard cards, they
// count toward savings/loans buckets even when flagged as revenue.
function isDuePenaltyEnt(entObj) {
  if (!entObj) return false;
  const due = entObj.compulsory_due == 1 || entObj.compulsory_due === '1' || entObj.compulsory_due === 'true' || entObj.compulsory_due === true;
  return !!(due || isPenaltyEnt(entObj));
}

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function shortLabel(d) {
  try {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch (e) {
    return '';
  }
}

/**
 * Bucket approved flows into the last 'weekCount' Monday-start weeks
 * (oldest first, current partial week last). Mirrors the dashboard card
 * classifications so chart and card always agree.
 */
export function buildWeeklyActivity(remittances, entObjMap, weekCount) {
  const n = weekCount || CHART_WEEKS;
  const thisMonday = mondayOf(new Date());
  const starts = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = new Date(thisMonday);
    s.setDate(s.getDate() - i * 7);
    starts.push(s);
  }
  const zero = () => ({ savings: 0, loans: 0, cash: 0, revenue: 0, tx: 0, submitted: 0, revM: 0, expM: 0 });
  const buckets = starts.map((s) => ({ start: s, label: shortLabel(s), sums: zero() }));
  let undated = 0;

  const place = (ms) => {
    for (let i = 0; i < starts.length; i++) {
      const end = i === starts.length - 1 ? Infinity : starts[i + 1].getTime();
      if (ms >= starts[i].getTime() && ms < end) return i;
    }
    return ms < starts[0].getTime() ? -1 : starts.length - 1;
  };

  (remittances || []).forEach((rem) => {
    const ms = new Date(rem.remittance_date).getTime();
    if (isNaN(ms)) { undated += 1; return; }
    const idx = place(ms);
    if (idx < 0) return;
    const b = buckets[idx].sums;
    b.submitted += 1;
    if (rem.status !== 'Approved') return;
    b.tx += 1;
    const bank = rem.bank_name;
    if (bank === null || bank === undefined || bank !== 'Internal Transfer') {
      b.cash += parseFloat(rem.amount || 0);
    }
    // Accounting follows the remittance header category (same rule as the
    // dashboard cards). Details feed only the enterprise savings/loans
    // buckets below.
    const cls = rem.category || '';
    const amtH = parseFloat(rem.amount || 0);
    if (isIncomeCat(cls)) {
      b.revenue += amtH;
      b.revM += amtH;
    } else if (isExpenseCat(cls)) {
      // Signed, same as the cards: a +ve expense header nets off.
      b.expM -= amtH;
    }
    (rem.details || []).forEach((d) => {
      const entObj = (entObjMap || {})[d.enterprise_id];
      if (!entObj) return;
      const amt = parseFloat(d.amount || 0);
      const t = entType(entObj);
      const rev = isRevenueEnt(entObj);
      const duePen = isDuePenaltyEnt(entObj);
      if ((!rev || duePen) && (t === 'savings' || t === 'liability')) b.savings += amt;
      if ((!rev || duePen) && (t === 'loan' || t === 'asset')) b.loans += amt;
    });
  });

  return { buckets: buckets, undated: undated };
}

/** Turn a current total + oldest-first weekly flows into a balance line. */
export function reconstructBalances(currentTotal, flowsAsc) {
  const out = new Array(flowsAsc.length);
  let future = 0;
  for (let i = flowsAsc.length - 1; i >= 0; i--) {
    out[i] = currentTotal - future;
    future += flowsAsc[i];
  }
  return out;
}

/** Fractional change first -> last week, or null when base is zero. */
export function weekPctChange(values) {
  if (!values || values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (!first) return null;
  return (last - first) / Math.abs(first);
}

export function compactCurr(v) {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1000000) return sign + '?' + trimNum(a / 1000000) + 'm';
  if (a >= 1000) return sign + '?' + trimNum(a / 1000) + 'k';
  return sign + '?' + Math.round(a).toLocaleString();
}

function trimNum(x) {
  const r = Math.round(x * 10) / 10;
  return String(r);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Inline SVG area + line chart. values oldest-first, labels aligned.
 * opts: { id, color, format } � format ticks for the Y axis.
 */
export function areaChartSVG(values, labels, opts) {
  const o = opts || {};
  const color = o.color || '#3b82f6';
  const gid = 'wcg-' + String(o.id || 'x').replace(/[^a-zA-Z0-9_-]/g, '');
  const fmt = typeof o.format === 'function' ? o.format : compactCurr;
  const W = 640;
  const H = 240;
  const padL = 56;
  const padR = 14;
  const padT = 16;
  const padB = 32;
  const vals = (values || []).map((v) => (typeof v === 'number' && !isNaN(v) ? v : 0));
  let min = Math.min.apply(null, vals.concat([0]));
  let max = Math.max.apply(null, vals.concat([0]));
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.08;
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(vals.length - 1, 1);
  const y = (v) => padT + (1 - (v - min) / (max - min + span * 0.08)) * (H - padT - padB);
  let line = '';
  let area = '';
  vals.forEach((v, i) => {
    const px = x(i).toFixed(1);
    const py = y(v).toFixed(1);
    line += (i === 0 ? 'M' : 'L') + px + ' ' + py;
  });
  const baseY = (H - padB).toFixed(1);
  area = line + 'L' + x(vals.length - 1).toFixed(1) + ' ' + baseY + 'L' + x(0).toFixed(1) + ' ' + baseY + 'Z';
  let grid = '';
  for (let g = 0; g <= 2; g++) {
    const gv = min + ((max - min) * g) / 2;
    const gy = y(gv).toFixed(1);
    grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="currentColor" stroke-opacity="0.12"/>' +
      '<text x="' + (padL - 6) + '" y="' + (+gy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="currentColor" opacity="0.55">' + esc(fmt(gv)) + '</text>';
  }
  let dots = '';
  vals.forEach((v, i) => {
    dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="2.6" fill="' + color + '"><title>' + esc(labels[i] || '') + ': ' + esc(fmt(v)) + '</title></circle>';
  });
  let xlabels = '';
  const every = Math.max(1, Math.ceil(vals.length / 5));
  vals.forEach((v, i) => {
    if (i % every !== 0 && i !== vals.length - 1) return;
    xlabels += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.55">' + esc(labels[i] || '') + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;" role="img">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + color + '" stop-opacity="0.35"/>' +
    '<stop offset="1" stop-color="' + color + '" stop-opacity="0.02"/>' +
    '</linearGradient></defs>' +
    grid +
    '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
    '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots + xlabels + '</svg>';
}
