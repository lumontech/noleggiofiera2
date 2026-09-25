// Analisi di una pagina di planimetria in PDF con pdf.js: dove sono scritti i
// numeri degli stand e quali riquadri sono disegnati. Tutte le misure sono
// frazioni della pagina (0-1), indipendenti dallo zoom.
//
// Non usa il DOM: gira uguale nel browser e nei test con Node.

import { codiciStand } from './stand.js';

const IDENTITA = [1, 0, 0, 1, 0, 0];

// Composizione di trasformazioni PDF: prima m2, poi m1 (come Util.transform di pdf.js).
function componi(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

const applica = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Riquadro (in frazioni di pagina) che contiene dei punti espressi nello spazio PDF. */
function riquadro(vista, punti) {
  const inVista = punti.map(([x, y]) => vista.convertToViewportPoint(x, y));
  const xs = inVista.map((p) => p[0]);
  const ys = inVista.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: x / vista.width,
    y: y / vista.height,
    w: (Math.max(...xs) - x) / vista.width,
    h: (Math.max(...ys) - y) / vista.height,
  };
}

/** Testi della pagina che contengono almeno un codice di stand. */
async function testiConCodici(pagina, vista) {
  const contenuto = await pagina.getTextContent();
  const testi = [];
  for (const el of contenuto.items) {
    if (!el.str || !el.str.trim()) continue;
    const codici = codiciStand(el.str);
    if (!codici.length) continue;
    // Gli angoli del testo seguono la sua direzione: vale anche per le
    // etichette ruotate, frequenti sulle piante.
    const [a, b, c, d, e, f] = el.transform;
    const lungo = Math.hypot(a, b) || 1;
    const alto = Math.hypot(c, d) || el.height || 1;
    const dir = [a / lungo, b / lungo];
    const su = [(c / alto) * (el.height || alto), (d / alto) * (el.height || alto)];
    const w = el.width;
    testi.push({
      testo: el.str.trim(),
      codici,
      box: riquadro(vista, [
        [e, f],
        [e + dir[0] * w, f + dir[1] * w],
        [e + su[0], f + su[1]],
        [e + dir[0] * w + su[0], f + dir[1] * w + su[1]],
      ]),
    });
  }
  return testi;
}

/**
 * Riquadri disegnati nella pagina: sia come rettangoli veri sia come percorsi
 * chiusi di quattro lati. Si scartano quelli enormi (bordi, padiglioni) e
 * quelli minuscoli (retini, simboli).
 */
