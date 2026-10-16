// "Scarica PDF": i documenti con l'intestazione dell'azienda.
//   - Noleggi: per fiera, chi ha cosa e in quale stand (con o senza importi);
//     prima di scaricare si possono togliere i noleggi da non mandare
//   - Materiale disponibile: il listino del parco, tutto o libero per una fiera

import { api, caricaLogo, scaricaFile } from './api.js';
import {
  h, monta, modale, avviso, campo, input, select, griglia, intervalloDate, oggiISO,
} from './ui.js';

const scelta = (name, valore, testo, aiuto, checked = false) => h('label', { class: 'scelta-pdf' },
  h('input', { type: 'radio', name, value: valore, checked }),
  h('span', {}, h('strong', {}, testo), h('small', {}, aiuto)));

/** @param {object} [o] o.fieraId: la fiera da proporre (es. quella filtrata nei Noleggi) */
export async function apriDocumenti({ fieraId = '' } = {}) {
  const [fiere, intestazione] = await Promise.all([api.fiere(), api.intestazione()]);
  const inProgramma = fiere.filter((f) => f.data_fine >= oggiISO() && f.stato !== 'annullata');
  // Una fiera già svolta si può comunque scaricare se è quella filtrata.
  const elenco = fieraId && !inProgramma.some((f) => String(f.id) === String(fieraId))
    ? [...inProgramma, ...fiere.filter((f) => String(f.id) === String(fieraId))] : inProgramma;

  const selFiera = select('fiera_id', [
    { valore: '', testo: 'Tutte le fiere in programma' },
    ...elenco.map((f) => ({ valore: f.id, testo: `${f.nome} (${intervalloDate(f.data_inizio, f.data_fine)})` })),
  ], String(fieraId || ''));
  const aiutoFiera = h('span', { class: 'campo__aiuto' });
  const campoFiera = campo('Fiera', selFiera);
  campoFiera.appendChild(aiutoFiera);
  // Solo per i Noleggi: in fondo, cosa si può ancora offrire per quella fiera.
  const casellaDisponibile = h('label', { class: 'casella casella--pdf' },
    h('input', { type: 'checkbox', name: 'disponibile', value: '1', checked: true }),
    h('span', {}, h('strong', {}, 'Aggiungi il materiale ancora disponibile'),
      h('small', {}, 'In fondo a ogni fiera, quello che è ancora libero nelle sue date: utile da girare all\'organizzatore.')));

  // I noleggi da mettere nel PDF: tutti spuntati, si tolgono quelli da non
  // mandare (es. un documento per un solo cliente). Per cliente, con una
  // casella che li prende tutti.
  const elencoNoleggi = h('div', { class: 'pdf-noleggi__elenco' });
  const contaScelti = h('span', { class: 'pdf-noleggi__conta' });
  const caselle = () => [...elencoNoleggi.querySelectorAll('input[data-noleggio]')];
  const aggiornaConta = () => {
    const tutte = caselle();
    const scelte = tutte.filter((c) => c.checked).length;
    contaScelti.textContent = `${scelte} di ${tutte.length}`;
    // La casella del cliente è piena, vuota o a metà.
    for (const gruppo of elencoNoleggi.querySelectorAll('.pdf-noleggi__cliente')) {
      const sue = [...gruppo.querySelectorAll('input[data-noleggio]')];
      const capo = gruppo.querySelector('input[data-cliente]');
      const n = sue.filter((c) => c.checked).length;
      capo.checked = n === sue.length;
      capo.indeterminate = n > 0 && n < sue.length;
    }
  };
  const tutti = (valore) => { caselle().forEach((c) => { c.checked = valore; }); aggiornaConta(); };
  const sezioneNoleggi = h('div', { class: 'pdf-noleggi' },
    h('div', { class: 'pdf-noleggi__testa' },
      h('span', { class: 'campo__etichetta' }, 'Noleggi nel PDF ', contaScelti),
      h('span', {},
        h('button', { type: 'button', class: 'btn btn--mini', onclick: () => tutti(true) }, 'Tutti'), ' ',
        h('button', { type: 'button', class: 'btn btn--mini', onclick: () => tutti(false) }, 'Nessuno'))),
    h('small', { class: 'campo__aiuto' }, 'Togli la spunta a quelli da non mettere, per esempio se il PDF è per un solo cliente.'),
    elencoNoleggi);

  const voceNoleggio = (n) => h('label', { class: 'pdf-noleggi__voce' },
    h('input', { type: 'checkbox', checked: true, 'data-noleggio': n.id, onchange: aggiornaConta }),
    h('span', {}, n.apparecchio,
      n.codice ? h('small', {}, ` · ${/^\d+$/.test(n.codice) ? `ID ${n.codice}` : n.codice}`) : null,
      n.piantane ? h('small', {}, ` · con piantana`) : null,
      (n.padiglione || n.stand) ? h('small', {}, ` · ${[n.padiglione && `pad. ${n.padiglione}`, n.stand && `stand ${n.stand}`].filter(Boolean).join(' · ')}`) : null));

  let richiestaLista = 0;
  const caricaNoleggi = async (fiera) => {
    const numero = ++richiestaLista;
    monta(elencoNoleggi, h('p', { class: 'pdf-noleggi__vuoto' }, 'Carico i noleggi…'));
    const fiereDoc = await api.noleggiDocumento(fiera);
    if (numero !== richiestaLista) return; // nel frattempo si è scelta un'altra fiera
    const blocchi = fiereDoc.filter((f) => f.noleggi.length).map((f) => {
      const clienti = new Map();
      for (const n of f.noleggi) {
        const chi = n.cliente || 'Cliente non indicato';
        if (!clienti.has(chi)) clienti.set(chi, []);
        clienti.get(chi).push(n);
      }
      return h('div', { class: 'pdf-noleggi__fiera' },
        fiereDoc.length > 1 ? h('p', { class: 'pdf-noleggi__nome-fiera' }, f.nome) : null,
        [...clienti.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it')).map(([chi, voci]) => h('div', { class: 'pdf-noleggi__cliente' },
          h('label', { class: 'pdf-noleggi__voce pdf-noleggi__voce--cliente' },
            h('input', {
              type: 'checkbox', checked: true, 'data-cliente': chi,
              onchange: (e) => {
                e.target.closest('.pdf-noleggi__cliente').querySelectorAll('input[data-noleggio]')
                  .forEach((c) => { c.checked = e.target.checked; });
                aggiornaConta();
              },
            }),
            h('strong', {}, chi)),
          h('div', { class: 'pdf-noleggi__voci' }, voci.map(voceNoleggio)))));
    });
    monta(elencoNoleggi, blocchi.length ? blocchi : h('p', { class: 'pdf-noleggi__vuoto' }, 'Nessun noleggio.'));
    aggiornaConta();
  };

  modale({
    titolo: 'Scarica PDF',
    sottotitolo: `Con l'intestazione di ${intestazione.ragione_sociale}.`,
    testoConferma: 'Scarica PDF',
    corpo: [
      h('p', { class: 'campo__etichetta' }, 'Documento'),
      h('div', { class: 'scelte-pdf' },
        scelta('tipo', 'noleggi', 'Noleggi', 'Espositore, stand, apparecchio, montaggio e note, fiera per fiera.', true),
        scelta('tipo', 'materiale', 'Materiale disponibile', 'Quello libero, con misure e quantità: da proporre ai clienti.')),
      h('p', { class: 'campo__etichetta' }, 'Prezzi'),
      h('div', { class: 'scelte-pdf' },
        scelta('prezzi', '1', 'Con prezzi', 'Importi e totali, IVA esclusa.', true),
        scelta('prezzi', '0', 'Senza prezzi', 'Da dare al tecnico o all\'organizzatore.')),
      campoFiera,
      sezioneNoleggi,
      casellaDisponibile,
      h('p', { class: 'pdf-intestazione' },
        intestazione.logo ? 'Intestazione con logo. ' : 'Intestazione senza logo. ',
        h('button', { type: 'button', class: 'btn btn--mini', onclick: () => apriIntestazione() }, 'Modifica intestazione e logo')),
    ],
    onConferma: async (dati) => {
      const parametri = new URLSearchParams({ prezzi: dati.prezzi });
      if (dati.fiera_id) parametri.set('fiera_id', dati.fiera_id);
      if (dati.tipo === 'noleggi' && dati.disponibile) parametri.set('disponibile', '1');
      if (dati.tipo === 'noleggi') {
        const tolti = caselle().filter((c) => !c.checked).map((c) => c.dataset.noleggio);
        if (tolti.length && tolti.length === caselle().length) throw new Error('Hai tolto tutti i noleggi: spuntane almeno uno.');
        if (tolti.length) parametri.set('escludi', tolti.join(','));
      }
      const percorso = dati.tipo === 'materiale' ? 'materiale' : 'noleggi';
      await scaricaFile(`/api/documenti/${percorso}.pdf?${parametri}`, 'Documento.pdf');
      avviso('PDF scaricato.');
    },
  });

  // L'aiuto sotto la fiera cambia col documento scelto.
  const modulo = selFiera.closest('form');
  const aggiornaAiuto = () => {
    const tipo = modulo.querySelector('input[name=tipo]:checked').value;
    casellaDisponibile.hidden = tipo !== 'noleggi';
    sezioneNoleggi.hidden = tipo !== 'noleggi';
    aiutoFiera.textContent = tipo === 'materiale'
      ? 'Con una fiera, i pezzi liberi nelle sue date; senza, quelli liberi oggi.'
      : 'Con una fiera, tutti i suoi noleggi; altrimenti quelli delle fiere in programma.';
  };
  modulo.addEventListener('change', aggiornaAiuto);
  aggiornaAiuto();
  // La lista dei noleggi segue la fiera scelta.
  selFiera.addEventListener('change', () => caricaNoleggi(selFiera.value).catch((e) => avviso(e.message, 'errore')));
  caricaNoleggi(selFiera.value).catch((e) => avviso(e.message, 'errore'));
}

