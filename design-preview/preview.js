(() => {
  const office = document.getElementById('home-office');
  if (document.body.classList.contains('preview-broadcast')) {
    const controls = document.createElement('div');
    controls.className = 'studio-offices';
    controls.setAttribute('role','group');
    controls.setAttribute('aria-label','Map office');
    for (const option of office.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.textContent;
      button.dataset.office = option.value;
      button.onclick = () => {
        office.value = option.value;
        office.dispatchEvent(new Event('change'));
      };
      controls.append(button);
    }
    function sync() {
      for (const button of controls.children) button.setAttribute('aria-pressed',String(button.dataset.office===office.value));
    }
    office.addEventListener('change',sync);
    office.labels[0].hidden = true;
    office.hidden = true;
    office.after(controls);
    sync();
  }
  const finding = document.getElementById('journal-finding');
  if (finding) {
    const races = document.getElementById('home-watch');
    function readFinding() {
      const race = races.querySelector('.home-panel');
      if (!race) return;
      const name = race.querySelector('h3').textContent;
      const gap = race.querySelector('.home-gap').textContent;
      finding.textContent = gap==='Tied' ? `${name} is tied in this snapshot.` : `${name} · ${gap} in the reported count.`;
    }
    new MutationObserver(readFinding).observe(races,{childList:true});
    readFinding();
  }
})();
