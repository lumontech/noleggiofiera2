// Base comune dei PDF: carta intestata (logo o nome dell'azienda, dati a
// destra), titolo, tabelle che vanno a capo da sole e piè di pagina numerato.

import PDFDocument from 'pdfkit';
import { leggiIntestazione, percorsoLogo } from './intestazione.js';

export const COLORE = { testo: '#0f172a', tenue: '#64748b', linea: '#e2e8f0', fondo: '#f1f5f9', accento: '#0284c7' };

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
  'settembre', 'ottobre', 'novembre', 'dicembre'];
export const dataLunga = (iso) => {
  const [a, m, g] = iso.split('-').map(Number);
  return `${g} ${MESI[m - 1]} ${a}`;
};
export const periodo = (da, a) => (da === a ? dataLunga(da) : `${dataLunga(da)} – ${dataLunga(a)}`);
export const euro = (n) => `€ ${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: 'always' }).format(n)}`;
export const oggi = () => new Date().toISOString().slice(0, 10);

/**
 * Apre un documento A4 con la carta intestata e il titolo.
 * @returns {{ doc, sinistra, larghezza, intestazione, fondoPagina }}
 */
export function nuovoDocumento(stream, { titolo, sottotitoli = [] }) {
  const intestazione = leggiIntestazione();
  const doc = new PDFDocument({
    size: 'A4', margins: { top: 40, bottom: 50, left: 42, right: 42 }, bufferPages: true,
    info: { Title: `${titolo} - ${intestazione.ragione_sociale}`, Author: intestazione.ragione_sociale },
  });
  doc.pipe(stream);
  const sinistra = doc.page.margins.left;
  const larghezza = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // A sinistra il logo, o in mancanza il nome dell'azienda; a destra i dati.
  const logo = percorsoLogo();
  let altezzaTesta = 0;
  if (logo) {
    try {
      doc.image(logo, sinistra, 38, { fit: [190, 66] });
      altezzaTesta = 66;
    } catch { /* logo non leggibile: si va avanti col solo testo */ }
  }
  if (!altezzaTesta && /lumon/i.test(intestazione.ragione_sociale)) {
    altezzaTesta = marchioLumon(doc, sinistra, 36, intestazione.sottotitolo) - 40;
  }
  if (!altezzaTesta) {
    doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORE.testo)
      .text(intestazione.ragione_sociale.toUpperCase(), sinistra, 42, { width: larghezza / 2 });
    if (intestazione.sottotitolo) {
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORE.tenue).text(intestazione.sottotitolo, sinistra, doc.y + 2, { width: larghezza / 2 });
    }
    altezzaTesta = doc.y - 40;
  }
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORE.testo)
    .text(intestazione.ragione_sociale, sinistra + larghezza / 2, 42, { width: larghezza / 2, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORE.tenue);
  for (const riga of [
    intestazione.indirizzo,
    intestazione.piva && `P.IVA ${intestazione.piva}`,
    [intestazione.telefono, intestazione.email].filter(Boolean).join(' · '),
    intestazione.sito,
  ].filter(Boolean)) doc.text(riga, { width: larghezza / 2, align: 'right' });
  const sottoTesta = Math.max(40 + altezzaTesta, doc.y) + 12;
  doc.moveTo(sinistra, sottoTesta).lineTo(sinistra + larghezza, sottoTesta).lineWidth(1.5).strokeColor(COLORE.accento).stroke();

  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORE.testo).text(titolo, sinistra, sottoTesta + 18, { width: larghezza });
  doc.font('Helvetica').fontSize(10).fillColor(COLORE.tenue);
  for (const riga of sottotitoli.filter(Boolean)) doc.text(riga, { width: larghezza });
  doc.moveDown(0.8);

  return {
    doc, sinistra, larghezza, intestazione,
    fondoPagina: () => doc.page.height - doc.page.margins.bottom - 10,
  };
}

/**
 * Il marchio Lumon ridisegnato, per quando il file del logo non è caricato:
 * "lum" e "n" in nero, al posto della "o" il cerchio di puntini verdi a
 * girasole, sotto la dicitura. Restituisce la y sotto il marchio.
 * Il logo originale, caricato dall'app, ha sempre la precedenza.
 */
