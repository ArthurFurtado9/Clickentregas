import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Helper to check if the Supabase keys are configured
export const isSupabaseConfigured = () => {
  return supabaseAnonKey && supabaseAnonKey !== 'SUA_CHAVE_ANONIMA_AQUI' && supabaseAnonKey !== '';
}

export const supabase = isSupabaseConfigured() 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const updateSupabaseHeaders = () => {
  if (!supabase) return;
  const savedUser = localStorage.getItem('clickentregas_user');
  if (savedUser) {
    try {
      const user = JSON.parse(savedUser);
      if (user.isAdmin) {
        const adminHash = localStorage.getItem('clickentregas_admin_hash');
        if (adminHash) {
          supabase.rest.headers.set('x-admin-key', adminHash);
        } else {
          supabase.rest.headers.delete('x-admin-key');
        }
        supabase.rest.headers.delete('x-client-phone');
      } else {
        if (user.phone) {
          supabase.rest.headers.set('x-client-phone', user.phone);
        } else {
          supabase.rest.headers.delete('x-client-phone');
        }
        supabase.rest.headers.delete('x-admin-key');
      }
    } catch (e) {
      console.error(e);
    }
  } else {
    supabase.rest.headers.delete('x-admin-key');
    supabase.rest.headers.delete('x-client-phone');
  }
}
