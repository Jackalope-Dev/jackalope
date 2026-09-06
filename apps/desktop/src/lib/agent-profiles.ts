import { nativeTask } from './task-runtime';

export interface AgentProfile {
  id: string;
  name: string;
}

export interface AgentProfilesView {
  profiles: AgentProfile[];
  activeId: string | null;
  envVar: string | null;
}

export const listAgentProfiles = (agent: string) =>
  nativeTask<AgentProfilesView>('agent_profile_list', { agent });

export const createAgentProfile = (agent: string, name: string) =>
  nativeTask<AgentProfile>('agent_profile_create', { agent, name });

export const renameAgentProfile = (agent: string, id: string, name: string) =>
  nativeTask<void>('agent_profile_rename', { agent, id, name });

export const deleteAgentProfile = (agent: string, id: string) =>
  nativeTask<void>('agent_profile_delete', { agent, id });

export const setActiveAgentProfile = (agent: string, id: string | null) =>
  nativeTask<void>('agent_profile_set_active', { agent, id });

export const signInAgentProfile = (agent: string, id: string) =>
  nativeTask<void>('agent_profile_sign_in', { agent, id });
