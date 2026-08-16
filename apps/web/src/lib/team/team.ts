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

export type InviteRole = 'manager' | 'operator';

export interface OrgMemberInvite {
  id: string;
  email: string;
  role: InviteRole;
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface PendingOrgInvite {
  id: string;
  organization_id: string;
  organization_name: string;
  role: InviteRole;
  created_at: string;
  expires_at: string;
}

export interface InviteResult {
  id: string;
  organization_id: string;
  email: string;
  role: InviteRole;
  created_at: string;
  expires_at: string;
  status: 'pending';
  created: boolean;
  renewed: boolean;
}

const TEAM_ERROR_MESSAGES: Record<string, string> = {
  PED80: 'Sessão expirada. Entre novamente.',
  PED81: 'Somente o proprietário pode realizar esta ação.',
  PED82: 'Informe um e-mail válido.',
  PED83: 'Função inválida.',
  PED84: 'Este e-mail já pertence a um membro da organização.',
  PED85: 'Você já pertence a uma organização.',
  PED86: 'Convite não encontrado.',
  PED87: 'Convite expirado.',
  PED88: 'Convite foi revogado.',
  PED89: 'Este convite já foi aceito.',
  PED90: 'Este convite pertence a outro e-mail.',
};

function withCode(error: { code?: string; message?: string }): Error {
  const err = new Error(error.message ?? 'Falha inesperada. Tente novamente.');
  if (error.code !== undefined) {
    (err as { code?: string }).code = error.code;
  }
  return err;
}

export function teamErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === 'string') {
      const mapped = TEAM_ERROR_MESSAGES[candidate.code];
      if (mapped !== undefined) return mapped;
    }
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return 'Falha inesperada. Tente novamente.';
}

export async function inviteOrgMember(email: string, role: InviteRole): Promise<InviteResult> {
  const { data, error } = await supabase.rpc('invite_org_member', {
    p_email: email,
    p_role: role,
  });
  if (error) {
    throw withCode(error);
  }
  return data as InviteResult;
}

export async function revokeOrgMemberInvite(inviteId: string): Promise<{ revoked: boolean }> {
  const { data, error } = await supabase.rpc('revoke_org_member_invite', {
    p_invite_id: inviteId,
  });
  if (error) {
    throw withCode(error);
  }
  return data as { revoked: boolean };
}

export async function fetchOrgMemberInvites(organizationId: string): Promise<OrgMemberInvite[]> {
  const { data, error } = await supabase.rpc('get_org_member_invites', {
    p_organization_id: organizationId,
  });
  if (error) {
    throw withCode(error);
  }
  return (data as OrgMemberInvite[] | null) ?? [];
}

export async function fetchMyPendingInvites(): Promise<PendingOrgInvite[]> {
  const { data, error } = await supabase.rpc('get_my_pending_member_invites');
  if (error) {
    throw withCode(error);
  }
  return (data as PendingOrgInvite[] | null) ?? [];
}

export async function acceptOrgMemberInvite(
  inviteId: string,
): Promise<{ organization_id: string; role: InviteRole; accepted: boolean }> {
  const { data, error } = await supabase.rpc('accept_org_member_invite', {
    p_invite_id: inviteId,
  });
  if (error) {
    throw withCode(error);
  }
  return data as { organization_id: string; role: InviteRole; accepted: boolean };
}
