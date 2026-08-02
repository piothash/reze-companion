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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      analytics_summaries: {
        Row: {
          computed_at: string
          created_at: string
          event_count: number
          id: string
          metrics: Json
          period_end: string
          period_start: string
          scope: string
          scope_key: string
          user_id: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          event_count?: number
          id?: string
          metrics?: Json
          period_end: string
          period_start: string
          scope: string
          scope_key?: string
          user_id: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          event_count?: number
          id?: string
          metrics?: Json
          period_end?: string
          period_start?: string
          scope?: string
          scope_key?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          metadata: Json
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          metadata?: Json
          user_id?: string
        }
        Relationships: []
      }
      configuration_profiles: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      engine_endpoints: {
        Row: {
          base_url: string
          created_at: string
          environment: string
          id: string
          is_active: boolean
          last_seen_at: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_url: string
          created_at?: string
          environment?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_url?: string
          created_at?: string
          environment?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      engine_snapshots: {
        Row: {
          captured_at: string
          endpoint_id: string | null
          engine_state: string | null
          id: string
          mode: string | null
          payload: Json
          user_id: string
        }
        Insert: {
          captured_at?: string
          endpoint_id?: string | null
          engine_state?: string | null
          id?: string
          mode?: string | null
          payload?: Json
          user_id: string
        }
        Update: {
          captured_at?: string
          endpoint_id?: string | null
          engine_state?: string | null
          id?: string
          mode?: string | null
          payload?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engine_snapshots_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "engine_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      event_log: {
        Row: {
          endpoint_id: string | null
          id: string
          level: string
          message: string
          occurred_at: string
          payload: Json
          source: string | null
          user_id: string
        }
        Insert: {
          endpoint_id?: string | null
          id?: string
          level?: string
          message: string
          occurred_at?: string
          payload?: Json
          source?: string | null
          user_id: string
        }
        Update: {
          endpoint_id?: string | null
          id?: string
          level?: string
          message?: string
          occurred_at?: string
          payload?: Json
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_log_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "engine_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      ledger_records: {
        Row: {
          created_at: string
          execution_intent_id: string | null
          fees: number
          id: string
          kind: string
          market_instance_id: string | null
          metadata: Json
          notional: number
          occurred_at: string
          outcome_key: string | null
          price: number
          quantity: number
          realized_pnl: number
          record_id: string
          source_event_id: string | null
          user_id: string
          window_instance_id: string | null
        }
        Insert: {
          created_at?: string
          execution_intent_id?: string | null
          fees?: number
          id?: string
          kind: string
          market_instance_id?: string | null
          metadata?: Json
          notional?: number
          occurred_at: string
          outcome_key?: string | null
          price?: number
          quantity?: number
          realized_pnl?: number
          record_id: string
          source_event_id?: string | null
          user_id: string
          window_instance_id?: string | null
        }
        Update: {
          created_at?: string
          execution_intent_id?: string | null
          fees?: number
          id?: string
          kind?: string
          market_instance_id?: string | null
          metadata?: Json
          notional?: number
          occurred_at?: string
          outcome_key?: string | null
          price?: number
          quantity?: number
          realized_pnl?: number
          record_id?: string
          source_event_id?: string | null
          user_id?: string
          window_instance_id?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          severity: string
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          severity?: string
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          severity?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_events: {
        Row: {
          attributes: Json
          causation_id: string | null
          classification: string
          correlation_id: string
          created_at: string
          event_id: string
          execution_intent_id: string | null
          id: string
          idempotency_key: string
          market_instance_id: string | null
          occurred_at: string
          payload: Json
          reason_code: string
          schema_version: string
          sequence: number
          source: string
          type: string
          user_id: string
          window_instance_id: string | null
        }
        Insert: {
          attributes?: Json
          causation_id?: string | null
          classification?: string
          correlation_id: string
          created_at?: string
          event_id: string
          execution_intent_id?: string | null
          id?: string
          idempotency_key: string
          market_instance_id?: string | null
          occurred_at: string
          payload?: Json
          reason_code: string
          schema_version: string
          sequence: number
          source: string
          type: string
          user_id: string
          window_instance_id?: string | null
        }
        Update: {
          attributes?: Json
          causation_id?: string | null
          classification?: string
          correlation_id?: string
          created_at?: string
          event_id?: string
          execution_intent_id?: string | null
          id?: string
          idempotency_key?: string
          market_instance_id?: string | null
          occurred_at?: string
          payload?: Json
          reason_code?: string
          schema_version?: string
          sequence?: number
          source?: string
          type?: string
          user_id?: string
          window_instance_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      replay_runs: {
        Row: {
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          deterministic: boolean
          event_count: number
          id: string
          mismatches: Json
          run_id: string
          source_from: string | null
          source_to: string | null
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          deterministic?: boolean
          event_count?: number
          id?: string
          mismatches?: Json
          run_id: string
          source_from?: string | null
          source_to?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          deterministic?: boolean
          event_count?: number
          id?: string
          mismatches?: Json
          run_id?: string
          source_from?: string | null
          source_to?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "operator" | "viewer"
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
  public: {
    Enums: {
      app_role: ["admin", "operator", "viewer"],
    },
  },
} as const
