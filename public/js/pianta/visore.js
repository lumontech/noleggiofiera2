// "Pianta con TV": la planimetria di un'edizione con coperti gli stand dove
// vanno i televisori noleggiati. È una copia generata al momento: il file
// originale non viene toccato e la copia rispecchia sempre i noleggi attuali.
//
// Nei PDF con testo i numeri degli stand si trovano da soli. Per le immagini e
// per gli stand non trovati si clicca lo stand sulla pianta: la posizione
// resta salvata per quella planimetria.
//
// In sola lettura (il tecnico) non si sposta nulla: si guarda la pianta, e i
// dati arrivano dal canale del tecnico, che non contiene prezzi.
//
// I segnaposti sono gli apparecchi messi in un punto preciso della pianta. In
// modalità "disposizione" (Noleggi → Planimetria) la pianta sta dentro la
// pagina, gli apparecchi liberi si trascinano dall'elenco a sinistra e ogni
// rilascio crea il noleggio; i segnaposti già messi si spostano trascinandoli.

import { api } from '../api.js';
import { h, monta, svuota, avviso, numero, nomeBreve, idProdotto,
  etichettaMontaggio, modale, badge, intervalloDate,
} from '../ui.js';
import { codiciStand, padiglione } from './stand.js';
import { analizzaPagina, collocaStand, spazioDelNumero } from './analisi.js';

const PDFJS = '/vendor/pdfjs/pdf.min.mjs';
const PDFJS_WORKER = '/vendor/pdfjs/pdf.worker.min.mjs';
// Oltre questa dimensione il browser rifiuta i canvas: si ingrandisce via CSS.
const LATO_MASSIMO_CANVAS = 8000;
// Dimensione di uno stand messo a mano, se non ce ne sono altri da imitare.
const SPAZIO_MANUALE = { w: 0.05, h: 0.05 };
const SCHERMI = ['TV', 'Monitor', 'Videowall', 'Totem'];

/** "1 TV + 1 piantana", "2 TV + 3 accessori", "1 cassa"…: cosa va nello stand, a colpo d'occhio. */
function contenutoStand(g) {
  const parti = [];
  if (g.tv) parti.push(`${g.tv} TV`);
  if (g.piantane) parti.push(`${g.piantane} ${g.piantane === 1 ? 'piantana' : 'piantane'}`);
  if (g.altri) parti.push(`${g.altri} ${g.altri === 1 ? 'accessorio' : 'accessori'}`);
  return parti.join(' + ');
}

// Sotto questo spostamento (in pixel) un trascinamento è solo un clic.
const SOGLIA_TRASCINAMENTO = 5;

let pdfjsCaricato = null;
export function caricaPdfjs() {
  // Si scarica solo la prima volta che si apre una pianta in PDF.
  pdfjsCaricato ||= import(PDFJS).then((modulo) => {
    modulo.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return modulo;
  });
  return pdfjsCaricato;
}

/**
 * I noleggi dell'edizione raggruppati per cliente e stand: un gruppo = una copertura.
 * Un apparecchio messo sulla pianta senza numero di stand ha già il suo
 * segnaposto: non serve anche nell'elenco degli stand da trovare.
 */
function gruppiDaNoleggi(noleggi, sullaPianta = new Set(), idAllegato = null) {
  const gruppi = new Map();
  for (const n of noleggi) {
    if (n.stato === 'annullato') continue;
    if (sullaPianta.has(n.id) && !codiciStand(n.stand).length) continue;
    // Messo dall'ufficio sulla pianta di un altro padiglione: non va cercato qui.
    if (n.segnaposto_allegato && n.segnaposto_allegato !== idAllegato) continue;
    const chiaveGruppo = `${(n.cliente || '').toLowerCase()}|${(n.stand || '').toLowerCase()}`;
    if (!gruppi.has(chiaveGruppo)) {
      const codici = codiciStand(n.stand);
      gruppi.set(chiaveGruppo, {
        cliente: n.cliente || 'Cliente non indicato',
        stand: n.stand || '',
        padiglione: n.padiglione || padiglione(n.stand),
        codici,
        // Chiave con cui si salva la posizione messa a mano.
        chiave: codici[0] || `cliente:${(n.cliente || n.stand || n.id).toString().toLowerCase()}`,
        apparecchi: [],
        noleggi: [],
        tv: 0,         // solo gli schermi: TV, monitor, videowall, totem
        piantane: 0,
        altri: 0,      // casse, cavi, segreterie…
        pezzi: 0,      // tutto
      });
    }
    const g = gruppi.get(chiaveGruppo);
    // Una piantana o una cassa non è una TV: si contano a parte.
    if (SCHERMI.includes(n.prodotto_categoria)) g.tv += n.quantita;
    else if (/piantana/i.test(n.prodotto_nome || '')) g.piantane += n.quantita;
    else g.altri += n.quantita;
    g.pezzi += n.quantita;
    g.noleggi.push(n);
    g.apparecchi.push(`${n.quantita > 1 ? `${n.quantita}× ` : ''}${nomeBreve({
      nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici,
    })}${n.prodotto_codice ? ` ${idProdotto(n.prodotto_codice)}` : ''}${n.montaggio ? ` (${etichettaMontaggio(n.montaggio).toLowerCase()})` : ''}`);
  }
  return [...gruppi.values()].sort((a, b) => (a.codici[0] || '~').localeCompare(b.codici[0] || '~', 'it', { numeric: true }));
}

/** Dimensione media degli stand trovati su una pagina, per quelli messi a mano. */
function dimensioneTipica(gruppi, pagina) {
  const spazi = gruppi.flatMap((g) => g.spazi.filter((s) => s.pagina === pagina && s.tipo !== 'manuale'));
  if (!spazi.length) return SPAZIO_MANUALE;
  const media = (k) => spazi.reduce((t, s) => t + s[k], 0) / spazi.length;
  return { w: media('w'), h: media('h') };
}

const datiDaAmministratore = (fiera, allegato) => Promise.all([
  api.fiera(fiera.id),
  api.posizioni(fiera.id, allegato.id),
  api.segnaposti(fiera.id, allegato.id),
]).then(([dettaglio, posizioni, segnaposti]) => ({ noleggi: dettaglio.noleggi, posizioni, segnaposti }));

