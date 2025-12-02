/**
 * MacRunner API Client
 * REST API functions for communicating with the FastAPI backend.
 */

// Dynamically determine API base URL based on current host
// This allows the app to work both locally and via Tailscale/remote access
const getApiBase = () => {
  const { protocol, hostname } = window.location;
  // In production or when accessing remotely, use port 8000 on the same host
  return `${protocol}//${hostname}:8000`;
};

const API_BASE = getApiBase();

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// PROJECT API
// ============================================================================

/**
 * Create a new project from a GitHub URL
 */
export async function createProject(data) {
  return apiFetch('/projects/', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Get all projects
 */
export async function getProjects() {
  return apiFetch('/projects/');
}

/**
 * Get a single project by ID
 */
export async function getProject(projectId) {
  return apiFetch(`/projects/${projectId}`);
}

/**
 * Update project configuration
 */
export async function updateProject(projectId, data) {
  return apiFetch(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Delete a project
 */
export async function deleteProject(projectId) {
  return apiFetch(`/projects/${projectId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// JOB API
// ============================================================================

/**
 * Run the install command for a project
 */
export async function installProject(projectId) {
  return apiFetch(`/projects/${projectId}/install`, {
    method: 'POST',
  });
}

/**
 * Run the main command for a project
 */
export async function runProject(projectId) {
  return apiFetch(`/projects/${projectId}/run`, {
    method: 'POST',
  });
}

/**
 * Execute git pull for a project
 */
export async function pullProject(projectId) {
  return apiFetch(`/projects/${projectId}/pull`, {
    method: 'POST',
  });
}

/**
 * Get all jobs for a project
 */
export async function getProjectJobs(projectId) {
  return apiFetch(`/projects/${projectId}/jobs`);
}

/**
 * Get a single job by ID
 */
export async function getJob(jobId) {
  return apiFetch(`/jobs/${jobId}`);
}

/**
 * Stop a running job
 */
export async function stopJob(jobId) {
  return apiFetch(`/jobs/${jobId}/stop`, {
    method: 'POST',
  });
}

// ============================================================================
// COMMAND TEMPLATES API
// ============================================================================

/**
 * Get all command templates for a project
 */
export async function getCommandTemplates(projectId) {
  return apiFetch(`/projects/${projectId}/commands`);
}

/**
 * Create a new command template
 */
export async function createCommandTemplate(projectId, data) {
  return apiFetch(`/projects/${projectId}/commands`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Update a command template
 */
export async function updateCommandTemplate(projectId, commandId, data) {
  return apiFetch(`/projects/${projectId}/commands/${commandId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Delete a command template
 */
export async function deleteCommandTemplate(projectId, commandId) {
  return apiFetch(`/projects/${projectId}/commands/${commandId}`, {
    method: 'DELETE',
  });
}

/**
 * Run a command template
 */
export async function runCommandTemplate(projectId, commandId) {
  return apiFetch(`/projects/${projectId}/commands/${commandId}/run`, {
    method: 'POST',
  });
}

// ============================================================================
// FILE EXPLORER API
// ============================================================================

/**
 * List files and directories at a path
 */
export async function listFiles(projectId, path = '') {
  return apiFetch(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`);
}

/**
 * Get file content
 */
export async function getFileContent(projectId, path) {
  const url = `${API_BASE}/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Get file download URL
 */
export function getFileDownloadUrl(projectId, path) {
  return `${API_BASE}/projects/${projectId}/files/download?path=${encodeURIComponent(path)}`;
}

/**
 * Get folder ZIP download URL
 */
export function getFolderZipUrl(projectId, path = '') {
  return `${API_BASE}/projects/${projectId}/files/download-zip?path=${encodeURIComponent(path)}`;
}

// ============================================================================
// TERMINAL API
// ============================================================================

/**
 * Start a new terminal session
 */
export async function startTerminalSession() {
  return apiFetch('/terminal/start', {
    method: 'POST',
  });
}

/**
 * Get WebSocket URL for terminal
 */
export function getTerminalWebSocketUrl(sessionId) {
  const { hostname } = window.location;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${hostname}:8000/ws/terminal/${sessionId}`;
}

// ============================================================================
// WEBSOCKET
// ============================================================================

/**
 * Get WebSocket URL for log streaming
 */
export function getLogWebSocketUrl(jobId) {
  const { hostname } = window.location;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${hostname}:8000/ws/logs/${jobId}`;
}
