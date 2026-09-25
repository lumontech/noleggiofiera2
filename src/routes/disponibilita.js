import { Router } from 'express';
import db from '../lib/db.js';
import {
  CATEGORIE, STATI_PRODOTTO, STATI_FIERA, STATI_NOLEGGIO,
  oggi, addGiorni, giorniTra, isData,
} from '../lib/domain.js';
import { prospettoDisponibilita, noleggiImpegnativi } from '../lib/disponibilita.js';

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
 * Timeline (stile Gantt) dell'occupazione, un blocco per noleggio.
 */
router.get('/timeline', (req, res) => {
  const { from, to } = intervallo(req, 44);
  const righe = noleggiImpegnativi({ from, to });
  const prodotti = db.prepare(`SELECT * FROM prodotti WHERE stato != 'dismesso'
     ORDER BY CASE categoria WHEN 'TV' THEN 1 WHEN 'Monitor' THEN 2 WHEN 'Videowall' THEN 3 WHEN 'Totem' THEN 4 WHEN 'Supporto' THEN 5 ELSE 6 END, pollici DESC, nome`).all();

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

  res.json({
    oggi: giorno,
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
