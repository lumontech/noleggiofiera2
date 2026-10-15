// La Planimetria del tecnico: la stessa schermata della Planimetria
// dell'ufficio, in sola lettura. A sinistra, al posto dei monitor liberi da
// trascinare, cosa manca da installare stallo per stallo: toccandone uno lo
// si trova sulla pianta. Dal canale del tecnico: nessun prezzo arriva fin qui.

import { api } from '../api.js';
import { apriPianta } from '../pianta/visore.js';
import { disegnaBottoniPadiglioni } from '../pianta/padiglioni.js';
import { standInColonne } from '../pianta/stand.js';
import {
  compito, conPiantaneNelTv, datiPerTecnico, perStallo,
} from './installazioni.js';
import {
  h, monta, vuoto, numero, nomeBreve, intervalloDate, oggiISO, idProdotto,
  select, etichettaMontaggio, eSchermo,
} from '../ui.js';

const parametri = () => new URLSearchParams(location.hash.split('?')[1] || '');

/**
 * La colonna a sinistra: cosa manca da installare (o da ritirare), stallo per
 * stallo. Quello già installato non c'è: sulla pianta si vede comunque.
 */
function colonnaTecnico(fiera) {
  const radice = h('div', { class: 'tav' });
  let soloPad = null;
  let tutti = false;

  function disegna() {
    const mancano = conPiantaneNelTv(fiera.installazioni)
      .map((n) => ({ ...n, compito: compito(n, fiera) }))
      .filter((n) => n.compito);
    const pezzi = (classe) => mancano.filter((n) => n.compito.classe === classe).reduce((t, n) => t + n.quantita, 0);
    // Del padiglione aperto, se si sa qual è; quelli senza padiglione restano sempre.
    const delPad = (g) => tutti || !soloPad || !g.padiglione || String(g.padiglione) === String(soloPad);
    const stalli = perStallo(mancano, fiera);
    const visibili = stalli.filter(delPad);
    const nascosti = stalli.length - visibili.length;

    monta(radice,
      h('div', { class: 'tav-testa' },
        h('strong', {}, 'Cosa manca'),
        h('p', {}, intervalloDate(fiera.data_inizio, fiera.data_fine)),
        h('div', { class: 'tav-numeri' },
          pezzi('da-fare') ? h('span', { class: 'tav-numero tav-numero--da-fare' }, h('strong', {}, numero(pezzi('da-fare'))), 'da installare') : null,
          pezzi('ritiro') ? h('span', { class: 'tav-numero tav-numero--ritiro' }, h('strong', {}, numero(pezzi('ritiro'))), 'da ritirare') : null,
          !mancano.length ? h('span', { class: 'tav-numero tav-numero--fatto' }, h('strong', {}, '✓'), 'tutto installato') : null)),
      h('div', { class: 'tav-elenco' },
        soloPad && nascosti ? h('p', { class: 'tav-filtro' },
          tutti ? 'Tutti i padiglioni. ' : `Solo PAD ${soloPad}. `,
          h('button', { type: 'button', class: 'tav-link', onclick: () => { tutti = !tutti; disegna(); } },
            tutti ? `Solo PAD ${soloPad}` : `Mostra tutti (${numero(nascosti)} stalli in altri padiglioni)`)) : null,
        mancano.length && !visibili.length ? h('p', { class: 'pianta__attesa' }, 'Niente da fare su questo padiglione.') : null,
        visibili.map((g) => {
          const posto = standInColonne(g.stand, fiera.padiglione, g.padiglione);
          return h('section', { class: 'tav-stand' },
            h('h3', {}, posto.stand ? `Stand ${posto.stand}` : 'Senza stand',
              posto.padiglione ? h('span', {}, ` · PAD ${posto.padiglione}`) : null),
            h('p', { class: 'tav-stand__cliente' }, g.cliente || 'Espositore non indicato'),
            h('ul', {}, g.righe.map((n) => h('li', {
              class: 'tav-voce tav-voce--tecnico',
              dataset: { noleggio: n.id },
              title: 'Tocca per vederlo sulla pianta',
            },
            h('span', { class: 'tav-voce__nome' },
              h('strong', {}, `${n.quantita > 1 ? `${n.quantita}× ` : ''}${nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici })}`),
              h('span', {}, [idProdotto(n.prodotto_codice),
                // Il montaggio solo se deciso; la piantana abbinata sta col suo TV.
                eSchermo(n.prodotto_categoria) && n.montaggio ? etichettaMontaggio(n.montaggio).toLowerCase() : null,
                n.piantane.length ? `piantana ${n.piantane.map((p) => idProdotto(p.prodotto_codice)).join(', ')}` : null,
              ].filter(Boolean).join(' · '))),
            h('span', { class: `installa__compito installa__compito--${n.compito.classe}` }, n.compito.testo)))));
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
