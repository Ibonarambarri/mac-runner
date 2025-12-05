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
  Settings,
  Check,
  X,
  Trash2,
  Key,
  FileCode,
  ExternalLink,
  BookOpen,
  LayoutDashboard,
  ScrollText,
} from 'lucide-react';

import { LogViewer } from '../components/LogViewer';
import { CommandSection } from '../components/CommandSection';
import { QuickRun } from '../components/QuickRun';
import { FileExplorer } from '../components/FileExplorer';
import { EnvEditor } from '../components/EnvEditor';
import { TensorBoardWidget } from '../components/TensorBoardWidget';
import { ScheduleManager } from '../components/ScheduleManager';
import { UserMenu } from '../components/UserMenu';
import { CreateUserModal } from '../components/CreateUserModal';
import { useLogStream } from '../hooks/useLogStream';
import { useAuth } from '../contexts/AuthContext';
import {
  getProject,
  getProjectJobs,
  runProject,
  installProject,
  pullProject,
  stopJob,
  deleteJob,
  getCommandTemplates,
  runCommandTemplate,
  runOneOffCommand,
  updateProject,
  listNotebooks,
  runNotebook,
  startJupyter,
  stopJupyter,
  getJupyterStatus,
  createUser,
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
 * Get color class for job type text
 */
function getJobTypeColor(commandName) {
  switch (commandName) {
    case 'run':
      return 'text-terminal-green';
    case 'install':
      return 'text-blue-400';
    case 'pull':
      return 'text-purple-400';
    default:
      return 'text-slate-400';
  }
}

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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // State
  const [project, setProject] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [commands, setCommands] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('actions'); // 'actions' | 'files' | 'secrets' | 'schedules'

  // Mobile navigation state - separate from desktop tabs
  const [mobileView, setMobileView] = useState('dashboard'); // 'dashboard' | 'files' | 'logs'

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editInstallValue, setEditInstallValue] = useState('');
  const [editRunValue, setEditRunValue] = useState('');
  const [editRunEnabled, setEditRunEnabled] = useState(true);
  const [editNotebookEnabled, setEditNotebookEnabled] = useState(false);
  const [editDefaultNotebook, setEditDefaultNotebook] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // Jupyter state
  const [jupyterStatus, setJupyterStatus] = useState({ running: false });
  const [jupyterLoading, setJupyterLoading] = useState(false);
  const [notebooks, setNotebooks] = useState([]);
  const [runningNotebook, setRunningNotebook] = useState(false);
  const [showJupyterInstallModal, setShowJupyterInstallModal] = useState(false);
  const [installingJupyter, setInstallingJupyter] = useState(false);

  // Create User Modal state
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // Log streaming hook
  const { logs, isConnected, isComplete, error: wsError, clearLogs } = useLogStream(selectedJobId);

  // Fetch project data
  const fetchData = useCallback(async () => {
    try {
      const [projectData, jobsData, commandsData, jupStatus] = await Promise.all([
        getProject(projectId),
        getProjectJobs(projectId),
        getCommandTemplates(projectId),
        getJupyterStatus(projectId).catch(() => ({ running: false })),
      ]);
      setProject(projectData);
      setJobs(jobsData);
      setCommands(commandsData);
      setJupyterStatus(jupStatus);
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

  const handleOpenSettings = async () => {
    setEditInstallValue(project.install_command);
    setEditRunValue(project.run_command);
    setEditRunEnabled(project.run_command_enabled ?? true);
    setEditNotebookEnabled(project.run_notebook_enabled ?? false);
    setEditDefaultNotebook(project.default_notebook || '');
    // Fetch notebooks for the selector
    try {
      const result = await listNotebooks(projectId);
      setNotebooks(result.notebooks || []);
    } catch (e) {
      console.error('Failed to fetch notebooks:', e);
    }
    setIsSettingsOpen(true);
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await updateProject(projectId, {
        install_command: editInstallValue,
        run_command: editRunValue,
        run_command_enabled: editRunEnabled,
        run_notebook_enabled: editNotebookEnabled,
        default_notebook: editDefaultNotebook || null,
      });
      setIsSettingsOpen(false);
      await fetchData();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingSettings(false);
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

  const handleDeleteJob = async (jobId, e) => {
    e.stopPropagation(); // Prevent selecting the job when clicking delete
    try {
      await deleteJob(jobId);
      if (selectedJobId === jobId) {
        setSelectedJobId(null);
        clearLogs();
      }
      await fetchData();
    } catch (e) {
      setError(e.message);
    }
  };

  // Jupyter handlers
  const handleLaunchJupyter = async () => {
    setJupyterLoading(true);
    try {
      const result = await startJupyter(projectId);
      setJupyterStatus({ running: true, url: result.url, port: result.port });
      // Open Jupyter in a new tab
      window.open(result.url, '_blank');
    } catch (e) {
      // Check for JUPYTER_NOT_INSTALLED error
      if (e.message === 'JUPYTER_NOT_INSTALLED') {
        setShowJupyterInstallModal(true);
      } else {
        setError(e.message);
      }
    } finally {
      setJupyterLoading(false);
    }
  };

  const handleInstallJupyter = async () => {
    setInstallingJupyter(true);
    setShowJupyterInstallModal(false);
    try {
      const job = await runOneOffCommand(projectId, 'pip install jupyterlab');
      setSelectedJobId(job.id);
      clearLogs();
      await fetchData();
    } catch (e) {
      setError(e.message);
    } finally {
      setInstallingJupyter(false);
    }
  };

  const handleStopJupyter = async () => {
    setJupyterLoading(true);
    try {
      await stopJupyter(projectId);
      setJupyterStatus({ running: false });
    } catch (e) {
      setError(e.message);
    } finally {
      setJupyterLoading(false);
    }
  };

  // Create user handler
  const handleCreateUser = async (userData) => {
    setIsCreatingUser(true);
    try {
      await createUser(userData);
      setShowCreateUserModal(false);
    } catch (e) {
      throw e; // Re-throw to let modal display error
    } finally {
      setIsCreatingUser(false);
    }
  };

  // Notebook handlers - run the default notebook directly
  const handleRunDefaultNotebook = async () => {
    if (!project.default_notebook) {
      setError('No default notebook configured. Go to Settings to select one.');
      return;
    }
    setRunningNotebook(true);
    try {
      const job = await runNotebook(projectId, project.default_notebook);
      setSelectedJobId(job.id);
      clearLogs();
      await fetchData();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunningNotebook(false);
    }
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

            {/* Jupyter Launch Button */}
            <div className="flex items-center gap-2">
              {jupyterStatus.running ? (
                <div className="flex items-center gap-2">
                  <a
                    href={jupyterStatus.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 text-orange-400 text-sm rounded-lg hover:bg-orange-500/30 transition-colors"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span className="hidden sm:inline">Jupyter</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    onClick={handleStopJupyter}
                    disabled={jupyterLoading}
                    className="p-1.5 text-orange-400 hover:bg-orange-500/20 rounded-lg transition-colors disabled:opacity-50"
                    title="Stop Jupyter"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleLaunchJupyter}
                  disabled={jupyterLoading || isCloning}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 text-orange-400 text-sm rounded-lg hover:bg-orange-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Launch Jupyter Lab"
                >
                  {jupyterLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <BookOpen className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">Jupyter</span>
                </button>
              )}
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

            {/* User Menu */}
            <UserMenu onCreateUser={() => setShowCreateUserModal(true)} />
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

      {/* Main content - Different layouts for mobile and desktop */}
      <main className="max-w-7xl mx-auto">
        {/* ==================== DESKTOP LAYOUT (lg+) ==================== */}
        <div className="hidden lg:block px-6 py-6">
          {/* Desktop Tab switcher */}
          <div className="flex gap-2 flex-wrap mb-6">
            <button
              onClick={() => setActiveTab('actions')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'files'
                  ? 'bg-terminal-green/20 text-terminal-green'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderOpen className="w-4 h-4" />
              Files
            </button>
            <button
              onClick={() => setActiveTab('secrets')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'secrets'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Key className="w-4 h-4" />
              Secrets
            </button>
            <button
              onClick={() => setActiveTab('schedules')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'schedules'
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-4 h-4" />
              Schedules
            </button>
          </div>

          {/* Desktop 2-column layout */}
          <div className={`grid gap-6 ${activeTab === 'files' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
            {/* Left column: Content */}
            <div className="space-y-6">
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
                          {project.run_command_enabled && (
                            <button
                              onClick={handleRun}
                              disabled={isCloning}
                              className="flex items-center gap-2 px-4 py-2.5 bg-terminal-green/20 text-terminal-green rounded-lg hover:bg-terminal-green/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Play className="w-4 h-4" />
                              Run
                            </button>
                          )}
                          <button
                            onClick={handleInstall}
                            disabled={isCloning}
                            className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Download className="w-4 h-4" />
                            Install
                          </button>
                          <button
                            onClick={handlePull}
                            disabled={isCloning}
                            className="flex items-center gap-2 px-4 py-2.5 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <GitPullRequest className="w-4 h-4" />
                            Pull
                          </button>
                          {project.run_notebook_enabled && (
                            <button
                              onClick={handleRunDefaultNotebook}
                              disabled={isCloning || runningNotebook}
                              className="flex items-center gap-2 px-4 py-2.5 bg-orange-500/20 text-orange-400 rounded-lg hover:bg-orange-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title={project.default_notebook || 'No notebook configured'}
                            >
                              {runningNotebook ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <FileCode className="w-4 h-4" />
                              )}
                              Notebook
                            </button>
                          )}
                        </>
                      )}
                      <div className="flex items-center gap-2 ml-auto">
                        <button
                          onClick={handleOpenSettings}
                          className="p-2.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Settings"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          onClick={fetchData}
                          className="p-2.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
                          title="Refresh"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* Quick Run - Admin only */}
                  {isAdmin && (
                    <QuickRun
                      projectId={projectId}
                      onJobStarted={(job) => {
                        setSelectedJobId(job.id);
                        clearLogs();
                      }}
                      onCommandsChange={fetchData}
                      disabled={isRunning || isCloning}
                    />
                  )}

                  {/* Command Templates */}
                  <CommandSection
                    projectId={projectId}
                    commands={commands}
                    onRunCommand={handleRunCommand}
                    onCommandsChange={fetchData}
                    disabled={isRunning || isCloning}
                    isAdmin={isAdmin}
                  />

                  {/* Job History */}
                  <section className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                    <h2 className="text-sm font-semibold text-slate-400 mb-4">Job History</h2>
                    {jobs.length === 0 ? (
                      <p className="text-slate-500 text-sm">No jobs yet</p>
                    ) : (
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {jobs.slice(0, 10).map((job) => (
                          <div
                            key={job.id}
                            onClick={() => handleSelectJob(job.id)}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer group ${
                              selectedJobId === job.id
                                ? 'bg-terminal-green/10 text-terminal-green'
                                : 'hover:bg-slate-800'
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

                            <span className={`flex-1 truncate ${selectedJobId === job.id ? '' : getJobTypeColor(job.command_name)}`} title={job.command_executed || ''}>
                              #{job.id} {job.command_executed
                                ? `- ${job.command_executed.length > 40 ? job.command_executed.substring(0, 40) + '...' : job.command_executed}`
                                : job.command_name && `- ${job.command_name}`}
                            </span>
                            <span className="text-xs text-slate-500 flex-shrink-0">
                              {new Date(job.start_time).toLocaleTimeString()}
                            </span>
                            {job.status !== 'running' && (
                              <button
                                onClick={(e) => handleDeleteJob(job.id, e)}
                                className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all flex-shrink-0 touch-manipulation"
                                title="Delete job"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ) : activeTab === 'files' ? (
                <div className="h-[calc(100vh-240px)]">
                  <TensorBoardWidget projectId={projectId} />
                  <FileExplorer projectId={projectId} fullWidth />
                </div>
              ) : activeTab === 'secrets' ? (
                <EnvEditor projectId={projectId} />
              ) : activeTab === 'schedules' ? (
                <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                  <ScheduleManager projectId={parseInt(projectId)} />
                </div>
              ) : null}
            </div>

            {/* Right column: Log Viewer - Desktop only, hidden when Files tab */}
            {activeTab !== 'files' && (
              <div className="sticky top-6 h-[calc(100vh-200px)]">
                <LogViewer
                  logs={logs}
                  isConnected={isConnected}
                  isComplete={isComplete}
                  error={wsError}
                  jobId={selectedJobId}
                  onClear={() => {
                    setSelectedJobId(null);
                    clearLogs();
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ==================== MOBILE LAYOUT (< lg) ==================== */}
        <div className="lg:hidden flex flex-col h-[calc(100dvh-140px)]">
          {/* Mobile Content Area - takes remaining space above bottom nav */}
          <div className="flex-1 overflow-hidden pb-16">
            {/* Dashboard View */}
            {mobileView === 'dashboard' && (
              <div className="h-full overflow-y-auto px-4 py-4 space-y-4">
                {/* Quick Actions */}
                <section className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                  <h2 className="text-sm font-semibold text-slate-400 mb-3">Quick Actions</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {isRunning ? (
                      <button
                        onClick={handleStop}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-red-500/20 text-red-400 rounded-lg active:bg-red-500/30 transition-colors touch-manipulation"
                      >
                        <Square className="w-5 h-5" />
                        Stop
                      </button>
                    ) : (
                      <>
                        {project.run_command_enabled && (
                          <button
                            onClick={handleRun}
                            disabled={isCloning}
                            className="flex items-center justify-center gap-2 px-4 py-3 bg-terminal-green/20 text-terminal-green rounded-lg active:bg-terminal-green/30 transition-colors disabled:opacity-50 touch-manipulation"
                          >
                            <Play className="w-5 h-5" />
                            Run
                          </button>
                        )}
                        <button
                          onClick={handleInstall}
                          disabled={isCloning}
                          className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-500/20 text-blue-400 rounded-lg active:bg-blue-500/30 transition-colors disabled:opacity-50 touch-manipulation"
                        >
                          <Download className="w-5 h-5" />
                          Install
                        </button>
                        <button
                          onClick={handlePull}
                          disabled={isCloning}
                          className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-500/20 text-purple-400 rounded-lg active:bg-purple-500/30 transition-colors disabled:opacity-50 touch-manipulation"
                        >
                          <GitPullRequest className="w-5 h-5" />
                          Pull
                        </button>
                        <button
                          onClick={handleOpenSettings}
                          className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 text-slate-300 rounded-lg active:bg-slate-700 transition-colors touch-manipulation"
                        >
                          <Settings className="w-5 h-5" />
                          Settings
                        </button>
                      </>
                    )}
                  </div>
                </section>

                {/* Quick Run - Admin only */}
                {isAdmin && (
                  <QuickRun
                    projectId={projectId}
                    onJobStarted={(job) => {
                      setSelectedJobId(job.id);
                      setMobileView('logs');
                      clearLogs();
                    }}
                    onCommandsChange={fetchData}
                    disabled={isRunning || isCloning}
                  />
                )}

                {/* Command Templates */}
                <CommandSection
                  projectId={projectId}
                  commands={commands}
                  onRunCommand={(commandId) => {
                    handleRunCommand(commandId);
                    setMobileView('logs');
                  }}
                  onCommandsChange={fetchData}
                  disabled={isRunning || isCloning}
                  isAdmin={isAdmin}
                />

                {/* Job History */}
                <section className="bg-slate-900/50 border border-slate-800 rounded-lg p-4">
                  <h2 className="text-sm font-semibold text-slate-400 mb-3">Job History</h2>
                  {jobs.length === 0 ? (
                    <p className="text-slate-500 text-sm">No jobs yet</p>
                  ) : (
                    <div className="space-y-1">
                      {jobs.slice(0, 10).map((job) => (
                        <div
                          key={job.id}
                          onClick={() => {
                            handleSelectJob(job.id);
                            setMobileView('logs');
                          }}
                          className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors cursor-pointer active:bg-slate-700 touch-manipulation ${
                            selectedJobId === job.id
                              ? 'bg-terminal-green/10 text-terminal-green'
                              : 'bg-slate-800/50'
                          }`}
                        >
                          {job.status === 'running' && (
                            <Loader2 className="w-4 h-4 animate-spin text-terminal-green flex-shrink-0" />
                          )}
                          {job.status === 'completed' && (
                            <CheckCircle2 className="w-4 h-4 text-terminal-green flex-shrink-0" />
                          )}
                          {job.status === 'failed' && (
                            <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          )}
                          {job.status === 'stopped' && (
                            <Square className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          )}
                          {job.status === 'pending' && (
                            <Clock className="w-4 h-4 text-slate-500 flex-shrink-0" />
                          )}

                          <span className={`flex-1 truncate ${selectedJobId === job.id ? '' : getJobTypeColor(job.command_name)}`}>
                            #{job.id} {job.command_name || 'command'}
                          </span>
                          <span className="text-xs text-slate-500 flex-shrink-0">
                            {new Date(job.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {/* Delete button always visible on mobile */}
                          {job.status !== 'running' && (
                            <button
                              onClick={(e) => handleDeleteJob(job.id, e)}
                              className="p-2 text-slate-500 active:text-red-400 active:bg-red-500/10 rounded flex-shrink-0 touch-manipulation"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Secrets & Schedules Links */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setActiveTab('secrets')}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-yellow-500/10 text-yellow-400 rounded-lg border border-yellow-500/20 active:bg-yellow-500/20 touch-manipulation"
                  >
                    <Key className="w-5 h-5" />
                    Secrets
                  </button>
                  <button
                    onClick={() => setActiveTab('schedules')}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-500/10 text-purple-400 rounded-lg border border-purple-500/20 active:bg-purple-500/20 touch-manipulation"
                  >
                    <Clock className="w-5 h-5" />
                    Schedules
                  </button>
                </div>
              </div>
            )}

            {/* Files View */}
            {mobileView === 'files' && (
              <div className="h-full">
                <FileExplorer projectId={projectId} fullWidth isMobile />
              </div>
            )}

            {/* Logs View */}
            {mobileView === 'logs' && (
              <div className="h-full p-2">
                <LogViewer
                  logs={logs}
                  isConnected={isConnected}
                  isComplete={isComplete}
                  error={wsError}
                  jobId={selectedJobId}
                  onClear={() => {
                    setSelectedJobId(null);
                    clearLogs();
                  }}
                  isMobile
                />
              </div>
            )}
          </div>

          {/* Mobile Bottom Navigation - Sticky */}
          <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 px-2 py-2 pb-safe z-40">
            <div className="flex justify-around items-center max-w-md mx-auto">
              <button
                onClick={() => setMobileView('dashboard')}
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors touch-manipulation min-w-[72px] ${
                  mobileView === 'dashboard'
                    ? 'text-terminal-green bg-terminal-green/10'
                    : 'text-slate-400 active:text-slate-200'
                }`}
              >
                <LayoutDashboard className="w-5 h-5" />
                <span className="text-xs font-medium">Dashboard</span>
              </button>
              <button
                onClick={() => setMobileView('files')}
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors touch-manipulation min-w-[72px] ${
                  mobileView === 'files'
                    ? 'text-terminal-green bg-terminal-green/10'
                    : 'text-slate-400 active:text-slate-200'
                }`}
              >
                <FolderOpen className="w-5 h-5" />
                <span className="text-xs font-medium">Files</span>
              </button>
              <button
                onClick={() => setMobileView('logs')}
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors touch-manipulation min-w-[72px] relative ${
                  mobileView === 'logs'
                    ? 'text-terminal-green bg-terminal-green/10'
                    : 'text-slate-400 active:text-slate-200'
                }`}
              >
                <ScrollText className="w-5 h-5" />
                <span className="text-xs font-medium">Logs</span>
                {/* Running indicator */}
                {isRunning && mobileView !== 'logs' && (
                  <span className="absolute top-1 right-3 w-2 h-2 bg-terminal-green rounded-full animate-pulse" />
                )}
              </button>
            </div>
          </nav>
        </div>
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 w-full max-w-md rounded-xl border border-slate-800 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-400" />
                <span className="font-semibold text-slate-100">Project Settings</span>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Install command */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Install Command
                </label>
                <input
                  type="text"
                  value={editInstallValue}
                  onChange={(e) => setEditInstallValue(e.target.value)}
                  placeholder="pip install -r requirements.txt"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green"
                />
              </div>

              {/* Run command toggle */}
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editRunEnabled}
                    onChange={(e) => setEditRunEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-950 text-terminal-green focus:ring-terminal-green focus:ring-offset-slate-900"
                  />
                  <span className="text-sm text-slate-300">Enable Run Command</span>
                </label>
              </div>

              {/* Run command */}
              {editRunEnabled && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Run Command
                  </label>
                  <input
                    type="text"
                    value={editRunValue}
                    onChange={(e) => setEditRunValue(e.target.value)}
                    placeholder="python main.py"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-terminal-green"
                  />
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-slate-700 my-2"></div>

              {/* Notebook toggle */}
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editNotebookEnabled}
                    onChange={(e) => setEditNotebookEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-950 text-orange-400 focus:ring-orange-400 focus:ring-offset-slate-900"
                  />
                  <span className="text-sm text-slate-300">Enable Run Notebook</span>
                </label>
              </div>

              {/* Default notebook selector */}
              {editNotebookEnabled && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Default Notebook
                  </label>
                  {notebooks.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">No notebooks found in project</p>
                  ) : (
                    <select
                      value={editDefaultNotebook}
                      onChange={(e) => setEditDefaultNotebook(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-orange-400"
                    >
                      <option value="">Select a notebook...</option>
                      {notebooks.map((nb) => (
                        <option key={nb.path} value={nb.path}>
                          {nb.path}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-4 py-3 border-t border-slate-800 bg-slate-900/30">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-4 py-2 text-sm bg-terminal-green text-slate-950 font-semibold rounded-lg hover:bg-terminal-green/90 transition-colors disabled:opacity-50"
              >
                {savingSettings ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Jupyter Install Modal */}
      {showJupyterInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 w-full max-w-md rounded-xl border border-slate-800 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-orange-400" />
                <span className="font-semibold text-slate-100">Jupyter Lab Not Installed</span>
              </div>
              <button
                onClick={() => setShowJupyterInstallModal(false)}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              <p className="text-slate-300 text-sm">
                Jupyter Lab is not installed in this project's environment. Would you like to install it now?
              </p>
              <div className="bg-slate-950 border border-slate-700 rounded-lg p-3">
                <code className="text-sm text-orange-400 font-mono">pip install jupyterlab</code>
              </div>
              <p className="text-slate-500 text-xs">
                This will run in the project's virtual environment and the output will appear in the log viewer.
              </p>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-4 py-3 border-t border-slate-800 bg-slate-900/30">
              <button
                onClick={() => setShowJupyterInstallModal(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInstallJupyter}
                disabled={installingJupyter}
                className="px-4 py-2 text-sm bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-500/90 transition-colors disabled:opacity-50"
              >
                {installingJupyter ? 'Installing...' : 'Install Jupyter Lab'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal - Admin only */}
      <CreateUserModal
        isOpen={showCreateUserModal}
        onClose={() => setShowCreateUserModal(false)}
        onSubmit={handleCreateUser}
        isLoading={isCreatingUser}
      />

    </div>
  );
}

export default ProjectPage;
