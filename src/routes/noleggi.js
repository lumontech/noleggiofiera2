import { Router } from 'express';
import db from '../lib/db.js';
import {
  STATI_NOLEGGIO, HttpError,
  testo, intero, decimale, enumerato, periodo, giorniTra, isData,
} from '../lib/domain.js';
import { verificaCapienza } from '../lib/disponibilita.js';
import { trovaProdotto } from './prodotti.js';
import { trovaFiera } from './fiere.js';

const router = Router();

function trovaNoleggio(id) {
  const noleggio = db.prepare('SELECT * FROM noleggi WHERE id = ?').get(id);
  if (!noleggio) throw new HttpError(404, 'Noleggio non trovato.');
  return noleggio;
}

function arricchisci(noleggio) {
  return {
    ...noleggio,
    giorni: giorniTra(noleggio.data_inizio, noleggio.data_fine),
    totale: Math.round((noleggio.prezzo_giorno ?? 0) * noleggio.quantita
      * giorniTra(noleggio.data_inizio, noleggio.data_fine) * 100) / 100,
  };
}

function leggiCorpo(body) {
  const { inizio, fine } = periodo(body);
  const prodotto = trovaProdotto(intero(body.prodotto_id, 'prodotto_id', { min: 1 }));
  const fiera = trovaFiera(intero(body.fiera_id, 'fiera_id', { min: 1 }));
  if (prodotto.stato === 'dismesso') {
    throw new HttpError(409, `"${prodotto.nome}" è dismesso e non può essere noleggiato.`);
  }
  return {
    prodotto,
    fiera,
    dati: {
      prodotto_id: prodotto.id,
      fiera_id: fiera.id,
      quantita: intero(body.quantita, 'quantita', { min: 1, max: 9999, predefinito: 1 }),
      data_inizio: inizio,
      data_fine: fine,
      stato: enumerato(body.stato, 'stato', STATI_NOLEGGIO, 'prenotato'),
      prezzo_giorno: body.prezzo_giorno === '' || body.prezzo_giorno == null
        ? prodotto.prezzo_giorno
        : decimale(body.prezzo_giorno, 'prezzo_giorno', { min: 0 }),
      note: testo(body.note, 'note', { max: 2000 }),
    },
  };
}

// Impedisce l'overbooking: la quantità richiesta deve stare nello stock libero.
function controllaDisponibilita({ prodotto, dati, escludiNoleggio = null }) {
  if (dati.stato === 'annullato' || dati.stato === 'rientrato') return;
  if (prodotto.stato === 'manutenzione') {
    throw new HttpError(409, `"${prodotto.nome}" è in manutenzione: rimettilo attivo per noleggiarlo.`);
  }
  const esito = verificaCapienza({
    prodotto,
    quantita: dati.quantita,
    from: dati.data_inizio,
    to: dati.data_fine,
    escludiNoleggio,
  });
  if (!esito.ok) {
    const dettaglio = esito.picco > 0
      ? ` Nel periodo il picco di impegno è di ${esito.picco} pezzi, il ${esito.giornoPicco}.`
      : '';
    throw new HttpError(409,
      `Disponibilità insufficiente per "${prodotto.nome}": ne restano ${esito.disponibili} `
      + `su ${prodotto.quantita} nelle date scelte.${dettaglio}`);
  }
}

router.get('/', (req, res) => {
  const { stato, prodotto_id: prodottoId, fiera_id: fieraId, from, to } = req.query;
  const condizioni = [];
  const parametri = [];
  if (stato) { condizioni.push('n.stato = ?'); parametri.push(stato); }
  if (prodottoId) { condizioni.push('n.prodotto_id = ?'); parametri.push(prodottoId); }
  if (fieraId) { condizioni.push('n.fiera_id = ?'); parametri.push(fieraId); }
  if (isData(from) && isData(to)) {
    condizioni.push('n.data_inizio <= ? AND n.data_fine >= ?');
    parametri.push(to, from);
  }
  let sql = `
    SELECT n.*, p.nome AS prodotto_nome, p.categoria AS prodotto_categoria,
           p.pollici AS prodotto_pollici, f.nome AS fiera_nome, f.citta AS fiera_citta
      FROM noleggi n
      JOIN prodotti p ON p.id = n.prodotto_id
      JOIN fiere    f ON f.id = n.fiera_id`;
  if (condizioni.length) sql += ` WHERE ${condizioni.join(' AND ')}`;
  sql += ' ORDER BY n.data_inizio DESC, n.id DESC';
  res.json(db.prepare(sql).all(...parametri).map(arricchisci));
});

router.post('/', (req, res) => {
  const { prodotto, dati } = leggiCorpo(req.body);
  controllaDisponibilita({ prodotto, dati });
  const adesso = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO noleggi (prodotto_id, fiera_id, quantita, data_inizio, data_fine, stato,
                         prezzo_giorno, note, creato_il, aggiornato_il)
    VALUES (@prodotto_id, @fiera_id, @quantita, @data_inizio, @data_fine, @stato,
            @prezzo_giorno, @note, @creato_il, @aggiornato_il)`)
    .run({ ...dati, creato_il: adesso, aggiornato_il: adesso });
  res.status(201).json(arricchisci(trovaNoleggio(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const noleggio = trovaNoleggio(req.params.id);
  const { prodotto, dati } = leggiCorpo(req.body);
  controllaDisponibilita({ prodotto, dati, escludiNoleggio: noleggio.id });
  db.prepare(`
    UPDATE noleggi SET prodotto_id=@prodotto_id, fiera_id=@fiera_id, quantita=@quantita,
                       data_inizio=@data_inizio, data_fine=@data_fine, stato=@stato,
                       prezzo_giorno=@prezzo_giorno, note=@note, aggiornato_il=@aggiornato_il
     WHERE id=@id`)
    .run({ ...dati, id: noleggio.id, aggiornato_il: new Date().toISOString() });
  res.json(arricchisci(trovaNoleggio(noleggio.id)));
});

// Cambio di stato rapido dalla lista (prenotato → consegnato → rientrato).
router.patch('/:id/stato', (req, res) => {
  const noleggio = trovaNoleggio(req.params.id);
  const stato = enumerato(req.body?.stato, 'stato', STATI_NOLEGGIO);
  if (['prenotato', 'consegnato'].includes(stato)
      && !['prenotato', 'consegnato'].includes(noleggio.stato)) {
    // Riattivare una riga chiusa rimette in gioco dei pezzi: va ricontrollata.
    const prodotto = trovaProdotto(noleggio.prodotto_id);
    controllaDisponibilita({
      prodotto,
      dati: { ...noleggio, stato },
      escludiNoleggio: noleggio.id,
    });
  }
  db.prepare('UPDATE noleggi SET stato = ?, aggiornato_il = ? WHERE id = ?')
    .run(stato, new Date().toISOString(), noleggio.id);
  res.json(arricchisci(trovaNoleggio(noleggio.id)));
});

router.delete('/:id', (req, res) => {
  const noleggio = trovaNoleggio(req.params.id);
  db.prepare('DELETE FROM noleggi WHERE id = ?').run(noleggio.id);
  res.json({ ok: true });
});

export default router;
