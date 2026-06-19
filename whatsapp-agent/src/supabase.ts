import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'

// Cliente service_role: bypassa RLS. Usado exclusivamente pelo agente.
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})
