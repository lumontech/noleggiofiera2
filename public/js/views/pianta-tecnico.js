// La Planimetria del tecnico: la stessa schermata della Planimetria
// dell'ufficio, in sola lettura. A sinistra, al posto dei monitor liberi da
// trascinare, il riepilogo e i monitor da installare: toccandone uno lo si
// trova sulla pianta. Dal canale del tecnico: nessun prezzo arriva fin qui.

import { api } from '../api.js';
import { apriPianta } from '../pianta/visore.js';
import { disegnaBottoniPadiglioni } from '../pianta/padiglioni.js';
import { standInColonne } from '../pianta/stand.js';
import { compito, datiPerTecnico, perStand } from './installazioni.js';
import {
  h, monta, vuoto, numero, nomeBreve, intervalloDate, oggiISO, idProdotto,
  select, etichettaMontaggio, eSchermo,
} from '../ui.js';

const parametri = () => new URLSearchParams(location.hash.split('?')[1] || '');

/** La colonna a sinistra: riepilogo in cima, poi i monitor stand per stand. */
function colonnaTecnico(fiera) {
  const radice = h('div', { class: 'tav' });
  let soloPad = null;
  let tutti = false;

  function disegna() {
    const righe = fiera.installazioni;
    const pezzi = (classe) => righe.filter((n) => compito(n, fiera).classe === classe).reduce((t, n) => t + n.quantita, 0);
    // Del padiglione aperto, se si sa qual è; quelli senza padiglione restano sempre.
    const delPad = (g) => {
      const pad = standInColonne(g.stand, fiera.padiglione, g.padiglione).padiglione;
      return tutti || !soloPad || !pad || String(pad) === String(soloPad);
    };
    const gruppi = perStand(righe);
    const visibili = gruppi.filter(delPad);
    const nascosti = gruppi.length - visibili.length;

    // Cosa portare, modello per modello.
    const modelli = new Map();
    for (const n of righe) {
      const nome = `${nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici })}`
        + (n.prodotto_codice ? ` ${idProdotto(n.prodotto_codice)}` : '');
      modelli.set(nome, (modelli.get(nome) || 0) + n.quantita);
    }

    monta(radice,
      h('div', { class: 'tav-testa' },
        h('strong', {}, 'Da installare'),
        h('p', {}, intervalloDate(fiera.data_inizio, fiera.data_fine), fiera.citta ? ` · ${fiera.citta}` : ''),
        h('div', { class: 'tav-numeri' },
          h('span', { class: 'tav-numero tav-numero--da-fare' }, h('strong', {}, numero(pezzi('da-fare'))), 'da installare'),
          h('span', { class: 'tav-numero tav-numero--fatto' }, h('strong', {}, numero(pezzi('fatto'))), 'installati'),
          pezzi('ritiro') ? h('span', { class: 'tav-numero tav-numero--ritiro' }, h('strong', {}, numero(pezzi('ritiro'))), 'da ritirare') : null,
          h('span', { class: 'tav-numero' }, h('strong', {}, numero(gruppi.length)), 'stand')),
        h('details', { class: 'tav-portare' },
          h('summary', {}, 'Cosa portare'),
          h('ul', {}, [...modelli.entries()].sort((a, b) => b[1] - a[1])
            .map(([nome, q]) => h('li', {}, h('strong', {}, `${q}×`), ` ${nome}`))))),
      h('div', { class: 'tav-elenco' },
        soloPad && nascosti ? h('p', { class: 'tav-filtro' },
          tutti ? 'Tutti i padiglioni. ' : `Solo PAD ${soloPad}. `,
          h('button', { type: 'button', class: 'tav-link', onclick: () => { tutti = !tutti; disegna(); } },
            tutti ? `Solo PAD ${soloPad}` : `Mostra tutti (${numero(nascosti)} stand in altri padiglioni)`)) : null,
        !visibili.length ? h('p', { class: 'pianta__attesa' }, 'Nessun monitor su questo padiglione.') : null,
        visibili.map((g) => {
          const posto = standInColonne(g.stand, fiera.padiglione, g.padiglione);
          return h('section', { class: 'tav-stand' },
            h('h3', {}, posto.stand ? `Stand ${posto.stand}` : 'Senza stand',
              posto.padiglione ? h('span', {}, ` · PAD ${posto.padiglione}`) : null),
            h('p', { class: 'tav-stand__cliente' }, g.cliente || 'Cliente non indicato'),
            h('ul', {}, g.righe.map((n) => {
              const c = compito(n, fiera);
              return h('li', {
                class: 'tav-voce tav-voce--tecnico',
                dataset: { noleggio: n.id },
                title: 'Tocca per vederlo sulla pianta',
              },
              h('span', { class: 'tav-voce__nome' },
                h('strong', {}, `${n.quantita > 1 ? `${n.quantita}× ` : ''}${nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici })}`),
                h('span', {}, [idProdotto(n.prodotto_codice),
                  eSchermo(n.prodotto_categoria) ? (n.montaggio ? etichettaMontaggio(n.montaggio).toLowerCase() : 'montaggio da definire') : null,
                ].filter(Boolean).join(' · '))),
              h('span', { class: `installa__compito installa__compito--${c.classe}` }, c.testo));
            })));
        })));
  }
  disegna();
  return {
    elemento: radice,
    padiglione: (pad) => { soloPad = pad; tutti = false; disegna(); },
  };
}

