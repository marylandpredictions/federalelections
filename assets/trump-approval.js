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

  function el(tag, attrs = {}, text) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    return node;
  }

  function setCurrent(data) {
    const {current, asOf} = data;
    $('approval-asof').textContent = `As of ${fmtDate(asOf)} · ${current.effectivePollsters} pollsters`;
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
      tr.append(name, dates, sample, approve, disapprove, net, weight);
      body.append(tr);
    }
  }

  function drawChart(series) {
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
    const values = series.flatMap(p => [p.approve, p.disapprove]);
    let minY = Math.min(...values);
    let maxY = Math.max(...values);
    const pad = Math.max(2, (maxY - minY) * 0.12);
    minY = Math.max(0, Math.floor(minY - pad));
    maxY = Math.min(100, Math.ceil(maxY + pad));
    const x = t => margin.left + ((t - minX) / Math.max(1, maxX - minX)) * innerW;
    const y = v => margin.top + ((maxY - v) / Math.max(1, maxY - minY)) * innerH;
    const line = key => series.map((p, i) =>
      `${i ? 'L' : 'M'}${x(xs[i]).toFixed(2)} ${y(p[key]).toFixed(2)}`).join(' ');

    const svg = el('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': 'Trump approve and disapprove averages over time',
    });
    const grid = el('g', {class: 'grid'});
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const value = minY + ((maxY - minY) * i) / ticks;
      const yy = y(value);
      grid.append(el('line', {x1: margin.left, x2: width - margin.right, y1: yy, y2: yy}));
      svg.append(el('text', {class: 'axis', x: margin.left - 10, y: yy + 4, 'text-anchor': 'end'}, `${Math.round(value)}%`));
    }
    svg.append(grid);

    const labelIndexes = [0, Math.floor((series.length - 1) / 2), series.length - 1];
    for (const i of new Set(labelIndexes)) {
      svg.append(el('text', {
        class: 'axis',
        x: x(xs[i]),
        y: height - 14,
        'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle',
      }, fmtDate(series[i].date)));
    }

    svg.append(el('path', {class: 'series-approve', d: line('approve')}));
    svg.append(el('path', {class: 'series-disapprove', d: line('disapprove')}));
    const markerApprove = el('circle', {class: 'marker marker-approve', r: 5, cx: -20, cy: -20});
    const markerDisapprove = el('circle', {class: 'marker marker-disapprove', r: 5, cx: -20, cy: -20});
    svg.append(markerApprove, markerDisapprove);

    const show = (point, clientX, clientY) => {
      tip.hidden = false;
      tipDate.textContent = fmtDate(point.date);
      tipValues.textContent =
        `Approve ${fmtPct(point.approve)} · Disapprove ${fmtPct(point.disapprove)} · Net ${fmtNet(point.net)}`;
      markerApprove.setAttribute('cx', x(Date.parse(`${point.date}T12:00:00Z`)));
      markerApprove.setAttribute('cy', y(point.approve));
      markerDisapprove.setAttribute('cx', x(Date.parse(`${point.date}T12:00:00Z`)));
      markerDisapprove.setAttribute('cy', y(point.disapprove));
      const bounds = host.getBoundingClientRect();
      const left = Math.min(Math.max(12, clientX - bounds.left + 14), bounds.width - 190);
      const top = Math.min(Math.max(12, clientY - bounds.top - 64), bounds.height - 78);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    const hide = () => {
      tip.hidden = true;
      markerApprove.setAttribute('cx', -20);
      markerDisapprove.setAttribute('cx', -20);
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
        'aria-label': `${fmtDate(series[i].date)}: approve ${fmtPct(series[i].approve)}, disapprove ${fmtPct(series[i].disapprove)}`,
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
  }

  async function boot() {
    try {
      const response = await fetch('/data/polling/trump-approval.json?v=20261108-1', {
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const data = await response.json();
      setCurrent(data);
      setPollTable(data.recentPolls || []);
      drawChart(data.series || []);
    } catch (error) {
      $('approval-asof').textContent = 'Unable to load approval average.';
      $('approval-chart').textContent = 'Chart unavailable.';
      console.error(error);
    }
  }

  boot();
})();
