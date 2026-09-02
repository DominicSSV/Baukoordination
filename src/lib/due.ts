/** Fristen sind reine Kalendertage im Format JJJJ-MM-TT, ohne Uhrzeit und Zeitzone. */

const MUSTER = /^\d{4}-\d{2}-\d{2}$/;

export function parseDueDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!MUSTER.test(trimmed)) {
    throw new Error('Frist bitte als Datum angeben (JJJJ-MM-TT).');
  }

  const datum = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(datum.getTime())) {
    throw new Error('Diese Frist ist kein gültiges Datum.');
  }

  return trimmed;
}

/** Heutiger Kalendertag als JJJJ-MM-TT. */
export function heute(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDueDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Überfällig = Frist liegt vor heute und die Aufgabe ist noch offen. */
export function istUeberfaellig(
  due: string | null | undefined,
  done: boolean,
): boolean {
  if (!due || done) return false;
  return due < heute();
}

/** Heute fällig – verdient einen Hinweis, ist aber noch nicht überfällig. */
export function istHeuteFaellig(
  due: string | null | undefined,
  done: boolean,
): boolean {
  if (!due || done) return false;
  return due === heute();
}

/**
 * Aufgaben nach Frist ordnen – die Reihenfolge, in der man sie abarbeitet.
 *
 * Zwei Blöcke:
 *
 * 1. Mit Frist, die früheste zuoberst. Was überfällig ist, steht damit von
 *    selbst ganz oben.
 * 2. Ohne Frist. Sie kämen sonst ganz nach oben – kein Datum ist kein "sofort".
 *    Untereinander bleibt hier die selbst gewählte Reihenfolge; bei frisch
 *    übernommenen Meilensteinen ist das die Reihenfolge des Bauablaufs.
 *
 * Erledigte bleiben, wo sie sind: Eine abgehakte Aufgabe rutscht nicht nach
 * unten. Wer eine Liste abarbeitet, will sehen, was daneben schon erledigt ist
 * – und nicht jedes Häkchen mit einem Sprung quittiert bekommen.
 *
 * Bei gleicher Frist entscheidet die selbst gewählte Reihenfolge.
 *
 * Sortiert wird eine Kopie: Die Liste aus dem Server bleibt unangetastet.
 */
export function fristBlock(t: { due_date: string | null }): 0 | 1 {
  return t.due_date ? 0 : 1;
}

export function nachFrist<
  T extends {
    due_date: string | null;
    order_index: number;
  },
>(aufgaben: T[]): T[] {
  return [...aufgaben].sort((a, b) => {
    const blockA = fristBlock(a);
    const blockB = fristBlock(b);
    if (blockA !== blockB) return blockA - blockB;

    if (a.due_date && b.due_date && a.due_date !== b.due_date) {
      return a.due_date.localeCompare(b.due_date);
    }

    return a.order_index - b.order_index;
  });
}
