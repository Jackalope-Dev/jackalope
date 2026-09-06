export interface OpenTaskItem {
  id: string;
  title: string;
  sourceFile: string;
  status: 'open' | 'completed';
  category?: string;
}

export interface DiscoveredCodebaseMemory {
  projectId: string;
  projectName: string;
  projectPath: string;
  summary: string;
  techStack: string[];
  conventions: string[];
  openTasks: OpenTaskItem[];
  roadmapItems: string[];
  buildCommands: string[];
  testCommands: string[];
  lastScannedAt: string;
  tokenUsageEstimate: number;
  scanDurationMs: number;
  sourceFilesDetected: string[];
  metaAgent?: string;
}
