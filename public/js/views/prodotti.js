import { api } from '../api.js';
import { stato as statoApp } from '../app.js';
import {
  h, monta, badge, modale, conferma, avviso, campo, input, select, areaTesto,
  griglia, numero, euro, vuoto, intervalloDate, etichetta,
} from '../ui.js';

const CATEGORIA_ICONA = {
  TV: '📺', Monitor: '🖥️', Videowall: '🧱', Totem: '🗼', Supporto: '🦾', Accessorio: '🔌',
};

function formProdotto(p = {}) {
  const { categorie, stati_prodotto: statiProdotto } = statoApp.costanti;
  return [
    griglia(
      campo('Nome', input('nome', { value: p.nome || '', required: true, placeholder: 'TV 55" 4K Samsung' }), { largo: true }),
      campo('Categoria', select('categoria', categorie.map((c) => ({ valore: c, testo: c })), p.categoria || 'TV')),
      campo('Stato', select('stato', statiProdotto, p.stato || 'attivo')),
      campo('Marca', input('marca', { value: p.marca || '', placeholder: 'Samsung' })),
      campo('Modello', input('modello', { value: p.modello || '', placeholder: 'QM55B' })),
      campo('Codice interno', input('codice', { value: p.codice || '', placeholder: 'TV-55-A' })),
      campo('Pollici', input('pollici', { value: p.pollici ?? '', type: 'number', step: '0.1', min: '1', placeholder: '55' })),
      campo('Risoluzione', input('risoluzione', { value: p.risoluzione || '', placeholder: '4K UHD' })),
      campo('Pezzi in magazzino', input('quantita', { value: p.quantita ?? 1, type: 'number', min: '1', required: true }),
        { aiuto: 'Quante unità identiche possiedi.' }),
      campo('Prezzo al giorno (€)', input('prezzo_giorno', { value: p.prezzo_giorno ?? 0, type: 'number', min: '0', step: '0.01' })),
      campo('Note', areaTesto('note', { value: p.note || '' }), { largo: true }),
    ),
  ];
}

function apriForm(p, ricarica) {
  const modifica = Boolean(p?.id);
  modale({
    titolo: modifica ? 'Modifica prodotto' : 'Nuovo prodotto',
    sottotitolo: modifica ? p.nome : 'Aggiungi un articolo al parco noleggio.',
    corpo: formProdotto(p || {}),
    testoConferma: modifica ? 'Salva modifiche' : 'Crea prodotto',
    larga: true,
    onConferma: async (dati) => {
      if (modifica) await api.modificaProdotto(p.id, dati);
      else await api.creaProdotto(dati);
      avviso(modifica ? 'Prodotto aggiornato.' : 'Prodotto creato.');
      await ricarica();
    },
  });
}

function schedaProdotto(p, ricarica) {
  const liberi = p.disponibili_oggi;
  const tono = p.stato !== 'attivo' ? 'inattivo' : liberi === 0 ? 'esaurito' : liberi < p.quantita ? 'parziale' : 'libero';
  const perc = p.quantita ? Math.round((p.impegnati_oggi / p.quantita) * 100) : 0;

  return h('article', { class: `prodotto prodotto--${tono}` },
    h('header', { class: 'prodotto__testa' },
      h('span', { class: 'prodotto__icona', 'aria-hidden': 'true' }, CATEGORIA_ICONA[p.categoria] || '📦'),
      h('div', { class: 'prodotto__titolo' },
        h('h3', {}, p.nome),
        h('p', {}, [p.marca, p.modello].filter(Boolean).join(' ')
          || p.categoria, p.pollici ? ` · ${p.pollici}"` : '', p.codice ? ` · ${p.codice}` : '')),
      badge(p.stato)),

    h('div', { class: 'prodotto__numeri' },
      h('div', {}, h('span', { class: 'prodotto__cifra' }, numero(liberi)), h('span', {}, 'liberi oggi')),
      h('div', {}, h('span', { class: 'prodotto__cifra' }, numero(p.impegnati_oggi)), h('span', {}, 'noleggiati')),
      h('div', {}, h('span', { class: 'prodotto__cifra' }, numero(p.quantita)), h('span', {}, 'totali')),
      h('div', {}, h('span', { class: 'prodotto__cifra' }, euro(p.prezzo_giorno)), h('span', {}, 'al giorno'))),

    h('div', { class: 'barra-occupazione barra-occupazione--sottile' },
      h('div', { class: 'barra-occupazione__riempimento', style: { width: `${perc}%` } })),
    h('p', { class: 'prodotto__nota' },
      p.impegno_max_30gg > 0
        ? `Picco di ${p.impegno_max_30gg} pezzi impegnati nei prossimi 30 giorni.`
        : 'Nessun impegno nei prossimi 30 giorni.'),

    h('footer', { class: 'prodotto__azioni' },
      h('button', { class: 'btn btn--mini', onclick: () => apriStorico(p) }, 'Storico'),
      h('button', { class: 'btn btn--mini', onclick: () => apriForm(p, ricarica) }, 'Modifica'),
      h('button', {
        class: 'btn btn--mini btn--pericolo',
        onclick: () => conferma({
          titolo: 'Eliminare il prodotto?',
          messaggio: `"${p.nome}" verrà rimosso dal catalogo. L'operazione non è reversibile.`,
          onConferma: async () => {
            await api.eliminaProdotto(p.id);
            avviso('Prodotto eliminato.');
            await ricarica();
          },
        }),
      }, 'Elimina')));
}

