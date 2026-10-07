// PDF del materiale da noleggiare, con l'intestazione dell'azienda.
//
// Un rigo per modello (non per apparecchio): "Samsung 65" – 5 disponibili".
// Con o senza prezzi; per tutto il parco o solo per quello libero nelle date
// di una fiera. I prezzi sono quelli di listino "a fiera", per pezzo.

import PDFDocument from 'pdfkit';
import db from './db.js';
import { ORDINE_PER_ID } from './domain.js';
import { apparecchiPerPeriodo } from './disponibilita.js';
import { leggiIntestazione, percorsoLogo } from './intestazione.js';

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
  'settembre', 'ottobre', 'novembre', 'dicembre'];
const dataLunga = (iso) => {
  const [a, m, g] = iso.split('-').map(Number);
  return `${g} ${MESI[m - 1]} ${a}`;
};
const periodo = (da, a) => (da === a ? dataLunga(da) : `${dataLunga(da)} – ${dataLunga(a)}`);
const euro = (n) => `€ ${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)}`;

const SEZIONI = [
  { titolo: 'Schermi', categorie: ['TV', 'Monitor', 'Videowall', 'Totem'] },
  { titolo: 'Supporti', categorie: ['Supporto'] },
  { titolo: 'Altro materiale', categorie: ['Accessorio'] },
];

const COLORE = { testo: '#0f172a', tenue: '#64748b', linea: '#e2e8f0', fondo: '#f1f5f9', accento: '#0284c7' };

