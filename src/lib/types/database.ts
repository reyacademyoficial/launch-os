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
      ai_runs: {
        Row: {
          created_at: string
          error_detail: Json | null
          id: string
          launch_id: string
          model: string
          output_text: string | null
          project_id: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_detail?: Json | null
          id?: string
          launch_id: string
          model: string
          output_text?: string | null
          project_id: string
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_detail?: Json | null
          id?: string
          launch_id?: string
          model?: string
          output_text?: string | null
          project_id?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_runs_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          launch_id: string
          metric: string
          operator: string
          threshold: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          launch_id: string
          metric: string
          operator: string
          threshold: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          launch_id?: string
          metric?: string
          operator?: string
          threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
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
      commission_rules: {
        Row: {
          created_at: string
          id: string
          launch_id: string | null
          payment_modality_id: string
          project_id: string
          type: string
          updated_at: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          launch_id?: string | null
          payment_modality_id: string
          project_id: string
          type: string
          updated_at?: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          launch_id?: string | null
          payment_modality_id?: string
          project_id?: string
          type?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_rules_payment_modality_id_fkey"
            columns: ["payment_modality_id"]
            isOneToOne: false
            referencedRelation: "payment_modalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_user_mappings: {
        Row: {
          created_at: string
          ghl_user_id: string
          id: string
          project_id: string
          team_member_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ghl_user_id: string
          id?: string
          project_id: string
          team_member_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ghl_user_id?: string
          id?: string
          project_id?: string
          team_member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_user_mappings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_user_mappings_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_runs: {
        Row: {
          error_detail: Json | null
          finished_at: string | null
          id: string
          launch_id: string
          provider: string
          rows_written: number | null
          stage: string | null
          started_at: string
          status: string
          triggered_by: string | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          error_detail?: Json | null
          finished_at?: string | null
          id?: string
          launch_id: string
          provider: string
          rows_written?: number | null
          stage?: string | null
          started_at?: string
          status: string
          triggered_by?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          error_detail?: Json | null
          finished_at?: string | null
          id?: string
          launch_id?: string
          provider?: string
          rows_written?: number | null
          stage?: string | null
          started_at?: string
          status?: string
          triggered_by?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_runs_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
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
      launch_daily_ads: {
        Row: {
          clicks: number
          date: string
          id: string
          impressions: number
          launch_id: string
          leads: number
          provider: string
          raw: Json
          spend: number
          synced_at: string
        }
        Insert: {
          clicks?: number
          date: string
          id?: string
          impressions?: number
          launch_id: string
          leads?: number
          provider: string
          raw?: Json
          spend?: number
          synced_at?: string
        }
        Update: {
          clicks?: number
          date?: string
          id?: string
          impressions?: number
          launch_id?: string
          leads?: number
          provider?: string
          raw?: Json
          spend?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_daily_ads_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_opportunities: {
        Row: {
          assigned_to_ghl_user: string | null
          contact_external_id: string | null
          created_at: string
          created_at_ghl: string | null
          external_id: string
          id: string
          launch_id: string
          monetary_value: number | null
          pipeline_id: string | null
          pipeline_stage_id: string | null
          project_id: string
          raw: Json
          source: string | null
          status: string
          synced_at: string
          updated_at: string
          updated_at_ghl: string | null
          won_at: string | null
        }
        Insert: {
          assigned_to_ghl_user?: string | null
          contact_external_id?: string | null
          created_at?: string
          created_at_ghl?: string | null
          external_id: string
          id?: string
          launch_id: string
          monetary_value?: number | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          project_id: string
          raw?: Json
          source?: string | null
          status: string
          synced_at?: string
          updated_at?: string
          updated_at_ghl?: string | null
          won_at?: string | null
        }
        Update: {
          assigned_to_ghl_user?: string | null
          contact_external_id?: string | null
          created_at?: string
          created_at_ghl?: string | null
          external_id?: string
          id?: string
          launch_id?: string
          monetary_value?: number | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          project_id?: string
          raw?: Json
          source?: string | null
          status?: string
          synced_at?: string
          updated_at?: string
          updated_at_ghl?: string | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "launch_opportunities_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launch_opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      launch_secrets: {
        Row: {
          created_at: string
          id: string
          launch_id: string
          provider: string
          secret: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          launch_id: string
          provider: string
          secret: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          launch_id?: string
          provider?: string
          secret?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "launch_secrets_launch_id_fkey"
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
          closed_at: string | null
          contactos_api: number | null
          created_at: string
          date: string | null
          date_end: string | null
          date_start: string | null
          dur_calentamiento: number
          dur_captacion: number
          dur_cierre: number
          dur_compra: number
          google_clicks: number | null
          google_investment: number | null
          google_leads: number | null
          hasta_pitch: number | null
          id: string
          ingresos_whatsapp: number | null
          integration_config: Json
          is_evergreen: boolean
          launch_date: string | null
          meta_clicks: number | null
          meta_investment: number | null
          meta_leads: number | null
          name: string
          platforms: string[]
          project_id: string
          recycle_target_launch_id: string | null
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
          closed_at?: string | null
          contactos_api?: number | null
          created_at?: string
          date?: string | null
          date_end?: string | null
          date_start?: string | null
          dur_calentamiento?: number
          dur_captacion?: number
          dur_cierre?: number
          dur_compra?: number
          google_clicks?: number | null
          google_investment?: number | null
          google_leads?: number | null
          hasta_pitch?: number | null
          id?: string
          ingresos_whatsapp?: number | null
          integration_config?: Json
          is_evergreen?: boolean
          launch_date?: string | null
          meta_clicks?: number | null
          meta_investment?: number | null
          meta_leads?: number | null
          name: string
          platforms?: string[]
          project_id: string
          recycle_target_launch_id?: string | null
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
          closed_at?: string | null
          contactos_api?: number | null
          created_at?: string
          date?: string | null
          date_end?: string | null
          date_start?: string | null
          dur_calentamiento?: number
          dur_captacion?: number
          dur_cierre?: number
          dur_compra?: number
          google_clicks?: number | null
          google_investment?: number | null
          google_leads?: number | null
          hasta_pitch?: number | null
          id?: string
          ingresos_whatsapp?: number | null
          integration_config?: Json
          is_evergreen?: boolean
          launch_date?: string | null
          meta_clicks?: number | null
          meta_investment?: number | null
          meta_leads?: number | null
          name?: string
          platforms?: string[]
          project_id?: string
          recycle_target_launch_id?: string | null
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
          {
            foreignKeyName: "launches_recycle_target_launch_id_fkey"
            columns: ["recycle_target_launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          contact: string | null
          created_at: string
          email: string | null
          external_id: string | null
          id: string
          launch_id: string | null
          name: string
          notes: string | null
          phone_normalized: string | null
          pinned_to_kanban: boolean
          project_id: string
          recycled_from_launch_id: string | null
          source: string
          status: string
          team_member_id: string | null
          updated_at: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          id?: string
          launch_id?: string | null
          name: string
          notes?: string | null
          phone_normalized?: string | null
          pinned_to_kanban?: boolean
          project_id: string
          recycled_from_launch_id?: string | null
          source?: string
          status?: string
          team_member_id?: string | null
          updated_at?: string
        }
        Update: {
          contact?: string | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          id?: string
          launch_id?: string | null
          name?: string
          notes?: string | null
          phone_normalized?: string | null
          pinned_to_kanban?: boolean
          project_id?: string
          recycled_from_launch_id?: string | null
          source?: string
          status?: string
          team_member_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_recycled_from_launch_id_fkey"
            columns: ["recycled_from_launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          dedup_key: string | null
          id: string
          launch_id: string | null
          metadata: Json
          project_id: string
          read_at: string | null
          severity: string
          target_role: string | null
          target_user_id: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          launch_id?: string | null
          metadata?: Json
          project_id: string
          read_at?: string | null
          severity?: string
          target_role?: string | null
          target_user_id?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          dedup_key?: string | null
          id?: string
          launch_id?: string | null
          metadata?: Json
          project_id?: string
          read_at?: string | null
          severity?: string
          target_role?: string | null
          target_user_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_modalities: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          project_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_modalities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          notes: string | null
          paid_at: string
          sale_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          sale_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          sale_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          full_name: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
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
      projections: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inputs: Json
          mode: string
          name: string
          outputs: Json
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inputs?: Json
          mode: string
          name: string
          outputs?: Json
          project_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inputs?: Json
          mode?: string
          name?: string
          outputs?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projections_project_id_fkey"
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
      sales: {
        Row: {
          closed_at: string
          created_at: string
          id: string
          lead_id: string
          payment_modality_id: string
          project_id: string
          team_member_id: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          closed_at?: string
          created_at?: string
          id?: string
          lead_id: string
          payment_modality_id: string
          project_id: string
          team_member_id?: string | null
          total_amount: number
          updated_at?: string
        }
        Update: {
          closed_at?: string
          created_at?: string
          id?: string
          lead_id?: string
          payment_modality_id?: string
          project_id?: string
          team_member_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_payment_modality_id_fkey"
            columns: ["payment_modality_id"]
            isOneToOne: false
            referencedRelation: "payment_modalities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          active: boolean
          commission_rate: number | null
          created_at: string
          id: string
          name: string
          project_id: string
          role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          commission_rate?: number | null
          created_at?: string
          id?: string
          name: string
          project_id: string
          role: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          commission_rate?: number | null
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_edit_launches_in: { Args: { p_project_id: string }; Returns: boolean }
      can_edit_project: { Args: { p_project_id: string }; Returns: boolean }
      create_notification: {
        Args: {
          p_body?: string
          p_dedup_key?: string
          p_launch_id?: string
          p_metadata?: Json
          p_project_id: string
          p_severity?: string
          p_target_role?: string
          p_target_user_id?: string
          p_title: string
          p_type: string
        }
        Returns: string
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      expire_stale_integration_runs: {
        Args: { p_threshold?: string }
        Returns: number
      }
      has_project_access: { Args: { p_project_id: string }; Returns: boolean }
      is_cliente: { Args: never; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      project_of_launch: { Args: { p_launch_id: string }; Returns: string }
      project_of_sale: { Args: { p_sale_id: string }; Returns: string }
      recycle_evergreen_leads: {
        Args: { p_launch_id: string }
        Returns: number
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      user_role_is_team: { Args: never; Returns: boolean }
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
