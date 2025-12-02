import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Square,
  Download,
  GitBranch,
  GitPullRequest,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  FolderOpen,
  Terminal,
} from 'lucide-react';

import { LogViewer } from '../components/LogViewer';
import { CommandSection } from '../components/CommandSection';
import { FileExplorer } from '../components/FileExplorer';
import { useLogStream } from '../hooks/useLogStream';
import {
  getProject,
  getProjectJobs,
  runProject,
  installProject,
  pullProject,
  stopJob,
  getCommandTemplates,
  runCommandTemplate,
} from '../api';

/**
 * Status indicator colors and icons
 */
const STATUS_CONFIG = {
  idle: {
    color: 'bg-slate-500',
    icon: null,
    text: 'Idle',
  },
  cloning: {
    color: 'bg-blue-500',
    icon: Loader2,
    text: 'Cloning...',
    animate: true,
  },
  running: {
    color: 'bg-terminal-green',
    icon: null,
    text: 'Running',
    pulse: true,
  },
  error: {
    color: 'bg-red-500',
    icon: AlertCircle,
    text: 'Error',
  },
};

/**
 * ProjectPage Component
 *
 * Detail page for a single project with:
 * - Project info and status
 * - Install/Run buttons
 * - Command templates section
 * - Log viewer
 * - Job history
 */
function ProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const projectId = parseInt(id, 10);

  // State
  const [project, setProject] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [commands, setCommands] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('actions'); // 'actions' | 'files'

  // Log streaming hook
  const { logs, isConnected, isComplete, error: wsError, clearLogs } = useLogStream(selectedJobId);

  // Fetch project data
  const fetchData = useCallback(async () => {
    try {
      const [projectData, jobsData, commandsData] = await Promise.all([
        getProject(projectId),
        getProjectJobs(projectId),
        getCommandTemplates(projectId),
      ]);
      setProject(projectData);
      setJobs(jobsData);
      setCommands(commandsData);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();

    // Poll for updates every 3 seconds
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Handlers
  const handleRun = async () => {
    try {
      const job = await runProject(projectId);
      setSelectedJobId(job.id);
      clearLogs();
      await fetchData();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleInstall = async () => {
    try {
      const job = await installProject(projectId);
      setSelectedJobId(job.id);
      clearLogs();
      await fetchData();
    } catch (e) {
      setError(e.message);
    }
  };

  const handlePull = async () => {
    try {
      const job = await pullProject(projectId);
      setSelectedJobId(job.id);
      clearLogs();
      await fetchData();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleStop = async () => {
    const runningJob = jobs.find((j) => j.status === 'running');
    if (!runningJob) return;

    try {
      await stopJob(runningJob.id);
      await fetchData();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleRunCommand = async (commandId) => {
    try {
      const job = await runCommandTemplate(projectId, commandId);
      setSelectedJobId(job.id);
      clearLogs();
      await fetchData();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSelectJob = (jobId) => {
    setSelectedJobId(jobId);
    clearLogs();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-terminal-green" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center">
        <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
        <p className="text-slate-400">Project not found</p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 text-terminal-green hover:underline"
        >
          Back to projects
        </button>
      </div>
    );
  }

  const status = STATUS_CONFIG[project.status] || STATUS_CONFIG.idle;
  const StatusIcon = status.icon;
  const isRunning = project.status === 'running';
  const isCloning = project.status === 'cloning';
  const runningJob = jobs.find((j) => j.status === 'running');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-100 truncate">
                {project.name}
              </h1>
              <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
                <GitBranch className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{project.repo_url}</span>
              </div>
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${status.color} ${
                  status.pulse ? 'status-pulse' : ''
                }`}
              />
              {StatusIcon && (
                <StatusIcon
                  className={`w-4 h-4 text-slate-400 ${
                    status.animate ? 'animate-spin' : ''
                  }`}
                />
              )}
              <span className="text-sm text-slate-400">{status.text}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/20 border-b border-red-500/30 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <span className="text-red-400 text-sm">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column: Tabs + Content */}
          <div className="space-y-6">
            {/* Tab switcher */}
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('actions')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation ${
                  activeTab === 'actions'
                    ? 'bg-terminal-green/20 text-terminal-green'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Terminal className="w-4 h-4" />
                Actions
              </button>
              <button
                onClick={() => setActiveTab('files')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation ${
                  activeTab === 'files'
                    ? 'bg-terminal-green/20 text-terminal-green'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <FolderOpen className="w-4 h-4" />
                Files
              </button>
            </div>

            {activeTab === 'actions' ? (
              <>
                {/* Quick Actions */}
                <section className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                  <h2 className="text-sm font-semibold text-slate-400 mb-4">Quick Actions</h2>
                  <div className="flex flex-wrap gap-3">
                    {isRunning ? (
                      <button
                        onClick={handleStop}
                        className="flex items-center gap-2 px-4 py-2.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                      >
                        <Square className="w-4 h-4" />
                        Stop
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleRun}
                          disabled={isCloning}
                          className="flex items-center gap-2 px-4 py-2.5 bg-terminal-green/20 text-terminal-green rounded-lg hover:bg-terminal-green/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                        >
                          <Play className="w-4 h-4" />
                          Run
                        </button>
                        <button
                          onClick={handleInstall}
                          disabled={isCloning}
                          className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                        >
                          <Download className="w-4 h-4" />
                          Install
                        </button>
                        <button
                          onClick={handlePull}
                          disabled={isCloning}
                          className="flex items-center gap-2 px-4 py-2.5 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
                        >
                          <GitPullRequest className="w-4 h-4" />
                          Pull
                        </button>
                      </>
                    )}
                    <button
                      onClick={fetchData}
                      className="p-2.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors ml-auto"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Default commands info */}
                  <div className="mt-4 pt-4 border-t border-slate-800 space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-slate-500 w-16 flex-shrink-0">Install:</span>
                      <code className="text-slate-300 font-mono text-xs bg-slate-800 px-2 py-1 rounded">
                        {project.install_command}
                      </code>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-slate-500 w-16 flex-shrink-0">Run:</span>
                      <code className="text-slate-300 font-mono text-xs bg-slate-800 px-2 py-1 rounded">
                        {project.run_command}
                      </code>
                    </div>
                  </div>
                </section>

                {/* Command Templates */}
                <CommandSection
                  projectId={projectId}
                  commands={commands}
                  onRunCommand={handleRunCommand}
                  onCommandsChange={fetchData}
                  disabled={isRunning || isCloning}
                />

                {/* Job History */}
                <section className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                  <h2 className="text-sm font-semibold text-slate-400 mb-4">Job History</h2>
                  {jobs.length === 0 ? (
                    <p className="text-slate-500 text-sm">No jobs yet</p>
                  ) : (
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {jobs.slice(0, 10).map((job) => (
                        <button
                          key={job.id}
                          onClick={() => handleSelectJob(job.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                            selectedJobId === job.id
                              ? 'bg-terminal-green/10 text-terminal-green'
                              : 'hover:bg-slate-800 text-slate-400'
                          }`}
                        >
                          {job.status === 'running' && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-terminal-green flex-shrink-0" />
                          )}
                          {job.status === 'completed' && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-terminal-green flex-shrink-0" />
                          )}
                          {job.status === 'failed' && (
                            <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                          )}
                          {job.status === 'stopped' && (
                            <Square className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                          )}
                          {job.status === 'pending' && (
                            <Clock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                          )}

                          <span className="flex-1 truncate">
                            #{job.id} {job.command_name && `- ${job.command_name}`}
                          </span>
                          <span className="text-xs text-slate-500 flex-shrink-0">
                            {new Date(job.start_time).toLocaleTimeString()}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : (
              /* Files Tab */
              <FileExplorer projectId={projectId} />
            )}
          </div>

          {/* Right column: Log Viewer */}
          <div className="lg:sticky lg:top-6 h-[calc(100vh-200px)]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-400">
                {selectedJobId ? `Job #${selectedJobId}` : 'Output'}
              </h2>
              {selectedJobId && (
                <button
                  onClick={() => {
                    setSelectedJobId(null);
                    clearLogs();
                  }}
                  className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="h-full">
              <LogViewer
                logs={logs}
                isConnected={isConnected}
                isComplete={isComplete}
                error={wsError}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default ProjectPage;
