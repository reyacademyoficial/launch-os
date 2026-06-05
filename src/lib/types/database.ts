export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          detail: Json
          id: string
          project_id: string
          ts: string
          user_id: string | null
        }
        Insert: {
          action: string
          detail?: Json
          id?: string
          project_id: string
          ts?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          detail?: Json
          id?: string
          project_id?: string
          ts?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_daily: {
        Row: {
          created_at: string
          date: string
          google_ads: number
          id: string
          launch_id: string
          meta_ads: number
          organico: number
          otro: number
          referidos: number
          tiktok_ads: number
          updated_at: string
          whatsapp: number
        }
        Insert: {
          created_at?: string
          date: string
          google_ads?: number
          id?: string
          launch_id: string
          meta_ads?: number
          organico?: number
          otro?: number
          referidos?: number
          tiktok_ads?: number
          updated_at?: string
          whatsapp?: number
        }
        Update: {
          created_at?: string
          date?: string
          google_ads?: number
          id?: string
          launch_id?: string
          meta_ads?: number
          organico?: number
          otro?: number
          referidos?: number
          tiktok_ads?: number
          updated_at?: string
          whatsapp?: number
        }
        Relationships: [
          {
            foreignKeyName: "launch_daily_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      launches: {
        Row: {
          asistentes: number | null
          contactos_api: number | null
          created_at: string
          date: string | null
          google_clicks: number | null
          google_investment: number | null
          google_leads: number | null
          hasta_pitch: number | null
          id: string
          ingresos_whatsapp: number | null
          meta_clicks: number | null
          meta_investment: number | null
          meta_leads: number | null
          name: string
          platforms: string[]
          project_id: string
          registrados: number | null
          revenue: number | null
          sources: Json
          status: string | null
          tiktok_clicks: number | null
          tiktok_investment: number | null
          tiktok_leads: number | null
          type: string | null
          updated_at: string
          ventas_anuales: number | null
          ventas_mensuales: number | null
          ventas_total: number | null
        }
        Insert: {
          asistentes?: number | null
          contactos_api?: number | null
          created_at?: string
          date?: string | null
          google_clicks?: number | null
          google_investment?: number | null
          google_leads?: number | null
          hasta_pitch?: number | null
          id?: string
          ingresos_whatsapp?: number | null
          meta_clicks?: number | null
          meta_investment?: number | null
          meta_leads?: number | null
          name: string
          platforms?: string[]
          project_id: string
          registrados?: number | null
          revenue?: number | null
          sources?: Json
          status?: string | null
          tiktok_clicks?: number | null
          tiktok_investment?: number | null
          tiktok_leads?: number | null
          type?: string | null
          updated_at?: string
          ventas_anuales?: number | null
          ventas_mensuales?: number | null
          ventas_total?: number | null
        }
        Update: {
          asistentes?: number | null
          contactos_api?: number | null
          created_at?: string
          date?: string | null
          google_clicks?: number | null
          google_investment?: number | null
          google_leads?: number | null
          hasta_pitch?: number | null
          id?: string
          ingresos_whatsapp?: number | null
          meta_clicks?: number | null
          meta_investment?: number | null
          meta_leads?: number | null
          name?: string
          platforms?: string[]
          project_id?: string
          registrados?: number | null
          revenue?: number | null
          sources?: Json
          status?: string | null
          tiktok_clicks?: number | null
          tiktok_investment?: number | null
          tiktok_leads?: number | null
          type?: string | null
          updated_at?: string
          ventas_anuales?: number | null
          ventas_mensuales?: number | null
          ventas_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "launches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_integrations: {
        Row: {
          account_id: string | null
          config: Json
          connected: boolean
          created_at: string
          id: string
          last_sync: string | null
          project_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          config?: Json
          connected?: boolean
          created_at?: string
          id?: string
          last_sync?: string | null
          project_id: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          config?: Json
          connected?: boolean
          created_at?: string
          id?: string
          last_sync?: string | null
          project_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_integrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_secrets: {
        Row: {
          created_at: string
          id: string
          project_id: string
          provider: string
          secret: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          provider: string
          secret: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          provider?: string
          secret?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_secrets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          business_name: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          business_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          business_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_edit_project: { Args: { p_project_id: string }; Returns: boolean }
      has_project_access: { Args: { p_project_id: string }; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      project_of_launch: { Args: { p_launch_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
