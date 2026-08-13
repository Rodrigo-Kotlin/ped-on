import { supabase } from '../supabase';

export interface ReadinessCheck {
  code: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
}

export interface ReadinessUnitSummary {
  unit_id: string;
  name: string;
  is_active: boolean;
  op_configured: boolean;
  hours_ok: boolean;
  payment_ok: boolean;
  catalog_ok: boolean;
  menu_published: boolean;
}

export interface PilotReadiness {
  organization_id: string;
  ready: boolean;
  blocking_ok: number;
  blocking_total: number;
  checked_at: string;
  checks: ReadinessCheck[];
  units_summary: ReadinessUnitSummary[];
}

export async function fetchPilotReadiness(organizationId: string): Promise<PilotReadiness> {
  const { data, error } = await supabase.rpc('get_org_pilot_readiness', {
    p_organization_id: organizationId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as PilotReadiness;
}
