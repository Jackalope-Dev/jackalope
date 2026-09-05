import * as Dialog from '@radix-ui/react-dialog';
import { Search, Settings2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useAgentConfigStore } from '../../stores/agentConfigStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useThemeStore } from '../../stores/themeStore';
import { type MascotMood, useMascotStore } from '../../stores/mascotStore';
import { AgentManager } from '../agents/AgentManager';
import { JackalopeMascot } from '../mascot/JackalopeMascot';
import { ThemeEditor } from '../theme/ThemeEditor';
import { Button } from '../ui/button';
import { Select, SelectItem } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { useDialogFocus } from '../ui/useDialogFocus';
import './settings.css';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialScope?: 'app' | 'project';
  initialProjectId?: string;
}
const categories = ['Appearance', 'Agents', 'Privacy', 'Project', 'Data & reset'] as const;
type Category = (typeof categories)[number];

function Setting({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <div className="settings-row"><div className="settings-row-info"><div className="settings-row-label">{title}</div><p className="settings-row-description">{description}</p></div>{children && <div className="settings-control-wrapper">{children}</div>}</div>;
}

export function SettingsDialog({ open, onClose, initialScope = 'app', initialProjectId }: SettingsDialogProps) {
  const dialogFocus = useDialogFocus();
  const settings = useSettingsStore();
  const agents = useAgentConfigStore();
  const { currentTheme, setTheme } = useThemeStore();
  const { mood, setMood, pet } = useMascotStore();
  const { projects, activeProjectId, updateProject, updateProjectPreferences } = useProjectStore();
  const [category, setCategory] = useState<Category>(initialScope === 'project' ? 'Project' : 'Appearance');
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const project = projects.find(p => p.id === (projectId || activeProjectId)) ?? projects[0];
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const matches = (section: Category, words: string) => query.trim() ? `${section} ${words}`.toLowerCase().includes(query.trim().toLowerCase()) : section === category;
  const visible = categories.filter(c => matches(c, {
    Appearance: 'theme color light dark atmosphere mascot companion moods reactions',
    Agents: 'default models allowed restrict manual cli command executable configuration',
    Privacy: 'marketplace MCP network telemetry crash reporting',
    Project: 'repository name path agent instructions verification command',
    'Data & reset': 'export clipboard erase delete nuke reset first time setup history local data',
  }[c]));
  const exportConfig = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ settings: JSON.parse(settings.exportSettings()), theme: currentTheme, agents: JSON.parse(JSON.stringify(agents)) }, null, 2));
      setMessage('Preferences copied to clipboard.');
    } catch (error) { setMessage(`Could not copy preferences: ${String(error)}`); }
  };
  const reset = async () => {
    if (confirmation !== 'RESET' || resetting) return;
    setResetting(true);
    setMessage('');
    try {
      if (isTauriEnvironment()) await nativeTask('app_reset', { confirmation });
      else {
        for (const key of Object.keys(localStorage)) if (key.startsWith('jackalope-')) localStorage.removeItem(key);
        window.location.reload();
      }
    } catch (error) { setMessage(`Reset failed: ${String(error)}`); setResetting(false); }
  };
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !resetting) { setConfirming(false); setConfirmation(''); onClose(); } }}>
    <Dialog.Portal>
      <Dialog.Overlay className="settings-dialog-overlay" />
      <Dialog.Content {...dialogFocus} className="settings-dialog appearance-panel" onEscapeKeyDown={event => { if (resetting) event.preventDefault(); }} onInteractOutside={event => { if (resetting) event.preventDefault(); }}>
        <header className="settings-header">
          <div className="flex items-center gap-3"><Settings2 size={20} /><Dialog.Title className="text-base font-semibold">Settings</Dialog.Title></div>
          <label className="settings-search"><Search size={16}/><input aria-label="Search settings" type="search" placeholder="Search settings…" value={query} onChange={e => setQuery(e.target.value)}/></label>
          <Dialog.Close asChild><button type="button" className="quiet-icon" aria-label="Close settings" disabled={resetting}><X size={18}/></button></Dialog.Close>
        </header>
        <Dialog.Description className="sr-only">Appearance, agents, privacy, project preferences and local data. Changes save immediately unless a Save button is shown.</Dialog.Description>
        <div className="settings-body">
          <nav className="settings-sidebar" aria-label="Settings categories">{categories.map(c => <button key={c} type="button" className={`settings-nav-item ${category === c && !query ? 'is-active' : ''}`} aria-current={category === c && !query ? 'page' : undefined} onClick={() => { setCategory(c); setQuery(''); setMessage(''); setConfirming(false); setConfirmation(''); }}>{c}</button>)}</nav>
          <main className="settings-content" tabIndex={0} aria-label="Settings content">
            {!visible.length && <p>No settings match “{query}”.</p>}
            {visible.map(c => <section key={c} className="settings-section">
              <h2 className="settings-section-title">{c}</h2>
              {c === 'Appearance' && <>
                <p className="settings-section-subtitle mb-6">Changes save immediately and apply throughout Jackalope.</p>
                <ThemeEditor value={currentTheme} onChange={setTheme}/>
                <div className="settings-companion-box mt-6"><div className="settings-companion-avatar"><JackalopeMascot size="md"/></div><div className="min-w-0"><p className="text-sm font-medium">Companion preview</p><div className="settings-mood-chips">{(['idle','thinking','working','success','sleep'] as MascotMood[]).map(m => <button key={m} type="button" aria-pressed={mood === m} className={`settings-mood-chip ${mood === m ? 'is-active' : ''}`} onClick={() => setMood(m)}>{m}</button>)}</div><Button variant="ghost" size="sm" onClick={pet}>Pet companion</Button></div></div>
              </>}
              {c === 'Agents' && <div className="mt-6"><AgentManager/><p className="settings-disclosure-box">Set parallel capacity in each project's task queue. Automatic failover, task timeouts and completion alerts are still planned.</p></div>}
              {c === 'Privacy' && <>
                <div className="settings-group mt-6"><Setting title="Use MCP marketplace" description="Allow searches and server details from allmcps.com. Disabling cancels marketplace requests; configured MCP servers remain available."><Switch label="Use MCP marketplace" checked={settings.useMcpMarketplace} onCheckedChange={settings.setUseMcpMarketplace}/></Setting></div>
                <p className="settings-disclosure-box">This build does not send usage telemetry or crash reports. Marketplace searches go to AllMCPs, which publicly logs requests, with User-Agent Jackalope/0.1.0. Your connected agents and MCP servers use their own services.</p>
              </>}
              {c === 'Project' && <>
                {!project ? <p className="settings-section-subtitle mt-4">Open a repository to configure project preferences.</p> : <>
                  <div className="my-6"><Select aria-label="Project to configure" value={project.id} onValueChange={setProjectId}>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</Select></div>
                  <div className="settings-group">
                    <Setting title="Project name" description="Label shown in the project switcher."><input className="settings-input" aria-label="Project name" value={project.name} onChange={e => updateProject(project.id, {name:e.target.value})}/></Setting>
                    <Setting title="Repository path" description={project.path}/>
                    <Setting title="Default task agent" description="Used for new tasks unless the composer has an explicit selection."><Select aria-label="Default task agent" value={project.preferences?.preferredRunner ?? 'inherit'} onValueChange={value => updateProjectPreferences(project.id, { preferredRunner: value })}><SelectItem value="inherit">App default</SelectItem>{[{id:'codex',name:'Codex'},{id:'claude',name:'Claude Code'},{id:'grok',name:'Grok'},...agents.customAgents].map(a => <SelectItem key={a.id} value={a.id} disabled={!agents.isAgentEnabled(a.id)}>{a.name}</SelectItem>)}</Select></Setting>
                  </div>
                  <label className="block text-sm font-medium" htmlFor="project-instructions">Project instructions</label><p className="settings-row-description mb-3">Appended to prompts launched from the task composer.</p><textarea id="project-instructions" className="settings-textarea" rows={5} value={project.preferences?.customInstructions ?? ''} onChange={e => updateProjectPreferences(project.id,{customInstructions:e.target.value})}/>
                  <label className="block text-sm font-medium mt-6" htmlFor="verification-command">Verification command reminder</label><p className="settings-row-description mb-3">Shown when reviewing workspace changes. This does not execute the command.</p><input id="verification-command" className="settings-input w-full" value={project.preferences?.verifyCommand ?? ''} placeholder="pnpm build" onChange={e => updateProjectPreferences(project.id,{verifyCommand:e.target.value})}/>
                  <p className="settings-disclosure-box">Choose isolation in the task composer. Isolated tasks use .worktrees and the current checkout; parallel tasks use master. Custom worktree locations, base branches and automatic cleanup are planned.</p>
                </>}
              </>}
              {c === 'Data & reset' && <>
                <p className="settings-section-subtitle mb-6">Manage this Jackalope profile on this computer.</p>
                <Button variant="outline" onClick={() => void exportConfig()}>Copy preferences to clipboard</Button>
                <div className="settings-reset-box mt-6">
                  <h3 className="text-base font-semibold">Reset Jackalope</h3>
                  <p className="settings-row-description mt-3">Erase this profile's projects, task history, drafts, queue, audit log, agent selections and appearance. Jackalope restarts for first-time setup. Repositories, worktrees, external agent sign-ins and agent MCP configuration files are preserved.</p>
                  <p className="settings-row-description mt-3">Stop active tasks and pause queues before resetting. Existing worktrees will remain on disk and can be managed after reopening the repository.</p>
                  {!confirming ? <Button variant="outline" className="mt-4" onClick={() => {setConfirming(true);setConfirmation('');}}>Reset all local data…</Button> : <div className="mt-4"><label htmlFor="reset-confirmation" className="block text-sm font-medium mb-2">Type RESET to confirm permanent deletion</label><input id="reset-confirmation" autoComplete="off" className="settings-input w-full" value={confirmation} disabled={resetting} onChange={e => setConfirmation(e.target.value)}/><div className="flex flex-wrap gap-3 mt-4"><Button disabled={confirmation !== 'RESET' || resetting} onClick={() => void reset()}>{resetting ? 'Restarting…' : 'Erase local data and restart'}</Button><Button variant="ghost" disabled={resetting} onClick={() => {setConfirming(false);setConfirmation('');}}>Cancel</Button></div></div>}
                </div>
              </>}
            </section>)}
            {message && <p role="status" className="settings-disclosure-box">{message}</p>}
          </main>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
