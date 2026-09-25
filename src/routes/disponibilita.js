import { Router } from 'express';
import db from '../lib/db.js';
import {
  CATEGORIE, STATI_PRODOTTO, STATI_FIERA, STATI_NOLEGGIO,
  oggi, addGiorni, giorniTra, isData,
  ORDINE_PER_ID,
} from '../lib/domain.js';
import { prospettoDisponibilita, noleggiImpegnativi, apparecchiPerPeriodo } from '../lib/disponibilita.js';

const router = Router();

function intervallo(req, giorniPredefiniti = 0) {
  const from = isData(req.query.from) ? req.query.from : oggi();
  const to = isData(req.query.to) ? req.query.to : addGiorni(from, giorniPredefiniti);
  return { from, to: to < from ? from : to };
}

// Elenco valori ammessi: alimenta le select del front-end senza duplicare costanti.
router.get('/costanti', (_req, res) => {
  res.json({
    categorie: CATEGORIE,
    stati_prodotto: STATI_PRODOTTO,
    stati_fiera: STATI_FIERA,
    stati_noleggio: STATI_NOLEGGIO,
    oggi: oggi(),
  });
});

/**
 * Prospetto "da noleggiare vs noleggiati" su un periodo.
 * Restituisce due liste già separate, più i totali.
 */
router.get('/', (req, res) => {
  const { from, to } = intervallo(req, 0);
  const categoria = CATEGORIE.includes(req.query.categoria) ? req.query.categoria : null;
  const prospetto = prospettoDisponibilita({ from, to, categoria });

  const disponibili = prospetto.filter((r) => r.disponibili > 0);
  const occupati = prospetto.filter((r) => r.impegnati > 0);

  const totali = prospetto.reduce((acc, r) => ({
    pezzi: acc.pezzi + r.prodotto.quantita,
    impegnati: acc.impegnati + r.impegnati,
    disponibili: acc.disponibili + r.disponibili,
  }), { pezzi: 0, impegnati: 0, disponibili: 0 });

  res.json({
    periodo: { from, to, giorni: giorniTra(from, to) },
    totali,
    disponibili,
    occupati,
    prospetto,
  });
});

/**
 * Apparecchi liberi e occupati in un periodo, per il modulo di noleggio.
 * `escludi` è il noleggio in modifica: non deve occupare sé stesso.
 */
router.get('/apparecchi', (req, res) => {
  const { from, to } = intervallo(req, 0);
  const escludi = Number.isInteger(Number(req.query.escludi)) && req.query.escludi
    ? Number(req.query.escludi) : null;
  res.json(apparecchiPerPeriodo({ from, to, escludiNoleggio: escludi }));
});

/**
 * Timeline (stile Gantt) dell'occupazione, un blocco per noleggio.
 */
router.get('/timeline', (req, res) => {
  const { from, to } = intervallo(req, 44);
  const righe = noleggiImpegnativi({ from, to });
  const prodotti = db.prepare(`SELECT * FROM prodotti WHERE stato != 'dismesso' ORDER BY ${ORDINE_PER_ID}`).all();

  res.json({
    periodo: { from, to, giorni: giorniTra(from, to) },
    prodotti: prodotti.map((prodotto) => ({
      id: prodotto.id,
      nome: prodotto.nome,
      categoria: prodotto.categoria,
      pollici: prodotto.pollici,
      quantita: prodotto.quantita,
      stato: prodotto.stato,
      blocchi: righe
        .filter((r) => r.prodotto_id === prodotto.id)
        .map((r) => ({
          id: r.id,
          fiera_id: r.fiera_id,
          fiera_nome: r.fiera_nome,
          quantita: r.quantita,
          stato: r.stato,
          data_inizio: r.data_inizio,
          data_fine: r.data_fine,
        })),
    })),
  });
});