async function apriStorico(p) {
  const dettaglio = await api.prodotto(p.id);
  modale({
    titolo: `Storico noleggi — ${p.nome}`,
    sottotitolo: `${dettaglio.noleggi.length} righe registrate su ${p.quantita} pezzi in magazzino.`,
    larga: true,
    testoConferma: 'Chiudi',
    corpo: dettaglio.noleggi.length
      ? h('table', { class: 'tabella' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Fiera'), h('th', {}, 'Periodo'), h('th', {}, 'Pezzi'), h('th', {}, 'Stato'))),
          h('tbody', {}, dettaglio.noleggi.map((n) => h('tr', {},
            h('td', {}, n.fiera_nome, n.fiera_citta ? h('span', { class: 'sottotesto' }, ` ${n.fiera_citta}`) : null),
            h('td', {}, intervalloDate(n.data_inizio, n.data_fine)),
            h('td', {}, numero(n.quantita)),
            h('td', {}, badge(n.stato))))))
      : vuoto('Nessun noleggio registrato', 'Questo articolo non è mai stato impegnato.'),
    onConferma: async () => {},
  });
}

export default async function vistaProdotti({ corpo, azioni, ricarica }) {
  const { categorie, stati_prodotto: statiProdotto } = statoApp.costanti;

  azioni.appendChild(h('button', {
    class: 'btn btn--primario', onclick: () => apriForm(null, ricarica),
  }, '+ Nuovo prodotto'));

  const filtri = { q: '', categoria: '', stato: '' };
  const contenitore = h('div', {});

  const disegna = async () => {
    const elenco = await api.prodotti(filtri);
    const totalePezzi = elenco.reduce((t, p) => t + p.quantita, 0);
    const liberi = elenco.reduce((t, p) => t + p.disponibili_oggi, 0);
    monta(contenitore,
      h('p', { class: 'riepilogo-filtro' },
        `${numero(elenco.length)} articoli · ${numero(totalePezzi)} pezzi · ${numero(liberi)} liberi oggi`),
      elenco.length
        ? h('div', { class: 'griglia-prodotti' }, elenco.map((p) => schedaProdotto(p, ricarica)))
        : vuoto('Nessun prodotto trovato',
            'Cambia i filtri oppure aggiungi il primo articolo da noleggiare.',
            h('button', { class: 'btn btn--primario', onclick: () => apriForm(null, ricarica) }, '+ Nuovo prodotto')));
  };

  const cerca = input('q', { placeholder: 'Cerca per nome, marca, modello o codice…', type: 'search' });
  cerca.addEventListener('input', () => { filtri.q = cerca.value.trim(); disegna(); });

  const selCategoria = select('categoria',
    [{ valore: '', testo: 'Tutte le categorie' }, ...categorie.map((c) => ({ valore: c, testo: c }))], '');
  selCategoria.addEventListener('change', () => { filtri.categoria = selCategoria.value; disegna(); });

  const selStato = select('stato',
    [{ valore: '', testo: 'Tutti gli stati' }, ...statiProdotto.map((s) => ({ valore: s, testo: etichetta(s) }))], '');
  selStato.addEventListener('change', () => { filtri.stato = selStato.value; disegna(); });

  monta(corpo,
    h('div', { class: 'filtri' }, cerca, selCategoria, selStato),
    contenitore);
  await disegna();
}