/** Etichetta corta di un segnaposto: pollici e ID, che è quello che il tecnico cerca in magazzino. */
const etichettaSegnaposto = (n) => [
  n.prodotto_pollici ? `${n.prodotto_pollici}"` : (n.prodotto_categoria || 'App.'),
  idProdotto(n.prodotto_codice),
].filter(Boolean).join(' · ');

const descrizioneSegnaposto = (n) => [
  nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici })
    + (n.prodotto_codice ? ` ${idProdotto(n.prodotto_codice)}` : ''),
  n.cliente || 'Cliente da indicare',
  n.stand ? `stand ${n.stand}` : 'stand da indicare',
  n.montaggio ? etichettaMontaggio(n.montaggio) : null,
].filter(Boolean).join(' · ');

/**
 * @param {object} o
 * @param {object} o.fiera        l'edizione ({ id, nome })
 * @param {object} o.allegato     la planimetria ({ id, nome, tipo, url })
 * @param {boolean} [o.solaLettura] niente "Posiziona", "Sposta", "Ripristina"
 * @param {Function} [o.caricaDati] () => Promise<{ noleggi, posizioni }>
 * @param {string} [o.stand]      stand da mettere in evidenza all'apertura
 * @param {HTMLElement} [o.contenitore] se c'è, la pianta sta dentro la pagina invece che a schermo intero
 * @param {HTMLElement} [o.colonnaSinistra] colonna a sinistra in sola lettura (il tecnico): le voci
 *   [data-noleggio] si toccano per aprire il monitor e trovarlo sulla pianta
 * @param {boolean} [o.latoIniziale] colonna degli stand aperta (true) o chiusa (false) all'inizio
 * @param {object} [o.disposizione] trascinare apparecchi sulla pianta:
 *   { lato: elemento con le voci [data-prodotto] da trascinare,
 *     crea: async ({ prodotto_id, pagina, x, y, cliente, stand, padiglione }) => noleggio,
 *     modifica: (noleggio) => void, dopo: () => void (dopo ogni modifica) }
 */
