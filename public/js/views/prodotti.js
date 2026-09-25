import { api } from '../api.js';
import { stato as statoApp } from '../app.js';
import {
  h, monta, badge, modale, conferma, avviso, campo, input, select, areaTesto,
  griglia, numero, euro, vuoto, intervalloDate, etichetta,
  idProdotto,
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
      campo('ID', input('codice', { value: p.codice || '', placeholder: '38' }), { aiuto: 'Il numero dell\'apparecchio, come in Airtable.' }),
      campo('Pollici', input('pollici', { value: p.pollici ?? '', type: 'number', step: '0.1', min: '1', placeholder: '55' })),
      campo('Risoluzione', input('risoluzione', { value: p.risoluzione || '', placeholder: '4K UHD' })),
      campo('Pezzi in magazzino', input('quantita', { value: p.quantita ?? 1, type: 'number', min: '1', required: true }),
        { aiuto: 'Quante unità identiche possiedi.' }),
      campo('Costo d\'acquisto (€)', input('costo_acquisto', { value: p.costo_acquisto ?? 0, type: 'number', min: '0', step: '0.01' }),
        { aiuto: 'Quanto l\'hai pagato, per pezzo. Serve per il bilancio nel cruscotto.' }),
      campo('Prezzo al giorno (€)', input('prezzo_giorno', { value: p.prezzo_giorno ?? 0, type: 'number', min: '0', step: '0.01' }),
        { aiuto: 'Listino indicativo: propone l\'importo nei nuovi noleggi.' }),
    ),
    h('h3', { class: 'form-sezione' }, 'Scheda tecnica'),
    h('p', { class: 'form-sezione__testo' }, 'Le misure servono agli allestitori per preparare lo stand.'),
    griglia(
      campo('EAN', input('ean', { value: p.ean || '', inputmode: 'numeric', placeholder: '8806095478333' })),
      campo('VESA', input('vesa', { value: p.vesa || '', placeholder: '300x300' })),
      campo('Larghezza (mm)', misura('larghezza_mm', p)),
      campo('Altezza senza base (mm)', misura('altezza_mm', p)),
      campo('Profondità (mm)', misura('profondita_mm', p)),
      campo('Altezza con base (mm)', misura('altezza_base_mm', p)),
      campo('Peso senza base (kg)', input('peso_kg', { value: p.peso_kg ?? '', type: 'number', min: '0', step: '0.1' })),
      campo('Link scheda tecnica', input('scheda_url', { value: p.scheda_url || '', type: 'url', placeholder: 'https://…' })),
      campo('Note', areaTesto('note', { value: p.note || '' }), { largo: true }),
    ),
  ];
}

const misura = (nome, p) => input(nome, { value: p[nome] ?? '', type: 'number', min: '0', step: '0.1' });

/** "1450 × 830 mm · con base 886 mm · 14,3 kg · VESA 300x200", con quello che c'è. */
export function misureInBreve(p) {
  const mm = (n) => numero(Math.round(n));
  return [
    p.larghezza_mm && p.altezza_mm ? `${mm(p.larghezza_mm)} × ${mm(p.altezza_mm)} mm` : null,
    p.profondita_mm ? `prof. ${mm(p.profondita_mm)} mm` : null,
    p.altezza_base_mm ? `con base alto ${mm(p.altezza_base_mm)} mm` : null,
    p.peso_kg ? `${String(p.peso_kg).replace('.', ',')} kg` : null,
    p.vesa ? `VESA ${p.vesa}` : null,
  ].filter(Boolean).join(' · ');
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
        h('h3', {}, p.codice ? h('span', { class: 'prodotto__id' }, idProdotto(p.codice)) : null, p.nome),
        h('p', {}, [p.marca, p.modello].filter(Boolean).join(' ')
          || p.categoria, p.pollici ? ` · ${p.pollici}"` : '')),
      badge(p.stato)),

    h('div', { class: 'prodotto__numeri' },
      statoOggi(p),
      h('div', {}, h('span', { class: 'prodotto__cifra' }, numero(p.noleggi_totali)),
        h('span', {}, p.noleggi_totali === 1 ? 'noleggio in tutto' : 'noleggi in tutto')),
      h('div', {}, h('span', { class: 'prodotto__cifra' }, euro(p.ricavi)), h('span', {}, 'guadagnato')),
      h('div', {}, h('span', { class: 'prodotto__cifra' }, euro(p.costo_acquisto * p.quantita)), h('span', {}, 'costo'))),

    // Con più pezzi uguali, la barra dice quanti sono fuori oggi.
    p.quantita > 1 ? h('div', { class: 'barra-occupazione barra-occupazione--sottile' },
      h('div', { class: 'barra-occupazione__riempimento', style: { width: `${perc}%` } })) : null,
    resa(p),
    schedaTecnica(p),
    h('p', { class: 'prodotto__nota' }, notaProssimi(p)),

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

