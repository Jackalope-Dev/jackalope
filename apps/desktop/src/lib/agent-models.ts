import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeTask } from './task-runtime';
import { isTauriEnvironment } from './tauri-bridge';

export interface ModelCatalog {
  models: { id: string; name: string; isDefault: boolean }[];
  source: string;
  account: string | null;
  checkedAt: string;
  detail: string;
}

export function useAgentModels(agentId: string, revision = 0, agentProfileId?: string) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const [loadedKey, setLoadedKey] = useState('');
  const key = JSON.stringify([agentId, revision, agentProfileId]);
  const refresh = useCallback(
    async (force = false) => {
      const version = ++request.current;
      setCatalog(undefined);
      setError('');
      setLoadedKey('');
      if (!agentId || !isTauriEnvironment()) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await nativeTask<ModelCatalog>('agent_models', {
          agent: agentId,
          agentProfileId,
          refresh: force,
        });
        if (version === request.current) {
          setCatalog(result);
          setLoadedKey(key);
        }
      } catch (cause) {
        if (version === request.current) {
          setError(String(cause));
          setLoadedKey(key);
        }
      } finally {
        if (version === request.current) setLoading(false);
      }
    },
    [agentId, agentProfileId, key],
  );
  useEffect(() => {
    void refresh(revision > 0);
    return () => {
      request.current++;
    };
  }, [refresh, revision]);
  return {
    catalog: loadedKey === key ? catalog : undefined,
    error: loadedKey === key ? error : '',
    loading: !!agentId && isTauriEnvironment() && (loading || loadedKey !== key),
    refresh,
  };
}
