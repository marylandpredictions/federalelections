(() => {
  const sections = [
    ['Home', '/'], ['Elections & Results', '/elections'], ['Maps', '/features/map-maker'],
    ['Research & Tools', '/analysis-center'], ['Analysis', '/articles'], ['About', '/about']
  ];
  const research = [
    ['State Polling Bias','/features/polling-bias','FEA’s state-by-state polling error research'],
    ['Election Lab','/analysis-center','Explore swings, local returns and historical benchmarks'],
    ['Model Lab','/model-lab','Examine FEA’s forecast experiments'],
    ['FEA Ratings Archive','/predictions','Browse published race ratings'],
    ['Calibration','/calibration','Review model performance']
  ];
  const path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const current = path === '/' || path === '/index' ? '/'
    : /map-maker/.test(path) ? '/features/map-maker'
    : /polling|data-lab|model-lab|analysis-center|calibration|predictions/.test(path) ? '/analysis-center'
    : /article|videos/.test(path) ? '/articles'
    : /about|contact|sources|terms|privacy/.test(path) ? '/about' : '/elections';
  const nav = sections.map(([name,url]) => {
    if (url === '/analysis-center') {
      return `<details class="fea-research"><summary${url===current?' class="fea-current"':''}>${name}</summary><div class="fea-research-menu">${research.map(([label,href,description])=>`<a href="${href}"><strong>${label}</strong><small>${description}</small></a>`).join('')}</div></details>`;
    }
    return `<a href="${url}"${url===current?' aria-current="page"':''}>${name}</a>`;
  }).join('');
  const header = document.querySelector('[data-fea-header], header.site-header');
  if (!header) return;
  header.className = 'fea-header';
  header.innerHTML = `<div class="fea-header-inner">
    <a class="fea-skip" href="#main-content">Skip to content</a>
    <a class="fea-brand" href="/"><img src="/assets/img/FEA_Icon.webp" width="36" height="36" alt=""><span>Federal Elections<span class="fea-brand-sub">ANALYSIS</span></span></a>
    <button class="fea-mobile fea-control" type="button" aria-controls="fea-nav" aria-expanded="false">Menu</button>
    <nav id="fea-nav" class="fea-nav" aria-label="Primary navigation">${nav}</nav>
    <div class="fea-utilities"><a class="fea-control" href="/search">Search</a><button type="button" class="fea-control" data-theme-toggle aria-label="Switch theme">◐</button></div>
  </div>`;
  const originalDonate = document.querySelector('.site-footer a[href*="gofund.me"]');
  if (!document.querySelector('[data-fea-footer]') && !originalDonate) {
    const footerNav = document.querySelector('.site-footer nav');
    if (footerNav) {
      const link = document.createElement('a');
      link.href = 'https://gofund.me/50724cf21';
      link.textContent = 'Donate';
      footerNav.append(link);
    }
  }
  const main = document.querySelector('main');
  if (main && !main.id) main.id = 'main-content';
  if (main) header.querySelector('.fea-skip').hash = main.id;
  const toggle = header.querySelector('.fea-mobile');
  const setMenu = open => toggle.setAttribute('aria-expanded', String(open));
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  header.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      toggle.focus();
    }
  });
  const researchMenu = header.querySelector('.fea-research');
  document.addEventListener('click', event => {
    if (!researchMenu.contains(event.target)) researchMenu.open = false;
  });
  researchMenu.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !researchMenu.open) return;
    event.stopPropagation();
    researchMenu.open = false;
    researchMenu.querySelector('summary').focus();
  });
  const footer = document.querySelector('[data-fea-footer], .site-footer');
  if (footer) footer.className = 'fea-footer';
  if (footer) footer.innerHTML = `<div class="fea-footer-inner"><strong>Federal Elections Analysis</strong><nav aria-label="Site information"><a href="/features/polling-bias">State Polling Bias</a><a href="/videos">Videos</a><a href="/sources">Sources</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="https://gofund.me/50724cf21" target="_blank" rel="noopener">Donate</a></nav></div>`;
})();
