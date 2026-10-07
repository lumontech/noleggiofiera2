// PDF del materiale da noleggiare, con l'intestazione dell'azienda.
//
// Un rigo per modello (non per apparecchio): "Samsung 65" – 5 disponibili".
// Con o senza prezzi; per tutto il parco o solo per quello libero nelle date
// di una fiera. I prezzi sono quelli di listino "a fiera", per pezzo.

import db from './db.js';
import { ORDINE_PER_ID } from './domain.js';
import { apparecchiPerPeriodo } from './disponibilita.js';
import {
  COLORE, dataLunga, periodo, euro, oggi, nuovoDocumento, titoloSezione, tabella, chiudiDocumento,
} from './pdf.js';

const SEZIONI = [
  { titolo: 'Schermi', categorie: ['TV', 'Monitor', 'Videowall', 'Totem'] },
  { titolo: 'Supporti', categorie: ['Supporto'] },
  { titolo: 'Altro materiale', categorie: ['Accessorio'] },
];

/** Il nome da catalogo: "Samsung 65" · UE65DU7172U" invece del nome di magazzino. */
export function titoloModello(p) {
  // Le sigle restano maiuscole (LG, TCL); gli altri marchi con l'iniziale maiuscola.
  const marca = !p.marca ? '' : p.marca.length <= 3 ? p.marca.toUpperCase()
    : p.marca.charAt(0).toUpperCase() + p.marca.slice(1).toLowerCase();
  const base = marca && p.pollici ? `${marca} ${Math.round(p.pollici)}"` : p.nome;
  return p.modello && base !== p.nome ? `${base} · ${p.modello}` : base;
}
const nomeSenzaCodici = (nome) => nome.replace(/\s+\d{8,}\b/g, '').trim();

/** Due righe: ingombro, poi peso e attacco. */
function misure(p) {
  const cm = (mm) => Math.round(mm / 10);
  const unisci = (parti) => parti.filter(Boolean).join(' · ');
  return [
    unisci([
      p.larghezza_mm && p.altezza_mm ? `${cm(p.larghezza_mm)} × ${cm(p.altezza_mm)} cm` : null,
      p.profondita_mm ? `prof. ${cm(p.profondita_mm)} cm` : null,
      p.altezza_base_mm ? `con base ${cm(p.altezza_base_mm)} cm` : null,
    ]),
    unisci([p.peso_kg ? `${String(p.peso_kg).replace('.', ',')} kg` : null, p.vesa ? `VESA ${p.vesa}` : null]),
  ].filter(Boolean);
}

/** Il prezzo che compare di più tra gli apparecchi dello stesso modello. */
function prezzoDelModello(apparecchi) {
  const conta = new Map();
  for (const a of apparecchi) if (a.prezzo_fiera > 0) conta.set(a.prezzo_fiera, (conta.get(a.prezzo_fiera) || 0) + 1);
  if (!conta.size) return null;
  return [...conta].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];
}

/**
 * I modelli da mettere nel documento, con quanti pezzi. Con una fiera contano
 * solo i pezzi liberi nelle sue date (allestimento e smontaggio compresi).
 */
export function modelliDaNoleggiare({ fiera = null } = {}) {
  const prodotti = db.prepare(`SELECT * FROM prodotti WHERE stato = 'attivo' ORDER BY ${ORDINE_PER_ID}`).all();
  let liberi = null;
  if (fiera) {
    const from = new Date(Date.parse(`${fiera.data_inizio}T00:00:00Z`) - fiera.giorni_allestimento * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.parse(`${fiera.data_fine}T00:00:00Z`) + fiera.giorni_smontaggio * 86400000).toISOString().slice(0, 10);
    liberi = new Map(apparecchiPerPeriodo({ from, to }).map((a) => [a.id, a.liberi]));
  }
  const modelli = new Map();
  for (const p of prodotti) {
    const pezzi = liberi ? (liberi.get(p.id) || 0) : p.quantita;
    if (!pezzi) continue;
    const chiave = `${p.categoria}|${(p.modello || nomeSenzaCodici(p.nome)).toLowerCase()}`;
    if (!modelli.has(chiave)) modelli.set(chiave, { esempio: p, apparecchi: [], pezzi: 0 });
    const m = modelli.get(chiave);
    m.apparecchi.push(p);
    m.pezzi += pezzi;
  }
  return [...modelli.values()].map((m) => ({
    categoria: m.esempio.categoria,
    titolo: titoloModello(m.esempio),
    descrizione: nomeSenzaCodici(m.esempio.nome),
    pollici: m.esempio.pollici,
    misure: misure(m.esempio),
    pezzi: m.pezzi,
    prezzo: prezzoDelModello(m.apparecchi),
  })).sort((a, b) => (b.pollici || 0) - (a.pollici || 0) || a.titolo.localeCompare(b.titolo, 'it'));
}

/** Scrive il PDF sullo stream (la risposta HTTP). */
export function scriviCatalogo(stream, { prezzi, fiera = null }) {
  const modelli = modelliDaNoleggiare({ fiera });
  const ctx = nuovoDocumento(stream, {
    titolo: 'Materiale a noleggio',
    sottotitoli: [
      fiera ? `Disponibile per ${fiera.nome} · ${periodo(fiera.data_inizio, fiera.data_fine)}` : `Aggiornato al ${dataLunga(oggi())}`,
      prezzi && 'Prezzi per pezzo, per l\'intera durata della fiera, IVA esclusa. Installazione e trasporto da concordare.',
    ],
  });
  const colonne = [
    { titolo: 'Apparecchio', peso: prezzi ? 42 : 50 },
    { titolo: 'Misure e attacco', peso: prezzi ? 33 : 38 },
    { titolo: 'Pezzi', peso: prezzi ? 10 : 12, allinea: 'center' },
    ...(prezzi ? [{ titolo: 'Prezzo', peso: 15, allinea: 'right' }] : []),
  ];

  if (!modelli.length) {
    ctx.doc.font('Helvetica').fontSize(11).fillColor(COLORE.tenue).text(fiera
      ? 'Nessun apparecchio libero nelle date di questa fiera.'
      : 'Nessun apparecchio disponibile al momento.');
  }
  for (const sezione of SEZIONI) {
    const elenco = modelli.filter((m) => sezione.categorie.includes(m.categoria)
      || (sezione.titolo === 'Altro materiale' && !SEZIONI.some((s) => s.categorie.includes(m.categoria))));
    if (!elenco.length) continue;
    titoloSezione(ctx, sezione.titolo);
    const t = tabella(ctx, colonne);
    t.intestazione();
    for (const m of elenco) {
      t.riga([
        { testo: m.titolo, grassetto: true, corpo: 10, sotto: m.descrizione !== m.titolo ? m.descrizione : '' },
        { testo: m.misure.join('\n') || '—', corpo: 8 },
        { testo: String(m.pezzi), grassetto: true, corpo: 11 },
        ...(prezzi ? [m.prezzo
          ? { testo: euro(m.prezzo), grassetto: true, corpo: 11 }
          : { testo: 'su richiesta', corpo: 8.5, colore: COLORE.tenue }] : []),
      ]);
    }
  }
  chiudiDocumento(ctx);
}
