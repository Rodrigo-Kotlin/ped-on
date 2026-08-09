import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (supabaseUrl === undefined || supabasePublishableKey === undefined) {
  console.warn(
    'Ped-On: VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLISHABLE_KEY ausentes. Usando endpoint placeholder (auth indisponível).',
  );
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabasePublishableKey ?? 'placeholder-key',
);
