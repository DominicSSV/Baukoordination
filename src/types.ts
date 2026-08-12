/** Gemeinsame Typen für Client und Server. */

export type Project = {
  id: string;
  name: string;
  ort: string | null;
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
};

/** Bauherrenvertreter, wie ihn auch ein Lieferant sehen darf – ohne E-Mail. */
export type AdminProfile = {
  user_id: string;
  name: string;
  firma: string;
  funktion: string | null;
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
    }
  | {
      kind: 'supplier';
      supplierId: string;
      name: string;
      firma: string | null;
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
};
