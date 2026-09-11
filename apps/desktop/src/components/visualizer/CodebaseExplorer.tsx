import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react';
import { ArrowLeft, Download, FileCode2, Folder, Network, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type CodebaseReference,
  type CodebaseSnapshot,
  preparedCodebase,
  scanCodebase,
  watchCodebase,
} from '../../lib/codebase';
import { dependencyCycles, directoryOf, GRAPH_LIMIT, mapGraph } from '../../lib/codebase-graph';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import type { Project } from '../../stores/projectStore';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { InlineNotice } from '../ui/InlineNotice';
import { Input } from '../ui/input';
import { LoadingState } from '../ui/LoadingState';
import { Select, SelectItem } from '../ui/Select';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import '@xyflow/react/dist/style.css';
import { CodebaseChecks } from './CodebaseChecks';
import './codebase.css';

export default function CodebaseExplorer({ project }: { project: Project }) {
  const [snapshot, setSnapshot] = useState<CodebaseSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [watchError, setWatchError] = useState('');
  const revision = useRef(0);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('all');
  const [folder, setFolder] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'map' | 'checks'>('map');
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const [page, setPage] = useState(1);
  const mounted = useRef(true);
  const running = useRef(false);
  const mapRegion = useRef<HTMLElement>(null);
  const focusNextNode = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const prepared =
      preparedCodebase(project.path) ??
      (isTauriEnvironment() ? scanCodebase(project.path, false) : undefined);
    if (prepared) {
      setBusy(true);
      void prepared
        .then((value) => {
          if (!canceled) {
            setSnapshot(value);
            setStale(false);
          }
        })
        .catch((cause) => {
          if (!canceled) setError(String(cause));
        })
        .finally(() => {
          if (!canceled) setBusy(false);
        });
    }
    return () => {
      canceled = true;
    };
  }, [project.path]);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let canceled = false;
    let stop: (() => Promise<void>) | undefined;
    const invalidate = () => {
      revision.current += 1;
      setStale(true);
    };
    const onFocus = () => invalidate();
    window.addEventListener('focus', onFocus);
    void watchCodebase(project.path, (unavailable) => {
      if (canceled) return;
      invalidate();
      if (unavailable) setWatchError('Live change detection stopped. Refresh the map manually.');
    })
      .then((cleanup) => {
        if (canceled) void cleanup().catch(() => {});
        else {
          stop = cleanup;
        }
      })
      .catch(() => {
        if (!canceled)
          setWatchError('Live change detection is unavailable. Refresh the map manually.');
      });
    return () => {
      canceled = true;
      window.removeEventListener('focus', onFocus);
      void stop?.().catch(() => {});
    };
  }, [project.path]);

  const scan = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    const startedRevision = revision.current;
    try {
      const next = await scanCodebase(project.path);
      if (!mounted.current) return;
      setSnapshot(next);
      setStale(startedRevision !== revision.current);
      setSelected((path) => (next.files.some((file) => file.path === path) ? path : null));
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const cycles = useMemo(() => (snapshot ? dependencyCycles(snapshot) : []), [snapshot]);
  const cycleFiles = useMemo(() => new Set(cycles.flat()), [cycles]);
  const unresolved = useMemo(
    () =>
      snapshot?.references.filter(
        (ref) => ref.status === 'unresolved' || ref.status === 'outside root',
      ) ?? [],
    [snapshot],
  );
  const languages = useMemo(
    () => [...new Set(snapshot?.files.map((file) => file.language))].sort(),
    [snapshot],
  );
  const files = useMemo(
    () =>
      snapshot?.files.filter(
        (file) =>
          (language === 'all' || file.language === language) &&
          (folder === null ||
            (folder === '.'
              ? directoryOf(file.path) === '.'
              : file.path.startsWith(`${folder}/`))) &&
          file.path.toLowerCase().includes(query.toLowerCase()),
      ) ?? [],
    [snapshot, language, folder, query],
  );
  const selectedFile = snapshot?.files.find((file) => file.path === selected);
  const outgoing = snapshot?.references.filter((ref) => ref.source === selected) ?? [];
  const incoming = snapshot?.references.filter((ref) => ref.target === selected) ?? [];
  const neighborhood = useMemo(() => {
    if (!snapshot || !selected) return null;
    const paths = new Set([selected]);
    for (const ref of snapshot.references) {
      if (ref.source === selected && ref.target) paths.add(ref.target);
      if (ref.target === selected) paths.add(ref.source);
    }
    return [...paths];
  }, [snapshot, selected]);
  const folderView = !selected;
  const graph = useMemo(
    () =>
      snapshot
        ? mapGraph(
            snapshot,
            neighborhood ?? files.map((file) => file.path),
            folderView,
            selected,
            folder,
          )
        : null,
    [snapshot, neighborhood, files, folderView, selected, folder],
  );
  const nodes = useMemo(
    () =>
      graph?.nodes.map((node) => ({
        id: node.id,
        position: node.position,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        selected: node.id === selected,
        className: cycleFiles.has(node.id) ? 'codebase-cycle-node' : undefined,
        data: {
          directory: node.directory,
          label: (
            <div className="codebase-node" title={node.id}>
              {node.directory ? <Folder size={17} /> : <FileCode2 size={17} />}
              <span>
                <strong>{node.id === '.' ? 'Root files' : node.id.split('/').pop()}</strong>
                <small>
                  {node.directory
                    ? `${node.count} ${node.count === 1 ? 'file' : 'files'} · ${node.id}`
                    : directoryOf(node.id)}
                </small>
              </span>
            </div>
          ),
        },
        ariaLabel: `${node.directory ? 'Explore directory' : 'Inspect file'} ${node.id}`,
        style: { width: 240, height: 64 },
      })) ?? [],
    [graph, selected, cycleFiles],
  );
  const edges = useMemo(
    () =>
      graph?.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: folderView ? String(edge.count) : undefined,
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-text-muted)' },
        style: { stroke: 'var(--color-text-muted)', strokeWidth: 1.5 },
      })) ?? [],
    [graph, folderView],
  );

  useEffect(() => {
    if (graph && flow && mode === 'map') {
      const frame = requestAnimationFrame(() => {
        void flow.fitView({ padding: 0.18, maxZoom: 1 });
        if (focusNextNode.current) {
          mapRegion.current
            ?.querySelector<HTMLElement>('.react-flow__node')
            ?.focus({ preventScroll: true });
          focusNextNode.current = false;
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [flow, graph, mode]);

  const inspect = (path: string) => {
    setSelected(path);
    setMode('map');
  };
  const reset = () => {
    setSelected(null);
    setFolder(null);
    setQuery('');
    setLanguage('all');
    setPage(1);
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'codebase-map.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const checkCount = cycles.length + unresolved.length + (snapshot?.diagnostics.length ?? 0);

  return (
    <div className="codebase-page">
      <WorkspaceHeading
        title="Codebase"
        action={
          <div className="flex gap-2">
            {snapshot && (
              <Button variant="ghost" onClick={download}>
                <Download size={16} />
                Export
              </Button>
            )}
            <Button onClick={() => void scan()} disabled={busy || !isTauriEnvironment()}>
              <RefreshCw size={16} />
              {busy
                ? 'Analyzing…'
                : stale
                  ? 'Update map'
                  : snapshot
                    ? 'Refresh map'
                    : 'Analyze repository'}
            </Button>
          </div>
        }
      />
      {error && (
        <InlineNotice tone="error">
          {error}
          {snapshot && ' The previous snapshot is still shown.'}
        </InlineNotice>
      )}
      {busy && <LoadingState compact={!!snapshot} label="Mapping files and references…" />}
      {watchError && (
        <p role="status" className="task-muted">
          {watchError}
        </p>
      )}
      {!snapshot ? (
        busy ? null : (
          <EmptyState
            icon={Network}
            title={busy ? 'Building your map' : 'A map of the code you have'}
            description={
              isTauriEnvironment()
                ? 'Explore file references and dependency cycles.'
                : 'Open the desktop app to analyze this repository.'
            }
          />
        )
      ) : (
        <>
          {snapshot.truncated && (
            <InlineNotice tone="error" role="status">
              Partial snapshot: a scan limit was reached. Some files or references are missing.
            </InlineNotice>
          )}
          <div className="codebase-toolbar">
            <span className="codebase-inline-count">
              {snapshot.files.length.toLocaleString()} files
            </span>
            <fieldset className="codebase-switch" aria-label="Codebase views">
              <Button
                variant={mode === 'map' ? 'secondary' : 'ghost'}
                aria-pressed={mode === 'map'}
                onClick={() => setMode('map')}
              >
                Explore
              </Button>
              <Button
                variant={mode === 'checks' ? 'secondary' : 'ghost'}
                aria-pressed={mode === 'checks'}
                onClick={() => setMode('checks')}
              >
                Checks <span className="codebase-count">{checkCount}</span>
              </Button>
            </fieldset>
            {mode === 'map' && (
              <>
                <div className="codebase-search">
                  <Search size={17} aria-hidden="true" />
                  <Input
                    aria-label="Find a file"
                    placeholder="Find a file or directory…"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelected(null);
                      setMode('map');
                      setPage(1);
                    }}
                  />
                </div>
                <Select
                  aria-label="File language"
                  value={language}
                  onValueChange={(value) => {
                    setLanguage(value);
                    setSelected(null);
                    setPage(1);
                  }}
                >
                  <SelectItem value="all">All languages</SelectItem>
                  {languages.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </Select>
              </>
            )}
          </div>
          {mode === 'checks' ? (
            <CodebaseChecks
              snapshot={snapshot}
              cycles={cycles}
              unresolved={unresolved}
              inspect={inspect}
            />
          ) : (
            <>
              {(folder || selected || query || language !== 'all') && (
                <div className="codebase-breadcrumb">
                  <Button
                    variant="ghost"
                    onClick={reset}
                    disabled={!folder && !selected && !query && language === 'all'}
                  >
                    <ArrowLeft size={16} />
                    All directories
                  </Button>
                  <p title={selected ?? folder ?? ''}>
                    {selected ? selected : (folder ?? 'Directory relationships')}
                  </p>
                  {selected && (
                    <Button variant="ghost" onClick={() => setSelected(null)}>
                      Clear selection
                    </Button>
                  )}
                </div>
              )}
              <div className="codebase-explorer">
                <aside className="codebase-files" aria-label="Repository files">
                  <p className="codebase-list-heading">
                    Files <span>{files.length}</span>
                  </p>
                  {files.length === 0 && (
                    <p className="task-muted p-4">
                      No files match. Clear the search or return to all directories.
                    </p>
                  )}
                  {files.slice(0, page * 100).map((file) => (
                    <button
                      type="button"
                      key={file.path}
                      aria-pressed={selected === file.path}
                      onClick={() => inspect(file.path)}
                      title={file.path}
                    >
                      <FileCode2 size={16} />
                      <span>
                        <strong>{file.path.split('/').pop()}</strong>
                        <small>{directoryOf(file.path)}</small>
                      </span>
                      {cycleFiles.has(file.path) && (
                        <span
                          className="codebase-cycle-label"
                          role="img"
                          aria-label="In a dependency cycle"
                        >
                          ↔
                        </span>
                      )}
                    </button>
                  ))}
                  {files.length > page * 100 && (
                    <Button variant="ghost" onClick={() => setPage(page + 1)}>
                      Show 100 more
                    </Button>
                  )}
                </aside>
                <section
                  ref={mapRegion}
                  className="codebase-canvas"
                  aria-label="Codebase relationship map"
                >
                  <div className="codebase-flow">
                    {nodes.length ? (
                      <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onInit={setFlow}
                        fitView
                        minZoom={0.08}
                        maxZoom={1.8}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        edgesFocusable={false}
                        deleteKeyCode={null}
                        onNodeClick={(_, node) => {
                          if (node.data.directory) {
                            setFolder(node.id);
                            setPage(1);
                          } else inspect(node.id);
                        }}
                        onKeyDown={(event) => {
                          const id = (event.target as HTMLElement)
                            .closest('.react-flow__node')
                            ?.getAttribute('data-id');
                          if (!id) return;
                          if (event.key === 'Enter') {
                            if (graph?.nodes.find((node) => node.id === id)?.directory) {
                              focusNextNode.current = true;
                              setFolder(id);
                              setPage(1);
                            } else inspect(id);
                          }
                        }}
                      >
                        <Background gap={22} size={1} color="var(--color-border)" />
                        <Controls showInteractive={false} />
                      </ReactFlow>
                    ) : (
                      <p className="task-muted p-6">No files to display.</p>
                    )}
                  </div>
                  <p className="codebase-map-caption">
                    {selected
                      ? 'Selected file and direct neighbors'
                      : folderView
                        ? 'Arrows follow references between directories'
                        : 'Arrows point to referenced files'}
                    {graph && graph.total > GRAPH_LIMIT
                      ? ` · Showing ${GRAPH_LIMIT} of ${graph.total}; narrow the search`
                      : ''}
                  </p>
                </section>
              </div>
              {selectedFile && (
                <section className="codebase-detail" aria-label="Selected file details">
                  <div className="codebase-detail-heading">
                    <h2>{selectedFile.path}</h2>
                    <p>
                      {selectedFile.language} ·{' '}
                      {selectedFile.lines === null
                        ? `${selectedFile.bytes.toLocaleString()} bytes`
                        : `${selectedFile.lines.toLocaleString()} lines`}{' '}
                      · {selectedFile.analyzed ? 'Syntax analyzed' : 'File inventory only'}
                    </p>
                  </div>
                  <div className="codebase-relations">
                    <ReferenceList
                      title="References"
                      refs={outgoing}
                      incoming={false}
                      inspect={inspect}
                    />
                    <ReferenceList
                      title="Referenced by"
                      refs={incoming}
                      incoming
                      inspect={inspect}
                    />
                  </div>
                </section>
              )}
            </>
          )}
          <details className="codebase-coverage">
            <summary>What this map covers</summary>
            <p>
              {snapshot.files.filter((file) => file.analyzed).length} files syntax-analyzed.
              JavaScript / TypeScript: static imports, re-exports, literal import() and require().
              Rust: file module declarations and crate/self/super use paths. Other languages appear
              in the file inventory.
            </p>
            <p>
              Relative imports use common source extensions and directory indexes. Tsconfig aliases
              and packages resolve when they point to scanned local files. Computed paths, inline
              Rust modules, macros and custom module paths are not resolved. A require() call may be
              shadowed. Conditional and type-only references are included; this is a source map, not
              a runtime call graph.
            </p>
            <p>
              {snapshot.references.filter((ref) => ref.status === 'package or alias').length}{' '}
              package or alias references and{' '}
              {snapshot.references.filter((ref) => ref.status === 'unsupported').length} unsupported
              references are retained in file details and JSON export.
            </p>
            <p>
              Respects repository ignore files. Skips symlinks, dependency, build and output
              directories. Limits: 6,000 files, 512 KiB per analyzed file, 32 MiB of source, 30,000
              references, 20 seconds. Read in {(snapshot.durationMs / 1000).toFixed(2)} seconds.
              Recent snapshots are cached briefly for return visits.
            </p>
          </details>
        </>
      )}
    </div>
  );
}

function ReferenceList({
  title,
  refs,
  incoming,
  inspect,
}: {
  title: string;
  refs: CodebaseReference[];
  incoming: boolean;
  inspect: (path: string) => void;
}) {
  return (
    <div>
      <h3>
        {title} <span>{refs.length}</span>
      </h3>
      {refs.length === 0 && <p className="task-muted">No recorded references.</p>}
      <div className="codebase-reference-list">
        {refs.map((ref) => {
          const target = incoming ? ref.source : ref.target;
          const content = (
            <>
              <span>{incoming ? ref.source : (ref.target ?? ref.specifier)}</span>
              <small>
                Line {ref.line} · {ref.kind}
                {ref.target ? '' : ` · ${ref.status}`}
              </small>
            </>
          );
          return target ? (
            <button
              type="button"
              key={`${ref.source}:${ref.line}:${ref.specifier}:${ref.kind}`}
              onClick={() => inspect(target)}
            >
              {content}
            </button>
          ) : (
            <div
              className="codebase-reference"
              key={`${ref.source}:${ref.line}:${ref.specifier}:${ref.kind}`}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
