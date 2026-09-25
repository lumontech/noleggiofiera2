// Mini libreria DOM: niente build step, niente framework, nessun innerHTML
// con dati utente (tutto passa da createTextNode).

export function h(tag, props = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [chiave, valore] of Object.entries(props || {})) {
    if (valore === null || valore === undefined || valore === false) continue;
    if (chiave === 'class') el.className = valore;
    else if (chiave === 'dataset') Object.assign(el.dataset, valore);
    else if (chiave === 'style' && typeof valore === 'object') Object.assign(el.style, valore);
    else if (chiave.startsWith('on') && typeof valore === 'function') {
      el.addEventListener(chiave.slice(2).toLowerCase(), valore);
    } else if (chiave === 'html') el.innerHTML = valore; // solo per icone SVG interne
    else if (chiave in el && chiave !== 'list') el[chiave] = valore;
    else el.setAttribute(chiave, valore);
  }
  aggiungi(el, figli);
  return el;
}

function aggiungi(genitore, figli) {
  for (const figlio of figli.flat(Infinity)) {
    if (figlio === null || figlio === undefined || figlio === false) continue;
    genitore.appendChild(figlio instanceof Node ? figlio : document.createTextNode(String(figlio)));
  }
}

export function svuota(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function monta(contenitore, ...figli) {
  svuota(contenitore);
  aggiungi(contenitore, figli);
  return contenitore;
}

/* ---------- formattazione ---------- */

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export function dataBreve(iso) {
  if (!iso) return '—';
  const [a, m, g] = iso.split('-');
  return `${Number(g)} ${MESI[Number(m) - 1]}`;
}

export function dataLunga(iso) {
  if (!iso) return '—';
  const [a, m, g] = iso.split('-');
  return `${Number(g)} ${MESI[Number(m) - 1]} ${a}`;
}

export function intervalloDate(da, a) {
  if (da === a) return dataLunga(da);
  const [aa] = da.split('-');
  const [ab] = a.split('-');
  return aa === ab ? `${dataBreve(da)} – ${dataLunga(a)}` : `${dataLunga(da)} – ${dataLunga(a)}`;
}

export const euro = (n) => new Intl.NumberFormat('it-IT', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
}).format(Number(n) || 0);

export const numero = (n) => new Intl.NumberFormat('it-IT').format(Number(n) || 0);

export function oggiISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addGiorni(iso, giorni) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0, 10);
}

export function giorniTra(da, a) {
  return Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${da}T00:00:00Z`)) / 86400000) + 1;
}

/** Toglie dalle note il marcatore tecnico usato dall'importatore Airtable. */
export const notePulite = (testo) => (testo || '').replace(/\[airtable:[^\]]+\]/g, '').trim();

export const etichetta = (chiave) => ({
  attivo: 'Attivo', manutenzione: 'In manutenzione', dismesso: 'Dismesso',
  pianificata: 'Pianificata', in_corso: 'In corso', conclusa: 'Conclusa', annullata: 'Annullata',
  prenotato: 'Prenotato', consegnato: 'Consegnato', rientrato: 'Rientrato', annullato: 'Annullato',
}[chiave] || chiave);

/* ---------- componenti riusabili ---------- */

export const badge = (stato, testo) => h('span', { class: `badge badge--${stato}` }, testo ?? etichetta(stato));

export function vuoto(titolo, sottotitolo, azione) {
  return h('div', { class: 'vuoto' },
    h('p', { class: 'vuoto__titolo' }, titolo),
    sottotitolo && h('p', { class: 'vuoto__testo' }, sottotitolo),
    azione);
}

export function avviso(messaggio, tipo = 'ok') {
  const host = document.getElementById('avvisi');
  const nodo = h('div', { class: `avviso avviso--${tipo}` }, messaggio);
  host.appendChild(nodo);
  setTimeout(() => {
    nodo.classList.add('avviso--uscita');
    setTimeout(() => nodo.remove(), 300);
  }, 4200);
}

/** Finestra modale con form. `campi` è un array di definizioni. */
export function modale({ titolo, sottotitolo, corpo, testoConferma = 'Salva', onConferma, larga = false }) {
  const host = document.getElementById('modale-host');
  let chiudi;

  const errore = h('p', { class: 'modale__errore', hidden: true });
  const conferma = h('button', { class: 'btn btn--primario', type: 'submit' }, testoConferma);

  const form = h('form', {
    class: 'modale__form',
    onsubmit: async (e) => {
      e.preventDefault();
      errore.hidden = true;
      conferma.disabled = true;
      conferma.textContent = 'Salvataggio…';
      try {
        await onConferma(Object.fromEntries(new FormData(form).entries()));
        chiudi();
      } catch (err) {
        errore.textContent = err.message || 'Operazione non riuscita.';
        errore.hidden = false;
      } finally {
        conferma.disabled = false;
        conferma.textContent = testoConferma;
      }
    },
  },
  corpo,
  errore,
  h('div', { class: 'modale__azioni' },
    h('button', { class: 'btn', type: 'button', onclick: () => chiudi() }, 'Annulla'),
    conferma));

  const pannello = h('div', { class: `modale ${larga ? 'modale--larga' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'modale__testa' },
      h('h2', {}, titolo),
      sottotitolo && h('p', {}, sottotitolo)),
    form);

  const sfondo = h('div', {
    class: 'modale__sfondo',
    onclick: (e) => { if (e.target === sfondo) chiudi(); },
  }, pannello);

  const suTasto = (e) => { if (e.key === 'Escape') chiudi(); };
  chiudi = () => {
    document.removeEventListener('keydown', suTasto);
    sfondo.remove();
  };
  document.addEventListener('keydown', suTasto);
  host.appendChild(sfondo);
  const primo = form.querySelector('input, select, textarea');
  if (primo) primo.focus();
  return { chiudi };
}

export function conferma({ titolo, messaggio, testoConferma = 'Elimina', onConferma }) {
  return modale({
    titolo,
    corpo: h('p', { class: 'modale__messaggio' }, messaggio),
    testoConferma,
    onConferma,
  });
}

/* ---------- campi form ---------- */

export function campo(etichettaTesto, controllo, { aiuto, largo = false } = {}) {
  return h('label', { class: `campo ${largo ? 'campo--largo' : ''}` },
    h('span', { class: 'campo__etichetta' }, etichettaTesto),
    controllo,
    aiuto && h('span', { class: 'campo__aiuto' }, aiuto));
}

export const input = (name, props = {}) => h('input', { name, class: 'controllo', ...props });

export function select(name, opzioni, valore, props = {}) {
  const el = h('select', { name, class: 'controllo', ...props });
  for (const o of opzioni) {
    const { valore: v, testo } = typeof o === 'string' ? { valore: o, testo: etichetta(o) } : o;
    el.appendChild(h('option', { value: v, selected: String(v) === String(valore) }, testo));
  }
  return el;
}

export const areaTesto = (name, props = {}) => h('textarea', { name, class: 'controllo', rows: 3, ...props });

export const griglia = (...figli) => h('div', { class: 'form-griglia' }, ...figli);