export async function apriIntestazione() {
  const dati = await api.intestazione();
  const anteprima = h('div', { class: 'logo-anteprima' });
  const disegnaLogo = (presente) => monta(anteprima, presente
    ? [h('img', { src: `/api/documenti/intestazione/logo?v=${Date.now()}`, alt: 'Logo' }),
      h('button', {
        type: 'button', class: 'btn btn--mini',
        onclick: async () => { await api.eliminaLogo(); disegnaLogo(false); avviso('Logo tolto.'); },
      }, 'Togli logo')]
    : h('span', {}, 'Nessun logo: in alto compare il nome dell\'azienda.'));
  disegnaLogo(dati.logo);
  const file = h('input', {
    type: 'file', accept: 'image/png,image/jpeg',
    onchange: async () => {
      if (!file.files[0]) return;
      try {
        await caricaLogo(file.files[0]);
        disegnaLogo(true);
        avviso('Logo caricato.');
      } catch (err) { avviso(err.message, 'errore'); }
      file.value = '';
    },
  });
  modale({
    titolo: 'Intestazione dei documenti',
    sottotitolo: 'Compare in alto nei PDF che scarichi.',
    testoConferma: 'Salva intestazione',
    larga: true,
    corpo: [
      h('div', { class: 'campo campo--largo' },
        h('span', { class: 'campo__etichetta' }, 'Logo (PNG o JPG)'), anteprima, file),
      griglia(
        campo('Ragione sociale', input('ragione_sociale', { value: dati.ragione_sociale, required: true, maxlength: 120 })),
        campo('Sottotitolo', input('sottotitolo', { value: dati.sottotitolo, maxlength: 160 })),
        campo('Indirizzo', input('indirizzo', { value: dati.indirizzo, maxlength: 200 }), { largo: true }),
        campo('Partita IVA', input('piva', { value: dati.piva, maxlength: 40 })),
        campo('Telefono', input('telefono', { value: dati.telefono, maxlength: 60 })),
        campo('Email', input('email', { value: dati.email, type: 'email', maxlength: 120 })),
        campo('Sito', input('sito', { value: dati.sito, maxlength: 120 })),
      ),
    ],
    onConferma: async (valori) => {
      await api.salvaIntestazione(valori);
      avviso('Intestazione salvata.');
    },
  });
}
