import { nativeTask } from './task-runtime';

export interface AgentProfile {
  id: string;
  name: string;
  group?: 'work' | 'personal' | null;
  tag?: string | null;
}

export interface AgentProfilesView {
  profiles: AgentProfile[];
  activeId: string | null;
  envVar: string | null;
}

export const listAgentProfiles = (agent: string) =>
  nativeTask<AgentProfilesView>('agent_profile_list', { agent });

export const createAgentProfile = (agent: string, name: string, group: AgentProfile['group']) =>
  nativeTask<AgentProfile>('agent_profile_create', { agent, name, group });

export const setAgentProfileGroup = (agent: string, id: string, group: AgentProfile['group']) =>
  nativeTask<void>('agent_profile_set_group', { agent, id, group });

export const setAgentProfileTag = (agent: string, id: string, tag: string | null) =>
  nativeTask<void>('agent_profile_set_tag', { agent, id, tag });

export const renameAgentProfile = (agent: string, id: string, name: string) =>
  nativeTask<void>('agent_profile_rename', { agent, id, name });

export const deleteAgentProfile = (agent: string, id: string) =>
  nativeTask<void>('agent_profile_delete', { agent, id });

export const setActiveAgentProfile = (agent: string, id: string | null) =>
  nativeTask<void>('agent_profile_set_active', { agent, id });

export interface AccountStatus {
  state: 'signedIn' | 'signedOut' | 'configured' | 'unknown' | 'notInstalled';
  identity: string | null;
  detail: string;
  checkedAt: string;
}

export const checkAgentProfile = (agent: string, id: string | null) =>
  nativeTask<AccountStatus>('agent_profile_status', { agent, id });

export const signInAgentProfile = (agent: string, id: string, cols = 80, rows = 16) =>
  nativeTask<string>('agent_profile_sign_in', { agent, id, cols, rows });

export interface SignInView {
  state: 'running' | 'exited' | 'cancelled' | 'timedOut' | 'failed';
  exitCode: number | null;
  chunks: { sequence: number; data: string }[];
  truncated: boolean;
}

export const pollSignIn = (sessionId: string, after: number) =>
  nativeTask<SignInView>('agent_profile_sign_in_poll', { sessionId, after });
export const stopSignIn = (sessionId: string) =>
  nativeTask<void>('agent_profile_sign_in_stop', { sessionId });
export const writeSignIn = (sessionId: string, data: string) =>
  nativeTask<void>('agent_profile_sign_in_input', { sessionId, data });
export const resizeSignIn = (sessionId: string, cols: number, rows: number) =>
  nativeTask<void>('agent_profile_sign_in_resize', { sessionId, cols, rows });

export const accountStatusLabel = (status?: AccountStatus) => {
  if (!status) return 'Not checked';
  return {
    signedIn: 'Signed in',
    signedOut: 'Sign-in needed',
    configured: 'Credentials configured',
    unknown: 'Status unavailable',
    notInstalled: 'Agent not installed',
  }[status.state];
};
