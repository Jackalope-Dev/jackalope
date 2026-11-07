import { invokeNative } from './native/transport';

export interface AgentProfile {
  id: string;
  name: string;
  group?: 'work' | 'personal' | null;
  tag?: string | null;
  preferredModel?: string | null;
  configDir?: string | null;
}

export interface AgentProfilesView {
  profiles: AgentProfile[];
  activeId: string | null;
  defaultGroup?: AgentProfile['group'];
  defaultName?: string | null;
  defaultTag?: string | null;
  envVar: string | null;
}

export const listAgentProfiles = (agent: string) =>
  invokeNative<AgentProfilesView>('agent_profile_list', { agent });

export const createAgentProfile = (agent: string, name: string, group: AgentProfile['group']) =>
  invokeNative<AgentProfile>('agent_profile_create', {
    agent,
    name,
    group,
    pending: true,
    configDir: null,
  });

export const setAgentProfileGroup = (
  agent: string,
  id: string | null,
  group: AgentProfile['group'],
) => invokeNative<void>('agent_profile_set_group', { agent, id, group });

export const setAgentProfileTag = (agent: string, id: string | null, tag: string | null) =>
  invokeNative<void>('agent_profile_set_tag', { agent, id, tag });

export const renameAgentProfile = (agent: string, id: string | null, name: string) =>
  invokeNative<void>('agent_profile_rename', { agent, id, name });

export const deleteAgentProfile = (agent: string, id: string) =>
  invokeNative<void>('agent_profile_delete', { agent, id });

export const setActiveAgentProfile = (agent: string, id: string | null) =>
  invokeNative<void>('agent_profile_set_active', { agent, id });

export interface AccountStatus {
  state: 'signedIn' | 'signedOut' | 'configured' | 'unknown' | 'notInstalled';
  identity: string | null;
  detail: string;
  checkedAt: string;
}

export const checkAgentProfile = (agent: string, id: string | null) =>
  invokeNative<AccountStatus>('agent_profile_status', { agent, id });

export const signInAgentProfile = (agent: string, id: string, cols = 80, rows = 16) =>
  invokeNative<string>('agent_profile_sign_in', { agent, id, cols, rows });

export const saveAgentProfileKey = (agent: string, id: string, name: string, value: string) =>
  invokeNative<void>('agent_profile_save_key', { agent, id, name, value });

export const completeProviderProfile = (id: string, model: string, activate: boolean) =>
  invokeNative<void>('agent_profile_complete_provider', { id, model, activate });

export interface SignInView {
  state: 'running' | 'exited' | 'cancelled' | 'timedOut' | 'failed';
  exitCode: number | null;
  chunks: { sequence: number; data: string }[];
  truncated: boolean;
}

export const pollSignIn = (sessionId: string, after: number) =>
  invokeNative<SignInView>('agent_profile_sign_in_poll', { sessionId, after });
export const stopSignIn = (sessionId: string) =>
  invokeNative<void>('agent_profile_sign_in_stop', { sessionId });
export const writeSignIn = (sessionId: string, data: string) =>
  invokeNative<void>('agent_profile_sign_in_input', { sessionId, data });
export const resizeSignIn = (sessionId: string, cols: number, rows: number) =>
  invokeNative<void>('agent_profile_sign_in_resize', { sessionId, cols, rows });

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

export const setConfigDir = (agent: string, id: string | null, configDir: string | null) =>
  invokeNative<void>('agent_profile_set_config_dir', { agent, id, configDir });

export interface AgentProbeResult {
  exists: boolean;
  executable: boolean;
  version: string | null;
  error: string | null;
}

export const probeExecutable = (path: string) =>
  invokeNative<AgentProbeResult>('agent_probe_executable', { path });