/** Il nome da catalogo: "Samsung 65" · UE65DU7172U" invece del nome di magazzino. */
function titoloModello(p) {
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
  const intestazione = leggiIntestazione();
  const modelli = modelliDaNoleggiare({ fiera });
  const doc = new PDFDocument({
    size: 'A4', margins: { top: 40, bottom: 50, left: 42, right: 42 }, bufferPages: true,
    info: { Title: `Materiale a noleggio - ${intestazione.ragione_sociale}`, Author: intestazione.ragione_sociale },
  });
  doc.pipe(stream);
  const sinistra = doc.page.margins.left;
  const larghezza = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  /* ---------- intestazione ---------- */
  const logo = percorsoLogo();
  let altezzaTesta = 0;
  if (logo) {
    try {
      doc.image(logo, sinistra, 38, { fit: [190, 66] });
      altezzaTesta = 66;
    } catch { /* logo non leggibile: si va avanti col solo testo */ }
  }
  if (!altezzaTesta) {
    doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORE.testo).text(intestazione.ragione_sociale.toUpperCase(), sinistra, 42, { width: larghezza / 2 });
    if (intestazione.sottotitolo) {
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORE.tenue).text(intestazione.sottotitolo, sinistra, doc.y + 2, { width: larghezza / 2 });
    }
    altezzaTesta = doc.y - 40;
  }
  const righeAzienda = [
    intestazione.indirizzo,
    intestazione.piva && `P.IVA ${intestazione.piva}`,
    [intestazione.telefono, intestazione.email].filter(Boolean).join(' · '),
    intestazione.sito,
  ].filter(Boolean);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORE.testo)
    .text(intestazione.ragione_sociale, sinistra + larghezza / 2, 42, { width: larghezza / 2, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORE.tenue);
  for (const riga of righeAzienda) doc.text(riga, { width: larghezza / 2, align: 'right' });
  const sottoTesta = Math.max(40 + altezzaTesta, doc.y) + 12;
  doc.moveTo(sinistra, sottoTesta).lineTo(sinistra + larghezza, sottoTesta).lineWidth(1.5).strokeColor(COLORE.accento).stroke();

  /* ---------- titolo ---------- */
  const oggi = new Date().toISOString().slice(0, 10);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORE.testo).text('Materiale a noleggio', sinistra, sottoTesta + 18);
  doc.font('Helvetica').fontSize(10).fillColor(COLORE.tenue).text(fiera
    ? `Disponibile per ${fiera.nome} · ${periodo(fiera.data_inizio, fiera.data_fine)}`
    : `Aggiornato al ${dataLunga(oggi)}`);
  if (prezzi) doc.text('Prezzi per pezzo, per l\'intera durata della fiera, IVA esclusa. Installazione e trasporto da concordare.');
  doc.moveDown(0.8);

  /* ---------- tabella ---------- */
  const colonne = prezzi
    ? [{ t: 'Apparecchio', w: 0.42 }, { t: 'Misure e attacco', w: 0.33 }, { t: 'Pezzi', w: 0.10, a: 'center' }, { t: 'Prezzo', w: 0.15, a: 'right' }]
    : [{ t: 'Apparecchio', w: 0.50 }, { t: 'Misure e attacco', w: 0.38 }, { t: 'Pezzi', w: 0.12, a: 'center' }];
  const x = []; let cursore = sinistra;
  for (const c of colonne) { x.push(cursore); c.px = c.w * larghezza; cursore += c.px; }
  const fondoPagina = () => doc.page.height - doc.page.margins.bottom - 10;

  const intestazioneTabella = () => {
    const y = doc.y;
    doc.rect(sinistra, y, larghezza, 20).fill(COLORE.fondo);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORE.tenue);
    colonne.forEach((c, i) => doc.text(c.t.toUpperCase(), x[i] + 6, y + 6, { width: c.px - 12, align: c.a || 'left' }));
    doc.y = y + 20;
  };

  const riga = (m) => {
    const testoMisure = m.misure.join('\n') || '—';
    doc.font('Helvetica-Bold').fontSize(10);
    const hTitolo = doc.heightOfString(m.titolo, { width: colonne[0].px - 12 });
    doc.font('Helvetica').fontSize(8);
    const hDescr = m.descrizione !== m.titolo ? doc.heightOfString(m.descrizione, { width: colonne[0].px - 12 }) : 0;
    const hMisure = doc.heightOfString(testoMisure, { width: colonne[1].px - 12 });
    const altezza = Math.max(hTitolo + hDescr + 2, hMisure, 14) + 14;
    if (doc.y + altezza > fondoPagina()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      intestazioneTabella();
    }
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORE.testo).text(m.titolo, x[0] + 6, y + 7, { width: colonne[0].px - 12 });
    if (hDescr) doc.font('Helvetica').fontSize(8).fillColor(COLORE.tenue).text(m.descrizione, x[0] + 6, doc.y + 1, { width: colonne[0].px - 12 });
    doc.font('Helvetica').fontSize(8).fillColor(COLORE.testo).text(testoMisure, x[1] + 6, y + 8, { width: colonne[1].px - 12 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORE.testo).text(String(m.pezzi), x[2] + 6, y + 7, { width: colonne[2].px - 12, align: 'center' });
    if (prezzi) {
      doc.font(m.prezzo ? 'Helvetica-Bold' : 'Helvetica').fontSize(m.prezzo ? 11 : 8.5).fillColor(m.prezzo ? COLORE.testo : COLORE.tenue)
        .text(m.prezzo ? euro(m.prezzo) : 'su richiesta', x[3] + 6, y + 7, { width: colonne[3].px - 12, align: 'right' });
    }
    doc.y = y + altezza;
    doc.moveTo(sinistra, doc.y).lineTo(sinistra + larghezza, doc.y).lineWidth(0.6).strokeColor(COLORE.linea).stroke();
  };

  if (!modelli.length) {
    doc.font('Helvetica').fontSize(11).fillColor(COLORE.tenue).text(fiera
      ? 'Nessun apparecchio libero nelle date di questa fiera.'
      : 'Nessun apparecchio disponibile al momento.');
  }
  for (const sezione of SEZIONI) {
    const elenco = modelli.filter((m) => sezione.categorie.includes(m.categoria)
      || (sezione.titolo === 'Altro materiale' && !SEZIONI.some((s) => s.categorie.includes(m.categoria))));
    if (!elenco.length) continue;
    if (doc.y + 70 > fondoPagina()) { doc.addPage(); doc.y = doc.page.margins.top; }
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORE.accento).text(sezione.titolo, sinistra, doc.y);
    doc.moveDown(0.3);
    intestazioneTabella();
    elenco.forEach(riga);
  }

  /* ---------- piè di pagina ---------- */
  const pagine = doc.bufferedPageRange();
  for (let i = 0; i < pagine.count; i += 1) {
    doc.switchToPage(pagine.start + i);
    // Scrivendo sotto il margine pdfkit aprirebbe una pagina nuova: lo si azzera.
    const margine = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 34;
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORE.tenue);
    doc.text([intestazione.ragione_sociale, intestazione.piva && `P.IVA ${intestazione.piva}`, intestazione.sito].filter(Boolean).join(' · '),
      sinistra, y, { width: larghezza * 0.75, lineBreak: false });
    doc.text(`Pagina ${i + 1} di ${pagine.count}`, sinistra + larghezza * 0.75, y, { width: larghezza * 0.25, align: 'right', lineBreak: false });
    doc.page.margins.bottom = margine;
  }
  doc.end();
}
