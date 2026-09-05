import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowUpRight,
  CheckCircle,
  Download,
  ExternalLink,
  Shield,
  Star,
  X,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import { type AllMcpsServer, useMcpStore } from '../../stores/mcpStore';
import { Button } from '../ui/button';
import { useDialogFocus } from '../ui/useDialogFocus';

const Markdown = lazy(() => import('react-markdown'));

interface McpInspectModalProps {
  server: AllMcpsServer | null;
  open: boolean;
  onClose: () => void;
  onInstall: (server: AllMcpsServer) => void;
}

export function McpInspectModal({ server, open, onClose, onInstall }: McpInspectModalProps) {
  const dialogFocus = useDialogFocus();
  const { inspectingMarkdown, loadingMarkdown } = useMcpStore();

  if (!server) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(val) => !val && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="task-dialog-overlay" />
        <Dialog.Content
          {...dialogFocus}
          className="task-dialog appearance-panel max-w-2xl max-h-[85vh] flex flex-col"
        >
          <Dialog.Close className="task-close" aria-label="Close dialog">
            <X size={18} />
          </Dialog.Close>

          {/* Header */}
          <div className="pb-4 border-b border-[var(--color-border)] shrink-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="mcp-pill">{server.category || 'Tool'}</span>
              {server.isOfficial && (
                <span className="mcp-pill official flex items-center gap-1">
                  <Shield size={11} /> Official
                </span>
              )}
              {server.isVerifiedActive && (
                <span className="mcp-pill verified flex items-center gap-1">
                  <CheckCircle size={11} /> Verified
                </span>
              )}
              {server.githubStars > 0 && (
                <span className="mcp-pill flex items-center gap-1">
                  <Star size={11} className="text-amber-400" /> {server.githubStars.toLocaleString()}
                </span>
              )}
              {server.qualityScore > 0 && (
                <span className="mcp-pill">Quality: {server.qualityScore}/100</span>
              )}
            </div>

            <Dialog.Title className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
              {server.name}
            </Dialog.Title>
            <Dialog.Description className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">
              {server.description}
            </Dialog.Description>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto py-4 space-y-4 text-xs">
            {/* Quick config snippet */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Configuration
              </h4>
              <pre className="p-3 rounded-lg bg-[var(--color-surface-sunken)] border border-[var(--color-border)] font-mono text-[11px] text-[var(--color-text)] overflow-x-auto">
                {JSON.stringify(
                  server.claudeConfigSnippet || {
                    mcpServers: {
                      [server.id]: {
                        command: 'npx',
                        args: ['-y', server.installName || server.id],
                      },
                    },
                  },
                  null,
                  2,
                )}
              </pre>
            </div>

            {/* Markdown Documentation */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Documentation & Tools
              </h4>
              {loadingMarkdown ? (
                <div className="p-8 text-center text-[var(--color-text-muted)]">
                  Loading documentation…
                </div>
              ) : (
                <div className="prose prose-invert max-w-none text-xs text-[var(--color-text-muted)] space-y-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg">
                  <Suspense fallback={<div>Rendering markdown…</div>}>
                    <Markdown>{inspectingMarkdown || server.description}</Markdown>
                  </Suspense>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="pt-4 border-t border-[var(--color-border)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {server.url && (
                <a
                  href={server.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[var(--color-accent-ink)] hover:underline inline-flex items-center gap-1"
                >
                  Source Repository <ExternalLink size={12} />
                </a>
              )}
              {server.detailUrl && (
                <a
                  href={server.detailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[var(--color-text-muted)] hover:underline inline-flex items-center gap-1"
                >
                  AllMCPs page <ArrowUpRight size={12} />
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  onInstall(server);
                }}
              >
                <Download size={15} />
                1-Click Install
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
