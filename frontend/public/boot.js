// Shows icons only once their font has loaded (no raw ligature text).
if ('fonts' in document) {
      Promise.all([
        document.fonts.load('20px "Material Symbols Outlined"'),
        document.fonts.load('20px "Material Symbols Rounded"')
      ]).then(function() {
        document.documentElement.classList.add('fonts-ready');
      }).catch(function() {
        document.documentElement.classList.add('fonts-ready');
      });
      setTimeout(function() { document.documentElement.classList.add('fonts-ready'); }, 1500);
    } else {
      document.documentElement.classList.add('fonts-ready');
    }
