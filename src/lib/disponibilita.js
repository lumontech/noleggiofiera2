// Motore di disponibilità: calcola quanti pezzi di ogni prodotto sono impegnati
// in un periodo e quanti restano liberi. È il cuore della piattaforma.

import db from './db.js';
import { STATI_IMPEGNATIVI, addGiorni, giorniTra, ORDINE_PER_ID } from './domain.js';

const PLACEHOLDER_STATI = STATI_IMPEGNATIVI.map(() => '?').join(',');

/**
 * Righe di noleggio che occupano magazzino e che intersecano il periodo dato.
 * @param {object} opzioni
 * @param {string} opzioni.from  data inizio periodo (AAAA-MM-GG)
 * @param {string} opzioni.to    data fine periodo (AAAA-MM-GG)
 * @param {number} [opzioni.prodottoId] limita a un prodotto
 * @param {number} [opzioni.escludiNoleggio] ignora un noleggio (utile in modifica)
 */
export function noleggiImpegnativi({ from, to, prodottoId = null, escludiNoleggio = null }) {
  const parametri = [...STATI_IMPEGNATIVI, to, from];
  let sql = `
    SELECT n.*, p.nome AS prodotto_nome, p.quantita AS prodotto_quantita,
           f.nome AS fiera_nome, f.citta AS fiera_citta
      FROM noleggi n
      JOIN prodotti p ON p.id = n.prodotto_id
      JOIN fiere    f ON f.id = n.fiera_id
     WHERE n.stato IN (${PLACEHOLDER_STATI})
       AND n.data_inizio <= ?
       AND n.data_fine   >= ?`;
  if (prodottoId !== null) {
    sql += ' AND n.prodotto_id = ?';
    parametri.push(prodottoId);
  }
  if (escludiNoleggio !== null) {
    sql += ' AND n.id != ?';
    parametri.push(escludiNoleggio);
  }
  sql += ' ORDER BY n.data_inizio ASC, n.id ASC';
  return db.prepare(sql).all(...parametri);
}

/**
 * Dato un insieme di righe di noleggio, il massimo di pezzi impegnati in uno
 * stesso giorno del periodo, e quale giorno è.
 */
function piccoGiornaliero(righe, from, to) {
  let picco = 0;
  let giornoPicco = null;
  for (let giorno = from; giorno <= to; giorno = addGiorni(giorno, 1)) {
    let impegno = 0;
    for (const r of righe) {
      if (r.data_inizio <= giorno && r.data_fine >= giorno) impegno += r.quantita;
    }
    if (impegno > picco) {
      picco = impegno;
      giornoPicco = giorno;
    }
  }
  return { picco, giornoPicco };
}

/**
 * Picco massimo di pezzi impegnati per un prodotto nel periodo.
 * Non basta sommare i noleggi: due noleggi consecutivi non si sommano.
 * Si scorrono i giorni del periodo e si prende il massimo impegno giornaliero.
 */
export function impegnoMassimo({ prodottoId, from, to, escludiNoleggio = null }) {
  const righe = noleggiImpegnativi({ from, to, prodottoId, escludiNoleggio });
  return { ...piccoGiornaliero(righe, from, to), righe };
}

/**
 * Verifica che aggiungere `quantita` pezzi nel periodo non superi lo stock.
 * Restituisce { ok, disponibili, picco, giornoPicco }.
 */
export function verificaCapienza({ prodotto, quantita, from, to, escludiNoleggio = null }) {
  const { picco, giornoPicco } = impegnoMassimo({
    prodottoId: prodotto.id,
    from,
    to,
    escludiNoleggio,
  });
  const disponibili = prodotto.quantita - picco;
  return { ok: quantita <= disponibili, disponibili, picco, giornoPicco };
}

/**
 * Fotografia completa del magazzino in un periodo: per ogni prodotto quanti
 * pezzi sono impegnati, quanti liberi e su quali fiere sono allocati.
 */
export function prospettoDisponibilita({ from, to, categoria = null, soloAttivi = true }) {
  let sql = 'SELECT * FROM prodotti';
  const condizioni = [];
  const parametri = [];
  if (soloAttivi) condizioni.push("stato != 'dismesso'");
  if (categoria) {
    condizioni.push('categoria = ?');
    parametri.push(categoria);
  }
  if (condizioni.length) sql += ` WHERE ${condizioni.join(' AND ')}`;
  sql += ` ORDER BY ${ORDINE_PER_ID}`;

  const prodotti = db.prepare(sql).all(...parametri);
  const tutteLeRighe = noleggiImpegnativi({ from, to });
  const perProdotto = new Map();
  for (const riga of tutteLeRighe) {
    if (!perProdotto.has(riga.prodotto_id)) perProdotto.set(riga.prodotto_id, []);
    perProdotto.get(riga.prodotto_id).push(riga);
  }

  return prodotti.map((prodotto) => {
    const righe = perProdotto.get(prodotto.id) || [];
    const { picco, giornoPicco } = piccoGiornaliero(righe, from, to);
    const inManutenzione = prodotto.stato === 'manutenzione';
    const disponibili = inManutenzione ? 0 : Math.max(prodotto.quantita - picco, 0);
    return {
      prodotto,
      impegnati: picco,
      giorno_picco: giornoPicco,
      disponibili,
      sovra_impegno: Math.max(picco - prodotto.quantita, 0),
      noleggi: righe.map((r) => ({
        id: r.id,
        fiera_id: r.fiera_id,
        fiera_nome: r.fiera_nome,
        fiera_citta: r.fiera_citta,
        quantita: r.quantita,
        data_inizio: r.data_inizio,
        data_fine: r.data_fine,
        stato: r.stato,
        giorni: giorniTra(r.data_inizio, r.data_fine),
      })),
    };
  });
}

/**
 * Ogni apparecchio noleggiabile con quanti pezzi restano liberi nel periodo e,
 * per quelli occupati, a chi sono già assegnati. Serve al modulo di noleggio
 * per proporre solo ciò che si può davvero noleggiare in quelle date.
 */
export function apparecchiPerPeriodo({ from, to, escludiNoleggio = null }) {
  const prodotti = db.prepare(`
    SELECT * FROM prodotti WHERE stato != 'dismesso' ORDER BY ${ORDINE_PER_ID}`).all();
  const righe = noleggiImpegnativi({ from, to, escludiNoleggio });

  return prodotti.map((prodotto) => {
    const proprie = righe.filter((r) => r.prodotto_id === prodotto.id);
    const { picco } = piccoGiornaliero(proprie, from, to);
    const inManutenzione = prodotto.stato === 'manutenzione';
    return {
      id: prodotto.id,
      nome: prodotto.nome,
      marca: prodotto.marca,
      pollici: prodotto.pollici,
      codice: prodotto.codice,
      categoria: prodotto.categoria,
      quantita: prodotto.quantita,
      stato: prodotto.stato,
      liberi: inManutenzione ? 0 : Math.max(prodotto.quantita - picco, 0),
      occupato_da: proprie.map((r) => ({
        cliente: r.cliente,
        stand: r.stand,
        fiera_nome: r.fiera_nome,
        data_inizio: r.data_inizio,
        data_fine: r.data_fine,
      })),
    };
  });
}
