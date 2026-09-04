export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_users: {
        Row: {
          active: boolean;
          created_at: string;
          email: string;
          id: string;
          role: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email: string;
          id?: string;
          role?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string;
          id?: string;
          role?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      availability_exceptions: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          is_closed: boolean;
          note: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          id?: string;
          is_closed?: boolean;
          note?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          is_closed?: boolean;
          note?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      availability_slots: {
        Row: {
          active: boolean;
          capacity: number;
          created_at: string;
          date: string;
          end_time: string;
          id: string;
          start_time: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          capacity?: number;
          created_at?: string;
          date: string;
          end_time: string;
          id?: string;
          start_time: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          capacity?: number;
          created_at?: string;
          date?: string;
          end_time?: string;
          id?: string;
          start_time?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      booking_requests: {
        Row: {
          address: string | null;
          created_at: string;
          customer_email: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          id: string;
          is_test: boolean;
          linked_booking_id: string | null;
          missing_fields: Json | null;
          neighborhood: string | null;
          payment_method: string | null;
          preferred_date: string | null;
          preferred_time: string | null;
          raw_payload: Json | null;
          service_type: string | null;
          source: string;
          status: string;
          updated_at: string;
          vehicle_type: string | null;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          is_test?: boolean;
          linked_booking_id?: string | null;
          missing_fields?: Json | null;
          neighborhood?: string | null;
          payment_method?: string | null;
          preferred_date?: string | null;
          preferred_time?: string | null;
          raw_payload?: Json | null;
          service_type?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          is_test?: boolean;
          linked_booking_id?: string | null;
          missing_fields?: Json | null;
          neighborhood?: string | null;
          payment_method?: string | null;
          preferred_date?: string | null;
          preferred_time?: string | null;
          raw_payload?: Json | null;
          service_type?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
          vehicle_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_requests_linked_booking_id_fkey";
            columns: ["linked_booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          address: string;
          address_type: string;
          address_lat: number | null;
          address_lng: number | null;
          assigned_operator_id: string | null;
          assigned_vehicle_label: string | null;
          operator_notes: string | null;
          booking_source: string;
          booking_status: string;
          coverage_zone_id: string | null;
          coverage_zone_name: string | null;
          created_at: string;
          customer_subscription_id: string | null;
          customer_email: string | null;
          customer_id: string | null;
          customer_name: string;
          customer_phone: string;
          discount_total: number;
          duration_minutes: number;
          extras_total: number;
          formatted_address: string | null;
          id: string;
          idempotency_key: string | null;
          location_validation_payload: Json | null;
          location_validation_status: string | null;
          marketing_campaign: string | null;
          marketing_content: string | null;
          marketing_medium: string | null;
          marketing_source: string | null;
          marketing_term: string | null;
          neighborhood: string;
          notes: string | null;
          payment_method: string;
          payment_status: string;
          place_id: string | null;
          price: number;
          price_breakdown: Json;
          private_extra_details: string | null;
          private_lot: string | null;
          private_neighborhood_id: string | null;
          private_neighborhood_name: string | null;
          qr_code_slug: string | null;
          referrer_url: string | null;
          gclid: string | null;
          gbraid: string | null;
          wbraid: string | null;
          scheduled_date: string;
          scheduled_time: string;
          selected_extras: Json;
          service_id: string | null;
          service_name: string;
          subtotal_before_discounts: number | null;
          subscription_usage_id: string | null;
          updated_at: string;
          vehicle_count: number;
          vehicle_surcharge: number;
          vehicle_type: string;
          landing_url: string | null;
        };
        Insert: {
          address: string;
          address_type?: string;
          address_lat?: number | null;
          address_lng?: number | null;
          booking_source?: string;
          booking_status?: string;
          coverage_zone_id?: string | null;
          coverage_zone_name?: string | null;
          created_at?: string;
          customer_subscription_id?: string | null;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name: string;
          customer_phone: string;
          discount_total?: number;
          duration_minutes: number;
          extras_total?: number;
          formatted_address?: string | null;
          id?: string;
          idempotency_key?: string | null;
          location_validation_payload?: Json | null;
          location_validation_status?: string | null;
          marketing_campaign?: string | null;
          marketing_content?: string | null;
          marketing_medium?: string | null;
          marketing_source?: string | null;
          marketing_term?: string | null;
          neighborhood: string;
          notes?: string | null;
          payment_method?: string;
          payment_status?: string;
          place_id?: string | null;
          price: number;
          price_breakdown?: Json;
          private_extra_details?: string | null;
          private_lot?: string | null;
          private_neighborhood_id?: string | null;
          private_neighborhood_name?: string | null;
          qr_code_slug?: string | null;
          referrer_url?: string | null;
          gclid?: string | null;
          gbraid?: string | null;
          wbraid?: string | null;
          scheduled_date: string;
          scheduled_time: string;
          selected_extras?: Json;
          service_id?: string | null;
          service_name: string;
          subtotal_before_discounts?: number | null;
          subscription_usage_id?: string | null;
          updated_at?: string;
          vehicle_count?: number;
          vehicle_surcharge?: number;
          vehicle_type: string;
          landing_url?: string | null;
        };
        Update: {
          address?: string;
          address_type?: string;
          address_lat?: number | null;
          address_lng?: number | null;
          booking_source?: string;
          booking_status?: string;
          coverage_zone_id?: string | null;
          coverage_zone_name?: string | null;
          created_at?: string;
          customer_subscription_id?: string | null;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name?: string;
          customer_phone?: string;
          discount_total?: number;
          duration_minutes?: number;
          extras_total?: number;
          formatted_address?: string | null;
          id?: string;
          idempotency_key?: string | null;
          location_validation_payload?: Json | null;
          location_validation_status?: string | null;
          marketing_campaign?: string | null;
          marketing_content?: string | null;
          marketing_medium?: string | null;
          marketing_source?: string | null;
          marketing_term?: string | null;
          neighborhood?: string;
          notes?: string | null;
          payment_method?: string;
          payment_status?: string;
          place_id?: string | null;
          price?: number;
          price_breakdown?: Json;
          private_extra_details?: string | null;
          private_lot?: string | null;
          private_neighborhood_id?: string | null;
          private_neighborhood_name?: string | null;
          qr_code_slug?: string | null;
          referrer_url?: string | null;
          gclid?: string | null;
          gbraid?: string | null;
          wbraid?: string | null;
          scheduled_date?: string;
          scheduled_time?: string;
          selected_extras?: Json;
          service_id?: string | null;
          service_name?: string;
          subtotal_before_discounts?: number | null;
          subscription_usage_id?: string | null;
          updated_at?: string;
          vehicle_count?: number;
          vehicle_surcharge?: number;
          vehicle_type?: string;
          landing_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_coverage_zone_id_fkey";
            columns: ["coverage_zone_id"];
            isOneToOne: false;
            referencedRelation: "coverage_zones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_private_neighborhood_id_fkey";
            columns: ["private_neighborhood_id"];
            isOneToOne: false;
            referencedRelation: "private_neighborhoods";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_units: {
        Row: {
          booking_id: string;
          created_at: string;
          discount_amount: number;
          discount_rate: number;
          duration_minutes: number;
          extras_total: number;
          id: string;
          price_breakdown: Json;
          selected_extras: Json;
          service_id: string | null;
          service_name: string;
          service_price: number;
          total_price: number;
          unit_index: number;
          vehicle_surcharge: number;
          vehicle_type: string;
        };
        Insert: {
          booking_id: string;
          created_at?: string;
          discount_amount?: number;
          discount_rate?: number;
          duration_minutes?: number;
          extras_total?: number;
          id?: string;
          price_breakdown?: Json;
          selected_extras?: Json;
          service_id?: string | null;
          service_name: string;
          service_price?: number;
          total_price?: number;
          unit_index: number;
          vehicle_surcharge?: number;
          vehicle_type: string;
        };
        Update: {
          booking_id?: string;
          created_at?: string;
          discount_amount?: number;
          discount_rate?: number;
          duration_minutes?: number;
          extras_total?: number;
          id?: string;
          price_breakdown?: Json;
          selected_extras?: Json;
          service_id?: string | null;
          service_name?: string;
          service_price?: number;
          total_price?: number;
          unit_index?: number;
          vehicle_surcharge?: number;
          vehicle_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_units_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_units_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      botmaker_conversations: {
        Row: {
          botmaker_conversation_id: string | null;
          channel: string | null;
          created_at: string;
          customer_name: string | null;
          customer_phone: string | null;
          id: string;
          last_message: string | null;
          last_message_at: string | null;
          last_sender_type: string | null;
          linked_booking_id: string | null;
          linked_booking_request_id: string | null;
          linked_customer_id: string | null;
          raw_payload: Json | null;
          updated_at: string;
        };
        Insert: {
          botmaker_conversation_id?: string | null;
          channel?: string | null;
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          last_message?: string | null;
          last_message_at?: string | null;
          last_sender_type?: string | null;
          linked_booking_id?: string | null;
          linked_booking_request_id?: string | null;
          linked_customer_id?: string | null;
          raw_payload?: Json | null;
          updated_at?: string;
        };
        Update: {
          botmaker_conversation_id?: string | null;
          channel?: string | null;
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          last_message?: string | null;
          last_message_at?: string | null;
          last_sender_type?: string | null;
          linked_booking_id?: string | null;
          linked_booking_request_id?: string | null;
          linked_customer_id?: string | null;
          raw_payload?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "botmaker_conversations_linked_booking_id_fkey";
            columns: ["linked_booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "botmaker_conversations_linked_booking_request_id_fkey";
            columns: ["linked_booking_request_id"];
            isOneToOne: false;
            referencedRelation: "booking_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "botmaker_conversations_linked_customer_id_fkey";
            columns: ["linked_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_assignments_botmaker_conversation_id_fkey";
            columns: ["id"];
            isOneToOne: false;
            referencedRelation: "conversation_assignments";
            referencedColumns: ["botmaker_conversation_id"];
          },
        ];
      };
      botmaker_events: {
        Row: {
          auth_valid: boolean;
          channel: string | null;
          conversation_id: string | null;
          created_at: string;
          customer_name: string | null;
          customer_phone: string | null;
          event_type: string | null;
          id: string;
          message_text: string | null;
          raw_payload: Json | null;
          sender_type: string | null;
        };
        Insert: {
          auth_valid?: boolean;
          channel?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          event_type?: string | null;
          id?: string;
          message_text?: string | null;
          raw_payload?: Json | null;
          sender_type?: string | null;
        };
        Update: {
          auth_valid?: boolean;
          channel?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          event_type?: string | null;
          id?: string;
          message_text?: string | null;
          raw_payload?: Json | null;
          sender_type?: string | null;
        };
        Relationships: [];
      };
      botmaker_messages: {
        Row: {
          botmaker_message_id: string | null;
          channel: string | null;
          conversation_id: string | null;
          created_at: string;
          customer_name: string | null;
          customer_phone: string | null;
          direction: string | null;
          id: string;
          message_text: string | null;
          message_type: string | null;
          raw_payload: Json | null;
          sender_type: string | null;
        };
        Insert: {
          botmaker_message_id?: string | null;
          channel?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          direction?: string | null;
          id?: string;
          message_text?: string | null;
          message_type?: string | null;
          raw_payload?: Json | null;
          sender_type?: string | null;
        };
        Update: {
          botmaker_message_id?: string | null;
          channel?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          direction?: string | null;
          id?: string;
          message_text?: string | null;
          message_type?: string | null;
          raw_payload?: Json | null;
          sender_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "botmaker_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "botmaker_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_agent_outbound_messages: {
        Row: {
          conversation_id: string;
          created_at: string;
          error: string | null;
          id: string;
          job_id: string;
          lease_token: string | null;
          message_text: string;
          provider_message_id: string | null;
          sent_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          job_id: string;
          lease_token?: string | null;
          message_text: string;
          provider_message_id?: string | null;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          job_id?: string;
          lease_token?: string | null;
          message_text?: string;
          provider_message_id?: string | null;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_agent_outbound_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_agent_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_agent_outbound_messages_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "whatsapp_agent_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_agent_jobs: {
        Row: {
          attempts: number;
          conversation_id: string;
          created_at: string;
          dry_run: boolean;
          external_message_id: string | null;
          id: string;
          last_error: string | null;
          lease_expires_at: string | null;
          lease_token: string | null;
          locked_at: string | null;
          message_text: string;
          source: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          conversation_id: string;
          created_at?: string;
          dry_run?: boolean;
          external_message_id?: string | null;
          id?: string;
          last_error?: string | null;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          locked_at?: string | null;
          message_text: string;
          source?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          conversation_id?: string;
          created_at?: string;
          dry_run?: boolean;
          external_message_id?: string | null;
          id?: string;
          last_error?: string | null;
          lease_expires_at?: string | null;
          lease_token?: string | null;
          locked_at?: string | null;
          message_text?: string;
          source?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_agent_jobs_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_agent_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_agent_conversations: {
        Row: {
          booking_id: string | null;
          botmaker_conversation_id: string | null;
          created_at: string;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string;
          draft: Json;
          id: string;
          is_test: boolean;
          last_activity_at: string;
          last_processed_external_message_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          booking_id?: string | null;
          botmaker_conversation_id?: string | null;
          created_at?: string;
          customer_id?: string | null;
          customer_name?: string | null;
          customer_phone: string;
          draft?: Json;
          id?: string;
          is_test?: boolean;
          last_activity_at?: string;
          last_processed_external_message_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          booking_id?: string | null;
          botmaker_conversation_id?: string | null;
          created_at?: string;
          customer_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string;
          draft?: Json;
          id?: string;
          is_test?: boolean;
          last_activity_at?: string;
          last_processed_external_message_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_agent_conversations_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_agent_conversations_botmaker_conversation_id_fkey";
            columns: ["botmaker_conversation_id"];
            isOneToOne: false;
            referencedRelation: "botmaker_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_agent_conversations_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_agent_messages: {
        Row: {
          content: string | null;
          conversation_id: string;
          created_at: string;
          external_message_id: string | null;
          id: string;
          job_id: string | null;
          raw_content: Json | null;
          role: string;
          tool_input: Json | null;
          tool_name: string | null;
          tool_output: Json | null;
        };
        Insert: {
          content?: string | null;
          conversation_id: string;
          created_at?: string;
          external_message_id?: string | null;
          id?: string;
          job_id?: string | null;
          raw_content?: Json | null;
          role: string;
          tool_input?: Json | null;
          tool_name?: string | null;
          tool_output?: Json | null;
        };
        Update: {
          content?: string | null;
          conversation_id?: string;
          created_at?: string;
          external_message_id?: string | null;
          id?: string;
          job_id?: string | null;
          raw_content?: Json | null;
          role?: string;
          tool_input?: Json | null;
          tool_name?: string | null;
          tool_output?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_agent_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_agent_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_agent_messages_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_agent_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_agent_processed_events: {
        Row: {
          created_at: string;
          customer_phone: string | null;
          external_message_id: string;
          id: string;
          provider: string;
        };
        Insert: {
          created_at?: string;
          customer_phone?: string | null;
          external_message_id: string;
          id?: string;
          provider: string;
        };
        Update: {
          created_at?: string;
          customer_phone?: string | null;
          external_message_id?: string;
          id?: string;
          provider?: string;
        };
        Relationships: [];
      };
      whatsapp_agent_manual_retries: {
        Row: {
          conversation_id: string;
          created_at: string;
          error: string | null;
          id: string;
          message_text: string;
          original_outbound_message_id: string;
          provider_message_id: string | null;
          reason: string | null;
          requested_at: string;
          requested_by: string;
          sent_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          conversation_id: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          message_text: string;
          original_outbound_message_id: string;
          provider_message_id?: string | null;
          reason?: string | null;
          requested_at?: string;
          requested_by: string;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          conversation_id?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          message_text?: string;
          original_outbound_message_id?: string;
          provider_message_id?: string | null;
          reason?: string | null;
          requested_at?: string;
          requested_by?: string;
          sent_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_agent_manual_retries_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_agent_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_agent_manual_retries_original_outbound_message_id_fkey";
            columns: ["original_outbound_message_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_agent_outbound_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_agent_manual_retries_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_counters: {
        Row: {
          count: number;
          key: string;
          window_start: string;
        };
        Insert: {
          count?: number;
          key: string;
          window_start?: string;
        };
        Update: {
          count?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      conversation_assignments: {
        Row: {
          assigned_to: string | null;
          botmaker_conversation_id: string;
          created_at: string;
          id: string;
          notes: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          botmaker_conversation_id: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          botmaker_conversation_id?: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_assignments_botmaker_conversation_id_fkey";
            columns: ["botmaker_conversation_id"];
            isOneToOne: true;
            referencedRelation: "botmaker_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      communication_logs: {
        Row: {
          booking_id: string | null;
          booking_request_id: string | null;
          channel: string;
          created_at: string;
          customer_id: string | null;
          direction: string;
          id: string;
          message_text: string | null;
          provider: string;
          raw_payload: Json | null;
        };
        Insert: {
          booking_id?: string | null;
          booking_request_id?: string | null;
          channel: string;
          created_at?: string;
          customer_id?: string | null;
          direction: string;
          id?: string;
          message_text?: string | null;
          provider: string;
          raw_payload?: Json | null;
        };
        Update: {
          booking_id?: string | null;
          booking_request_id?: string | null;
          channel?: string;
          created_at?: string;
          customer_id?: string | null;
          direction?: string;
          id?: string;
          message_text?: string | null;
          provider?: string;
          raw_payload?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "communication_logs_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communication_logs_booking_request_id_fkey";
            columns: ["booking_request_id"];
            isOneToOne: false;
            referencedRelation: "booking_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communication_logs_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      coverage_zones: {
        Row: {
          active: boolean;
          aliases: string[];
          center_lat: number | null;
          center_lng: number | null;
          coverage_notes: string | null;
          created_at: string;
          display_order: number;
          id: string;
          name: string;
          polygon_geojson: Json | null;
          radius_km: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          aliases?: string[];
          center_lat?: number | null;
          center_lng?: number | null;
          coverage_notes?: string | null;
          created_at?: string;
          display_order?: number;
          id?: string;
          name: string;
          polygon_geojson?: Json | null;
          radius_km?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          aliases?: string[];
          center_lat?: number | null;
          center_lng?: number | null;
          coverage_notes?: string | null;
          created_at?: string;
          display_order?: number;
          id?: string;
          name?: string;
          polygon_geojson?: Json | null;
          radius_km?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          address: string | null;
          address_lat: number | null;
          address_lng: number | null;
          coverage_zone_id: string | null;
          coverage_zone_name: string | null;
          created_at: string;
          email: string | null;
          formatted_address: string | null;
          full_name: string;
          id: string;
          neighborhood: string | null;
          notes: string | null;
          phone: string;
          place_id: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          address_lat?: number | null;
          address_lng?: number | null;
          coverage_zone_id?: string | null;
          coverage_zone_name?: string | null;
          created_at?: string;
          email?: string | null;
          formatted_address?: string | null;
          full_name: string;
          id?: string;
          neighborhood?: string | null;
          notes?: string | null;
          phone: string;
          place_id?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          address_lat?: number | null;
          address_lng?: number | null;
          coverage_zone_id?: string | null;
          coverage_zone_name?: string | null;
          created_at?: string;
          email?: string | null;
          formatted_address?: string | null;
          full_name?: string;
          id?: string;
          neighborhood?: string | null;
          notes?: string | null;
          phone?: string;
          place_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_coverage_zone_id_fkey";
            columns: ["coverage_zone_id"];
            isOneToOne: false;
            referencedRelation: "coverage_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      early_access_leads: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          neighborhood: string | null;
          notes: string | null;
          phone: string | null;
          source: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          neighborhood?: string | null;
          notes?: string | null;
          phone?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          neighborhood?: string | null;
          notes?: string | null;
          phone?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      finance_expenses: {
        Row: {
          id: string;
          expense_date: string;
          payer: string;
          concept: string;
          category: string;
          amount: number;
          payment_method: string | null;
          notes: string | null;
          sheet_row_key: string | null;
          synced_at: string;
          created_at: string;
          source: string;
          admin_override: boolean;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          expense_date: string;
          payer: string;
          concept?: string;
          category?: string;
          amount: number;
          payment_method?: string | null;
          notes?: string | null;
          sheet_row_key?: string | null;
          synced_at?: string;
          created_at?: string;
          source?: string;
          admin_override?: boolean;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          expense_date?: string;
          payer?: string;
          concept?: string;
          category?: string;
          amount?: number;
          payment_method?: string | null;
          notes?: string | null;
          sheet_row_key?: string | null;
          synced_at?: string;
          created_at?: string;
          source?: string;
          admin_override?: boolean;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      finance_settings: {
        Row: {
          id: number;
          truck_owner_pct: number;
          washero_pct: number;
          updated_at: string;
        };
        Insert: {
          id?: number;
          truck_owner_pct?: number;
          washero_pct?: number;
          updated_at?: string;
        };
        Update: {
          id?: number;
          truck_owner_pct?: number;
          washero_pct?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          booking_id: string | null;
          created_at: string;
          customer_address: string | null;
          customer_email: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          extras_total: number | null;
          id: string;
          invoice_number: string | null;
          invoice_status: string;
          issued_at: string | null;
          line_items: Json;
          notes: string | null;
          payment_method: string | null;
          payment_status: string | null;
          public_token: string | null;
          scheduled_date: string | null;
          scheduled_time: string | null;
          service_name: string | null;
          status: string;
          subtotal: number | null;
          total: number | null;
          updated_at: string;
          vehicle_surcharge: number | null;
          vehicle_type: string | null;
        };
        Insert: {
          booking_id?: string | null;
          created_at?: string;
          customer_address?: string | null;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          extras_total?: number | null;
          id?: string;
          invoice_number?: string | null;
          invoice_status?: string;
          issued_at?: string | null;
          line_items?: Json;
          notes?: string | null;
          payment_method?: string | null;
          payment_status?: string | null;
          public_token?: string | null;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          service_name?: string | null;
          status?: string;
          subtotal?: number | null;
          total?: number | null;
          updated_at?: string;
          vehicle_surcharge?: number | null;
          vehicle_type?: string | null;
        };
        Update: {
          booking_id?: string | null;
          created_at?: string;
          customer_address?: string | null;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          extras_total?: number | null;
          id?: string;
          invoice_number?: string | null;
          invoice_status?: string;
          issued_at?: string | null;
          line_items?: Json;
          notes?: string | null;
          payment_method?: string | null;
          payment_status?: string | null;
          public_token?: string | null;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          service_name?: string | null;
          status?: string;
          subtotal?: number | null;
          total?: number | null;
          updated_at?: string;
          vehicle_surcharge?: number | null;
          vehicle_type?: string | null;
        };
        Relationships: [];
      };
      kipper_leads: {
        Row: {
          booking_id: string | null;
          created_at: string;
          customer_id: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          notes: string | null;
          phone: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          booking_id?: string | null;
          created_at?: string;
          customer_id?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          notes?: string | null;
          phone?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          booking_id?: string | null;
          created_at?: string;
          customer_id?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          notes?: string | null;
          phone?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          amount: number;
          booking_id: string | null;
          created_at: string;
          id: string;
          provider: string;
          provider_payment_id: string | null;
          raw_payload: Json | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          booking_id?: string | null;
          created_at?: string;
          id?: string;
          provider: string;
          provider_payment_id?: string | null;
          raw_payload?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          booking_id?: string | null;
          created_at?: string;
          id?: string;
          provider?: string;
          provider_payment_id?: string | null;
          raw_payload?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_receipts: {
        Row: {
          id: string;
          booking_id: string | null;
          customer_phone: string | null;
          source: string;
          botmaker_message_id: string | null;
          media_url: string | null;
          storage_bucket: string;
          storage_path: string | null;
          mime_type: string | null;
          file_name: string | null;
          file_size: number | null;
          status: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          notes: string | null;
          raw_payload: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          booking_id?: string | null;
          customer_phone?: string | null;
          source?: string;
          botmaker_message_id?: string | null;
          media_url?: string | null;
          storage_bucket?: string;
          storage_path?: string | null;
          mime_type?: string | null;
          file_name?: string | null;
          file_size?: number | null;
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          notes?: string | null;
          raw_payload?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          booking_id?: string | null;
          customer_phone?: string | null;
          source?: string;
          botmaker_message_id?: string | null;
          media_url?: string | null;
          storage_bucket?: string;
          storage_path?: string | null;
          mime_type?: string | null;
          file_name?: string | null;
          file_size?: number | null;
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          notes?: string | null;
          raw_payload?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_receipts_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_receipts_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
      private_neighborhoods: {
        Row: {
          access_notes: string | null;
          active: boolean;
          aliases: string[];
          canonical_address: string;
          city: string | null;
          coverage_zone_id: string | null;
          coverage_zone_name: string | null;
          created_at: string;
          display_order: number;
          formatted_address: string;
          id: string;
          lat: number;
          lng: number;
          name: string;
          place_id: string | null;
          province: string | null;
          updated_at: string;
        };
        Insert: {
          access_notes?: string | null;
          active?: boolean;
          aliases?: string[];
          canonical_address: string;
          city?: string | null;
          coverage_zone_id?: string | null;
          coverage_zone_name?: string | null;
          created_at?: string;
          display_order?: number;
          formatted_address: string;
          id?: string;
          lat: number;
          lng: number;
          name: string;
          place_id?: string | null;
          province?: string | null;
          updated_at?: string;
        };
        Update: {
          access_notes?: string | null;
          active?: boolean;
          aliases?: string[];
          canonical_address?: string;
          city?: string | null;
          coverage_zone_id?: string | null;
          coverage_zone_name?: string | null;
          created_at?: string;
          display_order?: number;
          formatted_address?: string;
          id?: string;
          lat?: number;
          lng?: number;
          name?: string;
          place_id?: string | null;
          province?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "private_neighborhoods_coverage_zone_id_fkey";
            columns: ["coverage_zone_id"];
            isOneToOne: false;
            referencedRelation: "coverage_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      pricing_items: {
        Row: {
          active: boolean;
          amount: number;
          code: string;
          created_at: string;
          description: string | null;
          duration_minutes: number;
          display_order: number;
          id: string;
          name: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          amount?: number;
          code: string;
          created_at?: string;
          description?: string | null;
          duration_minutes?: number;
          display_order?: number;
          id?: string;
          name: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          amount?: number;
          code?: string;
          created_at?: string;
          description?: string | null;
          duration_minutes?: number;
          display_order?: number;
          id?: string;
          name?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      customer_subscriptions: {
        Row: {
          billing_day: number | null;
          created_at: string;
          current_period_end: string;
          current_period_start: string;
          customer_id: string;
          id: string;
          notes: string | null;
          plan_id: string;
          start_date: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          billing_day?: number | null;
          created_at?: string;
          current_period_end: string;
          current_period_start: string;
          customer_id: string;
          id?: string;
          notes?: string | null;
          plan_id: string;
          start_date?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          billing_day?: number | null;
          created_at?: string;
          current_period_end?: string;
          current_period_start?: string;
          customer_id?: string;
          id?: string;
          notes?: string | null;
          plan_id?: string;
          start_date?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_subscriptions_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "subscription_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      subscription_plans: {
        Row: {
          active: boolean;
          allowed_service_ids: string[];
          created_at: string;
          description: string | null;
          display_order: number;
          id: string;
          monthly_price: number;
          name: string;
          updated_at: string;
          washes_per_month: number;
        };
        Insert: {
          active?: boolean;
          allowed_service_ids?: string[];
          created_at?: string;
          description?: string | null;
          display_order?: number;
          id?: string;
          monthly_price?: number;
          name: string;
          updated_at?: string;
          washes_per_month?: number;
        };
        Update: {
          active?: boolean;
          allowed_service_ids?: string[];
          created_at?: string;
          description?: string | null;
          display_order?: number;
          id?: string;
          monthly_price?: number;
          name?: string;
          updated_at?: string;
          washes_per_month?: number;
        };
        Relationships: [];
      };
      subscription_usages: {
        Row: {
          booking_id: string;
          created_at: string;
          customer_subscription_id: string;
          id: string;
          period_end: string;
          period_start: string;
          used_at: string;
        };
        Insert: {
          booking_id: string;
          created_at?: string;
          customer_subscription_id: string;
          id?: string;
          period_end: string;
          period_start: string;
          used_at?: string;
        };
        Update: {
          booking_id?: string;
          created_at?: string;
          customer_subscription_id?: string;
          id?: string;
          period_end?: string;
          period_start?: string;
          used_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscription_usages_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscription_usages_customer_subscription_id_fkey";
            columns: ["customer_subscription_id"];
            isOneToOne: false;
            referencedRelation: "customer_subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      service_areas: {
        Row: {
          active: boolean;
          coverage_notes: string | null;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          coverage_notes?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          coverage_notes?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      services: {
        Row: {
          active: boolean;
          base_price: number;
          created_at: string;
          description: string | null;
          duration_minutes: number;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          base_price: number;
          created_at?: string;
          description?: string | null;
          duration_minutes: number;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          base_price?: number;
          created_at?: string;
          description?: string | null;
          duration_minutes?: number;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      weekly_availability_rules: {
        Row: {
          allow_overlaps: boolean;
          capacity: number;
          created_at: string;
          day_name: string;
          day_of_week: number;
          end_time: string;
          id: string;
          interval_minutes: number;
          is_open: boolean;
          slot_duration_minutes: number;
          start_time: string;
          updated_at: string;
        };
        Insert: {
          allow_overlaps?: boolean;
          capacity?: number;
          created_at?: string;
          day_name: string;
          day_of_week: number;
          end_time?: string;
          id?: string;
          interval_minutes?: number;
          is_open?: boolean;
          slot_duration_minutes?: number;
          start_time?: string;
          updated_at?: string;
        };
        Update: {
          allow_overlaps?: boolean;
          capacity?: number;
          created_at?: string;
          day_name?: string;
          day_of_week?: number;
          end_time?: string;
          id?: string;
          interval_minutes?: number;
          is_open?: boolean;
          slot_duration_minutes?: number;
          start_time?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      generate_invoice_for_booking: {
        Args: { _booking_id: string };
        Returns: string;
      };
      get_public_invoice_by_token: {
        Args: { _public_token: string };
        Returns: Json;
      };
      get_my_admin_profile: {
        Args: never;
        Returns: {
          active: boolean;
          email: string;
          role: string;
          user_id: string;
        }[];
      };
      is_admin: { Args: never; Returns: boolean };
      is_operator: { Args: never; Returns: boolean };
      get_my_operator_profile: {
        Args: never;
        Returns: {
          staff_id: string;
          user_id: string;
          email: string;
          role: string;
          active: boolean;
        }[];
      };
      next_invoice_number: { Args: never; Returns: string };
      create_booking_atomic: {
        Args: {
          p_booking: Json;
          p_idempotency_key?: string;
          p_skip_slot_checks?: boolean;
          p_units: Json;
        };
        Returns: Json;
      };
      cancel_booking_atomic: {
        Args: { p_booking_id: string; p_customer_phone: string };
        Returns: Json;
      };
      reschedule_booking_atomic: {
        Args: {
          p_booking_id: string;
          p_customer_phone: string;
          p_new_date: string;
          p_new_time: string;
        };
        Returns: Json;
      };
      claim_next_whatsapp_agent_job: {
        Args: { p_lease_seconds?: number };
        Returns: {
          attempts: number;
          conversation_id: string;
          created_at: string;
          dry_run: boolean;
          external_message_id: string | null;
          id: string;
          last_error: string | null;
          lease_expires_at: string | null;
          lease_token: string | null;
          locked_at: string | null;
          message_text: string;
          source: string;
          status: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "whatsapp_agent_jobs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      check_and_increment_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
