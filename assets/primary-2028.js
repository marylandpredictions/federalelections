(() => {
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#4d7cff', '#e35d7a', '#12a454', '#d4a017', '#8b5cf6', '#0f9aa8', '#f97316', '#64748b'];
  const fmtPct = value => `${Number(value).toFixed(1)}%`;
  const fmtDate = iso => {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  };
  const populationLabel = code => ({lv: 'LV', rv: 'RV', a: 'Adults', v: 'Voters'}[code] || code);
  const NAME_SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  const shortName = name => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return name;
    if (parts[0] === 'JB' || parts[0] === 'AOC' || parts[0] === 'RFK') {
      return NAME_SUFFIX.test(parts.at(-1)) ? parts.join(' ') : parts[0];
    }
    if (NAME_SUFFIX.test(parts.at(-1)) && parts.length >= 2) {
      const suffix = parts.at(-1).replace(/\.$/, '');
      const pretty = /^(jr|sr)$/i.test(suffix) ? `${suffix}.` : suffix;
      return `${parts.at(-2)} ${pretty}`;
    }
    return parts.at(-1);
  };

  let payload = null;
  let activeParty = null;
  let standingsExpanded = false;
  const STANDINGS_PREVIEW = 5;

  function el(tag, attrs = {}, text) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    return node;
  }

  function partyBlock() {
    return payload?.parties?.[activeParty] || null;
  }

  function renderPartyToggle() {
    const host = $('primary-party-toggle');
    host.replaceChildren();
    const parties = payload?.availableParties || [];
    for (const party of parties) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = party === 'D' ? 'Democratic' : 'Republican';
      btn.classList.toggle('is-active', party === activeParty);
      btn.setAttribute('aria-pressed', party === activeParty ? 'true' : 'false');
      btn.addEventListener('click', () => {
        activeParty = party;
        standingsExpanded = false;
        renderAll();
      });
      host.append(btn);
    }
  }

  function renderLeadStats(block) {
    const host = $('primary-lead-stats');
    host.replaceChildren();
    const lead = (block.current?.field?.length ? block.current.field : block.current?.candidates || []).slice(0, 3);
    for (const candidate of lead) {
      const wrap = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = shortName(candidate.name);
      const dd = document.createElement('dd');
      dd.textContent = fmtPct(candidate.pct);
      wrap.append(dt, dd);
      host.append(wrap);
    }
    const enopWrap = document.createElement('div');
    const enopDt = document.createElement('dt');
    enopDt.textContent = 'ENOP';
    const enopDd = document.createElement('dd');
    enopDd.textContent = Number.isFinite(block.current?.enop)
      ? Number(block.current.enop).toFixed(2)
      : '—';
    enopWrap.append(enopDt, enopDd);
    host.append(enopWrap);
  }

  function renderMeter(block) {
    const track = $('primary-meter-track');
    const labels = $('primary-meter-labels');
    track.replaceChildren();
    labels.replaceChildren();
    const candidates = block.current?.field?.length
      ? block.current.field
      : (block.current?.candidates || []);
    const top = candidates.slice(0, 4);
    const topSum = top.reduce((sum, c) => sum + c.pct, 0);
    const rest = Math.max(0, candidates.slice(4).reduce((sum, c) => sum + c.pct, 0));
    const total = topSum + rest;
    if (total <= 0) return;

    top.forEach((candidate, index) => {
      const span = document.createElement('span');
      span.style.width = `${(100 * candidate.pct) / total}%`;
      span.style.background = COLORS[index % COLORS.length];
      span.title = `${candidate.name} ${fmtPct(candidate.pct)}`;
      track.append(span);
    });
    if (rest > 0) {
      const other = document.createElement('span');
      other.style.width = `${(100 * rest) / total}%`;
      other.style.background = 'color-mix(in srgb, var(--ink) 18%, transparent)';
      other.title = `Others ${fmtPct(rest)}`;
      track.append(other);
    }

    const left = document.createElement('span');
    left.textContent = top[0] ? `${shortName(top[0].name)} ${fmtPct(top[0].pct)}` : '';
    const right = document.createElement('span');
    right.textContent = rest > 0
      ? `Others ${fmtPct(rest)}`
      : (top[1] ? `${shortName(top[1].name)} ${fmtPct(top[1].pct)}` : '');
    labels.append(left, right);
  }

  function renderStandings(block) {
    const list = $('primary-standings');
    const toggle = $('primary-standings-toggle');
    list.replaceChildren();
    const field = block.current?.field?.length ? block.current.field : (block.current?.candidates || []);
    const expanded = block.current?.expanded || [];
    const preview = field.slice(0, STANDINGS_PREVIEW);
    const rows = standingsExpanded ? [...field, ...expanded] : preview;
    const totalCount = field.length + expanded.length;
    rows.forEach((candidate, index) => {
      const li = document.createElement('li');
      if (standingsExpanded && expanded.length && index === field.length) {
        li.className = 'primary-standings-break';
        li.textContent = 'Also tested';
        list.append(li);
      }
      const row = document.createElement('li');
      if (!candidate.field && standingsExpanded) row.classList.add('is-expanded-only');
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = String(index + 1);
      const name = document.createElement('div');
      name.className = 'name';
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = COLORS[index % COLORS.length];
      name.append(swatch, document.createTextNode(candidate.name));
      const pct = document.createElement('div');
      pct.className = 'pct';
      pct.textContent = fmtPct(candidate.pct);
      row.append(rank, name, pct);
      list.append(row);
    });
    list.classList.toggle('is-collapsed', !standingsExpanded);
    if (!toggle) return;
    if (totalCount <= STANDINGS_PREVIEW) {
      toggle.hidden = true;
      return;
    }
    toggle.hidden = false;
    toggle.textContent = standingsExpanded ? 'Show less' : `Show all ${totalCount}`;
    toggle.setAttribute('aria-expanded', standingsExpanded ? 'true' : 'false');
  }

  function renderTable(block) {
    const body = $('primary-poll-rows');
    body.replaceChildren();
    for (const poll of block.recentPolls || []) {
      const tr = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      if (poll.url) {
        const a = document.createElement('a');
        a.href = poll.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = poll.pollster;
        name.append(a);
      } else name.textContent = poll.pollster;

      const dates = document.createElement('td');
      dates.textContent = poll.startDate === poll.endDate
        ? fmtDate(poll.endDate)
        : `${fmtDate(poll.startDate)} – ${fmtDate(poll.endDate)}`;

      const sample = document.createElement('td');
      sample.textContent = poll.sampleSize
        ? `${poll.sampleSize.toLocaleString('en-US')} ${populationLabel(poll.population)}`
        : `— ${populationLabel(poll.population)}`;

      const results = document.createElement('td');
      results.className = 'results';
      const chips = document.createElement('div');
      chips.className = 'result-chips';
      for (const answer of (poll.answers || []).slice(0, 5)) {
        const chip = document.createElement('span');
        chip.className = 'result-chip';
        const who = document.createElement('span');
        who.className = 'result-name';
        who.textContent = shortName(answer.name);
        const pct = document.createElement('strong');
        pct.textContent = fmtPct(answer.pct);
        chip.append(who, pct);
        chips.append(chip);
      }
      results.append(chips);

      const weight = document.createElement('td');
      weight.textContent = Number(poll.weight).toFixed(2);
      tr.append(name, dates, sample, results, weight);
      body.append(tr);
    }
  }

  function drawChart(block) {
    const host = $('primary-chart');
    const tip = $('primary-tooltip');
    const tipDate = $('primary-tooltip-date');
    const tipValues = $('primary-tooltip-values');
    const legend = $('primary-legend');
    host.replaceChildren();
    host.removeAttribute('aria-busy');
    const series = block.series || [];
    if (!series.length) {
      host.textContent = 'Not enough polls to chart yet.';
      legend.replaceChildren();
      return;
    }

    const latestNamed = [...series].reverse().find(p => (p.candidates || []).some(c => Number.isFinite(c.pct)));
    const ids = (latestNamed?.candidates || series[0].candidates || [])
      .filter(c => series.some(p => (p.candidates || []).some(x => x.id === c.id && Number.isFinite(x.pct))))
      .map(c => c.id);
    const names = Object.fromEntries((latestNamed?.candidates || series[0].candidates || []).map(c => [c.id, c.name]));
    legend.replaceChildren();
    ids.forEach((id, index) => {
      const span = document.createElement('span');
      span.style.color = COLORS[index % COLORS.length];
      span.append(document.createTextNode(names[id] || id));
      legend.append(span);
    });

    const width = 960;
    const height = 420;
    const margin = {top: 18, right: 18, bottom: 42, left: 46};
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const xs = series.map(p => Date.parse(`${p.date}T12:00:00Z`));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const values = series.flatMap(p => (p.candidates || []).map(c => c.pct).filter(Number.isFinite));
    let minY = 0;
    let maxY = Math.max(20, ...values);
    const pad = Math.max(2, (maxY - minY) * 0.12);
    maxY = Math.min(100, Math.ceil(maxY + pad));
    const x = t => margin.left + ((t - minX) / Math.max(1, maxX - minX)) * innerW;
    const y = v => margin.top + ((maxY - v) / Math.max(1e-6, maxY - minY)) * innerH;

    const svg = el('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `${block.label} primary support over time`,
    });
    const plot = el('g', {class: 'plot'});
    const grid = el('g', {class: 'grid'});
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const value = minY + ((maxY - minY) * i) / ticks;
      const yy = y(value);
      grid.append(el('line', {x1: margin.left, x2: width - margin.right, y1: yy, y2: yy}));
      svg.append(el('text', {class: 'axis', x: margin.left - 10, y: yy + 4, 'text-anchor': 'end'}, `${Math.round(value)}%`));
    }
    plot.append(grid);

    const labelIndexes = [0, Math.floor((series.length - 1) / 2), series.length - 1];
    for (const i of new Set(labelIndexes)) {
      svg.append(el('text', {
        class: 'axis',
        x: x(xs[i]),
        y: height - 14,
        'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle',
      }, fmtDate(series[i].date)));
    }

    ids.forEach((id, index) => {
      let d = '';
      let drawing = false;
      series.forEach((point, i) => {
        const hit = (point.candidates || []).find(c => c.id === id);
        const pct = hit && Number.isFinite(hit.pct) ? hit.pct : null;
        if (pct == null) {
          drawing = false;
          return;
        }
        d += `${drawing ? 'L' : 'M'}${x(xs[i]).toFixed(2)} ${y(pct).toFixed(2)}`;
        drawing = true;
      });
      if (d) plot.append(el('path', {class: `series-c${index % 8}`, d}));
    });

    const cursor = el('line', {
      class: 'cursor-line',
      x1: 0, x2: 0, y1: margin.top, y2: margin.top + innerH,
      visibility: 'hidden',
    });
    plot.append(cursor);
    svg.append(plot);

    const hide = () => {
      tip.hidden = true;
      cursor.setAttribute('visibility', 'hidden');
    };
    const show = (point, clientX, clientY) => {
      tip.hidden = false;
      tipDate.textContent = fmtDate(point.date);
      tipValues.innerHTML = (point.candidates || [])
        .filter(c => Number.isFinite(c.pct))
        .slice(0, 5)
        .map((c, index) => `<span style="color:${COLORS[index % COLORS.length]}"><i>${shortName(c.name)}</i> ${fmtPct(c.pct)}</span>`)
        .join('');
      const xx = x(Date.parse(`${point.date}T12:00:00Z`));
      cursor.setAttribute('visibility', 'visible');
      cursor.setAttribute('x1', xx);
      cursor.setAttribute('x2', xx);
      const bounds = host.getBoundingClientRect();
      const localX = clientX - bounds.left;
      const localY = clientY - bounds.top;
      const tipW = tip.offsetWidth || 128;
      const tipH = tip.offsetHeight || 110;
      // Prefer the side of the cursor that keeps the tip off the plot lines.
      const placeRight = localX < bounds.width * 0.55;
      const left = placeRight
        ? Math.min(localX + 16, bounds.width - tipW - 8)
        : Math.max(8, localX - tipW - 16);
      const top = Math.min(Math.max(8, localY - tipH * 0.35), bounds.height - tipH - 8);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };

    for (let i = 0; i < series.length; i++) {
      const left = i === 0 ? margin.left : (x(xs[i - 1]) + x(xs[i])) / 2;
      const right = i === series.length - 1 ? width - margin.right : (x(xs[i]) + x(xs[i + 1])) / 2;
      const hit = el('rect', {
        class: 'hit',
        x: left,
        y: margin.top,
        width: Math.max(1, right - left),
        height: innerH,
        tabindex: '0',
        role: 'listitem',
        'aria-label': `${fmtDate(series[i].date)} primary reading`,
      });
      hit.addEventListener('pointerenter', event => show(series[i], event.clientX, event.clientY));
      hit.addEventListener('pointermove', event => show(series[i], event.clientX, event.clientY));
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', () => {
        const box = hit.getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        show(series[i], box.left + box.width / 2, hostBox.top + 40);
      });
      hit.addEventListener('blur', hide);
      svg.append(hit);
    }

    host.append(svg);
    if (!host.contains(tip)) host.append(tip);
    hide();
  }

  function renderAll() {
    renderPartyToggle();
    const block = partyBlock();
    if (!block) {
      $('primary-asof').textContent = 'No primary average available.';
      $('primary-chart').textContent = 'Chart unavailable.';
      return;
    }
    $('primary-current-title').textContent = `${block.label} primary`;
    $('primary-asof').textContent = `As of ${fmtDate(block.asOf)}`;
    $('primary-method-text').textContent = payload.method || '';
    const guide = $('primary-chart-guide');
    if (guide) guide.textContent = 'Hover or focus for each day.';
    renderLeadStats(block);
    renderMeter(block);
    renderStandings(block);
    renderTable(block);
    drawChart(block);
  }

  async function boot() {
    try {
      const response = await fetch('/data/polling/2028-primary.json?v=20261113-primary6', {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      payload = await response.json();
      activeParty = (payload.availableParties || [])[0] || null;
      const toggle = $('primary-standings-toggle');
      if (toggle && !toggle.dataset.bound) {
        toggle.dataset.bound = '1';
        toggle.addEventListener('click', () => {
          standingsExpanded = !standingsExpanded;
          renderStandings(partyBlock() || {current: {candidates: []}});
        });
      }
      renderAll();
    } catch (error) {
      $('primary-asof').textContent = 'Unable to load primary averages.';
      $('primary-chart').textContent = 'Chart unavailable.';
      console.error(error);
    }
  }

  boot();
})();
