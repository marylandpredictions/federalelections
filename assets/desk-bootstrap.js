// The results desk owns its appearance; other site pages retain theme.js.
(function(){let preference;try{preference=FEADeskTheme.read(localStorage).current;}catch{preference=FEADeskTheme.presets[0];}document.documentElement.dataset.theme=FEADeskTheme.resolve(preference,matchMedia('(prefers-color-scheme: dark)').matches).mode;})();
