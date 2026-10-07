// "Scarica PDF": i documenti con l'intestazione dell'azienda.
//   - Noleggi: per fiera, chi ha cosa e in quale stand (con o senza importi)
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
      casellaDisponibile,
      h('p', { class: 'pdf-intestazione' },
        intestazione.logo ? 'Intestazione con logo. ' : 'Intestazione senza logo. ',
        h('button', { type: 'button', class: 'btn btn--mini', onclick: () => apriIntestazione() }, 'Modifica intestazione e logo')),
    ],
    onConferma: async (dati) => {
      const parametri = new URLSearchParams({ prezzi: dati.prezzi });
      if (dati.fiera_id) parametri.set('fiera_id', dati.fiera_id);
      if (dati.tipo === 'noleggi' && dati.disponibile) parametri.set('disponibile', '1');
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
    aiutoFiera.textContent = tipo === 'materiale'
      ? 'Con una fiera, i pezzi liberi nelle sue date; senza, quelli liberi oggi.'
      : 'Con una fiera, tutti i suoi noleggi; altrimenti quelli delle fiere in programma.';
  };
  modulo.addEventListener('change', aggiornaAiuto);
  aggiornaAiuto();
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
