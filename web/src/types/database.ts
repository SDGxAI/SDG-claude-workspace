/**
 * Handgepflegte Typen für das Supabase-Schema (supabase/migrations/0001_init.sql).
 * Bei Schemaänderungen bitte hier synchron halten (oder später mit der
 * Supabase CLI `supabase gen types typescript` neu generieren).
 */

export type ProjectRole = "editor" | "reviewer" | "viewer";
export type ProjectStatus = "entwurf" | "in_review" | "live";
export type CommentStatus = "offen" | "erledigt";
export type ProfileStatus = "eingeladen" | "aktiv";

export interface DetectedElement {
  id: string;
  kind: "color" | "text" | "image";
  label: string;
  default: string;
}

export interface ContentState {
  colors: Record<string, string>;
  texts: Record<string, string>;
  images: Record<string, string>;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          is_admin: boolean;
          status: ProfileStatus;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          is_admin?: boolean;
          status?: ProfileStatus;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      projects: {
        Row: {
          id: string;
          title: string;
          brand: string;
          status: ProjectStatus;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          brand: string;
          status?: ProjectStatus;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
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
      };
    };
  };
}
