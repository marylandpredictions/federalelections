(function (root) {
  const number = (value, digits = 2) => {
    if (!Number.isFinite(value)) return 'Not available';
    const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
    return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`;
  };
  function color(value) {
    if (!Number.isFinite(value)) return '#b2b6c0';
    const amount = Math.min(Math.abs(value) / 7, 1);
    const neutral = [231, 233, 240], end = value >= 0 ? [28, 82, 157] : [180, 49, 64];
    return '#' + neutral.map((v, i) => Math.round(v + (end[i] - v) * amount).toString(16).padStart(2, '0')).join('');
  }
  function labelColor(fill) {
    const rgb = fill.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#000' : '#fff';
  }
  const direction = value => value > 0 ? 'Democratic overstatement' : value < 0 ? 'Republican overstatement' : 'No signed bias';
  const partyNumber = (value, digits = 2) => !Number.isFinite(value) ? 'Not available' : Math.abs(value) < .5 * 10 ** -digits ? 'Even' : `${value > 0 ? 'D' : 'R'} by ${Math.abs(value).toFixed(digits)}`;
  const partyClass = value => !Number.isFinite(value) || value === 0 ? '' : value > 0 ? 'bias-positive' : 'bias-negative';
  const plainBias = value => !Number.isFinite(value) ? 'Not available' : value === 0 ? 'No estimated advantage to either party' : `Polls may overstate ${value > 0 ? 'Democrats' : 'Republicans'} by ${Math.abs(value).toFixed(2)} points`;
  const api = {number, color, labelColor, direction, partyNumber, partyClass, plainBias};
  if (typeof module !== 'undefined') module.exports = api;
  if (!root.document) return;
  const document = root.document, svgNS = 'http://www.w3.org/2000/svg';
  const element = (tag, attrs = {}, text) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const cell = (text, className = '') => {const node = document.createElement('td'); node.textContent = text; node.className = className; return node;};
  async function start() {
    const response = await Promise.all(['/data/features/polling-bias.json?v=20261030-1', '/data/features/polling-bias-map.json?v=20261030-geometry3'].map(async url => {
      const r = await fetch(url); if (!r.ok) throw Error('Data unavailable'); return r.json();
    }));
    const [data, geometry] = response, states = new Map(data.states.map(state => [state.abbr, state]));
    function select(abbr, scroll = false) {
      const state = states.get(abbr); if (!state) return;
      document.getElementById('bias-state').value = abbr;
      document.getElementById('bias-state-name').textContent = state.state;
      document.getElementById('bias-division-name').textContent = state.division;
      const values = {
        prior: partyNumber(state.prior), confidence: state.confidence,
        raw: state.raceCount ? partyNumber(state.rawBias) : 'No state race evidence',
        division: partyNumber(state.divisionPrior), polls: state.pollCount,
        races: state.raceCount, weight: state.evidenceWeight.toFixed(4),
        coherence: state.coherenceMultiplier === 1 ? 'No extra adjustment' : `${Math.round((state.coherenceMultiplier - 1) * 100)}% increase`
      };
      for (const [key, value] of Object.entries(values)) document.getElementById('bias-' + key).textContent = value;
      for (const [id, value] of [['prior',state.prior],['raw',state.raceCount ? state.rawBias : null],['division',state.divisionPrior]]) document.getElementById('bias-' + id).className = partyClass(value);
      document.getElementById('bias-reading').textContent = `${plainBias(state.prior)} in ${state.state}, according to FEA’s 2026 estimate. This describes possible polling error, not who will win.`;
      const body = document.getElementById('bias-race-rows'), calculationRows = document.getElementById('bias-calculation-rows');
      body.replaceChildren(); calculationRows.replaceChildren();
      const totalWeight = state.races.reduce((sum, race) => sum + race.weight, 0);
      for (const race of state.races) {
        const row = document.createElement('tr');
        const year = document.createElement('th'); year.scope = 'row'; year.textContent = race.year; row.append(year);
        row.append(cell(partyNumber(race.bias), partyClass(race.bias) + ' bias-miss'), cell(partyNumber(race.pollMargin), partyClass(race.pollMargin)), cell(partyNumber(race.actualMargin), partyClass(race.actualMargin)), cell(race.polls));
        body.append(row);
        const calculation = document.createElement('tr'), calculationYear = document.createElement('th');
        calculationYear.scope = 'row'; calculationYear.textContent = race.year; calculation.append(calculationYear);
        calculation.append(cell(race.window === '21d' ? 'Last 21 days' : 'Up to 45 days'), cell(race.pollsFinal21Days), cell(partyNumber(race.cappedBias), partyClass(race.cappedBias)), cell(totalWeight ? Math.round(race.weight / totalWeight * 100) + '%' : 'Not available'));
        calculationRows.append(calculation);
      }
      document.getElementById('bias-no-races').hidden = !!state.races.length;
      document.getElementById('bias-no-races').textContent = `There are no usable Democratic-versus-Republican Senate races for this state in the data. Its 2026 estimate starts from the regional pattern for ${state.division}, so confidence is very low.`;
      document.querySelectorAll('.bias-map a[data-state]').forEach(link => {
        const active = link.dataset.state === abbr; link.classList.toggle('selected', active);
        if (active) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
      });
      document.getElementById('bias-detail-content').hidden = false;
      document.getElementById('bias-detail-loading').hidden = true;
      if (scroll) {
        const target = document.getElementById('state-details');
        target.scrollIntoView({behavior: root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
        document.getElementById('bias-state-name').focus({preventScroll: true});
      }
    }
    for (const metric of ['prior']) {
      const host = document.getElementById('bias-map-' + metric);
      const svg = element('svg', {viewBox: geometry.viewBox, role: 'group', 'aria-label': 'FEA estimated 2026 Senate polling bias. Hover or focus for a preview; choose a state for history.'});
      for (const shape of geometry.states) {
        const state = states.get(shape.abbr); if (!state) continue;
        const value = state[metric], fill = color(value);
        const link = element('a', {href: '#state-details', 'data-state': state.abbr, 'aria-label': `${state.state}: ${plainBias(value)}. View history.`});
        link.append(element('path', {d: shape.d, fill}));
        if (shape.leader) link.append(element('line', {x1: shape.leader[0], y1: shape.leader[1], x2: shape.label[0] - 14, y2: shape.label[1] - 4, class: 'bias-leader'}));
        link.append(element('text', {x: shape.label[0], y: shape.label[1], fill: shape.leader ? 'var(--ink)' : labelColor(fill), 'text-anchor': 'middle', 'dominant-baseline': 'central'}, state.abbr));
        svg.append(link);
      }
      host.replaceChildren(svg); host.setAttribute('aria-busy', 'false');
    }
    const map = document.getElementById('bias-map-prior'), preview = document.getElementById('bias-preview');
    let previewLink = null, previewFrame = 0;
    function hidePreview() {
      preview.hidden = true; previewLink?.removeAttribute('aria-describedby'); previewLink = null;
      root.cancelAnimationFrame(previewFrame); previewFrame = 0;
    }
    function showPreview(link, point) {
      const state = states.get(link.dataset.state); if (!state) return;
      if (previewLink !== link) {
        previewLink?.removeAttribute('aria-describedby'); previewLink = link;
        document.getElementById('bias-preview-state').textContent = state.state;
        const value = document.getElementById('bias-preview-value'); value.textContent = partyNumber(state.prior) + ' points'; value.className = partyClass(state.prior);
        document.getElementById('bias-preview-meaning').textContent = plainBias(state.prior);
        document.getElementById('bias-preview-evidence').textContent = state.raceCount ? `${state.confidence} confidence · ${state.raceCount} past races · ${state.pollCount} polls` : 'Very low confidence · regional estimate; no state race evidence';
        link.setAttribute('aria-describedby', 'bias-preview');
      }
      preview.hidden = false;
      root.cancelAnimationFrame(previewFrame);
      previewFrame = root.requestAnimationFrame(() => {
        const card = map.closest('.bias-map-card').getBoundingClientRect(), box = link.getBoundingClientRect();
        const x = point?.clientX ?? box.x + box.width / 2, y = point?.clientY ?? box.y;
        const left = Math.max(10, Math.min(x + 16, root.innerWidth - preview.offsetWidth - 10));
        const header = document.querySelector('.site-header')?.getBoundingClientRect();
        const safeTop = header && header.top <= 0 && header.bottom > 0 ? header.bottom + 8 : 10;
        const top = Math.max(Math.min(safeTop, root.innerHeight - preview.offsetHeight - 10), Math.min(y - preview.offsetHeight - 14, root.innerHeight - preview.offsetHeight - 10));
        preview.style.left = (left - card.left) + 'px'; preview.style.top = (top - card.top) + 'px';
      });
    }
    map.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      const link = event.target.closest('a[data-state]'); if (link) showPreview(link, event); else hidePreview();
    });
    map.addEventListener('pointerleave', hidePreview);
    map.addEventListener('focusin', event => {const link = event.target.closest('a[data-state]'); if (link) showPreview(link);});
    map.addEventListener('focusout', hidePreview);
    root.addEventListener('scroll', () => {
      if (previewLink && document.activeElement === previewLink) {
        const box = previewLink.getBoundingClientRect();
        if (box.bottom > 0 && box.top < root.innerHeight) {showPreview(previewLink); return;}
      }
      hidePreview();
    }, {passive: true, capture: true});
    root.addEventListener('resize', hidePreview, {passive: true});
    document.addEventListener('keydown', event => {if (event.key === 'Escape') hidePreview();});
    document.addEventListener('click', event => {
      const link = event.target.closest('a[data-state]');
      if (!link || !states.has(link.dataset.state)) return;
      event.preventDefault(); hidePreview(); select(link.dataset.state, true);
    });
    document.getElementById('bias-state').addEventListener('change', event => select(event.target.value));
    const requested = new URLSearchParams(root.location.search).get('state')?.toUpperCase();
    select(states.has(requested) ? requested : 'AL');
  }
  start().catch(() => {
    for (const host of document.querySelectorAll('.bias-map')) {host.textContent = 'The map could not load. All state priors are listed below, and the source spreadsheet contains the full data.'; host.setAttribute('aria-busy', 'false');}
    document.getElementById('bias-detail-loading').textContent = 'State detail could not load. Please refresh or open the source spreadsheet.';
  });
})(typeof window === 'undefined' ? globalThis : window);
