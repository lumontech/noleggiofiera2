// Segnaposti: dove va ogni apparecchio sulla planimetria, messo trascinandolo.
// Le coordinate sono frazioni (0-1) della pagina, indipendenti dallo zoom.

import db from './db.js';
import { HttpError, intero } from './domain.js';

const frazione = (v, campo) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new HttpError(400, `"${campo}" deve essere tra 0 e 1.`);
  return n;
};

export function leggiPosizione(body) {
  return {
    pagina: intero(body?.pagina, 'pagina', { min: 1, max: 500, predefinito: 1 }),
    x: frazione(body?.x, 'x'),
    y: frazione(body?.y, 'y'),
  };
}

/** La planimetria deve essere della stessa fiera del noleggio. */
export function allegatoDellaFiera(allegatoId, fieraId) {
  const allegato = db.prepare('SELECT * FROM allegati WHERE id = ? AND fiera_id = ?')
    .get(intero(allegatoId, 'allegato_id', { min: 1 }), fieraId);
  if (!allegato) throw new HttpError(404, 'Planimetria non trovata su questa fiera.');
  return allegato;
}

export function salvaSegnaposto(noleggioId, allegatoId, { pagina, x, y }) {
  db.prepare(`
    INSERT INTO segnaposti (noleggio_id, allegato_id, pagina, x, y, aggiornato_il)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (noleggio_id) DO UPDATE
       SET allegato_id = excluded.allegato_id, pagina = excluded.pagina,
           x = excluded.x, y = excluded.y, aggiornato_il = excluded.aggiornato_il`)
    .run(noleggioId, allegatoId, pagina, x, y, new Date().toISOString());
  return { noleggio_id: noleggioId, allegato_id: allegatoId, pagina, x, y };
}

/** I segnaposti di una planimetria; con `stati` solo quelli dei noleggi in quegli stati. */
export function segnapostiDi(allegatoId, stati = null) {
  const filtro = stati ? ` AND n.stato IN (${stati.map(() => '?').join(',')})` : '';
  return db.prepare(`
    SELECT s.noleggio_id, s.pagina, s.x, s.y
      FROM segnaposti s JOIN noleggi n ON n.id = s.noleggio_id
     WHERE s.allegato_id = ? AND n.stato != 'annullato'${filtro}`)
    .all(allegatoId, ...(stati || []));
}
