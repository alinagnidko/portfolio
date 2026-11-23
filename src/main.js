const header = document.querySelector('.header');
const burger = document.querySelector('.burger');
const nav = document.querySelector('#site-nav');

function setOpen(open) {
  header.classList.toggle('is-open', open);
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

burger.addEventListener('click', () => setOpen(!header.classList.contains('is-open')));
nav.addEventListener('click', (e) => {
  if (e.target.closest('a')) setOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setOpen(false);
});
window.matchMedia('(min-width: 901px)').addEventListener('change', () => setOpen(false));
