/** Gemeinsame Typen für Client und Server. */

export type Project = {
  id: string;
  name: string;
  ort: string | null;
  created_at: string;
  /** Zeitraum des Terminplans, JJJJ-MM-TT. Leer = aus den Arbeiten abgeleitet. */
  schedule_start?: string | null;
  schedule_end?: string | null;
  /** Gruppe in der Seitenleiste. */
  status?: ProjektStatus;
  order_index?: number;
};

export type ProjektStatus = 'planung' | 'umsetzung' | 'abschluss' | 'abgeschlossen';

export const PROJEKT_STATUS: Array<{ wert: ProjektStatus; name: string }> = [
  { wert: 'planung', name: 'In Planung' },
  { wert: 'umsetzung', name: 'In Umsetzung' },
  { wert: 'abschluss', name: 'In Abschluss' },
  { wert: 'abgeschlossen', name: 'Abgeschlossen' },
];

/** Eine Zeile im Balkenplan. */
export type ScheduleTask = {
  id: string;
  project_id: string;
  /** Wer die Arbeit ausführt, als freier Text – z.B. 'Gärtner', 'Kran'. */
  responsible: string | null;
  /** Wer sie organisiert: 'admin:<user_id>' oder 'supplier:<id>', sonst null. */
  owner: string | null;
  label: string;
  start_date: string;
  end_date: string;
  color: string;
  order_index: number;
  /** Anmerkungen und Terminvorschläge zu dieser Arbeit. */
  notes: ScheduleNote[];
};

export type ScheduleNote = {
  id: string;
  task_id: string;
  text: string;
  author: string;
  author_supplier_id: string | null;
  vorschlag_start: string | null;
  vorschlag_ende: string | null;
  status: 'offen' | 'uebernommen' | 'abgelehnt';
  created_at: string;
};

export type Supplier = {
  id: string;
  name: string | null;
  firma: string | null;
  gewerk: string | null;
  kontakt: string | null;
  email: string | null;
  /** Nur für den Admin gesetzt – Lieferanten bekommen fremde Codes nie zu sehen. */
  access_code?: string | null;
  created_at?: string;
  /** Kurzlebige Signatur auf das Profilbild, null = keines hinterlegt. */
  avatar_url?: string | null;
};

/** Bauherrenvertreter, wie ihn auch ein Lieferant sehen darf – ohne E-Mail. */
export type AdminProfile = {
  user_id: string;
  name: string;
  firma: string;
  funktion: string | null;
  /** Kurzlebige Signatur auf das Profilbild, null = keines hinterlegt. */
  avatar_url?: string | null;
};

export type TodoComment = {
  id: string;
  todo_id: string;
  text: string;
  author: string;
  author_supplier_id: string | null;
  created_at: string;
};

export type Todo = {
  id: string;
  project_id: string;
  text: string;
  /** 'internal' | 'admin:<user_id>' | 'supplier:<supplier_id>' – siehe lib/assignee.ts */
  assigned_to: string;
  /**
   * Alle Zuständigen. assigned_to ist immer der erste Eintrag – ältere Aufgaben
   * und Einbauten, die nur einen Zuständigen kennen, funktionieren dadurch weiter.
   */
  assignees: string[];
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  created_by: string;
  created_by_supplier_id: string | null;
  created_at: string;
  edited_at: string | null;
  order_index: number;
  /** "zu erledigen bis" als reines Datum, z.B. "2026-08-20". */
  due_date: string | null;
  comments: TodoComment[];
};

export type ProjectFile = {
  id: string;
  project_id: string;
  todo_id: string | null;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  uploaded_by_supplier_id: string | null;
  uploaded_at: string;
  /** Kurzlebige Signed URL auf die Vorschau (Bilder) bzw. die Datei selbst. */
  thumb_url: string | null;
  can_delete: boolean;
  /**
   * Ordner im Register "Offerten" – null bei gewöhnlichen Dateien.
   * Siehe lib/offers.ts. Offerten sehen nur wir und der Lieferant, der sie
   * hochgeladen hat.
   */
  offer_folder: string | null;
};

export type ActivityEntry = {
  id: string;
  project_id: string;
  actor_name: string;
  text: string;
  icon: string | null;
  created_at: string;
};

export type SessionInfo =
  | {
      kind: 'admin';
      userId: string;
      name: string;
      firma: string;
      funktion: string | null;
      email: string | null;
      /** false = SUPABASE_JWT_SECRET fehlt, RLS greift für Lieferanten nicht. */
      rlsEnforced: boolean;
      mailEnabled: boolean;
      avatarUrl: string | null;
    }
  | {
      kind: 'supplier';
      supplierId: string;
      name: string;
      firma: string | null;
      avatarUrl: string | null;
    };

export type ProjectDetail = {
  project: Project;
  todos: Todo[];
  files: ProjectFile[];
  activity: ActivityEntry[];
  /** Lieferanten mit Zugriff auf dieses Projekt. */
  accessIds: string[];
  /** Namen aller relevanten Lieferanten (für Zuweisungs-Anzeige). */
  suppliers: Supplier[];
  /** Weitere Lieferanten ohne Zugriff – nur für den Admin gefüllt. */
  otherSuppliers: Supplier[];
  /** Bauherrenvertreter, denen eine Aufgabe zugewiesen werden kann. */
  admins: AdminProfile[];
  /** Balkenplan des Projekts. */
  schedule: ScheduleTask[];
};
