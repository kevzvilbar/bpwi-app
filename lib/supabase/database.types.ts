export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppRole = 'admin' | 'scheduler' | 'manager' | 'operator' | 'viewer';

export type OrgChartMetaJson = {
  title?: string;
  subtitle?: string;
  legend1?: string;
  legend2?: string;
};

export type ChangeRequestOriginalStateJson = {
  shift_type_id?: string | null;
  area_code_id?: string | null;
  standby_type?: string | null;
  title?: string | null;
  status?: string | null;
  scheduled_date?: string | null;
  assigned_operator_ids?: string[] | null;
  leave_code?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type AccomplishmentEntryJson = {
  id: string;
  source_activity_id?: string | null;
  column_id: string | null;
  others_specify: string;
  location_project: string;
  location_ph: string;
  location_blk: string;
  location_lot: string;
  time_started: string;
  time_finished: string;
  remarks: string;
};

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          timezone: string;
          app_title: string;
          org_chart_meta: OrgChartMetaJson | Json | null;
          allowed_signup_domains: string[];
        };
        Insert: {
          id?: string;
          name: string;
          timezone?: string;
          app_title?: string;
          org_chart_meta?: OrgChartMetaJson | Json | null;
          allowed_signup_domains?: string[];
        };
        Update: {
          id?: string;
          name?: string;
          timezone?: string;
          app_title?: string;
          org_chart_meta?: OrgChartMetaJson | Json | null;
          allowed_signup_domains?: string[];
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          id: string;
          organization_id: string;
          full_name: string | null;
          phone_number: string | null;
          role: AppRole;
          is_active: boolean;
          operator_id: string | null;
          job_title: string | null;
          can_approve: boolean;
        };
        Insert: {
          id: string;
          organization_id: string;
          full_name?: string | null;
          phone_number?: string | null;
          role?: AppRole;
          is_active?: boolean;
          operator_id?: string | null;
          job_title?: string | null;
          can_approve?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          full_name?: string | null;
          phone_number?: string | null;
          role?: AppRole;
          is_active?: boolean;
          operator_id?: string | null;
          job_title?: string | null;
          can_approve?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'user_profiles_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
        ];
      };
      operators: {
        Row: {
          id: string;
          organization_id: string;
          legacy_key: string | null;
          employee_code: string | null;
          full_name: string;
          phone_number: string | null;
          position: string | null;
          default_station: string | null;
          sort_order: number;
          is_active: boolean;
          department_head_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          legacy_key?: string | null;
          employee_code?: string | null;
          full_name: string;
          phone_number?: string | null;
          position?: string | null;
          default_station?: string | null;
          sort_order?: number;
          is_active?: boolean;
          department_head_id?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          legacy_key?: string | null;
          employee_code?: string | null;
          full_name?: string;
          phone_number?: string | null;
          position?: string | null;
          default_station?: string | null;
          sort_order?: number;
          is_active?: boolean;
          department_head_id?: string | null;
        };
        Relationships: [];
      };
      shift_types: {
        Row: {
          id: string;
          organization_id: string;
          legacy_key: string | null;
          code: string;
          description: string | null;
          start_time: string | null;
          end_time: string | null;
          duration_hours: number;
          is_off: boolean;
          background_color: string;
          text_color: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          legacy_key?: string | null;
          code: string;
          description?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          duration_hours?: number;
          is_off?: boolean;
          background_color?: string;
          text_color?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          legacy_key?: string | null;
          code?: string;
          description?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          duration_hours?: number;
          is_off?: boolean;
          background_color?: string;
          text_color?: string;
        };
        Relationships: [];
      };
      area_codes: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          name: string | null;
          category: 'station' | 'leave' | 'holiday' | 'rest';
          background_color: string;
          text_color: string;
          sub_sites: string[];
        };
        Insert: {
          id?: string;
          organization_id: string;
          code: string;
          name?: string | null;
          category?: 'station' | 'leave' | 'holiday' | 'rest';
          background_color?: string;
          text_color?: string;
          sub_sites?: string[];
        };
        Update: {
          id?: string;
          organization_id?: string;
          code?: string;
          name?: string | null;
          category?: 'station' | 'leave' | 'holiday' | 'rest';
          background_color?: string;
          text_color?: string;
          sub_sites?: string[];
        };
        Relationships: [];
      };
      schedule_assignments: {
        Row: {
          id: string;
          organization_id: string;
          operator_id: string;
          schedule_date: string;
          shift_type_id: string | null;
          area_code_id: string | null;
          notes: string | null;
          created_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          operator_id: string;
          schedule_date: string;
          shift_type_id?: string | null;
          area_code_id?: string | null;
          notes?: string | null;
          created_by?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          operator_id?: string;
          schedule_date?: string;
          shift_type_id?: string | null;
          area_code_id?: string | null;
          notes?: string | null;
          created_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      standby_assignments: {
        Row: {
          id: string;
          organization_id: string;
          operator_id: string;
          schedule_date: string;
          standby_type: string;
          status: string;
          notes: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          operator_id: string;
          schedule_date: string;
          standby_type?: string;
          status?: string;
          notes?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          operator_id?: string;
          schedule_date?: string;
          standby_type?: string;
          status?: string;
          notes?: string | null;
        };
        Relationships: [];
      };
      leave_records: {
        Row: {
          id: string;
          organization_id: string;
          operator_id: string;
          leave_code: string;
          start_date: string;
          end_date: string;
          status: string;
          remarks: string | null;
          approved_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          operator_id: string;
          leave_code: string;
          start_date: string;
          end_date: string;
          status?: string;
          remarks?: string | null;
          approved_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          operator_id?: string;
          leave_code?: string;
          start_date?: string;
          end_date?: string;
          status?: string;
          remarks?: string | null;
          approved_by?: string | null;
        };
        Relationships: [];
      };
      pm_tasks: {
        Row: {
          id: string;
          organization_id: string;
          legacy_key: string | null;
          activity_type: string;
          title: string;
          locations: string[];
          asset: string | null;
          assigned_operator_ids: string[];
          completed_by_operator_ids: string[];
          scheduled_date: string;
          status: 'planned' | 'done' | 'postponed';
          completed_at: string | null;
          remarks: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          legacy_key?: string | null;
          activity_type: string;
          title: string;
          locations?: string[];
          asset?: string | null;
          assigned_operator_ids?: string[];
          completed_by_operator_ids?: string[];
          scheduled_date: string;
          status?: 'planned' | 'done' | 'postponed';
          completed_at?: string | null;
          remarks?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          legacy_key?: string | null;
          activity_type?: string;
          title?: string;
          locations?: string[];
          asset?: string | null;
          assigned_operator_ids?: string[];
          completed_by_operator_ids?: string[];
          scheduled_date?: string;
          status?: 'planned' | 'done' | 'postponed';
          completed_at?: string | null;
          remarks?: string | null;
        };
        Relationships: [];
      };
      pm_activity_types: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          label: string;
          short_label: string;
          color: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          code: string;
          label: string;
          short_label: string;
          color?: string;
          sort_order?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          code?: string;
          label?: string;
          short_label?: string;
          color?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      pm_locations: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      gensets: {
        Row: {
          id: string;
          organization_id: string;
          control_no: string;
          brand_model: string | null;
          kva_rating: string | null;
          fuel_type: string;
          status: 'active' | 'standby_yard' | 'under_repair' | 'retired';
          current_location: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          control_no: string;
          brand_model?: string | null;
          kva_rating?: string | null;
          fuel_type?: string;
          status?: 'active' | 'standby_yard' | 'under_repair' | 'retired';
          current_location?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          control_no?: string;
          brand_model?: string | null;
          kva_rating?: string | null;
          fuel_type?: string;
          status?: 'active' | 'standby_yard' | 'under_repair' | 'retired';
          current_location?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      genset_transfers: {
        Row: {
          id: string;
          organization_id: string;
          genset_id: string;
          from_location: string | null;
          to_location: string | null;
          reason: string | null;
          moved_by: string | null;
          moved_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          genset_id: string;
          from_location?: string | null;
          to_location?: string | null;
          reason?: string | null;
          moved_by?: string | null;
          moved_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          genset_id?: string;
          from_location?: string | null;
          to_location?: string | null;
          reason?: string | null;
          moved_by?: string | null;
          moved_at?: string;
        };
        Relationships: [];
      };
      holidays: {
        Row: {
          id: string;
          organization_id: string;
          holiday_date: string;
          name: string;
          holiday_type: 'regular' | 'special_non_working' | 'company';
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          holiday_date: string;
          name: string;
          holiday_type?: 'regular' | 'special_non_working' | 'company';
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          holiday_date?: string;
          name?: string;
          holiday_type?: 'regular' | 'special_non_working' | 'company';
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      edit_grants: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          starts_at: string;
          ends_at: string;
          date_from: string | null;
          date_to: string | null;
          note: string | null;
          granted_by: string | null;
          created_at: string;
          revoked_at: string | null;
          revoked_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          starts_at: string;
          ends_at: string;
          date_from?: string | null;
          date_to?: string | null;
          note?: string | null;
          granted_by?: string | null;
          created_at?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          starts_at?: string;
          ends_at?: string;
          date_from?: string | null;
          date_to?: string | null;
          note?: string | null;
          granted_by?: string | null;
          created_at?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
        };
        Relationships: [];
      };
      change_requests: {
        Row: {
          id: string;
          organization_id: string;
          requester_id: string;
          title: string | null;
          note: string | null;
          status: 'draft' | 'pending' | 'approved' | 'partially_approved' | 'rejected' | 'cancelled';
          submitted_at: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          review_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          requester_id: string;
          title?: string | null;
          note?: string | null;
          status?: 'draft' | 'pending' | 'approved' | 'partially_approved' | 'rejected' | 'cancelled';
          submitted_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          review_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          requester_id?: string;
          title?: string | null;
          note?: string | null;
          status?: 'draft' | 'pending' | 'approved' | 'partially_approved' | 'rejected' | 'cancelled';
          submitted_at?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          review_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      change_request_items: {
        Row: {
          id: string;
          request_id: string;
          organization_id: string;
          target_table: 'schedule_assignments' | 'standby_assignments' | 'pm_tasks' | 'leave_records';
          target_id: string | null;
          action: 'upsert' | 'delete';
          operator_id: string | null;
          schedule_date: string | null;
          shift_type_id: string | null;
          area_code_id: string | null;
          standby_type: string | null;
          pm_task_id: string | null;
          pm_title: string | null;
          pm_status: string | null;
          pm_assigned_operator_ids: string[] | null;
          leave_code: string | null;
          leave_start_date: string | null;
          leave_end_date: string | null;
          notes: string | null;
          original_state: ChangeRequestOriginalStateJson | null;
          payload: Record<string, unknown>;
          status: 'pending' | 'approved' | 'rejected' | 'conflict';
          rejection_reason: string | null;
          applied_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          organization_id: string;
          target_table: 'schedule_assignments' | 'standby_assignments' | 'pm_tasks' | 'leave_records';
          target_id?: string | null;
          action?: 'upsert' | 'delete';
          operator_id?: string | null;
          schedule_date?: string | null;
          shift_type_id?: string | null;
          area_code_id?: string | null;
          standby_type?: string | null;
          pm_task_id?: string | null;
          pm_title?: string | null;
          pm_status?: string | null;
          pm_assigned_operator_ids?: string[] | null;
          leave_code?: string | null;
          leave_start_date?: string | null;
          leave_end_date?: string | null;
          notes?: string | null;
          original_state?: ChangeRequestOriginalStateJson | Json | null;
          payload?: Record<string, unknown> | Json;
          status?: 'pending' | 'approved' | 'rejected' | 'conflict';
          rejection_reason?: string | null;
          applied_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          request_id?: string;
          organization_id?: string;
          target_table?: 'schedule_assignments' | 'standby_assignments' | 'pm_tasks' | 'leave_records';
          target_id?: string | null;
          action?: 'upsert' | 'delete';
          operator_id?: string | null;
          schedule_date?: string | null;
          shift_type_id?: string | null;
          area_code_id?: string | null;
          standby_type?: string | null;
          pm_task_id?: string | null;
          pm_title?: string | null;
          pm_status?: string | null;
          pm_assigned_operator_ids?: string[] | null;
          leave_code?: string | null;
          leave_start_date?: string | null;
          leave_end_date?: string | null;
          notes?: string | null;
          original_state?: ChangeRequestOriginalStateJson | Json | null;
          payload?: Record<string, unknown> | Json;
          status?: 'pending' | 'approved' | 'rejected' | 'conflict';
          rejection_reason?: string | null;
          applied_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'change_request_items_request_id_fkey';
            columns: ['request_id'];
            isOneToOne: false;
            referencedRelation: 'change_requests';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          kind: string;
          title: string;
          body: string | null;
          href: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          kind?: string;
          title: string;
          body?: string | null;
          href?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          kind?: string;
          title?: string;
          body?: string | null;
          href?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: number;
          organization_id: string | null;
          user_id: string | null;
          action: string | null;
          table_name: string | null;
          record_id: string | null;
          old_value: Json | null;
          new_value: Json | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          organization_id?: string | null;
          user_id?: string | null;
          action?: string | null;
          table_name?: string | null;
          record_id?: string | null;
          old_value?: Json | null;
          new_value?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          organization_id?: string | null;
          user_id?: string | null;
          action?: string | null;
          table_name?: string | null;
          record_id?: string | null;
          old_value?: Json | null;
          new_value?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      daily_activities: {
        Row: {
          id: string;
          organization_id: string;
          activity_date: string;
          logged_by: string | null;
          lead_operator_id: string | null;
          crew_operator_ids: string[];
          shift_type_id: string | null;
          area_code_id: string | null;
          site_or_well: string | null;
          block_lot: string | null;
          activity_type: string;
          pm_task_id: string | null;
          job_order_id: string | null;
          status: 'draft' | 'submitted' | 'verified' | 'flagged';
          started_at: string | null;
          completed_at: string | null;
          gps_lat: number | null;
          gps_lng: number | null;
          notes: string | null;
          details: Record<string, unknown>;
          photo_urls: string[];
          photo_storage_paths: string[];
          photos_expires_at: string | null;
          photos_purged_at: string | null;
          signature_data: string | null;
          verified_by: string | null;
          verified_at: string | null;
          review_note: string | null;
          is_sample: boolean;
          sample_expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          activity_date?: string;
          logged_by?: string | null;
          lead_operator_id?: string | null;
          crew_operator_ids?: string[];
          shift_type_id?: string | null;
          area_code_id?: string | null;
          site_or_well?: string | null;
          block_lot?: string | null;
          activity_type: string;
          pm_task_id?: string | null;
          job_order_id?: string | null;
          status?: 'draft' | 'submitted' | 'verified' | 'flagged';
          started_at?: string | null;
          completed_at?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          notes?: string | null;
          details?: Record<string, unknown>;
          photo_urls?: string[];
          photo_storage_paths?: string[];
          photos_expires_at?: string | null;
          photos_purged_at?: string | null;
          signature_data?: string | null;
          verified_by?: string | null;
          verified_at?: string | null;
          review_note?: string | null;
          is_sample?: boolean;
          sample_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          activity_date?: string;
          logged_by?: string | null;
          lead_operator_id?: string | null;
          crew_operator_ids?: string[];
          shift_type_id?: string | null;
          area_code_id?: string | null;
          site_or_well?: string | null;
          block_lot?: string | null;
          activity_type?: string;
          pm_task_id?: string | null;
          job_order_id?: string | null;
          status?: 'draft' | 'submitted' | 'verified' | 'flagged';
          started_at?: string | null;
          completed_at?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          notes?: string | null;
          details?: Record<string, unknown>;
          photo_urls?: string[];
          photo_storage_paths?: string[];
          photos_expires_at?: string | null;
          photos_purged_at?: string | null;
          signature_data?: string | null;
          verified_by?: string | null;
          verified_at?: string | null;
          review_note?: string | null;
          is_sample?: boolean;
          sample_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      job_orders: {
        Row: {
          id: string;
          organization_id: string;
          jo_number: string;
          title: string;
          activity_type: string | null;
          priority: 'low' | 'medium' | 'high';
          area_code_id: string | null;
          site_or_well: string | null;
          block_lot: string | null;
          account_number: string | null;
          account_name: string | null;
          contact_number: string | null;
          description: string | null;
          assigned_operator_ids: string[];
          deadline: string | null;
          estimated_hours: number | null;
          status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
          tat_justification: string | null;
          created_by: string | null;
          completed_at: string | null;
          is_sample: boolean;
          sample_expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          jo_number?: string;
          title: string;
          activity_type?: string | null;
          priority?: 'low' | 'medium' | 'high';
          area_code_id?: string | null;
          site_or_well?: string | null;
          block_lot?: string | null;
          account_number?: string | null;
          account_name?: string | null;
          contact_number?: string | null;
          description?: string | null;
          assigned_operator_ids?: string[];
          deadline?: string | null;
          estimated_hours?: number | null;
          status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
          tat_justification?: string | null;
          created_by?: string | null;
          completed_at?: string | null;
          is_sample?: boolean;
          sample_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          jo_number?: string;
          title?: string;
          activity_type?: string | null;
          priority?: 'low' | 'medium' | 'high';
          area_code_id?: string | null;
          site_or_well?: string | null;
          block_lot?: string | null;
          account_number?: string | null;
          account_name?: string | null;
          contact_number?: string | null;
          description?: string | null;
          assigned_operator_ids?: string[];
          deadline?: string | null;
          estimated_hours?: number | null;
          status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
          tat_justification?: string | null;
          created_by?: string | null;
          completed_at?: string | null;
          is_sample?: boolean;
          sample_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shift_handovers: {
        Row: {
          id: string;
          organization_id: string;
          handover_date: string;
          shift_type_id: string | null;
          area_code_id: string | null;
          outgoing_operator_id: string | null;
          incoming_operator_id: string | null;
          plant_status: 'normal' | 'watch' | 'critical';
          summary: string;
          pending_items: string | null;
          chemical_fuel_notes: string | null;
          created_by: string | null;
          is_sample: boolean;
          sample_expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          handover_date?: string;
          shift_type_id?: string | null;
          area_code_id?: string | null;
          outgoing_operator_id?: string | null;
          incoming_operator_id?: string | null;
          plant_status?: 'normal' | 'watch' | 'critical';
          summary: string;
          pending_items?: string | null;
          chemical_fuel_notes?: string | null;
          created_by?: string | null;
          is_sample?: boolean;
          sample_expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          handover_date?: string;
          shift_type_id?: string | null;
          area_code_id?: string | null;
          outgoing_operator_id?: string | null;
          incoming_operator_id?: string | null;
          plant_status?: 'normal' | 'watch' | 'critical';
          summary?: string;
          pending_items?: string | null;
          chemical_fuel_notes?: string | null;
          created_by?: string | null;
          is_sample?: boolean;
          sample_expires_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      accomplishment_reports: {
        Row: {
          id: string;
          organization_id: string;
          report_date: string;
          shift_type_id: string | null;
          operator_id: string | null;
          submitted_by: string;
          assigned_head_id: string | null;
          prepared_by_name: string;
          prepared_by_title: string;
          checked_by_name: string | null;
          checked_by_title: string | null;
          status: 'draft' | 'submitted' | 'checked' | 'returned';
          entries: AccomplishmentEntryJson[];
          summary_notes: string | null;
          head_remarks: string | null;
          submitted_at: string | null;
          checked_by: string | null;
          checked_at: string | null;
          is_sample: boolean;
          sample_expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          report_date: string;
          shift_type_id?: string | null;
          operator_id?: string | null;
          submitted_by?: string;
          assigned_head_id?: string | null;
          prepared_by_name?: string;
          prepared_by_title?: string;
          checked_by_name?: string | null;
          checked_by_title?: string | null;
          status?: 'draft' | 'submitted' | 'checked' | 'returned';
          entries?: AccomplishmentEntryJson[];
          summary_notes?: string | null;
          head_remarks?: string | null;
          submitted_at?: string | null;
          checked_by?: string | null;
          checked_at?: string | null;
          is_sample?: boolean;
          sample_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          report_date?: string;
          shift_type_id?: string | null;
          operator_id?: string | null;
          submitted_by?: string;
          assigned_head_id?: string | null;
          prepared_by_name?: string;
          prepared_by_title?: string;
          checked_by_name?: string | null;
          checked_by_title?: string | null;
          status?: 'draft' | 'submitted' | 'checked' | 'returned';
          entries?: AccomplishmentEntryJson[];
          summary_notes?: string | null;
          head_remarks?: string | null;
          submitted_at?: string | null;
          checked_by?: string | null;
          checked_at?: string | null;
          is_sample?: boolean;
          sample_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      org_positions: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          department_group: string;
          tier: 'executive' | 'support' | 'head' | 'leadman' | 'staff';
          parent_position_id: string | null;
          secondary_parent_id: string | null;
          holder_user_id: string | null;
          holder_operator_id: string | null;
          fallback_name: string | null;
          shift_badge: string | null;
          color_theme: string;
          is_vacant: boolean;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          title: string;
          department_group?: string;
          tier?: 'executive' | 'support' | 'head' | 'leadman' | 'staff';
          parent_position_id?: string | null;
          secondary_parent_id?: string | null;
          holder_user_id?: string | null;
          holder_operator_id?: string | null;
          fallback_name?: string | null;
          shift_badge?: string | null;
          color_theme?: string;
          is_vacant?: boolean;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          title?: string;
          department_group?: string;
          tier?: 'executive' | 'support' | 'head' | 'leadman' | 'staff';
          parent_position_id?: string | null;
          secondary_parent_id?: string | null;
          holder_user_id?: string | null;
          holder_operator_id?: string | null;
          fallback_name?: string | null;
          shift_badge?: string | null;
          color_theme?: string;
          is_vacant?: boolean;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sample_photo_cleanup: {
        Row: {
          id: string;
          organization_id: string;
          storage_path: string;
          queued_at: string;
          attempts: number;
          last_error: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          storage_path: string;
          queued_at?: string;
          attempts?: number;
          last_error?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          storage_path?: string;
          queued_at?: string;
          attempts?: number;
          last_error?: string | null;
        };
        Relationships: [];
      };
      route_compute_cache: {
        Row: {
          organization_id: string;
          cache_key: string;
          routed_legs: Json;
          encoded_polylines: Json;
          expires_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          cache_key: string;
          routed_legs: Json;
          encoded_polylines: Json;
          expires_at: string;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          cache_key?: string;
          routed_legs?: Json;
          encoded_polylines?: Json;
          expires_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      route_compute_rate_hits: {
        Row: {
          id: number;
          user_id: string;
          bucket: 'total' | 'upstream';
          created_at: string;
        };
        Insert: {
          id?: never;
          user_id: string;
          bucket: 'total' | 'upstream';
          created_at?: string;
        };
        Update: {
          id?: never;
          user_id?: string;
          bucket?: 'total' | 'upstream';
          created_at?: string;
        };
        Relationships: [];
      };
      consumable_items: {
        Row: {
          id: string;
          organization_id: string;
          code: string | null;
          name: string;
          category: 'chlorine' | 'fuel' | 'chemical' | 'lubricant' | 'supplies' | 'other';
          unit: string;
          low_stock_threshold: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          code?: string | null;
          name: string;
          category?: 'chlorine' | 'fuel' | 'chemical' | 'lubricant' | 'supplies' | 'other';
          unit: string;
          low_stock_threshold?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          code?: string | null;
          name?: string;
          category?: 'chlorine' | 'fuel' | 'chemical' | 'lubricant' | 'supplies' | 'other';
          unit?: string;
          low_stock_threshold?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      consumable_movements: {
        Row: {
          id: string;
          organization_id: string;
          item_id: string;
          site_name: string;
          movement_type:
            | 'opening_stock'
            | 'delivery'
            | 'manual_usage'
            | 'adjustment'
            | 'transfer_in'
            | 'transfer_out'
            | 'activity_usage'
            | 'activity_delivery';
          quantity_delta: number;
          movement_date: string;
          activity_id: string | null;
          reference_no: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          item_id: string;
          site_name: string;
          movement_type:
            | 'opening_stock'
            | 'delivery'
            | 'manual_usage'
            | 'adjustment'
            | 'transfer_in'
            | 'transfer_out'
            | 'activity_usage'
            | 'activity_delivery';
          quantity_delta: number;
          movement_date?: string;
          activity_id?: string | null;
          reference_no?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          item_id?: string;
          site_name?: string;
          movement_type?:
            | 'opening_stock'
            | 'delivery'
            | 'manual_usage'
            | 'adjustment'
            | 'transfer_in'
            | 'transfer_out'
            | 'activity_usage'
            | 'activity_delivery';
          quantity_delta?: number;
          movement_date?: string;
          activity_id?: string | null;
          reference_no?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      submit_change_request: {
        Args: {
          p_request_id: string;
          p_note?: string | null;
        };
        Returns: Json;
      };
      approve_change_request: {
        Args: {
          p_request_id: string;
          p_item_ids?: string[] | null;
          p_reject_item_ids?: string[] | null;
          p_review_notes?: string | null;
          p_force_conflicts?: boolean;
          p_allow_self_override?: boolean;
        };
        Returns: Json;
      };
      reject_change_request: {
        Args: {
          p_request_id: string;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      update_org_chart_meta: {
        Args: {
          p_org_id: string;
          p_meta: OrgChartMetaJson | Json;
        };
        Returns: undefined;
      };
      sample_cleanup_health: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      purge_expired_sample_records: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          activities_deleted: number;
          job_orders_deleted: number;
          handovers_deleted: number;
          reports_deleted: number;
        }>;
      };
      purge_expired_route_compute_state: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          purged_cache_rows: number;
          purged_rate_hits: number;
        }>;
      };
      check_route_compute_rate_limit: {
        Args: {
          p_user_id: string;
          p_bucket: string;
        };
        Returns: Array<{
          allowed: boolean;
          remaining: number;
          retry_after_seconds: number;
        }>;
      };
      get_route_compute_cache: {
        Args: {
          p_org_id: string;
          p_cache_key: string;
        };
        Returns: Array<{
          routed_legs: Json;
          encoded_polylines: Json;
        }>;
      };
      set_route_compute_cache: {
        Args: {
          p_org_id: string;
          p_cache_key: string;
          p_routed_legs: Json;
          p_encoded_polylines: Json;
        };
        Returns: undefined;
      };
      bootstrap_initial_org_admin: {
        Args: {
          p_org_name?: string;
          p_admin_email?: string | null;
          p_admin_full_name?: string | null;
        };
        Returns: string;
      };
      purge_expired_telemetry_pii: {
        Args: {
          p_retention_days?: number;
        };
        Returns: Array<{
          activities_scrubbed: number;
          job_orders_scrubbed: number;
        }>;
      };
      seed_default_consumables: {
        Args: {
          p_org_id: string;
        };
        Returns: undefined;
      };
      current_org: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      current_role_name: {
        Args: Record<PropertyKey, never>;
        Returns: AppRole | null;
      };
      current_operator_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
    };
    Enums: {
      app_role: AppRole;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
