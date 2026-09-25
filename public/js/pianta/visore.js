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

import { api } from '../api.js';
import { h, monta, svuota, avviso, numero, nomeBreve, idProdotto } from '../ui.js';
import { codiciStand, padiglione } from './stand.js';
import { analizzaPagina, collocaStand } from './analisi.js';

const PDFJS = '/vendor/pdfjs/pdf.min.mjs';
const PDFJS_WORKER = '/vendor/pdfjs/pdf.worker.min.mjs';
// Oltre questa dimensione il browser rifiuta i canvas: si ingrandisce via CSS.
const LATO_MASSIMO_CANVAS = 8000;
// Dimensione di uno stand messo a mano, se non ce ne sono altri da imitare.
const SPAZIO_MANUALE = { w: 0.05, h: 0.05 };

let pdfjsCaricato = null;
function caricaPdfjs() {
  // Si scarica solo la prima volta che si apre una pianta in PDF.
  pdfjsCaricato ||= import(PDFJS).then((modulo) => {
    modulo.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return modulo;
  });
  return pdfjsCaricato;
}

/** I noleggi dell'edizione raggruppati per cliente e stand: un gruppo = una copertura. */
function gruppiDaNoleggi(noleggi) {
  const gruppi = new Map();
  for (const n of noleggi) {
    if (n.stato === 'annullato') continue;
    const chiaveGruppo = `${(n.cliente || '').toLowerCase()}|${(n.stand || '').toLowerCase()}`;
    if (!gruppi.has(chiaveGruppo)) {
      const codici = codiciStand(n.stand);
      gruppi.set(chiaveGruppo, {
        cliente: n.cliente || 'Cliente non indicato',
        stand: n.stand || '',
        padiglione: padiglione(n.stand),
        codici,
        // Chiave con cui si salva la posizione messa a mano.
        chiave: codici[0] || `cliente:${(n.cliente || n.stand || n.id).toString().toLowerCase()}`,
        apparecchi: [],
        tv: 0,
      });
    }
    const g = gruppi.get(chiaveGruppo);
    g.tv += n.quantita;
    g.apparecchi.push(`${n.quantita > 1 ? `${n.quantita}× ` : ''}${nomeBreve({
      nome: n.prodotto_nome, marca: n.prodotto_marca, pollici: n.prodotto_pollici,
    })}${n.prodotto_codice ? ` ${idProdotto(n.prodotto_codice)}` : ''}`);
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
]).then(([dettaglio, posizioni]) => ({ noleggi: dettaglio.noleggi, posizioni }));

/**
 * @param {object} o
 * @param {object} o.fiera        l'edizione ({ id, nome })
 * @param {object} o.allegato     la planimetria ({ id, nome, tipo, url })
 * @param {boolean} [o.solaLettura] niente "Posiziona", "Sposta", "Ripristina"
 * @param {Function} [o.caricaDati] () => Promise<{ noleggi, posizioni }>
 * @param {string} [o.stand]      stand da mettere in evidenza all'apertura
 */
export async function apriPianta({
  fiera, allegato, solaLettura = false, caricaDati = () => datiDaAmministratore(fiera, allegato), stand = '',
}) {
  const radice = h('div', { class: 'pianta', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pianta con TV' });
  document.body.appendChild(radice);
  document.body.classList.add('pianta-aperta');

  const stato = {
    pagina: 1,
    pagine: [],          // analisi di ogni pagina (vuota per le immagini)
    documento: null,     // pdf.js, se PDF
    immagine: null,      // elemento <img>, se immagine
    zoom: 1,
    gruppi: [],
    posiziona: null,     // gruppo in attesa di un clic sulla pianta
    evidenziato: null,
  };

  const chiudi = () => {
    document.removeEventListener('keydown', suTasto, true);
    window.removeEventListener('resize', suRidimensiona);
    document.body.classList.remove('pianta-aperta');
    radice.remove();
  };
  // In cattura e fermando la propagazione: Esc deve chiudere solo il visore,
  // non anche la finestra da cui lo si è aperto.
  const suTasto = (e) => {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    if (stato.posiziona) annullaPosizionamento();
    else chiudi();
  };
  document.addEventListener('keydown', suTasto, true);

  /* ---------- struttura ---------- */

  const titoloPagina = h('span', { class: 'pianta__pagina' });
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
      h('button', { class: 'btn btn--fantasma pianta__chiudi', onclick: chiudi }, '← Chiudi'),
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
          h('button', { class: 'btn btn--mini', onclick: () => esporta('stampa') }, 'Stampa')))),
    h('div', { class: 'pianta__corpo' },
      h('div', { class: 'pianta__vista' }, banner, area),
      h('aside', { class: 'pianta__lato' }, elenco)));

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
  const gruppiBase = gruppiDaNoleggi(dati.noleggi);
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
          class: `pianta__copertura pianta__copertura--${s.tipo} ${aDestra} ${stato.evidenziato === g ? 'pianta__copertura--evidenziata' : ''}`,
          style: { left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` },
          title: `${g.cliente}${g.stand ? ` · stand ${g.stand}` : ''}\n${g.apparecchi.join('\n')}`,
          onclick: (e) => { e.stopPropagation(); evidenzia(g, false); },
        },
        // L'etichetta solo sulla prima copertura del gruppo (es. 5017 e 5018 sono uno stand solo).
        i === 0 ? h('span', { class: 'pianta__etichetta' },
          h('strong', {}, `${g.tv} TV`), ` ${g.cliente}`) : null);
        livello.appendChild(copertura);
      });
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
        class: `pianta__voce ${stato.evidenziato === g ? 'pianta__voce--evidenziata' : ''}`,
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

    monta(elenco,
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
          const testo = `${g.tv} TV ${g.cliente}`;
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
    clearTimeout(attesaRidimensiona);
    attesaRidimensiona = setTimeout(disegnaPagina, 150);
  };
  window.addEventListener('resize', suRidimensiona);

  aggiornaTutto();
  await disegnaPagina();
  if (richiesto) evidenzia(richiesto, true);
}
