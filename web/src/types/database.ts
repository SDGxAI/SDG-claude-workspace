/**
 * Handgepflegte Typen für das Supabase-Schema (supabase/migrations/0001_init.sql).
 * Bei Schemaänderungen bitte hier synchron halten (oder später mit der
 * Supabase CLI `supabase gen types typescript` neu generieren).
 */

export type ProjectRole = "editor" | "reviewer" | "viewer";
export type ProjectStatus = "entwurf" | "in_review" | "live";
export type CommentStatus = "offen" | "erledigt";
export type ProfileStatus = "eingeladen" | "aktiv";
/** Woher eine archivierte Seitenversion stammt. */
export type PageVersionSource =
  | "manual"
  | "editor"
  | "claude"
  | "umsetzen"
  | "import"
  | "ki";

/** Eine Nachricht im KI-Bearbeiten-Chat (Meta-Ebene). */
export interface DraftMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface DetectedElement {
  id: string;
  kind: "color" | "text" | "image" | "link";
  label: string;
  default: string;
}

/** In einer Version festgehaltener Kommentar (denormalisiert für die Anzeige). */
export interface StoredComment {
  id: string;
  body: string;
  xPct: number;
  yPct: number;
  status: CommentStatus;
  createdAt: string;
  authorEmail: string;
  replies: {
    id: string;
    body: string;
    createdAt: string;
    authorEmail: string;
  }[];
}

export interface CustomButton {
  id: string;
  label: string;
  url: string;
  /** CSS-Selektor des Elements, HINTER dem der Button eingefügt wird. */
  afterSelector: string;
  color: string;
}

export interface ContentState {
  colors: Record<string, string>;
  texts: Record<string, string>;
  images: Record<string, string>;
  /** Ziel-Adressen (href) von Links/Buttons je data-edit-id. */
  links?: Record<string, string>;
  /** Bestehende Textelemente, die zu einem Link gemacht wurden (id -> url). */
  wrapLinks?: Record<string, string>;
  /** Übersetzungen (Sprache -> Schlüssel -> Wert), falls mehrsprachig. */
  i18n?: Record<string, Record<string, string>>;
  /** Selbst hinzugefügte Buttons/Links. */
  customButtons?: CustomButton[];
}

export interface Database {
  public: {
    Tables: {
      user_brand_roles: {
        Row: {
          user_id: string;
          brand: string;
          role: ProjectRole;
          created_at: string;
        };
        Insert: {
          user_id: string;
          brand: string;
          role: ProjectRole;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["user_brand_roles"]["Insert"]
        >;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          is_admin: boolean;
          status: ProfileStatus;
          must_change_password: boolean;
          avatar_url: string | null;
          brands: string[];
          last_seen_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          is_admin?: boolean;
          status?: ProfileStatus;
          must_change_password?: boolean;
          avatar_url?: string | null;
          brands?: string[];
          last_seen_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          title: string;
          brand: string;
          status: ProjectStatus;
          created_by: string | null;
          ingest_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          brand: string;
          status?: ProjectStatus;
          created_by?: string | null;
          ingest_token?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
      project_members: {
        Row: {
          project_id: string;
          user_id: string;
          role: ProjectRole;
          created_at: string;
        };
        Insert: {
          project_id: string;
          user_id: string;
          role: ProjectRole;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["project_members"]["Insert"]
        >;
        Relationships: [];
      };
      pages: {
        Row: {
          id: string;
          project_id: string;
          template_html: string;
          detected_elements: DetectedElement[];
          content_state: ContentState;
          original_filename: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          template_html: string;
          detected_elements?: DetectedElement[];
          content_state?: ContentState;
          original_filename: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["pages"]["Insert"]>;
        Relationships: [];
      };
      snapshots: {
        Row: {
          id: string;
          page_id: string;
          label: string;
          content_state: ContentState;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          page_id: string;
          label: string;
          content_state: ContentState;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["snapshots"]["Insert"]>;
        Relationships: [];
      };
      page_versions: {
        Row: {
          id: string;
          page_id: string;
          version_no: number;
          label: string | null;
          source: PageVersionSource;
          template_html: string;
          detected_elements: DetectedElement[];
          content_state: ContentState;
          comments_snapshot: StoredComment[];
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          page_id: string;
          version_no: number;
          label?: string | null;
          source?: PageVersionSource;
          template_html: string;
          detected_elements?: DetectedElement[];
          content_state?: ContentState;
          comments_snapshot?: StoredComment[];
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["page_versions"]["Insert"]
        >;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          body: string;
          project_id: string | null;
          comment_id: string | null;
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          body: string;
          project_id?: string | null;
          comment_id?: string | null;
          read?: boolean;
          created_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["notifications"]["Insert"]
        >;
        Relationships: [];
      };
      page_drafts: {
        Row: {
          page_id: string;
          html: string;
          messages: DraftMessage[];
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          page_id: string;
          html: string;
          messages?: DraftMessage[];
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["page_drafts"]["Insert"]>;
        Relationships: [];
      };
      comments: {
        Row: {
          id: string;
          page_id: string;
          parent_id: string | null;
          author_id: string | null;
          body: string;
          x_pct: number;
          y_pct: number;
          status: CommentStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          page_id: string;
          parent_id?: string | null;
          author_id?: string | null;
          body: string;
          x_pct: number;
          y_pct: number;
          status?: CommentStatus;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["comments"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_project_member: {
        Args: { p_project_id: string; p_min_role?: ProjectRole | null };
        Returns: boolean;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      next_page_version_no: {
        Args: { p_page_id: string };
        Returns: number;
      };
      effective_project_role: {
        Args: { p_project_id: string };
        Returns: string | null;
      };
    };
    Enums: {
      project_role: ProjectRole;
      project_status: ProjectStatus;
      comment_status: CommentStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
