const { copyFileSync, mkdirSync, cpSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const www  = join(__dirname, 'www');

mkdirSync(join(www, 'fonts'), { recursive: true });
mkdirSync(join(www, 'icons'), { recursive: true });

for (const f of ['index.html', 'style.css', 'app.js', 'sw.js', 'manifest.json']) {
  copyFileSync(join(root, f), join(www, f));
}

cpSync(join(root, 'fonts'), join(www, 'fonts'), { recursive: true });
cpSync(join(root, 'icons'), join(www, 'icons'), { recursive: true });

console.log('Web files synced to www/');
