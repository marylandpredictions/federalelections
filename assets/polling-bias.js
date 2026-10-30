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
  const api = {number, color, labelColor, direction};
  if (typeof module !== 'undefined') module.exports = api;
  if (!root.document) return;
  const document = root.document, svgNS = 'http://www.w3.org/2000/svg';
  const element = (tag, attrs = {}, text) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const cell = text => {const node = document.createElement('td'); node.textContent = text; return node;};
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
        prior: number(state.prior) + ' pp', confidence: state.confidence,
        raw: state.raceCount ? number(state.rawBias) + ' pp' : 'Division prior only',
        division: number(state.divisionPrior) + ' pp', polls: state.pollCount,
        races: state.raceCount, weight: state.evidenceWeight.toFixed(4), coherence: state.coherenceMultiplier.toFixed(2) + '×'
      };
      for (const [key, value] of Object.entries(values)) document.getElementById('bias-' + key).textContent = value;
      document.getElementById('bias-evidence').textContent = state.evidence;
      document.getElementById('bias-reading').textContent = `${direction(state.prior)} of ${Math.abs(state.prior).toFixed(2)} percentage points in the source’s 2026 prior.`;
      const body = document.getElementById('bias-race-rows'); body.replaceChildren();
      for (const race of state.races) {
        const row = document.createElement('tr');
        const year = document.createElement('th'); year.scope = 'row'; year.textContent = race.year; row.append(year);
        for (const text of [race.polls, race.pollsFinal21Days, race.window, number(race.pollMargin, 3), number(race.actualMargin, 3), number(race.bias, 3), number(race.cappedBias, 3), race.weight.toFixed(4)]) row.append(cell(text));
        body.append(row);
      }
      document.getElementById('bias-no-races').hidden = !!state.races.length;
      document.getElementById('bias-no-races').textContent = `No usable standard D-vs-R Senate race in the source. The prior uses ${state.division}; the source’s raw-bias field is ${number(state.rawBias, 4)}.`;
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
    for (const metric of ['prior', 'rawBias']) {
      const host = document.getElementById('bias-map-' + metric);
      const svg = element('svg', {viewBox: geometry.viewBox, role: 'group', 'aria-label': metric === 'prior' ? '2026 state polling bias priors. Choose a state for details.' : 'Historical weighted Senate polling bias. Choose a state for details.'});
      for (const shape of geometry.states) {
        const state = states.get(shape.abbr); if (!state) continue;
        const value = metric === 'rawBias' && !state.raceCount ? null : state[metric], fill = color(value);
        const link = element('a', {href: '#state-details', 'data-state': state.abbr, 'aria-label': `${state.state}: ${value === null ? 'no direct race evidence' : number(value) + ' percentage points; ' + direction(value)}`});
        link.append(element('path', {d: shape.d, fill}));
        if (shape.leader) link.append(element('line', {x1: shape.leader[0], y1: shape.leader[1], x2: shape.label[0] - 14, y2: shape.label[1] - 4, class: 'bias-leader'}));
        link.append(element('text', {x: shape.label[0], y: shape.label[1], fill: shape.leader ? 'var(--ink)' : labelColor(fill), 'text-anchor': 'middle', 'dominant-baseline': 'central'}, state.abbr));
        svg.append(link);
      }
      host.replaceChildren(svg); host.setAttribute('aria-busy', 'false');
    }
    document.addEventListener('click', event => {
      const link = event.target.closest('a[data-state]');
      if (!link || !states.has(link.dataset.state)) return;
      event.preventDefault(); select(link.dataset.state, true);
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
