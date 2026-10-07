// Le note dei noleggi mostrate fuori dall'ufficio.

/**
 * Le note di un noleggio per chi installa (PDF e app del tecnico): quelle per
 * il tecnico e le altre (es. "montaggio verticale" scritto nelle note). Si
 * tolgono i riferimenti interni e, senza prezzi, ogni riga che parla di soldi.
 */
export function noteDelNoleggio(n, { prezzi = false } = {}) {
  const soldi = /€|\beur(o|i)?\b|\bprezz|\bimport|\bpagat|\bfattur|\bsconto|\biva\b/i;
  const altre = String(n.note || '')
    .replace(/\[airtable:[^\]]+\]/g, '')
    .replace(/Date ereditate dalla fiera: in Airtable la richiesta non le riportava\.?/g, '')
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r && !/^Da richiesta di\b/.test(r) && !/^Piantana per il TV\b/.test(r))
    .filter((r) => prezzi || !soldi.test(r))
    .filter((r) => r.toLowerCase() !== String(n.note_tecnico || '').trim().toLowerCase());
  return { tecnico: n.note_tecnico || '', altre: altre.join(' · ') };
}
