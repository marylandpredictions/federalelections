(function (root) {
  const offices = ['house', 'senate', 'governor'];
  const route = (path, fields, anchor = '') => {
    const params = new URLSearchParams(Object.entries(fields).filter(([, value]) => value));
    return path + (params.size ? '?' + params : '') + anchor;
  };
  function findRace(params, races) {
    const id = params.get('race');
    const office = params.get('office');
    return races.find(race => race.id === id && (!offices.includes(office) || race.type === office));
  }
  const validUnit = value => /^\d{5}(?:\d{5})?$/.test(value || '') ? value : '';
  function labView(params, races, sources) {
    const race = findRace(params, races);
    const choice = (key, values, fallback) => values.includes(params.get(key)) ? params.get(key) : fallback;
    const office = race?.type || choice('office', offices, 'senate');
    return {
      race, office,
      baseline: choice('baseline', sources.filter(source => source.appliesTo.includes(office)).map(source => source.id), ''),
      unit: race ? validUnit(params.get('unit')) : '',
      metric: choice('metric', ['margin','swing','dem-share','rep-share'], 'margin'),
      display: choice('display', ['map','chart'], 'map'),
      sort: choice('sort', ['race','value','votes'], 'race'),
      find: (params.get('find') || '').slice(0,80)
    };
  }
  const raceFields = race => ({office: race.type, race: race.id});
  const results = (race, unit) => route('/results', {
    ...raceFields(race), tab: validUnit(unit) && 'counties', county: validUnit(unit)
  });
  const lab = (race, {baseline, unit, section = 'analysis-workspace'} = {}) => route('/analysis-center', {
    ...raceFields(race), baseline, unit: validUnit(unit)
  }, '#' + section);
  const maker = race => route('/features/map-maker', raceFields(race));
  const bias = state => route('/features/polling-bias', {state}, '#state-details');
  const archive = (state, year = '2024') => route('/election-history', {year, state});
  const api = {findRace, labView, results, lab, maker, bias, archive};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FEAResearchLinks = api;
})(globalThis);
