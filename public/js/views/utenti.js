// Chi può entrare e cosa vede. Due ruoli: l'amministratore vede tutto, il
// tecnico solo le installazioni (cosa montare, dove, con la pianta), senza prezzi.

import { api } from '../api.js';
import { stato as statoApp } from '../app.js';
import {
  h, monta, modale, avviso, campo, input, select, griglia, vuoto, dataBreve,
} from '../ui.js';

const RUOLI = [
  { valore: 'tecnico', testo: 'Tecnico' },
  { valore: 'amministratore', testo: 'Amministratore' },
];

const DESCRIZIONE_RUOLO = {
  tecnico: 'Vede solo cosa installare, in quale stand e la pianta con le TV. Nessun prezzo, nessun importo.',
  amministratore: 'Vede e modifica tutto: prodotti, fiere, noleggi, importi e utenti.',
};

const nomeRuolo = (ruolo) => RUOLI.find((r) => r.valore === ruolo)?.testo || ruolo;

function formUtente(u = {}) {
  const modifica = Boolean(u.id);
  const aiutoRuolo = h('span', { class: 'campo__aiuto' }, DESCRIZIONE_RUOLO[u.ruolo || 'tecnico']);
  const ruolo = select('ruolo', RUOLI, u.ruolo || 'tecnico');
  ruolo.addEventListener('change', () => { aiutoRuolo.textContent = DESCRIZIONE_RUOLO[ruolo.value]; });
  const campoRuolo = campo('Ruolo', ruolo);
  campoRuolo.appendChild(aiutoRuolo);

  return griglia(
    campo('Nome e cognome', input('nome', { value: u.nome || '', required: true, maxlength: 80, placeholder: 'Mario Rossi' })),
    campo('Nome utente', input('accesso', {
      value: u.accesso || '', required: true, maxlength: 40, placeholder: 'mario',
      autocomplete: 'off', autocapitalize: 'none', spellcheck: false,
    }), { aiuto: 'Serve per entrare. Lettere minuscole, numeri, punto o trattino.' }),
    campoRuolo,
    campo(modifica ? 'Nuova password' : 'Password', input('password', {
      type: 'password', required: !modifica, minlength: 4, autocomplete: 'new-password',
      placeholder: modifica ? 'Lascia vuoto per non cambiarla' : 'Almeno 4 caratteri',
    }), { aiuto: modifica ? 'Se la cambi, l\'utente viene disconnesso da tutti i dispositivi.' : null }),
  );
}

function apriForm(u, ricarica) {
  const modifica = Boolean(u?.id);
  const io = modifica && u.id === statoApp.utente?.id;
  modale({
    titolo: modifica ? `Modifica ${u.nome}` : 'Nuovo utente',
    sottotitolo: modifica ? `Nome utente: ${u.accesso}` : 'Comunica tu nome utente e password alla persona.',
    corpo: formUtente(u || {}),
    testoConferma: modifica ? 'Salva modifiche' : 'Crea utente',
    azionePericolosa: modifica && !io ? {
      testo: 'Elimina utente',
      testoConferma: 'Tocca ancora per eliminare',
      onClick: async () => {
        await api.eliminaUtente(u.id);
        avviso(`${u.nome} eliminato.`);
        await ricarica();
      },
    } : null,
    onConferma: async (dati) => {
      if (!dati.password) delete dati.password;
      if (modifica) await api.modificaUtente(u.id, dati);
      else await api.creaUtente(dati);
      avviso(modifica ? 'Utente aggiornato.' : `Utente ${dati.accesso} creato.`);
      await ricarica();
    },
  });
}

function rigaUtente(u, ricarica) {
  const io = u.id === statoApp.utente?.id;
  return h('article', { class: `utente ${u.attivo ? '' : 'utente--disattivato'}` },
    h('div', { class: 'utente__iniziale', 'aria-hidden': 'true' }, (u.nome || '?').trim().charAt(0).toUpperCase()),
    h('div', { class: 'utente__testo' },
      h('h3', {}, u.nome, io ? h('span', { class: 'utente__tu' }, ' (tu)') : null),
      h('p', {}, h('span', { class: 'utente__accesso' }, u.accesso), ' · ',
        u.ultimo_accesso ? `ultimo accesso ${dataBreve(u.ultimo_accesso.slice(0, 10))}` : 'mai entrato')),
    h('span', { class: `badge badge--ruolo-${u.ruolo}` }, nomeRuolo(u.ruolo)),
    u.attivo ? null : h('span', { class: 'badge badge--annullato' }, 'Disattivato'),
    h('div', { class: 'utente__azioni' },
      io ? null : h('button', {
        class: 'btn btn--mini',
        title: u.attivo ? 'Non potrà più entrare finché non lo riattivi' : 'Potrà di nuovo entrare',
        onclick: async () => {
          try {
            await api.modificaUtente(u.id, { attivo: !u.attivo });
            avviso(u.attivo ? `${u.nome} disattivato: è stato disconnesso.` : `${u.nome} riattivato.`);
            await ricarica();
          } catch (err) { avviso(err.message, 'errore'); }
        },
      }, u.attivo ? 'Disattiva' : 'Riattiva'),
      h('button', { class: 'btn btn--mini', onclick: () => apriForm(u, ricarica) }, 'Modifica')));
}

export default async function vistaUtenti({ corpo, azioni, ricarica }) {
  azioni.appendChild(h('button', {
    class: 'btn btn--primario', onclick: () => apriForm(null, ricarica),
  }, '+ Nuovo utente'));

  const elenco = await api.utenti();
  const tecnici = elenco.filter((u) => u.ruolo === 'tecnico');
  const amministratori = elenco.filter((u) => u.ruolo === 'amministratore');

  monta(corpo,
    h('div', { class: 'ruoli' },
      RUOLI.map((r) => h('div', { class: 'ruoli__voce' },
        h('span', { class: `badge badge--ruolo-${r.valore}` }, r.testo),
        h('p', {}, DESCRIZIONE_RUOLO[r.valore])))),
    h('h2', { class: 'titolo-sezione' }, `Tecnici (${tecnici.length})`),
    tecnici.length
      ? h('div', { class: 'utenti' }, tecnici.map((u) => rigaUtente(u, ricarica)))
      : vuoto('Nessun tecnico',
          'Crea un utente con ruolo Tecnico: vedrà solo cosa installare e dove, senza prezzi.',
          h('button', { class: 'btn btn--primario', onclick: () => apriForm(null, ricarica) }, '+ Nuovo utente')),
    h('h2', { class: 'titolo-sezione' }, `Amministratori (${amministratori.length})`),
    h('div', { class: 'utenti' }, amministratori.map((u) => rigaUtente(u, ricarica))));
}
