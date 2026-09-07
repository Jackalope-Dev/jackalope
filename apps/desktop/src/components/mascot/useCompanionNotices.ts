import { useEffect } from 'react';
import { type CompanionNotice, useCompanionStore } from '../../stores/companionStore';

export function useCompanionNotices(source: string, notices: CompanionNotice[]) {
  useEffect(() => {
    useCompanionStore.getState().publish(source, notices);
  }, [source, notices]);
  useEffect(() => () => useCompanionStore.getState().remove(source), [source]);
}

export function returnToCompanion(event: Event) {
  const trigger = document.getElementById('jackalope-companion-trigger');
  if (trigger) {
    event.preventDefault();
    trigger.focus();
  }
}
