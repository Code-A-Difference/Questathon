// Local reading controls use the site's visual vocabulary, without loading its
// navigation scripts or depending on the parent site's document structure.
const root = document.documentElement;
const menu = document.getElementById('reading-options');
const size = document.getElementById('reading-size');
const theme = document.getElementById('reading-theme');
const motion = document.getElementById('reading-motion');
const key = 'questathon.reading.v1';
const defaults = { size: '1', theme: 'light', motion: false };
let saved = defaults;
try { saved = { ...defaults, ...JSON.parse(localStorage.getItem(key)) }; } catch { /* Storage is optional. */ }
size.value = ['1', '1.15', '1.3'].includes(saved.size) ? saved.size : '1';
theme.value = ['light', 'dark', 'contrast'].includes(saved.theme) ? saved.theme : 'light';
motion.checked = saved.motion === true;

function apply() {
  root.style.setProperty('--reading-scale', size.value);
  root.dataset.theme = theme.value;
  root.dataset.motion = motion.checked ? 'off' : 'on';
  document.querySelector('meta[name="theme-color"]').content = theme.value === 'light' ? '#ffffff' : '#0f0a18';
  document.dispatchEvent(new CustomEvent('questathon:reading', { detail: { reducedMotion: motion.checked } }));
  try { localStorage.setItem(key, JSON.stringify({ size: size.value, theme: theme.value, motion: motion.checked })); } catch { /* Storage is optional. */ }
}
for (const control of [size, theme, motion]) control.addEventListener('change', apply);
document.getElementById('reading-reset').addEventListener('click', () => {
  size.value = '1'; theme.value = 'light'; motion.checked = false; apply();
});
document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
apply();
