(() => {
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const fmtPct = value => `${Number(value).toFixed(1)}%`;
  const fmtNet = value => `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}`;
  const fmtDate = iso => {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
  };
  const populationLabel = code => ({lv: 'LV', rv: 'RV', a: 'Adults', v: 'Voters'}[code] || code);

  let chartSeries = [];
  let chartMode = 'split';

  function el(tag, attrs = {}, text) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    return node;
  }

  function setCurrent(data) {
    const {current, asOf} = data;
    const enop = Number.isFinite(current.enop) ? ` · ENOP ${current.enop.toFixed(2)}` : '';
    $('approval-asof').textContent =
      `As of ${fmtDate(asOf)} · ${current.pollCount} polls · ${current.effectivePollsters} pollsters${enop}`;
    const approve = $('approval-approve');
    const disapprove = $('approval-disapprove');
    const net = $('approval-net');
    approve.textContent = fmtPct(current.approve);
    approve.className = 'is-approve';
    disapprove.textContent = fmtPct(current.disapprove);
    disapprove.className = 'is-disapprove';
    net.textContent = fmtNet(current.net);
    net.className = current.net >= 0 ? 'is-approve' : 'is-disapprove';
    $('approval-polls').textContent = String(current.pollCount);
    const total = current.approve + current.disapprove;
    const approveShare = total > 0 ? (100 * current.approve) / total : 50;
    $('approval-meter-approve').style.width = `${approveShare}%`;
    $('approval-meter-disapprove').style.width = `${100 - approveShare}%`;
    $('approval-method-text').textContent = data.method;
    const guide = $('approval-chart-guide');
    if (guide) {
      guide.textContent = current.halfLife
        ? `Soft-decay weighted average (half-life ${current.halfLife} days). Hover or focus the chart for a daily reading.`
        : 'Soft-decay weighted average. Hover or focus the chart for a daily reading.';
    }
  }

  function setPollTable(polls) {
    const body = $('approval-poll-rows');
    body.replaceChildren();
    for (const poll of polls) {
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
        : populationLabel(poll.population);
      const approve = document.createElement('td');
      approve.className = 'is-approve';
      approve.textContent = fmtPct(poll.approve);
      const disapprove = document.createElement('td');
      disapprove.className = 'is-disapprove';
      disapprove.textContent = fmtPct(poll.disapprove);
      const net = document.createElement('td');
      net.className = poll.net >= 0 ? 'is-approve' : 'is-disapprove';
      net.textContent = fmtNet(poll.net);
      const weight = document.createElement('td');
      weight.textContent = poll.weight.toFixed(2);
      const sources = document.createElement('td');
      sources.textContent = (poll.sources || []).join(', ') || '—';
      tr.append(name, dates, sample, approve, disapprove, net, weight, sources);
      body.append(tr);
    }
  }

  function updateLegend() {
    const legend = $('approval-legend');
    if (!legend) return;
    if (chartMode === 'net') {
      legend.innerHTML = '<span class="approval-legend-net">Net approval (approve − disapprove)</span>';
    } else {
      legend.innerHTML =
        '<span class="approval-legend-approve">Approve</span>' +
        '<span class="approval-legend-disapprove">Disapprove</span>';
    }
  }

  function drawChart(series, mode = chartMode) {
    const host = $('approval-chart');
    const tip = $('approval-tooltip');
    const tipDate = $('approval-tooltip-date');
    const tipValues = $('approval-tooltip-values');
    host.replaceChildren();
    host.removeAttribute('aria-busy');
    if (!series.length) {
      host.textContent = 'Not enough polls to chart yet.';
      return;
    }

    const width = 960;
    const height = 420;
    const margin = {top: 18, right: 18, bottom: 42, left: 46};
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const xs = series.map(p => Date.parse(`${p.date}T12:00:00Z`));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const values = mode === 'net'
      ? series.map(p => p.net)
      : series.flatMap(p => [p.approve, p.disapprove]);
    let minY = Math.min(...values);
    let maxY = Math.max(...values);
    if (mode === 'net') {
      const span = Math.max(8, maxY - minY);
      const pad = span * 0.15;
      minY = Math.floor(minY - pad);
      maxY = Math.ceil(maxY + pad);
      if (minY < 0 && maxY > 0) {
        // keep zero in frame
      } else if (minY >= 0) minY = Math.min(0, minY);
      else maxY = Math.max(0, maxY);
    } else {
      const pad = Math.max(2, (maxY - minY) * 0.12);
      minY = Math.max(0, Math.floor(minY - pad));
      maxY = Math.min(100, Math.ceil(maxY + pad));
    }
    const x = t => margin.left + ((t - minX) / Math.max(1, maxX - minX)) * innerW;
    const y = v => margin.top + ((maxY - v) / Math.max(1e-6, maxY - minY)) * innerH;
    const line = key => series.map((p, i) =>
      `${i ? 'L' : 'M'}${x(xs[i]).toFixed(2)} ${y(p[key]).toFixed(2)}`).join(' ');

    const svg = el('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': mode === 'net'
        ? 'Trump net approval average over time'
        : 'Trump approve and disapprove averages over time',
    });
    const plot = el('g', {class: 'plot'});
    const grid = el('g', {class: 'grid'});
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const value = minY + ((maxY - minY) * i) / ticks;
      const yy = y(value);
      grid.append(el('line', {x1: margin.left, x2: width - margin.right, y1: yy, y2: yy}));
      const label = mode === 'net'
        ? `${value > 0 ? '+' : ''}${Math.round(value)}`
        : `${Math.round(value)}%`;
      svg.append(el('text', {class: 'axis', x: margin.left - 10, y: yy + 4, 'text-anchor': 'end'}, label));
    }
    plot.append(grid);
    if (mode === 'net' && minY < 0 && maxY > 0) {
      plot.append(el('line', {
        class: 'zero-line',
        x1: margin.left,
        x2: width - margin.right,
        y1: y(0),
        y2: y(0),
      }));
    }

    const labelIndexes = [0, Math.floor((series.length - 1) / 2), series.length - 1];
    for (const i of new Set(labelIndexes)) {
      svg.append(el('text', {
        class: 'axis',
        x: x(xs[i]),
        y: height - 14,
        'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle',
      }, fmtDate(series[i].date)));
    }

    if (mode === 'net') {
      plot.append(el('path', {class: 'series-net', d: line('net')}));
    } else {
      plot.append(el('path', {class: 'series-approve', d: line('approve')}));
      plot.append(el('path', {class: 'series-disapprove', d: line('disapprove')}));
    }

    const cursor = el('line', {
      class: 'cursor-line',
      x1: 0, x2: 0, y1: margin.top, y2: margin.top + innerH,
      visibility: 'hidden',
    });
    const markerApprove = el('circle', {class: 'marker marker-approve', r: 5, visibility: 'hidden'});
    const markerDisapprove = el('circle', {class: 'marker marker-disapprove', r: 5, visibility: 'hidden'});
    const markerNet = el('circle', {class: 'marker marker-net', r: 5, visibility: 'hidden'});
    plot.append(cursor, markerApprove, markerDisapprove, markerNet);
    svg.append(plot);

    const hide = () => {
      tip.hidden = true;
      cursor.setAttribute('visibility', 'hidden');
      markerApprove.setAttribute('visibility', 'hidden');
      markerDisapprove.setAttribute('visibility', 'hidden');
      markerNet.setAttribute('visibility', 'hidden');
    };

    const show = (point, clientX, clientY) => {
      tip.hidden = false;
      tipDate.textContent = fmtDate(point.date);
      const xx = x(Date.parse(`${point.date}T12:00:00Z`));
      cursor.setAttribute('visibility', 'visible');
      cursor.setAttribute('x1', xx);
      cursor.setAttribute('x2', xx);
      if (mode === 'net') {
        tipValues.textContent = `Net ${fmtNet(point.net)} · Approve ${fmtPct(point.approve)} · Disapprove ${fmtPct(point.disapprove)}`;
        markerNet.setAttribute('visibility', 'visible');
        markerNet.setAttribute('cx', xx);
        markerNet.setAttribute('cy', y(point.net));
        markerApprove.setAttribute('visibility', 'hidden');
        markerDisapprove.setAttribute('visibility', 'hidden');
      } else {
        tipValues.textContent =
          `Approve ${fmtPct(point.approve)} · Disapprove ${fmtPct(point.disapprove)} · Net ${fmtNet(point.net)}`;
        markerApprove.setAttribute('visibility', 'visible');
        markerDisapprove.setAttribute('visibility', 'visible');
        markerApprove.setAttribute('cx', xx);
        markerApprove.setAttribute('cy', y(point.approve));
        markerDisapprove.setAttribute('cx', xx);
        markerDisapprove.setAttribute('cy', y(point.disapprove));
        markerNet.setAttribute('visibility', 'hidden');
      }
      const bounds = host.getBoundingClientRect();
      const left = Math.min(Math.max(12, clientX - bounds.left + 14), bounds.width - 190);
      const top = Math.min(Math.max(12, clientY - bounds.top - 64), bounds.height - 78);
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
        'aria-label': mode === 'net'
          ? `${fmtDate(series[i].date)}: net ${fmtNet(series[i].net)}`
          : `${fmtDate(series[i].date)}: approve ${fmtPct(series[i].approve)}, disapprove ${fmtPct(series[i].disapprove)}`,
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

  function setMode(mode) {
    chartMode = mode;
    const split = $('approval-view-split');
    const net = $('approval-view-net');
    if (split && net) {
      split.classList.toggle('is-active', mode === 'split');
      net.classList.toggle('is-active', mode === 'net');
      split.setAttribute('aria-pressed', mode === 'split' ? 'true' : 'false');
      net.setAttribute('aria-pressed', mode === 'net' ? 'true' : 'false');
    }
    updateLegend();
    drawChart(chartSeries, mode);
  }

  function bindToggle() {
    $('approval-view-split')?.addEventListener('click', () => setMode('split'));
    $('approval-view-net')?.addEventListener('click', () => setMode('net'));
  }

  async function boot() {
    bindToggle();
    try {
      const response = await fetch('/data/polling/trump-approval.json?v=20261108-3', {
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const data = await response.json();
      chartSeries = data.series || [];
      setCurrent(data);
      setPollTable(data.recentPolls || []);
      updateLegend();
      drawChart(chartSeries, chartMode);
    } catch (error) {
      $('approval-asof').textContent = 'Unable to load approval average.';
      $('approval-chart').textContent = 'Chart unavailable.';
      console.error(error);
    }
  }

  boot();
})();