export async function apriPianta({
  fiera, allegato, solaLettura = false, caricaDati = () => datiDaAmministratore(fiera, allegato), stand = '',
  contenitore = null, disposizione = null, latoIniziale = null, colonnaSinistra = null,
}) {
  const incorporata = Boolean(contenitore);
  const radice = h('div', incorporata
    ? { class: `pianta pianta--incorporata ${disposizione || colonnaSinistra ? 'pianta--disposizione' : ''}` }
    : { class: 'pianta', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pianta con TV' });
  if (incorporata) {
    monta(contenitore, radice);
  } else {
    document.body.appendChild(radice);
    document.body.classList.add('pianta-aperta');
  }

  const stato = {
    pagina: 1,
    pagine: [],          // analisi di ogni pagina (vuota per le immagini)
    documento: null,     // pdf.js, se PDF
    immagine: null,      // elemento <img>, se immagine
    zoom: 1,
    gruppi: [],
    posiziona: null,     // gruppo in attesa di un clic sulla pianta
    evidenziato: null,
    segnaposti: [],      // { noleggio_id, pagina, x, y }
    scelto: null,        // noleggio del segnaposto selezionato
  };

  const chiudi = () => {
    document.removeEventListener('keydown', suTasto, true);
    window.removeEventListener('resize', suRidimensiona);
    if (!incorporata) {
      document.body.classList.remove('pianta-aperta');
      radice.remove();
    }
  };
  // In cattura e fermando la propagazione: Esc deve chiudere solo il visore,
  // non anche la finestra da cui lo si è aperto.
  const suTasto = (e) => {
    if (e.key !== 'Escape') return;
    if (!radice.isConnected) { chiudi(); return; }
    // Con un popup aperto, Esc chiude il popup e basta.
    if (document.querySelector('#modale-host .modale__sfondo')) return;
    if (incorporata && !stato.posiziona) return;
    e.stopImmediatePropagation();
    if (stato.posiziona) annullaPosizionamento();
    else chiudi();
  };
  document.addEventListener('keydown', suTasto, true);

  /* ---------- struttura ---------- */

  const titoloPagina = h('span', { class: 'pianta__pagina' });
  // Il numero del padiglione, ben visibile in alto: dal titolo della pianta o dal nome del file.
  const etichettaPad = h('span', { class: 'pianta__pad', hidden: true });
  const padDelFile = padiglione(String(allegato.nome || '').replace(/[_-]/g, ' '));
  const padDellaPagina = (n) => stato.pagine[n - 1]?.padiglione || padDelFile || null;

  // La colonna degli stand si può chiudere; dentro Noleggi parte chiusa.
  // `latoIniziale` sceglie se parte aperta (il tecnico la vuole: è il suo riepilogo).
  const CHIAVE_LATO = latoIniziale !== null ? 'nf_lato_stand_tecnico' : incorporata ? 'nf_lato_stand_noleggi' : 'nf_lato_stand';
  let latoAperto = latoIniziale ?? !incorporata;
  try { const v = localStorage.getItem(CHIAVE_LATO); if (v !== null) latoAperto = v === '1'; } catch { /* niente */ }
  const bottoneLato = h('button', { class: 'btn btn--mini', type: 'button' });
  const applicaLato = () => {
    radice.classList.toggle('pianta--senza-lato', !latoAperto);
    bottoneLato.textContent = latoAperto ? 'Nascondi stand' : 'Elenco stand';
    bottoneLato.title = latoAperto ? 'Chiudi la colonna con l\'elenco degli stand' : 'Apri l\'elenco degli stand coperti e non trovati';
  };
  bottoneLato.addEventListener('click', () => {
    latoAperto = !latoAperto;
    try { localStorage.setItem(CHIAVE_LATO, latoAperto ? '1' : '0'); } catch { /* niente */ }
    applicaLato();
    disegnaPagina();
  });
  const bottoniPagina = h('div', { class: 'pianta__gruppo-bottoni' });
  const etichettaZoom = h('span', { class: 'pianta__zoom' }, '100%');
  const area = h('div', { class: 'pianta__area' });
  const foglio = h('div', { class: 'pianta__foglio' });
  const tela = h('canvas', { class: 'pianta__tela' });
  const livello = h('div', { class: 'pianta__livello' });
  const banner = h('div', { class: 'pianta__banner', hidden: true });
  const elenco = h('div', { class: 'pianta__elenco' });
  foglio.append(tela, livello);
  area.append(foglio);

  monta(radice,
    h('header', { class: 'pianta__testa' },
      incorporata ? null : h('button', { class: 'btn btn--fantasma pianta__chiudi', onclick: chiudi }, '← Chiudi'),
      etichettaPad,
      h('div', { class: 'pianta__titolo' },
        h('strong', {}, `${fiera.nome} · pianta con TV`),
        h('span', {}, allegato.nome)),
      h('div', { class: 'pianta__comandi' },
        bottoniPagina,
        h('div', { class: 'pianta__gruppo-bottoni' },
          h('button', { class: 'btn btn--mini', title: 'Rimpicciolisci', onclick: () => cambiaZoom(stato.zoom / 1.25) }, '−'),
          etichettaZoom,
          h('button', { class: 'btn btn--mini', title: 'Ingrandisci', onclick: () => cambiaZoom(stato.zoom * 1.25) }, '+'),
          h('button', { class: 'btn btn--mini', onclick: () => cambiaZoom(1) }, 'Adatta')),
        h('div', { class: 'pianta__gruppo-bottoni' },
          h('button', { class: 'btn btn--mini', onclick: () => esporta('scarica') }, 'Scarica PNG'),
          h('button', { class: 'btn btn--mini', onclick: () => esporta('stampa') }, 'Stampa'),
          bottoneLato))),
    h('div', { class: 'pianta__corpo' },
      disposizione ? h('aside', { class: 'pianta__tavolozza' }, disposizione.lato) : null,
      colonnaSinistra ? h('aside', { class: 'pianta__tavolozza' }, colonnaSinistra) : null,
      h('div', { class: 'pianta__vista' }, banner, area),
      h('aside', { class: 'pianta__lato' }, elenco)));

  applicaLato();
  monta(elenco, h('p', { class: 'pianta__attesa' }, 'Leggo la planimetria…'));

  /* ---------- caricamento e analisi ---------- */

  let dati;
  try {
    dati = await caricaDati();
  } catch (err) {
    monta(elenco, h('p', { class: 'pianta__errore' }, err.message || 'Impossibile caricare i dati.'));
    return;
  }
  const salvate = dati.posizioni;
  let gruppiBase;
  const noleggiPerId = new Map();
  function leggiDati() {
    stato.segnaposti = dati.segnaposti || [];
    noleggiPerId.clear();
    for (const n of dati.noleggi) noleggiPerId.set(n.id, n);
    // Un segnaposto il cui noleggio non arriva (annullato, o non visibile al tecnico) non si disegna.
    stato.segnaposti = stato.segnaposti.filter((sp) => noleggiPerId.has(sp.noleggio_id));
    gruppiBase = gruppiDaNoleggi(dati.noleggi, new Set(stato.segnaposti.map((sp) => sp.noleggio_id)), allegato.id);
    if (stato.scelto) stato.scelto = noleggiPerId.get(stato.scelto.id) || null;
  }
  leggiDati();
  const eImmagine = allegato.tipo.startsWith('image/');

  try {
    if (eImmagine) {
      stato.immagine = await new Promise((risolvi, rifiuta) => {
        const img = new Image();
        img.onload = () => risolvi(img);
        img.onerror = () => rifiuta(new Error('Impossibile aprire l\'immagine.'));
        img.src = allegato.url;
      });
      stato.pagine = [{ testi: [], riquadri: [], proporzione: stato.immagine.naturalWidth / stato.immagine.naturalHeight }];
    } else {
      const pdfjs = await caricaPdfjs();
      const risposta = await fetch(allegato.url, { credentials: 'same-origin' });
      if (!risposta.ok) throw new Error('Impossibile scaricare la planimetria.');
      stato.documento = await pdfjs.getDocument({ data: new Uint8Array(await risposta.arrayBuffer()) }).promise;
      for (let n = 1; n <= stato.documento.numPages; n += 1) {
        stato.pagine.push(await analizzaPagina(await stato.documento.getPage(n), pdfjs.OPS));
      }
    }
  } catch (err) {
    monta(elenco, h('p', { class: 'pianta__errore' }, err.message || 'Impossibile leggere la planimetria.'));
    return;
  }

  // Le posizioni messe a mano prevalgono su quelle trovate nel PDF.
  const manuali = new Map(salvate.map((p) => [p.chiave, p]));
  function ricolloca() {
    const automatici = collocaStand(gruppiBase, stato.pagine);
    stato.gruppi = automatici.map((g) => {
      const m = manuali.get(g.chiave);
      if (!m) return g;
      const dim = dimensioneTipica(automatici, m.pagina);
      return {
        ...g,
        stato: 'manuale',
        spazi: [{ pagina: m.pagina, codice: g.codici[0] || '', tipo: 'manuale',
          x: m.x - dim.w / 2, y: m.y - dim.h / 2, w: dim.w, h: dim.h }],
      };
    });
  }
  ricolloca();

  // Si apre sulla pagina con più stand coperti, o su quella dello stand richiesto.
  const perPagina = stato.pagine.map((_, i) => stato.gruppi.filter((g) => g.spazi.some((s) => s.pagina === i + 1)).length);
  stato.pagina = perPagina.indexOf(Math.max(...perPagina)) + 1 || 1;
  const codiceRichiesto = codiciStand(stand)[0];
  const richiesto = codiceRichiesto
    ? stato.gruppi.find((g) => g.codici.includes(codiceRichiesto) && g.spazi.length) : null;
  if (richiesto) {
    stato.evidenziato = richiesto;
    stato.pagina = richiesto.spazi[0].pagina;
  }

  /* ---------- disegno ---------- */

  let disegnoInCorso = null;
  async function disegnaPagina() {
    const larghezzaDisponibile = Math.max(area.clientWidth - 32, 200);
    const proporzione = stato.pagine[stato.pagina - 1].proporzione;
    const larghezza = larghezzaDisponibile * stato.zoom;
    const altezza = larghezza / proporzione;
    foglio.style.width = `${larghezza}px`;
    foglio.style.height = `${altezza}px`;

    if (stato.immagine) {
      tela.hidden = true;
      if (!foglio.contains(stato.immagine)) {
        stato.immagine.className = 'pianta__immagine';
        foglio.insertBefore(stato.immagine, livello);
      }
    } else {
      disegnoInCorso?.cancel();
      const pagina = await stato.documento.getPage(stato.pagina);
      const base = pagina.getViewport({ scale: 1 });
      const densita = window.devicePixelRatio || 1;
      let scala = (larghezza / base.width) * densita;
      scala = Math.min(scala, LATO_MASSIMO_CANVAS / Math.max(base.width, base.height));
      const vista = pagina.getViewport({ scale: scala });
      tela.width = Math.floor(vista.width);
      tela.height = Math.floor(vista.height);
      disegnoInCorso = pagina.render({ canvasContext: tela.getContext('2d'), viewport: vista });
      try { await disegnoInCorso.promise; } catch { /* sostituito da un disegno più recente */ }
    }
    disegnaCoperture();
  }

  function disegnaCoperture() {
    svuota(livello);
    for (const g of stato.gruppi) {
      g.spazi.filter((s) => s.pagina === stato.pagina).forEach((s, i) => {
        // Vicino al bordo destro l'etichetta si allinea a destra, per non uscire dal foglio.
        const aDestra = s.x + s.w > 0.78 ? 'pianta__copertura--a-destra' : '';
        const copertura = h('div', {
          class: `pianta__copertura pianta__copertura--${s.tipo} ${aDestra} ${stato.evidenziato?.chiave === g.chiave ? 'pianta__copertura--evidenziata' : ''}`,
          style: { left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` },
          title: `${g.cliente}${g.stand ? ` · stand ${g.stand}` : ''}\n${g.apparecchi.join('\n')}`,
          onclick: (e) => { e.stopPropagation(); evidenzia(g, false); apriStand(g); },
        },
        // L'etichetta solo sulla prima copertura del gruppo (es. 5017 e 5018 sono uno stand solo).
        i === 0 ? h('span', { class: 'pianta__etichetta' },
          h('strong', {}, contenutoStand(g)), ` ${g.cliente}`) : null);
        livello.appendChild(copertura);
      });
    }
    for (const sp of stato.segnaposti.filter((x) => x.pagina === stato.pagina)) {
      const n = noleggiPerId.get(sp.noleggio_id);
      const aDestra = sp.x > 0.85 ? 'pianta__segnaposto--a-destra' : '';
      livello.appendChild(h('button', {
        type: 'button',
        class: `pianta__segnaposto ${aDestra} ${stato.scelto?.id === n.id ? 'pianta__segnaposto--scelto' : ''}`
          + ` ${n.stand ? '' : 'pianta__segnaposto--incompleto'} ${solaLettura ? '' : 'pianta__segnaposto--mobile'}`,
        style: { left: `${sp.x * 100}%`, top: `${sp.y * 100}%` },
        title: descrizioneSegnaposto(n),
        dataset: { noleggio: n.id },
      }, h('span', { class: 'pianta__segnaposto-punto' }), h('span', { class: 'pianta__segnaposto-testo' }, etichettaSegnaposto(n))));
    }
    livello.classList.toggle('pianta__livello--posiziona', Boolean(stato.posiziona));
  }

  /* ---------- elenco laterale ---------- */

  const ETICHETTE = {
    trovato: { testo: 'Sulla pianta', classe: 'ok' },
    manuale: { testo: 'Posizionato a mano', classe: 'ok' },
    parziale: { testo: 'Trovato in parte', classe: 'attenzione' },
    ambiguo: { testo: 'Numero ripetuto: verifica', classe: 'attenzione' },
    'non-trovato': { testo: 'Non su questa pianta', classe: 'mancante' },
    'senza-codice': { testo: 'Numero non indicato', classe: 'mancante' },
  };

  function disegnaElenco() {
    const coperti = stato.gruppi.filter((g) => g.spazi.length);
    const mancanti = stato.gruppi.filter((g) => !g.spazi.length);
    const tvCoperte = coperti.reduce((t, g) => t + g.tv, 0);
    const senzaTesto = !stato.pagine.some((p) => p.testi.length);

    banner.hidden = !senzaTesto && !stato.posiziona;
    if (stato.posiziona) {
      monta(banner,
        h('span', {}, `Clicca sulla pianta dove si trova lo stand di ${stato.posiziona.cliente}`
          + `${stato.posiziona.stand ? ` (${stato.posiziona.stand})` : ''}.`),
        h('button', { class: 'btn btn--mini', onclick: annullaPosizionamento }, 'Annulla'));
      banner.className = 'pianta__banner pianta__banner--azione';
    } else if (senzaTesto && solaLettura) {
      monta(banner, h('span', {},
        'I numeri degli stand non si leggono da soli su questa planimetria: vedi l\'elenco degli stand. '
        + 'Quelli già posizionati dall\'ufficio sono coperti sulla pianta.'));
      banner.className = 'pianta__banner';
    } else if (senzaTesto) {
      monta(banner, h('span', {}, eImmagine
        ? 'Questa planimetria è un\'immagine: i numeri degli stand non si possono leggere da soli. '
          + 'Usa "Posiziona" e clicca lo stand sulla pianta: la posizione resta salvata.'
        : 'Questo PDF non contiene testo leggibile (probabilmente è una scansione). '
          + 'Usa "Posiziona" e clicca lo stand sulla pianta: la posizione resta salvata.'));
      banner.className = 'pianta__banner';
    }

    const voce = (g) => {
      const et = ETICHETTE[g.stato];
      const pagine = [...new Set(g.spazi.map((s) => s.pagina))];
      return h('li', {
        class: `pianta__voce ${stato.evidenziato?.chiave === g.chiave ? 'pianta__voce--evidenziata' : ''}`,
        onclick: () => g.spazi.length && evidenzia(g, true),
      },
      h('div', { class: 'pianta__voce-testa' },
        g.codici.length
          ? h('strong', {}, g.codici.join(' · '))
          : h('span', { class: 'pianta__senza-numero' }, 'Senza numero di stand'),
        h('span', { class: `pianta__stato pianta__stato--${et.classe}` }, et.testo)),
      h('p', { class: 'pianta__cliente' }, g.cliente,
        g.padiglione ? h('span', {}, ` · pad. ${g.padiglione}`) : null,
        stato.pagine.length > 1 && pagine.length ? h('span', {}, ` · pag. ${pagine.join(', ')}`) : null),
      h('p', { class: 'pianta__apparecchi' }, g.apparecchi.join(' · ')),
      solaLettura ? null : h('div', { class: 'pianta__voce-azioni' },
        h('button', {
          class: `btn btn--mini ${g.spazi.length ? '' : 'btn--primario'}`,
          onclick: (e) => { e.stopPropagation(); avviaPosizionamento(g); },
        }, g.spazi.length ? 'Sposta' : 'Posiziona'),
        g.stato === 'manuale' ? h('button', {
          class: 'btn btn--mini',
          title: 'Torna alla posizione trovata nel PDF, se c\'è',
          onclick: async (e) => {
            e.stopPropagation();
            await api.eliminaPosizione(fiera.id, allegato.id, g.chiave);
            manuali.delete(g.chiave);
            ricolloca();
            aggiornaTutto();
          },
        }, 'Ripristina') : null));
    };

    const sullaPagina = stato.segnaposti.length;
    monta(elenco,
      disposizione && !stato.segnaposti.length ? h('p', { class: 'pianta__suggerimento' },
        'Trascina un monitor dall\'elenco a sinistra e lascialo sulla pianta dove va montato: '
        + 'il noleggio si crea e si salva da solo. Se lo lasci sopra uno stand, stand e cliente si compilano da soli.') : null,
      sullaPagina ? h('p', { class: 'pianta__nota' },
        `${numero(sullaPagina)} ${sullaPagina === 1 ? 'apparecchio messo' : 'apparecchi messi'} sulla pianta`
        + (solaLettura ? ': tocca un segnaposto per i dettagli.' : ': trascinali per spostarli, cliccali per aprirli.')) : null,
      h('div', { class: 'pianta__riepilogo' },
        h('p', {}, h('strong', {}, numero(tvCoperte)), ` TV su ${numero(coperti.length)} stand coperti`),
        mancanti.length
          ? h('p', { class: 'pianta__riepilogo-mancanti' },
              `${numero(mancanti.length)} ${mancanti.length === 1 ? 'non trovato' : 'non trovati'} su questa pianta`)
          : h('p', { class: 'pianta__riepilogo-ok' }, 'Tutti gli stand sono sulla pianta.')),
      !stato.gruppi.length ? h('p', { class: 'pianta__attesa' }, 'Nessun noleggio su questa edizione.') : null,
      mancanti.length ? h('h3', {}, 'Non trovati su questa pianta') : null,
      mancanti.length ? h('p', { class: 'pianta__nota' }, solaLettura
        ? 'Possono essere in un padiglione che questa pianta non mostra: guarda le altre planimetrie '
          + 'della fiera o chiedi all\'ufficio.'
        : 'Possono essere in un padiglione che questa pianta non mostra: allega anche la sua, '
          + 'oppure usa "Posiziona" e clicca lo stand.') : null,
      mancanti.length ? h('ul', {}, mancanti.map(voce)) : null,
      coperti.length ? h('h3', {}, 'Sulla pianta') : null,
      coperti.length ? h('ul', {}, coperti.map(voce)) : null);
  }

  function disegnaPaginazione() {
    const tot = stato.pagine.length;
    const pad = padDellaPagina(stato.pagina);
    etichettaPad.hidden = !pad;
    etichettaPad.textContent = pad ? `PAD ${pad}` : '';
    // Se ogni pagina è un padiglione diverso, i bottoni portano il suo numero.
    const pads = stato.pagine.map((_, i) => stato.pagine[i].padiglione);
    const perPadiglione = pads.every(Boolean) && new Set(pads).size === tot;
    // Spesso ogni pagina è un padiglione: con poche pagine, un bottone per
    // ciascuna (col numero di stand e apparecchi sopra), per saltare subito.
    if (tot > 1 && tot <= 12) {
      const sopra = (n) => stato.gruppi.filter((g) => g.spazi.some((sp) => sp.pagina === n)).length
        + stato.segnaposti.filter((sp) => sp.pagina === n).length;
      monta(bottoniPagina, Array.from({ length: tot }, (_, i) => i + 1).map((n) => h('button', {
        class: `btn btn--mini pianta__pagina-bottone ${n === stato.pagina ? 'pianta__pagina-bottone--attiva' : ''}`,
        title: `Pagina ${n}${sopra(n) ? ` · ${sopra(n)} sulla pianta` : ''}`,
        onclick: () => vaiA(n),
      }, perPadiglione ? `PAD ${pads[n - 1]}` : `Pag. ${n}`, sopra(n) ? h('span', { class: 'pianta__pagina-conta' }, sopra(n)) : null)));
      return;
    }
    monta(bottoniPagina, tot > 1 ? [
      h('button', { class: 'btn btn--mini', disabled: stato.pagina <= 1, onclick: () => vaiA(stato.pagina - 1) }, '‹'),
      titoloPagina,
      h('button', { class: 'btn btn--mini', disabled: stato.pagina >= tot, onclick: () => vaiA(stato.pagina + 1) }, '›'),
    ] : []);
    titoloPagina.textContent = `Pagina ${stato.pagina} di ${tot}`;
  }

  function aggiornaTutto() {
    disegnaElenco();
    disegnaPaginazione();
    disegnaCoperture();
  }

  async function vaiA(pagina) {
    stato.pagina = pagina;
    disegnaPaginazione();
    await disegnaPagina();
  }

  async function cambiaZoom(valore) {
    stato.zoom = Math.min(Math.max(valore, 0.4), 6);
    etichettaZoom.textContent = `${Math.round(stato.zoom * 100)}%`;
    await disegnaPagina();
  }

  async function evidenzia(g, scorri) {
    stato.evidenziato = g;
    stato.scelto = null;
    const spazio = g.spazi[0];
    if (spazio && spazio.pagina !== stato.pagina) await vaiA(spazio.pagina);
    aggiornaTutto();
    if (scorri && spazio) {
      // Porta la copertura al centro dell'area visibile.
      area.scrollTo({
        left: (spazio.x + spazio.w / 2) * foglio.clientWidth - area.clientWidth / 2,
        top: (spazio.y + spazio.h / 2) * foglio.clientHeight - area.clientHeight / 2,
        behavior: 'smooth',
      });
    }
  }

  /* ---------- posizionamento a mano ---------- */

  function avviaPosizionamento(g) {
    stato.posiziona = g;
    aggiornaTutto();
  }
  function annullaPosizionamento() {
    stato.posiziona = null;
    aggiornaTutto();
  }

  livello.addEventListener('click', async (e) => {
    if (!stato.posiziona || solaLettura) return;
    const r = livello.getBoundingClientRect();
    const posizione = {
      pagina: stato.pagina,
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    };
    const g = stato.posiziona;
    try {
      await api.salvaPosizione(fiera.id, allegato.id, g.chiave, posizione);
    } catch (err) {
      avviso(err.message, 'errore');
      return;
    }
    manuali.set(g.chiave, { chiave: g.chiave, ...posizione });
    stato.posiziona = null;
    ricolloca();
    stato.evidenziato = stato.gruppi.find((x) => x.chiave === g.chiave) || null;
    aggiornaTutto();
    avviso(`Stand di ${g.cliente} posizionato.`);
  });

  /* ---------- scheda di un apparecchio (popup) ---------- */

  function togliDaiDati(id) {
    dati.segnaposti = (dati.segnaposti || []).filter((x) => x.noleggio_id !== id);
    stato.scelto = null;
    leggiDati();
    ricolloca();
    aggiornaTutto();
  }

  function apriScheda(n, { tieniStand = false } = {}) {
    stato.scelto = n;
    if (!tieniStand) stato.evidenziato = null;
    aggiornaTutto();
    const riga = (etichetta, valore, mancante = '') => h('div', { class: 'scheda-app__riga' },
      h('dt', {}, etichetta),
      h('dd', { class: valore ? '' : 'scheda-app__mancante' }, valore || mancante || '—'));
    let finestra;
    const togli = solaLettura ? null : h('button', {
      class: 'btn btn--mini',
      type: 'button',
      title: 'Il noleggio resta: si toglie solo il punto sulla pianta',
      onclick: async () => {
        await api.togliSegnaposto(n.id);
        togliDaiDati(n.id);
        finestra.chiudi();
        avviso('Tolto dalla pianta: il noleggio resta nell\'elenco.');
        disposizione?.dopo?.();
      },
    }, 'Togli solo dalla pianta');
    const puoModificare = !solaLettura && disposizione?.modifica;
    finestra = modale({
      titolo: nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici }),
      sottotitolo: [idProdotto(n.prodotto_codice), n.prodotto_nome].filter(Boolean).join(' · '),
      corpo: [
        h('dl', { class: 'scheda-app' },
          riga('Cliente', n.cliente, 'da indicare'),
          riga('Stand', [n.padiglione ? `Pad. ${n.padiglione}` : null, n.stand].filter(Boolean).join(' · '), 'da indicare'),
          riga('Montaggio', n.montaggio ? etichettaMontaggio(n.montaggio) : '', 'da definire'),
          n.note_tecnico ? riga('Note per il tecnico', n.note_tecnico) : null,
          riga('Date', intervalloDate(n.data_inizio, n.data_fine)),
          h('div', { class: 'scheda-app__riga' }, h('dt', {}, 'Stato'), h('dd', {}, badge(n.stato)))),
        togli ? h('div', { class: 'scheda-app__altro' }, togli) : null,
      ],
      testoConferma: puoModificare ? (n.cliente && n.stand ? 'Modifica noleggio' : 'Completa il noleggio') : 'Chiudi',
      soloChiudi: !puoModificare,
      onConferma: async () => { if (puoModificare) disposizione.modifica(n); },
      azionePericolosa: solaLettura ? null : {
        testo: 'Elimina',
        testoConferma: 'Clicca ancora per eliminare',
        onClick: async () => {
          await api.eliminaNoleggio(n.id);
          dati.noleggi = dati.noleggi.filter((x) => x.id !== n.id);
          togliDaiDati(n.id);
          avviso(`${etichettaSegnaposto(n)} eliminato: il noleggio non c'è più.`);
          disposizione?.dopo?.();
        },
      },
    });
  }

  /** Popup di uno stand: i monitor che ci vanno, ognuno apribile nei suoi dettagli. */
  function apriStand(g) {
    let finestra;
    const voce = (n) => h('li', {},
      h('button', {
        type: 'button',
        class: 'stand-app',
        onclick: () => { finestra.chiudi(); apriScheda(n); },
      },
      h('span', { class: 'stand-app__nome' },
        h('strong', {}, `${n.quantita > 1 ? `${n.quantita}× ` : ''}${nomeBreve({ nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici })}`),
        h('span', {}, [idProdotto(n.prodotto_codice), n.montaggio ? etichettaMontaggio(n.montaggio) : 'montaggio da definire',
          n.note_tecnico].filter(Boolean).join(' · '))),
      badge(n.stato),
      h('span', { class: 'stand-app__vai', 'aria-hidden': 'true' }, '›')));
    finestra = modale({
      titolo: g.stand ? `Stand ${g.stand}` : 'Stand senza numero',
      sottotitolo: [g.cliente, g.padiglione ? `Pad. ${g.padiglione}` : null,
        contenutoStand(g)].filter(Boolean).join(' · '),
      corpo: [
        h('ul', { class: 'stand-app__elenco' }, g.noleggi.map(voce)),
        h('p', { class: 'campo__aiuto' }, solaLettura
          ? 'Tocca un apparecchio per vederne i dettagli.'
          : 'Clicca un apparecchio per i dettagli, per modificarlo o eliminarlo.'),
      ],
      testoConferma: 'Chiudi',
      soloChiudi: true,
      onConferma: async () => {},
    });
  }

  /* ---------- segnaposti e trascinamento ---------- */

  /** Punto della pianta sotto il puntatore, in frazioni della pagina; null se fuori. */
  function puntoSullaPianta(e) {
    const r = livello.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    // Il punto deve anche essere nella parte visibile dell'area, non sotto una barra.
    const a = area.getBoundingClientRect();
    if (e.clientX < a.left || e.clientX > a.right || e.clientY < a.top || e.clientY > a.bottom) return null;
    return { pagina: stato.pagina, x, y };
  }

  /** Lo stand sotto un punto: prima uno già coperto (con il suo cliente), poi un numero letto dal PDF. */
  function standNelPunto({ pagina, x, y }) {
    const dentro = (s) => s.pagina === pagina && s.x <= x && x <= s.x + s.w && s.y <= y && y <= s.y + s.h;
    const coperti = stato.gruppi
      .flatMap((g) => g.spazi.filter(dentro).map((s) => ({ g, area: s.w * s.h })))
      .sort((a, b) => a.area - b.area);
    if (coperti.length) {
      const { g } = coperti[0];
      return { cliente: g.cliente === 'Cliente non indicato' ? '' : g.cliente, stand: g.stand, padiglione: g.padiglione || '' };
    }
    const p = stato.pagine[pagina - 1];
    const numeri = (p?.testi || [])
      .map((t) => ({ t, s: { pagina, ...spazioDelNumero(t.box, p.riquadri) } }))
      .filter(({ s }) => dentro(s))
      .sort((a, b) => a.s.w * a.s.h - b.s.w * b.s.h);
    if (numeri.length) {
      const { t } = numeri[0];
      return {
        cliente: '',
        stand: t.testo.length <= 24 ? t.testo : t.codici.join(' '),
        padiglione: padiglione(t.testo) || '',
      };
    }
    return { cliente: '', stand: '', padiglione: '' };
  }

  async function ricaricaDati() {
    dati = await caricaDati();
    leggiDati();
    ricolloca();
    aggiornaTutto();
  }

  /**
   * Trascinamento con il puntatore (mouse, dito o penna): funziona uguale su
   * computer e tablet, dove il drag and drop nativo del browser non c'è.
   */
  function trascina(e, { fantasma, suMuovi = () => {}, suRilascio, suClic = () => {} }) {
    const inizio = { x: e.clientX, y: e.clientY };
    let avviato = false;
    const muovi = (ev) => {
      if (!avviato && Math.hypot(ev.clientX - inizio.x, ev.clientY - inizio.y) < SOGLIA_TRASCINAMENTO) return;
      if (!avviato) {
        avviato = true;
        document.body.appendChild(fantasma);
        radice.classList.add('pianta--trascina');
      }
      ev.preventDefault();
      fantasma.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px)`;
      const punto = puntoSullaPianta(ev);
      livello.classList.toggle('pianta__livello--rilascio', Boolean(punto));
      suMuovi(ev, punto);
    };
    const fine = async (ev) => {
      document.removeEventListener('pointermove', muovi);
      document.removeEventListener('pointerup', fine);
      document.removeEventListener('pointercancel', annulla);
      fantasma.remove();
      radice.classList.remove('pianta--trascina');
      livello.classList.remove('pianta__livello--rilascio');
      if (!avviato) { suClic(); return; }
      const punto = puntoSullaPianta(ev);
      if (punto) await suRilascio(punto);
    };
    const annulla = () => {
      document.removeEventListener('pointermove', muovi);
      document.removeEventListener('pointerup', fine);
      document.removeEventListener('pointercancel', annulla);
      fantasma.remove();
      radice.classList.remove('pianta--trascina');
      livello.classList.remove('pianta__livello--rilascio');
    };
    document.addEventListener('pointermove', muovi);
    document.addEventListener('pointerup', fine);
    document.addEventListener('pointercancel', annulla);
  }

  // Clic (o tocco) su un segnaposto: i dettagli nell'elenco. Trascinandolo, si sposta.
  livello.addEventListener('pointerdown', (e) => {
    const bottone = e.target.closest('.pianta__segnaposto');
    if (!bottone || stato.posiziona) return;
    const n = noleggiPerId.get(Number(bottone.dataset.noleggio));
    if (!n) return;
    const scegli = () => apriScheda(n);
    if (solaLettura) { scegli(); return; }
    e.preventDefault();
    trascina(e, {
      fantasma: h('div', { class: 'pianta__fantasma pianta__fantasma--segnaposto' }, etichettaSegnaposto(n)),
      suClic: scegli,
      suRilascio: async (punto) => {
        try {
          await api.spostaSegnaposto(n.id, { allegato_id: allegato.id, ...punto });
        } catch (err) {
          avviso(err.message, 'errore');
          return;
        }
        const sp = (dati.segnaposti || []).find((x) => x.noleggio_id === n.id);
        Object.assign(sp, punto);
        stato.scelto = n;
        leggiDati();
        aggiornaTutto();
        avviso(`${etichettaSegnaposto(n)} spostato.`);
        disposizione?.dopo?.();
      },
    });
  });

  // Colonna del tecnico: toccando un monitor lo si trova sulla pianta e se ne aprono i dettagli.
  colonnaSinistra?.addEventListener('click', async (e) => {
    const voce = e.target.closest('[data-noleggio]');
    const n = voce && noleggiPerId.get(Number(voce.dataset.noleggio));
    if (!n) return;
    const sp = stato.segnaposti.find((x) => x.noleggio_id === n.id);
    const g = stato.gruppi.find((x) => x.spazi.length && x.noleggi.some((y) => y.id === n.id));
    if (sp) {
      if (sp.pagina !== stato.pagina) await vaiA(sp.pagina);
      area.scrollTo({
        left: sp.x * foglio.clientWidth - area.clientWidth / 2,
        top: sp.y * foglio.clientHeight - area.clientHeight / 2,
        behavior: 'smooth',
      });
      apriScheda(n);
    } else if (g) {
      await evidenzia(g, true);
      apriScheda(n, { tieniStand: true });
    } else {
      apriScheda(n);
    }
  });

  // Dall'elenco degli apparecchi liberi alla pianta: nasce il noleggio.
  // Un clic (o un tocco) senza trascinare apre invece i dettagli dell'apparecchio.
  if (disposizione?.dettagli) {
    disposizione.lato.addEventListener('click', (e) => {
      const voce = e.target.closest('[data-prodotto]');
      if (voce) disposizione.dettagli(Number(voce.dataset.prodotto));
    });
  }
  if (disposizione) {
    disposizione.lato.addEventListener('pointerdown', (e) => {
      const voce = e.target.closest('[data-prodotto]');
      if (!voce || e.button > 0) return;
      // Col dito si trascina dalla maniglia, così l'elenco si può ancora scorrere.
      if (e.pointerType !== 'mouse' && !e.target.closest('.tav-maniglia')) return;
      e.preventDefault();
      const etichetta = voce.dataset.etichetta || 'Apparecchio';
      trascina(e, {
        fantasma: h('div', { class: 'pianta__fantasma' }, etichetta),
        suRilascio: async (punto) => {
          const posto = standNelPunto(punto);
          let noleggio;
          try {
            noleggio = await disposizione.crea({ prodotto_id: Number(voce.dataset.prodotto), ...punto, ...posto });
          } catch (err) {
            avviso(err.message, 'errore');
            return;
          }
          await ricaricaDati();
          stato.scelto = noleggiPerId.get(noleggio.id) || null;
          aggiornaTutto();
          avviso(posto.stand
            ? `${etichetta} messo sullo stand ${posto.stand}${posto.cliente ? ` (${posto.cliente})` : ''}.`
            : `${etichetta} messo sulla pianta. Stand non riconosciuto: completalo dai dettagli a destra.`);
          disposizione.dopo?.();
        },
      });
    });
  }

  /* ---------- esportazione ---------- */

  async function immagineConCoperture() {
    const proporzione = stato.pagine[stato.pagina - 1].proporzione;
    const larghezza = Math.min(3200, LATO_MASSIMO_CANVAS);
    const altezza = Math.round(larghezza / proporzione);
    const c = document.createElement('canvas');
    c.width = larghezza;
    c.height = altezza;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, larghezza, altezza);
    if (stato.immagine) {
      ctx.drawImage(stato.immagine, 0, 0, larghezza, altezza);
    } else {
      const pagina = await stato.documento.getPage(stato.pagina);
      const base = pagina.getViewport({ scale: 1 });
      await pagina.render({ canvasContext: ctx, viewport: pagina.getViewport({ scale: larghezza / base.width }) }).promise;
    }
    // Le stesse coperture che si vedono a schermo.
    const carattere = Math.max(14, Math.round(larghezza / 110));
    for (const g of stato.gruppi) {
      g.spazi.filter((s) => s.pagina === stato.pagina).forEach((s, i) => {
        const [x, y, w, hh] = [s.x * larghezza, s.y * altezza, s.w * larghezza, s.h * altezza];
        ctx.fillStyle = 'rgba(234, 88, 12, 0.32)';
        ctx.fillRect(x, y, w, hh);
        ctx.lineWidth = Math.max(2, larghezza / 900);
        ctx.strokeStyle = 'rgb(234, 88, 12)';
        ctx.strokeRect(x, y, w, hh);
        if (i === 0) {
          const testo = `${contenutoStand(g)} ${g.cliente}`;
          ctx.font = `bold ${carattere}px sans-serif`;
          const tw = ctx.measureText(testo).width + carattere * 0.8;
          // Come a schermo: l'etichetta non deve uscire dall'immagine.
          const ex = Math.min(Math.max(x, 0), larghezza - tw);
          const ey = y - carattere * 1.5 < 0 ? y + hh : y - carattere * 1.5;
          ctx.fillStyle = 'rgb(194, 65, 12)';
          ctx.fillRect(ex, ey, tw, carattere * 1.5);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(testo, ex + carattere * 0.4, ey + carattere * 1.1);
        }
      });
    }
    // E i segnaposti, uguali a quelli a schermo.
    for (const sp of stato.segnaposti.filter((x) => x.pagina === stato.pagina)) {
      const n = noleggiPerId.get(sp.noleggio_id);
      const [x, y] = [sp.x * larghezza, sp.y * altezza];
      const raggio = Math.max(7, larghezza / 260);
      ctx.beginPath();
      ctx.arc(x, y, raggio, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(79, 70, 229)';
      ctx.fill();
      ctx.lineWidth = raggio / 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      const testo = etichettaSegnaposto(n);
      ctx.font = `bold ${carattere}px sans-serif`;
      const tw = ctx.measureText(testo).width + carattere * 0.8;
      const ex = Math.min(x + raggio * 1.4, larghezza - tw);
      ctx.fillStyle = 'rgb(55, 48, 163)';
      ctx.fillRect(ex, y - carattere * 0.75, tw, carattere * 1.5);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(testo, ex + carattere * 0.4, y + carattere * 0.35);
    }
    return c.toDataURL('image/png');
  }

  async function esporta(modo) {
    const nome = `${fiera.nome} - pianta con TV${stato.pagine.length > 1 ? ` - pag ${stato.pagina}` : ''}.png`;
    avviso('Preparo l\'immagine…');
    const dati = await immagineConCoperture();
    if (modo === 'scarica') {
      const a = h('a', { href: dati, download: nome });
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const finestra = window.open('', '_blank');
    if (!finestra) {
      avviso('Il browser ha bloccato la finestra di stampa: usa "Scarica PNG".', 'attenzione');
      return;
    }
    finestra.document.title = nome;
    const stile = finestra.document.createElement('style');
    stile.textContent = '@page{size:landscape;margin:8mm}body{margin:0}img{width:100%;display:block}';
    const img = finestra.document.createElement('img');
    img.src = dati;
    img.onload = () => { finestra.focus(); finestra.print(); };
    finestra.document.head.appendChild(stile);
    finestra.document.body.appendChild(img);
  }

  /* ---------- avvio ---------- */

  let attesaRidimensiona;
  const suRidimensiona = () => {
    // Incorporata, la pianta sparisce quando si cambia pagina: si smette di ascoltare.
    if (!radice.isConnected) { chiudi(); return; }
    clearTimeout(attesaRidimensiona);
    attesaRidimensiona = setTimeout(disegnaPagina, 150);
  };
  window.addEventListener('resize', suRidimensiona);

  aggiornaTutto();
  await disegnaPagina();
  if (richiesto) evidenzia(richiesto, true);
  // Le TV che stanno su questa planimetria: negli stand trovati o messe a mano, senza contarle due volte.
  const tvSullaPianta = () => {
    const ids = new Set(stato.segnaposti.map((sp) => sp.noleggio_id));
    for (const g of stato.gruppi) if (g.spazi.length) g.noleggi.forEach((n) => ids.add(n.id));
    return [...ids].map((id) => noleggiPerId.get(id))
      .filter((n) => n && SCHERMI.includes(n.prodotto_categoria))
      .reduce((t, n) => t + n.quantita, 0);
  };
  return { ricarica: ricaricaDati, padiglione: padDellaPagina(stato.pagina), tvSullaPianta };
}
