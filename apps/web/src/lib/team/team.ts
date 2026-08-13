import { supabase } from '../supabase';
import type { AdminRole } from '../admin/admin-context';

export interface OrgMember {
  id: string;
  full_name: string | null;
  email: string;
  role: AdminRole;
  unit_ids: string[];
  created_at: string;
}

export async function fetchOrgMembers(organizationId: string): Promise<OrgMember[]> {
  const { data, error } = await supabase.rpc('get_org_members_admin', {
    p_organization_id: organizationId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data as OrgMember[] | null) ?? [];
}

export interface UnitAssignmentResult {
  assigned: boolean;
  already_assigned: boolean;
}

export async function assignUnitToMember(
  organizationId: string,
  userId: string,
  unitId: string,
): Promise<UnitAssignmentResult> {
  const { data, error } = await supabase.rpc('assign_unit_to_member', {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_unit_id: unitId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as UnitAssignmentResult;
}

export interface UnitRemovalResult {
  removed: boolean;
}

export async function removeUnitFromMember(
  organizationId: string,
  userId: string,
  unitId: string,
): Promise<UnitRemovalResult> {
  const { data, error } = await supabase.rpc('remove_unit_from_member', {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_unit_id: unitId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as UnitRemovalResult;
}
