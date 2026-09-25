// Selettore di apparecchi che propone solo quelli liberi nelle date scelte.
// Gli occupati restano visibili ma non selezionabili, con accanto a chi sono
// già assegnati: così non si noleggia due volte lo stesso apparecchio e si
// capisce subito perché uno manca.

import { api } from './api.js';
import { h, monta, numero, nomeBreve, idProdotto } from './ui.js';

function etichettaApparecchio(a) {
  const base = [idProdotto(a.codice), nomeBreve(a)].filter(Boolean).join(' · ');
  return a.quantita > 1 ? `${base} — ${a.liberi} liberi su ${a.quantita}` : base;
}

function motivoOccupato(a) {
  if (a.stato === 'manutenzione') return 'in manutenzione';
  return a.occupato_da
    .map((o) => [o.cliente || 'cliente senza nome', o.fiera_nome].join(', '))
    .join(' + ');
}

/**
 * @param {object} opzioni
 * @param {number} [opzioni.selezionato] apparecchio già scelto (in modifica)
 * @param {number} [opzioni.escludi] noleggio in modifica, che non occupa sé stesso
 */
export function selettoreApparecchi({ selezionato = null, escludi = null } = {}) {
  const select = h('select', { name: 'prodotto_id', class: 'controllo', required: true },
    h('option', { value: '', disabled: true, selected: true }, 'Caricamento apparecchi…'));
  const nota = h('span', { class: 'campo__aiuto selettore__nota' });
  let scelto = selezionato;
  let richiesta = 0;

  select.addEventListener('change', () => { scelto = Number(select.value) || null; });

  async function aggiorna(from, to) {
    if (!from || !to || to < from) {
      nota.textContent = 'Scegli prima le date per vedere cosa è libero.';
      return;
    }
    // Se le date cambiano in fretta, conta solo l'ultima risposta.
    const questa = ++richiesta;
    nota.textContent = 'Controllo cosa è libero…';
    const elenco = await api.apparecchi({ from, to, escludi });
    if (questa !== richiesta) return;

    const liberi = elenco.filter((a) => a.liberi > 0);
    const occupati = elenco.filter((a) => a.liberi === 0 && a.stato !== 'manutenzione');
    const guasti = elenco.filter((a) => a.stato === 'manutenzione');
    const sceltoAncoraLibero = liberi.some((a) => a.id === scelto);
    const sceltoPerso = scelto && !sceltoAncoraLibero;

    monta(select,
      h('option', { value: '', disabled: true, selected: !sceltoAncoraLibero },
        liberi.length ? 'Scegli un apparecchio libero…' : 'Nessun apparecchio libero in queste date'),
      liberi.length ? h('optgroup', { label: `Liberi in queste date (${liberi.length})` },
        liberi.map((a) => h('option', { value: a.id, selected: a.id === scelto, title: a.nome },
          etichettaApparecchio(a)))) : null,
      occupati.length ? h('optgroup', { label: `Già noleggiati in queste date (${occupati.length})` },
        occupati.map((a) => h('option', { value: a.id, disabled: true, title: a.nome },
          `${etichettaApparecchio(a)} — ${motivoOccupato(a)}`))) : null,
      guasti.length ? h('optgroup', { label: `In manutenzione (${guasti.length})` },
        guasti.map((a) => h('option', { value: a.id, disabled: true, title: a.nome },
          etichettaApparecchio(a)))) : null);

    if (sceltoPerso) {
      scelto = null;
      nota.className = 'campo__aiuto selettore__nota selettore__nota--allerta';
      nota.textContent = 'L\'apparecchio che avevi scelto è già noleggiato in queste date: scegline un altro.';
      return;
    }
    nota.className = 'campo__aiuto selettore__nota';
    // Le date sono già nel modulo, subito sopra: qui bastano i numeri.
    nota.textContent = `${numero(liberi.length)} ${liberi.length === 1 ? 'apparecchio libero' : 'apparecchi liberi'}`
      + (occupati.length ? ` · ${numero(occupati.length)} già ${occupati.length === 1 ? 'noleggiato' : 'noleggiati'} in queste date` : ' in queste date');
  }

  return { select, nota, aggiorna };
}
