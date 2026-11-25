// Easter eggs: a note for people who open the console, the Konami code, and the cat party.

console.log(
  '%c  /\\_/\\ \n ( o.o )  hi, fellow console reader.\n  > ^ <   try the Konami code, or type `help` in the terminal on the home page.',
  'font-family: monospace; color: #22a355; font-size: 12px;',
);

function toast(text: string) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('p');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 5000);
}

let partying = false;
export function catParty(message = 'Cheat code accepted. +30 cats.') {
  toast(message);
  const reduced =
    matchMedia('(prefers-reduced-motion: reduce)').matches || 'calm' in document.documentElement.dataset;
  const source = document.querySelector('#byte .pixel-cat');
  if (reduced || !source || partying) return;
  partying = true;
  for (let i = 0; i < 30; i++) {
    const drop = document.createElement('div');
    drop.className = 'cat-rain';
    drop.setAttribute('aria-hidden', 'true');
    drop.append(source.cloneNode(true));
    // Setting styles through the CSSOM is allowed by the CSP; style attributes in markup are not.
    drop.style.left = `${Math.random() * 95}vw`;
    drop.style.animationDelay = `${Math.random() * 2.5}s`;
    drop.style.setProperty('--fall', `${2.5 + Math.random() * 2}s`);
    drop.style.setProperty('--spin', `${(Math.random() - 0.5) * 720}deg`);
    document.body.append(drop);
    drop.addEventListener('animationend', () => drop.remove());
  }
  setTimeout(() => (partying = false), 5000);
}

document.addEventListener('catparty', () => catParty('Byte called her friends.'));

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let pos = 0;
document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea, [contenteditable]')) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  pos = key === KONAMI[pos] ? pos + 1 : key === KONAMI[0] ? 1 : 0;
  if (pos === KONAMI.length) {
    pos = 0;
    catParty();
  }
});