/**
 * Com'è l'apparecchio oggi. Con un pezzo solo (il caso normale: una riga per
 * apparecchio fisico) si dice a parole; con più pezzi uguali, quanti sono liberi.
 */
function statoOggi(p) {
  if (p.quantita === 1) {
    const [testo, classe] = p.stato === 'manutenzione' ? ['Guasto', 'fermo']
      : p.stato === 'dismesso' ? ['Dismesso', 'fermo']
        : p.impegnati_oggi > 0 ? ['In fiera', 'fuori'] : ['Libero', 'libero'];
    return h('div', {}, h('span', { class: `prodotto__cifra prodotto__oggi--${classe}` }, testo), h('span', {}, 'oggi'));
  }
  return h('div', {}, h('span', { class: 'prodotto__cifra' }, `${numero(p.disponibili_oggi)}/${numero(p.quantita)}`),
    h('span', {}, 'liberi oggi'));
}

function notaProssimi(p) {
  if (p.stato === 'manutenzione') return 'Segnato come guasto / in manutenzione: non viene proposto nei noleggi.';
  if (p.stato === 'dismesso') return 'Dismesso: non viene proposto nei noleggi.';
  if (!p.impegno_max_30gg) return 'Libero nei prossimi 30 giorni.';
  return p.quantita === 1 ? 'Già prenotato nei prossimi 30 giorni.'
    : `Fino a ${numero(p.impegno_max_30gg)} pezzi prenotati nei prossimi 30 giorni.`;
}

/** Quanto ha già ripagato l'apparecchio del suo costo. */
function resa(p) {
  const costo = p.costo_acquisto * p.quantita;
  if (!costo) return null;
  const perc = Math.round((p.ricavi / costo) * 100);
  return h('p', { class: `prodotto__resa ${perc >= 100 ? 'prodotto__resa--ok' : ''}` },
    perc >= 100
      ? h('strong', {}, `Ripagato: ha reso il ${perc}% del costo`)
      : [h('strong', {}, `Ripagato al ${perc}%`), ` · mancano ${euro(costo - p.ricavi)}`]);
}

function schedaTecnica(p) {
  const misure = misureInBreve(p);
  if (!misure && !p.ean) return null;
  return h('div', { class: 'prodotto__scheda' },
    misure ? h('p', {}, misure) : h('p', { class: 'prodotto__scheda-vuota' }, 'Misure non ancora inserite'),
    h('p', { class: 'prodotto__ean' },
      p.ean ? `EAN ${p.ean}` : null,
      p.ean && p.scheda_url ? ' · ' : null,
      p.scheda_url ? h('a', { href: p.scheda_url, target: '_blank', rel: 'noopener' }, 'Scheda tecnica') : null));
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

  const cerca = input('q', { placeholder: 'Cerca per nome, marca, modello o ID…', type: 'search' });
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
