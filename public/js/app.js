// Shell applicativa: login, navigazione e routing via hash.

import { api, impostaGestoreLogout } from './api.js';
import { h, monta, svuota, avviso, modale, campo, input } from './ui.js';
import vistaDashboard from './views/dashboard.js';
import vistaProdotti from './views/prodotti.js';
import vistaFiere from './views/fiere.js';
import vistaNoleggi from './views/noleggi.js';
import vistaDisponibilita from './views/disponibilita.js';
import vistaUtenti from './views/utenti.js';
import vistaInstallazioni from './views/installazioni.js';

const app = document.getElementById('app');

export const stato = { costanti: null, utente: null };

const SEZIONI_AMMINISTRATORE = [
  { id: 'dashboard', titolo: 'Cruscotto', icona: '▦', vista: vistaDashboard,
    descrizione: 'La situazione di oggi in una schermata.' },
  { id: 'disponibilita', titolo: 'Disponibilità', icona: '◧', vista: vistaDisponibilita,
    descrizione: 'Cosa è libero e cosa è occupato, in un periodo a scelta.' },
  { id: 'prodotti', titolo: 'Prodotti', icona: '▤', vista: vistaProdotti,
    descrizione: 'Il parco TV, monitor e accessori da noleggiare.' },
  { id: 'fiere', titolo: 'Fiere', icona: '◈', vista: vistaFiere,
    descrizione: 'Gli eventi dove il materiale viene noleggiato.' },
  { id: 'noleggi', titolo: 'Noleggi', icona: '⇄', vista: vistaNoleggi,
    descrizione: 'Chi ha cosa, fiera per fiera. Clicca un noleggio per modificarlo.' },
  { id: 'utenti', titolo: 'Utenti', icona: '◉', vista: vistaUtenti,
    descrizione: 'Chi può entrare e cosa vede. Il tecnico vede solo le installazioni, senza prezzi.' },
];

// Il tecnico ha una sezione sola: il resto dell'API gli è comunque chiuso dal server.
const SEZIONI_TECNICO = [
  { id: 'installazioni', titolo: 'Installazioni', icona: '▣', vista: vistaInstallazioni,
    descrizione: 'Cosa montare e in quale stand. Apri la pianta per vedere dove.' },
];

const sezioniDelRuolo = () => (stato.utente?.ruolo === 'amministratore' ? SEZIONI_AMMINISTRATORE : SEZIONI_TECNICO);

// Il nome utente si ricorda sul dispositivo, la password no.
const ULTIMO_UTENTE = 'nf_ultimo_utente';
const leggiUltimoUtente = () => { try { return localStorage.getItem(ULTIMO_UTENTE) || ''; } catch { return ''; } };
const salvaUltimoUtente = (v) => { try { localStorage.setItem(ULTIMO_UTENTE, v); } catch { /* niente */ } };

/* ---------------- login ---------------- */

function schermataAccesso() {
  const utente = h('input', {
    class: 'controllo', type: 'text', name: 'utente', required: true, value: leggiUltimoUtente(),
    autocomplete: 'username', autocapitalize: 'none', spellcheck: false, placeholder: 'es. mario',
  });
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
        await api.accesso(utente.value.trim(), password.value);
        salvaUltimoUtente(utente.value.trim());
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
  h('label', { class: 'campo' }, h('span', { class: 'campo__etichetta' }, 'Nome utente'), utente),
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
  (utente.value ? password : utente).focus();
}

function cambiaPassword() {
  modale({
    titolo: 'Cambia la tua password',
    sottotitolo: 'Gli altri dispositivi con cui sei entrato verranno disconnessi.',
    corpo: [
      campo('Password attuale', input('attuale', { type: 'password', required: true, autocomplete: 'current-password' })),
      campo('Nuova password', input('nuova', { type: 'password', required: true, minlength: 4, autocomplete: 'new-password' }),
        { aiuto: 'Almeno 4 caratteri.' }),
    ],
    testoConferma: 'Cambia password',
    onConferma: async ({ attuale, nuova }) => {
      await api.cambiaPassword(attuale, nuova);
      avviso('Password cambiata.');
    },
  });
}

/* ---------------- shell ---------------- */

function sezioneCorrente() {
  const sezioni = sezioniDelRuolo();
  const id = location.hash.replace('#/', '').split('?')[0];
  return sezioni.find((s) => s.id === id) || sezioni[0];
}

function shell() {
  const contenuto = h('main', { class: 'contenuto', id: 'contenuto' });
  const nav = h('nav', { class: 'barra__nav' });

  const disegnaNav = () => {
    const attiva = sezioneCorrente().id;
    svuota(nav);
    for (const s of sezioniDelRuolo()) {
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

  app.className = `guscio guscio--${stato.utente.ruolo}`;
  monta(app,
    h('aside', { class: 'barra' },
      h('div', { class: 'logo' }, h('span', { class: 'logo__segno' }, '▤'),
        h('span', {}, 'Noleggio', h('strong', {}, 'Fiera'))),
      nav,
      h('div', { class: 'barra__utente' },
        h('p', { class: 'barra__nome' }, stato.utente.nome,
          h('span', {}, stato.utente.ruolo === 'amministratore' ? 'Amministratore' : 'Tecnico')),
        h('div', { class: 'barra__bottoni' },
          h('button', { class: 'btn btn--fantasma', onclick: cambiaPassword }, 'Password'),
          h('button', {
            class: 'btn btn--fantasma',
            onclick: async () => { await api.uscita(); schermataAccesso(); },
          }, 'Esci'))),
      h('p', { class: 'barra__versione', id: 'versione' })),
    contenuto);

  window.removeEventListener('hashchange', statoShell.disegna);
  statoShell.disegna = disegnaVista;
  window.addEventListener('hashchange', disegnaVista);
  disegnaVista();
  api.salute()
    .then(({ versione }) => { document.getElementById('versione').textContent = `versione ${versione}`; })
    .catch(() => {});
}

/* ---------------- avvio ---------------- */

// Un solo ascoltatore di hashchange anche dopo esci/rientra.
const statoShell = { disegna: null };

async function avvia() {
  const { autenticato, utente } = await api.sessione();
  if (!autenticato) return schermataAccesso();
  stato.utente = utente;
  // Le costanti servono ai moduli dell'amministratore; al tecnico non servono (e non gli sono aperte).
  stato.costanti = utente.ruolo === 'amministratore' ? await api.costanti() : null;
  return shell();
}

impostaGestoreLogout(() => {
  avviso('Sessione scaduta, effettua di nuovo l\'accesso.', 'attenzione');
  schermataAccesso();
});

avvia().catch((err) => {
  monta(app, h('p', { class: 'errore-vista' }, err.message || 'Impossibile contattare il server.'));
});