async function riquadriDisegnati(pagina, vista, OPS) {
  const lista = await pagina.getOperatorList();
  const pila = [];
  let ctm = IDENTITA;
  const trovati = [];

  const aggiungi = (puntiUtente) => {
    const r = riquadro(vista, puntiUtente.map(([x, y]) => applica(ctm, x, y)));
    const area = r.w * r.h;
    const proporzione = Math.max(r.w, r.h) / Math.max(Math.min(r.w, r.h), 1e-9);
    if (area > 0.00002 && area < 0.05 && proporzione < 12) trovati.push(r);
  };
  const eRettangolo = (p) => {
    if (p.length === 5 && Math.hypot(p[4][0] - p[0][0], p[4][1] - p[0][1]) < 0.5) p = p.slice(0, 4);
    if (p.length !== 4) return false;
    // Lati alternati orizzontali e verticali (con tolleranza).
    const tol = 0.5;
    const oriz = (u, v) => Math.abs(u[1] - v[1]) < tol;
    const vert = (u, v) => Math.abs(u[0] - v[0]) < tol;
    const lati = [[p[0], p[1]], [p[1], p[2]], [p[2], p[3]], [p[3], p[0]]];
    return (oriz(...lati[0]) && vert(...lati[1]) && oriz(...lati[2]) && vert(...lati[3]))
      || (vert(...lati[0]) && oriz(...lati[1]) && vert(...lati[2]) && oriz(...lati[3]));
  };

  for (let i = 0; i < lista.fnArray.length; i += 1) {
    const fn = lista.fnArray[i];
    const args = lista.argsArray[i];
    if (fn === OPS.save) pila.push(ctm);
    else if (fn === OPS.restore) ctm = pila.pop() || IDENTITA;
    else if (fn === OPS.transform) ctm = componi(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      pila.push(ctm);
      if (args?.[0]) ctm = componi(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = pila.pop() || IDENTITA;
    else if (fn === OPS.constructPath) {
      const [ops, coord] = args;
      let k = 0;
      let percorso = null;
      for (const op of ops) {
        if (op === OPS.rectangle) {
          const [x, y, w, h] = [coord[k], coord[k + 1], coord[k + 2], coord[k + 3]];
          k += 4;
          aggiungi([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
          percorso = null;
        } else if (op === OPS.moveTo) {
          if (percorso && eRettangolo(percorso)) aggiungi(percorso);
          percorso = [[coord[k], coord[k + 1]]];
          k += 2;
        } else if (op === OPS.lineTo) {
          if (percorso) percorso.push([coord[k], coord[k + 1]]);
          k += 2;
        } else if (op === OPS.curveTo) {
          k += 6; percorso = null;
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          k += 4; percorso = null;
        } else if (op === OPS.closePath) {
          if (percorso && eRettangolo(percorso)) aggiungi(percorso);
          percorso = null;
        }
      }
      if (percorso && eRettangolo(percorso)) aggiungi(percorso);
    }
  }
  return trovati;
}

export async function analizzaPagina(pagina, OPS) {
  const vista = pagina.getViewport({ scale: 1 });
  const [testi, riquadri] = await Promise.all([
    testiConCodici(pagina, vista),
    riquadriDisegnati(pagina, vista, OPS),
  ]);
  return { testi, riquadri, proporzione: vista.width / vista.height };
}

/**
 * Lo spazio dello stand intorno a un numero: il riquadro disegnato più piccolo
 * che contiene il centro del numero. Se lo stand non è disegnato come
 * riquadro, un'area attorno al numero, proporzionata al carattere.
 */
export function spazioDelNumero(box, riquadri) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const contenitori = riquadri.filter((r) => r.x <= cx && cx <= r.x + r.w && r.y <= cy && cy <= r.y + r.h
    // Uno stand è grande al massimo qualche decina di volte il suo numero.
    && r.w * r.h <= box.w * box.h * 80);
  if (contenitori.length) {
    const piccolo = contenitori.reduce((a, b) => (a.w * a.h <= b.w * b.h ? a : b));
    return { ...piccolo, tipo: 'riquadro' };
  }
  const margine = box.h * 1.1;
  return {
    x: box.x - margine,
    y: box.y - margine * 0.8,
    w: box.w + margine * 2,
    h: box.h + margine * 1.6,
    tipo: 'attorno',
  };
}

/**
 * Dove va ogni gruppo di noleggi: per ciascun codice dello stand, le pagine e
 * gli spazi in cui compare. Più occorrenze dello stesso codice = da verificare.
 */
export function collocaStand(gruppi, pagine) {
  return gruppi.map((g) => {
    const spazi = [];
    let occorrenzeMax = 0;
    for (const codice of g.codici) {
      const occorrenze = [];
      pagine.forEach((p, indice) => {
        for (const t of p.testi) {
          if (t.codici.includes(codice)) {
            occorrenze.push({ pagina: indice + 1, codice, ...spazioDelNumero(t.box, p.riquadri) });
          }
        }
      });
      occorrenzeMax = Math.max(occorrenzeMax, occorrenze.length);
      // Se un codice compare più volte si usa la prima e si segnala il dubbio.
      if (occorrenze.length) spazi.push(occorrenze[0]);
    }
    return {
      ...g,
      spazi,
      stato: !g.codici.length ? 'senza-codice'
        : !spazi.length ? 'non-trovato'
          : occorrenzeMax > 1 ? 'ambiguo'
            : spazi.length < g.codici.length ? 'parziale' : 'trovato',
    };
  });
}
