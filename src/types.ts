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
  /**
   * Bild der Liegenschaft – kurzlebige Signatur, null = keines hinterlegt.
   * Gefüllt nur in der Projektansicht, nicht in der Liste der Seitenleiste.
   */
  bild_url?: string | null;
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
  /**
   * Alle Zuständigen – an einem Gewerk sind oft zwei dran. owner ist der erste
   * Eintrag; ohne Migration 0022 bleibt die Liste leer und owner gilt allein.
   */
  owners: string[];
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
  /**
   * Alter Zugangscode. Wird nirgends mehr angezeigt und führt nirgends mehr
   * hinein – die Anmeldung läuft ausschliesslich über E-Mail und Passwort.
   * Die Spalte bleibt, damit alte Zeilen nicht angefasst werden müssen.
   */
  access_code?: string | null;
  /**
   * Das von uns vergebene Passwort im Klartext – nur für den Admin gesetzt,
   * damit wir nachlesen können, wem wir was mitgeteilt haben.
   */
  start_passwort?: string | null;
  /** Wann zuletzt ein Passwort vergeben wurde. Null = die Person kommt nicht herein. */
  passwort_gesetzt_am?: string | null;
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
  /**
   * true = nur wir und die beteiligten Lieferantenfirmen sehen die Aufgabe.
   * false (Standard) = alle am Projekt.
   */
  vertraulich: boolean;
  /**
   * true = einer der festen Schritte des Projekts, kein Tagesgeschäft.
   * Sonst eine gewöhnliche Aufgabe – nur oben abgesetzt dargestellt.
   */
  meilenstein: boolean;
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

export type FileComment = {
  id: string;
  file_id: string;
  text: string;
  author: string;
  author_supplier_id: string | null;
  created_at: string;
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
  /**
   * Ordner im Register "Dokumente" – null, wenn die Datei woanders liegt.
   * Dokumente sehen alle, die Zugriff auf das Projekt haben: Pläne und Schemas
   * braucht jedes Gewerk.
   */
  document_folder: string | null;
  /** Anmerkungen zur Datei – gelesen und geschrieben von uns und der Firma. */
  comments: FileComment[];
  /** Betrag der Offerte in Franken, null = nicht erfasst. */
  offer_amount: number | null;
  /** Stand der Offerte; null gilt als 'eingereicht'. */
  offer_status: OffertenStand | null;
};

export type OffertenStand = 'eingereicht' | 'geprueft' | 'vergeben' | 'abgelehnt';

// Die gespeicherten Werte bleiben stabil, angezeigt werden die Wunschnamen.
export const OFFERTEN_STAENDE: Array<{ wert: OffertenStand; name: string }> = [
  { wert: 'eingereicht', name: 'Eingereicht' },
  { wert: 'geprueft', name: 'Prüfung' },
  { wert: 'vergeben', name: 'Angenommen' },
  { wert: 'abgelehnt', name: 'Abgelehnt' },
];

/**
 * Eine Person im Register "Kontakte" – wir und die Lieferanten in einer Liste.
 * Nur für die Swiss Solar Ventures AG: Hier stehen die Zugänge und die
 * Kontaktdaten sämtlicher Firmen beieinander.
 */
export type Kontakt = {
  art: 'admin' | 'lieferant';
  id: string;
  name: string;
  firma: string;
  /** Funktion bei uns bzw. Gewerk beim Lieferanten. */
  rolle: string | null;
  kontakt: string | null;
  email: string | null;
  avatarUrl: string | null;
  /** Kennungen der Projekte, für die der Lieferant freigegeben ist. */
  projekte: string[];
  /**
   * Bekommt diese Person Benachrichtigungen per Mail?
   *
   * Bei uns immer, das entscheidet die Firmen-Domain. Bei Lieferanten je
   * Person freizuschalten – standardmässig nein.
   */
  mailAn: boolean;
  /**
   * Hat diese Person ein Passwort für die Anmeldung?
   *
   * Bei uns immer – dort läuft die Anmeldung über den Anmeldedienst. Bei
   * Lieferanten heisst false: Diese Person kommt gar nicht herein, solange wir
   * ihr kein Passwort vergeben haben.
   */
  hatPasswort: boolean;
  /**
   * Das von uns vergebene Passwort im Klartext – als Merkhilfe, wem man was
   * mitgeteilt hat. Vertretbar, weil die Lieferanten ihr Passwort nicht selbst
   * wählen: Es kommt immer von uns und gilt nur für diese App.
   */
  startPasswort: string | null;
};

/**
 * Eine gespeicherte Schrittfolge – die Meilensteine eines typischen Projekts.
 * Nur der Text; Frist und Zuständige gehören zum einzelnen Bau.
 */
export type MeilensteinVorlage = {
  id: string;
  name: string;
  schritte: string[];
};

/**
 * Eine Angabe zum Objekt: Zugang, Standort, Parkieren, Besonderheiten.
 *
 * Freie Zeile aus Titel und Text statt fester Felder – auf der nächsten
 * Baustelle ist es die Alarmanlage, danach der Kranstellplatz.
 */
export type ProjektInfo = {
  id: string;
  titel: string;
  text: string | null;
  sortierung: number;
};

/**
 * Eine Person am Bau ohne App-Zugang – Hauswart, Verwaltung, Bauherr,
 * Ansprechperson vor Ort. Reine Adressangabe, kein Zugriffsrecht.
 */
export type ProjektKontakt = {
  id: string;
  /** Wofür die Person zuständig ist. Das Einzige, was Pflicht ist. */
  rolle: string;
  name: string | null;
  firma: string | null;
  telefon: string | null;
  email: string | null;
  notiz: string | null;
  /**
   * An welchen Wochentagen die Person vor Ort ist: 1 = Montag … 7 = Sonntag.
   * Leer heisst "immer vor Ort" und nicht "nie" – siehe lib/tage.ts.
   */
  tage: number[];
  sortierung: number;
};

/** Ein weggeworfener Eintrag, wie ihn der Papierkorb zeigt. */
export type PapierkorbEintrag = {
  art: 'todo' | 'datei';
  id: string;
  /** Aus welchem Projekt der Eintrag stammt – dorthin geht auch die Aktion. */
  projectId: string;
  projektName: string;
  text: string;
  zusatz: string | null;
  deletedAt: string;
  deletedBy: string | null;
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
      /** false = Lieferanten bekommen keine automatischen Mails (Standard). */
      mailAnLieferanten: boolean;
      avatarUrl: string | null;
    }
  | {
      kind: 'supplier';
      supplierId: string;
      name: string;
      firma: string | null;
      avatarUrl: string | null;
      /** Die eigene Adresse – zugleich der Benutzername bei der Anmeldung. */
      email: string | null;
      /** true = Anmeldung mit E-Mail und Passwort ist eingerichtet. */
      hatPasswort: boolean;
    };

/**
 * Ein Ordner im Register "Dokumente". Zwei Ebenen: Ein Hauptordner hat
 * parent_id = null, ein Unterordner zeigt auf seinen Hauptordner.
 */
export type DokumentOrdner = {
  id: string;
  name: string;
  position: number;
  parent_id: string | null;
};

export type ProjectDetail = {
  project: Project;
  todos: Todo[];
  files: ProjectFile[];
  /** Gliederung des Registers "Dokumente"; leer ohne Migration 0019. */
  documentFolders: DokumentOrdner[];
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
