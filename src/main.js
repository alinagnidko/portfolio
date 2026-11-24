import './curtains.js';
import './valance.js';

const header = document.querySelector('.header');
const burger = document.querySelector('.burger');
const nav = document.querySelector('#site-nav');

function setOpen(open, { focus = false } = {}) {
  header.classList.toggle('is-open', open);
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  // keyboard users: open the menu and land on its first item; closing with Escape returns to the button
  if (open && focus) nav.querySelector('a')?.focus();
  if (!open && focus) burger.focus();
}

// a keyboard press on the button also arrives as a click with detail 0
burger.addEventListener('click', (e) =>
  setOpen(!header.classList.contains('is-open'), { focus: e.detail === 0 }),
);
// when a ticket is chosen it turns cream for a moment, then the menu closes,
// so a tap on a phone shows the same fill that a mouse shows on hover
nav.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (!link) return;
  link.classList.add('is-picked');
  setTimeout(() => {
    link.classList.remove('is-picked');
    setOpen(false);
  }, 260);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && header.classList.contains('is-open')) setOpen(false, { focus: true });
});
window.matchMedia('(min-width: 901px)').addEventListener('change', () => setOpen(false));
