// Dati di esempio: serve a vedere subito la piattaforma popolata.
// Uso: npm run seed  (non cancella nulla se ci sono già dei prodotti)

import db from './lib/db.js';
import { oggi, addGiorni, giorniTra } from './lib/domain.js';

const esistenti = db.prepare('SELECT COUNT(*) AS n FROM prodotti').get().n;
if (esistenti > 0 && !process.argv.includes('--forza')) {
  console.log(`Database già popolato (${esistenti} prodotti). Usa --forza per aggiungere comunque.`);
  process.exit(0);
}

const adesso = new Date().toISOString();
const g = oggi();

const prodotti = [
  ['TV 55" 4K Samsung', 'TV', 'Samsung', 'QM55B', 'TV-55-A', 55, '4K UHD', 12, 85],
  ['TV 65" 4K LG', 'TV', 'LG', '65UR640S', 'TV-65-A', 65, '4K UHD', 8, 120],
  ['TV 43" Full HD', 'TV', 'Samsung', 'BE43C', 'TV-43-A', 43, '1920x1080', 10, 60],
  ['TV 75" 4K Premium', 'TV', 'LG', '75UR781C', 'TV-75-A', 75, '4K UHD', 4, 190],
  ['Monitor 27" touch', 'Monitor', 'Dell', 'P2418HT', 'MON-27-T', 27, '1920x1080', 6, 55],
  ['Monitor 32" 4K', 'Monitor', 'BenQ', 'PD3200U', 'MON-32-4K', 32, '4K UHD', 5, 70],
  ['Videowall 2x2 46"', 'Videowall', 'Samsung', 'VM46B-U', 'VW-2X2', 46, '1920x1080', 3, 420],
  ['Totem verticale 55"', 'Totem', 'Philips', '55BDL4051D', 'TOT-55', 55, '4K UHD', 6, 150],
  ['Supporto a pavimento', 'Supporto', 'Vogel\'s', 'PFF2420', 'SUP-PAV', null, '', 20, 18],
  ['Staffa a muro VESA', 'Supporto', 'Vogel\'s', 'PFW6870', 'SUP-MUR', null, '', 15, 12],
  ['Media player 4K', 'Accessorio', 'BrightSign', 'HD225', 'MP-4K', null, '', 14, 22],
  ['Cavo HDMI 10m', 'Accessorio', '', 'HDMI 2.1', 'CAV-HDMI-10', null, '', 30, 4],
];

const insProdotto = db.prepare(`
  INSERT INTO prodotti (nome, categoria, marca, modello, codice, pollici, risoluzione,
                        quantita, prezzo_giorno, stato, note, creato_il, aggiornato_il)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'attivo', '', ?, ?)`);

const fiere = [
  ['Salone del Mobile', 'Arredo Group Srl', 'Fiera Milano Rho', 'Milano', '12', 'C24', addGiorni(g, 12), addGiorni(g, 16), 2, 1, 'pianificata'],
  ['SMAU Milano', 'TechLab Spa', 'Allianz MiCo', 'Milano', '3', 'A08', addGiorni(g, 40), addGiorni(g, 42), 1, 1, 'pianificata'],
  ['Cibus Parma', 'Food Italia Srl', 'Fiere di Parma', 'Parma', '5', 'B15', addGiorni(g, -2), addGiorni(g, 3), 2, 1, 'in_corso'],
  ['Vinitaly', 'Cantine Riunite', 'Veronafiere', 'Verona', '9', 'D02', addGiorni(g, -60), addGiorni(g, -56), 2, 1, 'conclusa'],
  ['MECSPE Bologna', 'Meccanica Nord Srl', 'BolognaFiere', 'Bologna', '15', 'E11', addGiorni(g, 75), addGiorni(g, 78), 2, 2, 'pianificata'],
];

const insFiera = db.prepare(`
  INSERT INTO fiere (nome, cliente, luogo, citta, padiglione, stand, data_inizio, data_fine,
                     giorni_allestimento, giorni_smontaggio, stato, note, creato_il, aggiornato_il)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`);

const insNoleggio = db.prepare(`
  INSERT INTO noleggi (prodotto_id, fiera_id, cliente, stand, quantita, data_inizio, data_fine,
                       stato, importo, note, creato_il, aggiornato_il)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`);

db.transaction(() => {
  const idProdotti = prodotti.map((p) => insProdotto.run(...p, adesso, adesso).lastInsertRowid);
  const idFiere = fiere.map((f) => insFiera.run(...f, adesso, adesso).lastInsertRowid);

  const righe = [
    // [indice prodotto, indice fiera, quantità, stato, cliente, stand]
    [0, 0, 6, 'prenotato', 'Arredo Group Srl', 'C24'], [1, 0, 3, 'prenotato', 'Arredo Group Srl', 'C24'],
    [8, 0, 6, 'prenotato', 'Poltrone Nord', 'C31'], [10, 0, 4, 'prenotato', 'Poltrone Nord', 'C31'],
    [3, 1, 2, 'prenotato', 'TechLab Spa', 'A08'], [6, 1, 1, 'prenotato', 'TechLab Spa', 'A08'],
    [4, 1, 4, 'prenotato', 'Datacloud Srl', 'A15'],
    [0, 2, 4, 'consegnato', 'Food Italia Srl', 'B15'], [2, 2, 6, 'consegnato', 'Food Italia Srl', 'B15'],
    [7, 2, 3, 'consegnato', 'Pastificio Sud', 'B22'], [11, 2, 12, 'consegnato', 'Pastificio Sud', 'B22'],
    [1, 3, 4, 'rientrato', 'Cantine Riunite', 'D02'], [5, 3, 2, 'rientrato', 'Cantine Riunite', 'D02'],
    [3, 4, 2, 'prenotato', 'Meccanica Nord Srl', 'E11'], [7, 4, 4, 'prenotato', 'Utensili Pro', 'E18'],
  ];

  for (const [ip, iff, quantita, stato, cliente, stand] of righe) {
    const fiera = fiere[iff];
    const inizio = addGiorni(fiera[6], -fiera[8]);
    const fine = addGiorni(fiera[7], fiera[9]);
    const importo = prodotti[ip][8] * quantita * (giorniTra(inizio, fine));
    insNoleggio.run(idProdotti[ip], idFiere[iff], cliente, stand, quantita, inizio, fine,
      stato, importo, adesso, adesso);
  }
})();

console.log(`Creati ${prodotti.length} prodotti, ${fiere.length} fiere e i relativi noleggi.`);