function marchioLumon(doc, x, y, dicitura) {
  const corpo = 40;
  const nero = '#1d1d1b';
  const verde = '#8cc63f';
  doc.font('Helvetica-Bold').fontSize(corpo).fillColor(nero);
  doc.text('lum', x, y, { lineBreak: false, characterSpacing: -1 });
  const larghezzaLum = doc.widthOfString('lum', { characterSpacing: -1 });
  // Proporzioni di Helvetica: linea di base e altezza della x.
  const base = y + corpo * 0.93;
  const altezzaX = corpo * 0.53;
  const diametro = altezzaX * 1.3;
  const cx = x + larghezzaLum + diametro / 2 + corpo * 0.05;
  // Il cerchio poggia sulla linea di base, come le lettere.
  const cy = base - diametro / 2;
  // Girasole: ogni punto ruota dell'angolo aureo e si allontana come la radice;
  // i punti esterni sono un po' più piccoli.
  const punti = 100;
  for (let i = 1; i <= punti; i += 1) {
    const r = (diametro / 2 - diametro * 0.03) * Math.sqrt((i - 0.5) / punti);
    const angolo = i * 2.39996;
    const raggio = diametro * (0.044 - 0.014 * (i / punti));
    doc.circle(cx + r * Math.cos(angolo), cy + r * Math.sin(angolo), raggio).fill(verde);
  }
  doc.font('Helvetica-Bold').fontSize(corpo).fillColor(nero)
    .text('n', cx + diametro / 2 + corpo * 0.05, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(12).fillColor('#3c3c3b')
    .text(dicitura || 'Digital Signage Solution', x + 1, base + 6, { lineBreak: false });
  return base + 6 + 15;
}

/** Un titolo di sezione (es. il nome della fiera); va a pagina nuova se non c'è spazio. */
export function titoloSezione(ctx, testo, sotto = '', { piccolo = false } = {}) {
  const { doc, sinistra, larghezza } = ctx;
  if (doc.y + 80 > ctx.fondoPagina()) { doc.addPage(); doc.y = doc.page.margins.top; }
  doc.moveDown(piccolo ? 0.4 : 0.6);
  doc.font('Helvetica-Bold').fontSize(piccolo ? 10 : 12.5).fillColor(piccolo ? COLORE.testo : COLORE.accento)
    .text(testo, sinistra, doc.y, { width: larghezza });
  if (sotto) doc.font('Helvetica').fontSize(9).fillColor(COLORE.tenue).text(sotto, { width: larghezza });
  doc.moveDown(0.3);
}

/**
 * Una tabella. `colonne`: [{ titolo, peso, allinea }]. Ogni riga è un elenco
 * di celle { testo, sotto, grassetto, corpo, colore }: l'altezza si adatta al
 * contenuto e, se la riga non ci sta, si va a pagina nuova ripetendo i titoli.
 */
export function tabella(ctx, colonne) {
  const { doc, sinistra, larghezza } = ctx;
  const totale = colonne.reduce((t, c) => t + c.peso, 0);
  let x = sinistra;
  const col = colonne.map((c) => {
    const w = (c.peso / totale) * larghezza;
    const r = { ...c, x, w };
    x += w;
    return r;
  });
  const opzioni = (c) => ({ width: c.w - 12, align: c.allinea || 'left' });

  const intestazioneTabella = () => {
    const y = doc.y;
    // Alta quanto serve, se un titolo va a capo.
    doc.font('Helvetica-Bold').fontSize(7.5);
    const altezza = Math.max(...col.map((c) => doc.heightOfString(c.titolo.toUpperCase(), opzioni(c)))) + 13;
    doc.rect(sinistra, y, larghezza, altezza).fill(COLORE.fondo);
    doc.fillColor(COLORE.tenue);
    col.forEach((c) => doc.text(c.titolo.toUpperCase(), c.x + 6, y + 6.5, opzioni(c)));
    doc.y = y + altezza;
  };

  const altezzaCella = (cella, c) => {
    if (!cella) return 0;
    doc.font(cella.grassetto ? 'Helvetica-Bold' : 'Helvetica').fontSize(cella.corpo || 9);
    let h = cella.testo ? doc.heightOfString(String(cella.testo), opzioni(c)) : 0;
    if (cella.sotto) {
      doc.font('Helvetica').fontSize(7.5);
      h += doc.heightOfString(String(cella.sotto), opzioni(c)) + 1;
    }
    return h;
  };

  const riga = (celle, { sfondo = null } = {}) => {
    const altezza = Math.max(14, ...celle.map((cella, i) => altezzaCella(cella, col[i]))) + 12;
    if (doc.y + altezza > ctx.fondoPagina()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      intestazioneTabella();
    }
    const y = doc.y;
    if (sfondo) doc.rect(sinistra, y, larghezza, altezza).fill(sfondo);
    celle.forEach((cella, i) => {
      if (!cella) return;
      const c = col[i];
      doc.font(cella.grassetto ? 'Helvetica-Bold' : 'Helvetica').fontSize(cella.corpo || 9).fillColor(cella.colore || COLORE.testo);
      doc.text(String(cella.testo ?? ''), c.x + 6, y + 6, opzioni(c));
      if (cella.sotto) {
        doc.font('Helvetica').fontSize(7.5).fillColor(cella.coloreSotto || COLORE.tenue).text(String(cella.sotto), c.x + 6, doc.y + 1, opzioni(c));
      }
    });
    doc.y = y + altezza;
    doc.moveTo(sinistra, doc.y).lineTo(sinistra + larghezza, doc.y).lineWidth(0.6).strokeColor(COLORE.linea).stroke();
  };

  return { intestazione: intestazioneTabella, riga };
}

/** Piè di pagina numerato su tutte le pagine, poi chiude il documento. */
export function chiudiDocumento(ctx) {
  const { doc, sinistra, larghezza, intestazione } = ctx;
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