export default async function vistaPiantaTecnico({ corpo }) {
  const fiere = await api.installazioni();
  if (!fiere.length) {
    monta(corpo, vuoto('Nessuna installazione in programma',
      'Quando l\'ufficio prenota dei televisori per una fiera, li trovi qui sulla pianta.'));
    return;
  }

  // Si parte dalla fiera nell'indirizzo, o dalla prima non ancora finita.
  const idFiera = Number(parametri().get('fiera'));
  const fiera = fiere.find((f) => f.id === idFiera)
    || fiere.find((f) => f.data_fine >= oggiISO()) || fiere[0];
  const piante = fiera.allegati.filter((a) => a.tipo === 'application/pdf' || a.tipo.startsWith('image/'));

  const selFiera = select('fiera', fiere.map((f) => ({
    valore: f.id, testo: `${f.nome} — ${intervalloDate(f.data_inizio, f.data_fine)}`,
  })), fiera.id);
  selFiera.addEventListener('change', () => { location.hash = `#/planimetria?fiera=${selFiera.value}`; });

  const barraPadiglioni = h('nav', { class: 'padiglioni', 'aria-label': 'Planimetrie della fiera' });
  const zona = h('div', { class: 'nol-pianta' });
  monta(corpo,
    h('div', { class: 'filtri' }, selFiera),
    piante.length > 1 ? barraPadiglioni : null,
    zona);

  if (!piante.length) {
    monta(zona, vuoto('Planimetria non ancora caricata',
      'L\'ufficio non ha ancora allegato la pianta di questa fiera: trovi stand e monitor in "Installazioni".'));
    return;
  }

  const padLetti = new Map();
  const conta = (id) => fiera.installazioni.filter((n) => n.segnaposto_allegato === id).length;
  // Senza una scelta precisa, si apre la planimetria con più monitor sopra.
  const piuPiena = [...piante].sort((x, y) => conta(y.id) - conta(x.id))[0];
  let aperta = piante.find((a) => a.id === Number(parametri().get('pianta'))) || piuPiena;

  async function apri(a) {
    aperta = a;
    history.replaceState(null, '', `#/planimetria?fiera=${fiera.id}&pianta=${a.id}`);
    if (piante.length > 1) disegnaBottoniPadiglioni(barraPadiglioni, { piante, aperta, padLetti, conta, onScegli: apri });
    const colonna = colonnaTecnico(fiera);
    const pianta = await apriPianta({
      fiera,
      allegato: a,
      contenitore: zona,
      solaLettura: true,
      latoIniziale: false,
      colonnaSinistra: colonna.elemento,
      caricaDati: datiPerTecnico(fiera, a),
    });
    if (pianta?.padiglione) {
      colonna.padiglione(pianta.padiglione);
      if (!padLetti.has(a.id)) {
        padLetti.set(a.id, pianta.padiglione);
        if (piante.length > 1) disegnaBottoniPadiglioni(barraPadiglioni, { piante, aperta, padLetti, conta, onScegli: apri });
      }
    }
  }
  await apri(aperta);
}
