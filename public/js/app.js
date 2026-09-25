// Shell applicativa: login, navigazione e routing via hash.

import { api, impostaGestoreLogout } from './api.js';
import { h, monta, svuota, avviso } from './ui.js';
import vistaDashboard from './views/dashboard.js';
import vistaProdotti from './views/prodotti.js';
import vistaFiere from './views/fiere.js';
import vistaNoleggi from './views/noleggi.js';
import vistaDisponibilita from './views/disponibilita.js';

const app = document.getElementById('app');

export const stato = { costanti: null };

const SEZIONI = [
  { id: 'dashboard', titolo: 'Cruscotto', icona: '▦', vista: vistaDashboard,
    descrizione: 'La situazione di oggi in una schermata.' },
  { id: 'disponibilita', titolo: 'Disponibilità', icona: '◧', vista: vistaDisponibilita,
    descrizione: 'Cosa è libero e cosa è occupato, in un periodo a scelta.' },
  { id: 'prodotti', titolo: 'Prodotti', icona: '▤', vista: vistaProdotti,
    descrizione: 'Il parco TV, monitor e accessori da noleggiare.' },
  { id: 'fiere', titolo: 'Fiere', icona: '◈', vista: vistaFiere,
    descrizione: 'Gli eventi dove il materiale viene noleggiato.' },
  { id: 'noleggi', titolo: 'Noleggi', icona: '⇄', vista: vistaNoleggi,
    descrizione: 'Tutte le righe di noleggio, con stato e periodo.' },
];

/* ---------------- login ---------------- */

function schermataAccesso() {
  const password = h('input', {
    class: 'controllo', type: 'password', name: 'password', required: true,
    autocomplete: 'current-password', placeholder: '••••••••',
  });
  const errore = h('p', { class: 'accesso__errore', hidden: true });
  const bottone = h('button', { class: 'btn btn--primario btn--blocco', type: 'submit' }, 'Entra');

  const form = h('form', {
    class: 'accesso__form',
    onsubmit: async (e) => {
      e.preventDefault();
      errore.hidden = true;
      bottone.disabled = true;
      try {
        await api.accesso(password.value);
        await avvia();
      } catch (err) {
        errore.textContent = err.message;
        errore.hidden = false;
        password.select();
      } finally {
        bottone.disabled = false;
      }
    },
  },
  h('label', { class: 'campo' }, h('span', { class: 'campo__etichetta' }, 'Password'), password),
  errore,
  bottone);

  app.className = 'accesso';
  monta(app, h('div', { class: 'accesso__riquadro' },
    h('div', { class: 'logo logo--grande' }, h('span', { class: 'logo__segno' }, '▤'),
      h('span', {}, 'Noleggio', h('strong', {}, 'Fiera'))),
    h('p', { class: 'accesso__testo' },
      'Gestione del parco monitor e TV a noleggio: disponibilità, fiere e occupazione nel tempo.'),
    form));
  password.focus();
}

/* ---------------- shell ---------------- */

function sezioneCorrente() {
  const id = (location.hash.replace('#/', '').split('?')[0]) || 'dashboard';
  return SEZIONI.find((s) => s.id === id) || SEZIONI[0];
}

function shell() {
  const contenuto = h('main', { class: 'contenuto', id: 'contenuto' });
  const nav = h('nav', { class: 'barra__nav' });

  const disegnaNav = () => {
    const attiva = sezioneCorrente().id;
    svuota(nav);
    for (const s of SEZIONI) {
      nav.appendChild(h('a', {
        class: `voce ${s.id === attiva ? 'voce--attiva' : ''}`,
        href: `#/${s.id}`,
        'aria-current': s.id === attiva ? 'page' : null,
      }, h('span', { class: 'voce__icona', 'aria-hidden': 'true' }, s.icona), s.titolo));
    }
  };

  const disegnaVista = async () => {
    const sezione = sezioneCorrente();
    disegnaNav();
    document.title = `${sezione.titolo} — NoleggioFiera`;
    monta(contenuto,
      h('header', { class: 'intestazione' },
        h('div', {},
          h('h1', {}, sezione.titolo),
          h('p', { class: 'intestazione__testo' }, sezione.descrizione)),
        h('div', { class: 'intestazione__azioni', id: 'azioni-vista' })));
    const corpo = h('div', { class: 'vista' }, h('p', { class: 'caricamento' }, 'Caricamento…'));
    contenuto.appendChild(corpo);
    try {
      await sezione.vista({
        corpo,
        azioni: contenuto.querySelector('#azioni-vista'),
        ricarica: disegnaVista,
        vai: (id) => { location.hash = `#/${id}`; },
      });
    } catch (err) {
      monta(corpo, h('p', { class: 'errore-vista' }, err.message || 'Errore nel caricamento dei dati.'));
    }
  };

  app.className = 'guscio';
  monta(app,
    h('aside', { class: 'barra' },
      h('div', { class: 'logo' }, h('span', { class: 'logo__segno' }, '▤'),
        h('span', {}, 'Noleggio', h('strong', {}, 'Fiera'))),
      nav,
      h('button', {
        class: 'btn btn--fantasma btn--blocco',
        onclick: async () => { await api.uscita(); schermataAccesso(); },
      }, 'Esci')),
    contenuto);

  window.addEventListener('hashchange', disegnaVista);
  disegnaVista();
}

/* ---------------- avvio ---------------- */

async function avvia() {
  const { autenticato } = await api.sessione();
  if (!autenticato) return schermataAccesso();
  stato.costanti = await api.costanti();
  return shell();
}

impostaGestoreLogout(() => {
  avviso('Sessione scaduta, effettua di nuovo l\'accesso.', 'attenzione');
  schermataAccesso();
});

avvia().catch((err) => {
  monta(app, h('p', { class: 'errore-vista' }, err.message || 'Impossibile contattare il server.'));
});
