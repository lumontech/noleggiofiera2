// Dal campo "stand" di un noleggio, scritto a mano in tanti modi, ai codici
// degli stand da cercare sulla planimetria. Funzioni pure: le usa il browser
// e le verificano i test sui dati reali.
//
//   "PAD 5 - 5042"                       → ["5042"]
//   "PAD 3 3042-43"                      → ["3042", "3043"]
//   "E3E5"                               → ["E3", "E5"]
//   "D29 D31 - altezza da 138 da terra"  → ["D29", "D31"]
//   "Stand Airone"                       → []

// Da qui in poi è descrizione, non codici (il 138 di "altezza da 138").
const CODA_DESCRITTIVA = /\b(ALTEZZA|ALTO|H\.|CM|METRI|MT)\b.*$/;
const PADIGLIONE = /\bPAD(?:IGLIONE)?\s*\.?\s*(\d{1,2})\b/g;

/** Il padiglione, se scritto: "PAD 5 - 5042" → "5". */
export function padiglione(testo) {
  const trovato = /\bPAD(?:IGLIONE)?\s*\.?\s*(\d{1,2})\b/.exec(String(testo || '').toUpperCase());
  return trovato ? trovato[1] : null;
}

export function codiciStand(testo) {
  let s = String(testo || '').toUpperCase().replace(CODA_DESCRITTIVA, ' ');
  s = s.replace(PADIGLIONE, ' ').replace(/STAND\s*/g, ' ');

  // "3042-43" è l'abbreviazione di 3042 e 3043: si completa il secondo numero.
  s = s.replace(/(?<![A-Z0-9])(\d{2,5})\s*-\s*(\d{1,5})(?![0-9])/g, (_, primo, secondo) => {
    const completo = secondo.length < primo.length
      ? primo.slice(0, primo.length - secondo.length) + secondo
      : secondo;
    return ` ${primo} ${completo} `;
  });

  const codici = [];
  // Codici con lettera: C12, D29, e anche attaccati come in "E3E5".
  for (const m of s.matchAll(/(?<![A-Z])[A-Z]{1,2}\d{1,4}(?![0-9])/g)) codici.push(m[0]);
  // Numeri di almeno due cifre che non fanno parte di un codice con lettera.
  for (const m of s.matchAll(/(?<![A-Z0-9])\d{2,5}(?![0-9])/g)) codici.push(m[0]);

  return [...new Set(codici)];
}