/** Cruscotto iniziale: numeri chiave, prossime fiere, avvisi. */
router.get('/dashboard', (_req, res) => {
  const giorno = oggi();
  const fra30 = addGiorni(giorno, 30);
  const prospettoOggi = prospettoDisponibilita({ from: giorno, to: giorno });

  const totali = prospettoOggi.reduce((acc, r) => ({
    pezzi: acc.pezzi + r.prodotto.quantita,
    impegnati: acc.impegnati + r.impegnati,
    disponibili: acc.disponibili + r.disponibili,
  }), { pezzi: 0, impegnati: 0, disponibili: 0 });

  const inManutenzione = db.prepare(
    "SELECT COALESCE(SUM(quantita),0) AS n FROM prodotti WHERE stato = 'manutenzione'").get().n;

  const prossimeFiere = db.prepare(`
    SELECT f.*,
           (SELECT COALESCE(SUM(n.quantita),0) FROM noleggi n
             WHERE n.fiera_id = f.id AND n.stato != 'annullato') AS pezzi
      FROM fiere f
     WHERE f.data_fine >= ? AND f.stato != 'annullata'
     ORDER BY f.data_inizio ASC LIMIT 6`).all(giorno);

  const inCorso = db.prepare(`
    SELECT COUNT(*) AS n FROM fiere
     WHERE data_inizio <= ? AND data_fine >= ? AND stato != 'annullata'`).get(giorno, giorno).n;

  const consegneImminenti = db.prepare(`
    SELECT n.*, p.nome AS prodotto_nome, f.nome AS fiera_nome, f.citta AS fiera_citta
      FROM noleggi n
      JOIN prodotti p ON p.id = n.prodotto_id
      JOIN fiere    f ON f.id = n.fiera_id
     WHERE n.stato = 'prenotato' AND n.data_inizio BETWEEN ? AND ?
     ORDER BY n.data_inizio ASC LIMIT 8`).all(giorno, addGiorni(giorno, 14));

  const rientriAttesi = db.prepare(`
    SELECT n.*, p.nome AS prodotto_nome, f.nome AS fiera_nome
      FROM noleggi n
      JOIN prodotti p ON p.id = n.prodotto_id
      JOIN fiere    f ON f.id = n.fiera_id
     WHERE n.stato = 'consegnato' AND n.data_fine < ?
     ORDER BY n.data_fine ASC LIMIT 8`).all(giorno);

  // Sovra-impegni: prodotti prenotati oltre lo stock nei prossimi 30 giorni.
  const criticita = prospettoDisponibilita({ from: giorno, to: fra30 })
    .filter((r) => r.sovra_impegno > 0)
    .map((r) => ({
      prodotto: r.prodotto.nome,
      quantita: r.prodotto.quantita,
      impegnati: r.impegnati,
      giorno: r.giorno_picco,
    }));

  // Soldi: quanto è costato il parco e quanto hanno reso i noleggi.
  const tondo = (n) => Math.round((n || 0) * 100) / 100;
  const speso = db.prepare(
    'SELECT COALESCE(SUM(costo_acquisto * quantita), 0) AS euro, COALESCE(SUM(quantita), 0) AS pezzi FROM prodotti').get();
  const ricavi = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN data_fine <  ? THEN importo END), 0) AS fatti,
           COALESCE(SUM(CASE WHEN data_fine >= ? THEN importo END), 0) AS in_arrivo,
           COUNT(CASE WHEN data_fine < ? THEN 1 END) AS lavori_fatti,
           COUNT(CASE WHEN data_fine >= ? THEN 1 END) AS lavori_in_arrivo
      FROM noleggi WHERE stato != 'annullato'`).get(giorno, giorno, giorno, giorno);
  const perAnno = db.prepare(`
    SELECT substr(data_inizio, 1, 4) AS anno, COALESCE(SUM(importo), 0) AS ricavi, COUNT(*) AS noleggi
      FROM noleggi WHERE stato != 'annullato' GROUP BY anno ORDER BY anno`).all();
  const economia = {
    speso: tondo(speso.euro),
    pezzi_acquistati: speso.pezzi,
    guadagnato: tondo(ricavi.fatti),
    in_arrivo: tondo(ricavi.in_arrivo),
    lavori_fatti: ricavi.lavori_fatti,
    lavori_in_arrivo: ricavi.lavori_in_arrivo,
    bilancio: tondo(ricavi.fatti + ricavi.in_arrivo - speso.euro),
    per_anno: perAnno.map((r) => ({ ...r, ricavi: tondo(r.ricavi) })),
  };

  res.json({
    oggi: giorno,
    economia,
    totali: { ...totali, manutenzione: inManutenzione },
    prodotti_totali: prospettoOggi.length,
    fiere_in_corso: inCorso,
    fiere_totali: db.prepare('SELECT COUNT(*) AS n FROM fiere').get().n,
    noleggi_attivi: db.prepare(
      "SELECT COUNT(*) AS n FROM noleggi WHERE stato IN ('prenotato','consegnato')").get().n,
    prossime_fiere: prossimeFiere.map((f) => ({
      ...f,
      durata_giorni: giorniTra(f.data_inizio, f.data_fine),
      giorni_mancanti: Math.round(
        (new Date(`${f.data_inizio}T00:00:00Z`) - new Date(`${giorno}T00:00:00Z`)) / 86400000),
    })),
    consegne_imminenti: consegneImminenti,
    rientri_attesi: rientriAttesi,
    criticita,
  });
});

export default router;
