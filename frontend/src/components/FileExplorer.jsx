import { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  File,
  FileText,
  FileCode,
  Image,
  ChevronRight,
  ChevronDown,
  Download,
  Archive,
  ArrowLeft,
  Loader2,
  Home,
  CheckSquare,
  Square,
  Eye,
  X,
  Edit3,
  Save,
  RotateCcw,
  Code,
  BookOpen,
} from 'lucide-react';
import { listFiles, getFileDownloadUrl, getFolderZipUrl, getBatchDownloadUrl, getFileContent, saveFileContent, renderNotebook } from '../api';
import { MarkdownRenderer } from './MarkdownRenderer';

/**
 * Get icon component based on file extension
 */
function getFileIcon(extension, isDirectory) {
  if (isDirectory) return Folder;

  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'go', 'rs', 'rb', 'php', 'ipynb'];
  const textExtensions = ['txt', 'md', 'json', 'yml', 'yaml', 'xml', 'html', 'css', 'scss'];
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'];

  if (codeExtensions.includes(extension)) return FileCode;
  if (textExtensions.includes(extension)) return FileText;
  if (imageExtensions.includes(extension)) return Image;

  return File;
}

/**
 * Format file size in human readable format
 */
function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if file is previewable
 */
function isPreviewable(extension) {
  const previewableExtensions = [
    // Code/Text
    'txt', 'md', 'json', 'yml', 'yaml', 'xml', 'html', 'css', 'scss',
    'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'go', 'rs', 'rb', 'php',
    'sh', 'bash', 'zsh', 'conf', 'cfg', 'ini', 'toml', 'env', 'gitignore', 'dockerfile',
    // Notebooks
    'ipynb',
    // Images
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico',
  ];
  return previewableExtensions.includes(extension?.toLowerCase());
}

/**
 * Check if file is an image
 */
function isImage(extension) {
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'];
  return imageExtensions.includes(extension?.toLowerCase());
}

/**
 * Check if file is editable (text-based)
 */
function isEditable(extension) {
  const editableExtensions = [
    // Code
    'txt', 'md', 'json', 'yml', 'yaml', 'xml', 'html', 'css', 'scss',
    'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'go', 'rs', 'rb', 'php',
    'sh', 'bash', 'zsh', 'conf', 'cfg', 'ini', 'toml', 'env', 'gitignore', 'dockerfile',
  ];
  return editableExtensions.includes(extension?.toLowerCase());
}

/**
 * Check if file is a markdown file
 */
function isMarkdown(extension) {
  return extension?.toLowerCase() === 'md' || extension?.toLowerCase() === 'markdown';
}

/**
 * FileExplorer Component
 *
 * VS Code-style file browser with split pane.
 * Left side: File tree
 * Right side: File preview/editor
 *
 * Mobile: Single view with fullscreen file preview
 */
export function FileExplorer({ projectId, fullWidth = false, isMobile = false }) {
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Multi-select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState(new Set());

  // Preview state
  const [previewFile, setPreviewFile] = useState(null);
  const [previewContent, setPreviewContent] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Markdown view mode (rendered vs source)
  const [showMarkdownSource, setShowMarkdownSource] = useState(false);

  // Mobile: show file preview fullscreen
  const [mobileShowPreview, setMobileShowPreview] = useState(false);

  // Fetch files for current path
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listFiles(projectId, currentPath);
      setFiles(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, currentPath]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // Navigate to a directory
  const navigateTo = (path) => {
    setCurrentPath(path);
    // Clear preview when navigating
    setPreviewFile(null);
    setPreviewContent(null);
  };

  // Toggle select mode
  const toggleSelectMode = () => {
    if (selectMode) {
      setSelectedPaths(new Set());
    }
    setSelectMode(!selectMode);
  };

  // Toggle selection of a file/folder
  const toggleSelection = (path, e) => {
    e.stopPropagation();
    setSelectedPaths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  // Handle batch download
  const handleBatchDownload = () => {
    if (selectedPaths.size === 0) return;
    const url = getBatchDownloadUrl(projectId, Array.from(selectedPaths));
    window.location.href = url;
  };

  // Go back one level
  const goBack = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    navigateTo(parts.join('/'));
  };

  // Handle file click - preview or navigate
  const handleFileClick = async (file) => {
    if (file.is_directory) {
      navigateTo(file.path);
    } else if (!selectMode) {
      // Preview the file
      await loadPreview(file);
      // On mobile, show fullscreen preview
      if (isMobile) {
        setMobileShowPreview(true);
      }
    }
  };

  // Load file preview
  const loadPreview = async (file) => {
    setPreviewFile(file);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewContent(null);
    setShowMarkdownSource(false); // Reset markdown view mode for new files

    try {
      if (file.extension === 'ipynb') {
        // Render notebook as HTML
        const result = await renderNotebook(projectId, file.path);
        setPreviewContent({ type: 'notebook', html: result.html });
      } else if (isImage(file.extension)) {
        // Image preview - use download URL
        setPreviewContent({ type: 'image', url: getFileDownloadUrl(projectId, file.path) });
      } else if (isPreviewable(file.extension)) {
        // Text/code preview
        const content = await getFileContent(projectId, file.path);
        setPreviewContent({ type: 'text', content, extension: file.extension });
      } else {
        setPreviewContent({ type: 'binary' });
      }
    } catch (e) {
      setPreviewError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Close preview
  const closePreview = () => {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Are you sure you want to close?')) {
        return;
      }
    }
    setPreviewFile(null);
    setPreviewContent(null);
    setPreviewError(null);
    setIsEditing(false);
    setEditContent('');
    setOriginalContent('');
    setHasUnsavedChanges(false);
    setSaveError(null);
    setShowMarkdownSource(false);
    setMobileShowPreview(false);
  };

  // Enter edit mode
  const enterEditMode = () => {
    if (previewContent?.type === 'text') {
      setEditContent(previewContent.content);
      setOriginalContent(previewContent.content);
      setIsEditing(true);
      setHasUnsavedChanges(false);
      setSaveError(null);
    }
  };

  // Cancel edit mode
  const cancelEdit = () => {
    if (hasUnsavedChanges) {
      if (!confirm('Discard unsaved changes?')) {
        return;
      }
    }
    setIsEditing(false);
    setEditContent('');
    setHasUnsavedChanges(false);
    setSaveError(null);
  };

  // Handle content change
  const handleContentChange = (e) => {
    const newContent = e.target.value;
    setEditContent(newContent);
    setHasUnsavedChanges(newContent !== originalContent);
    setSaveError(null);
  };

  // Save file
  const handleSave = async () => {
    if (!previewFile || !hasUnsavedChanges) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      await saveFileContent(projectId, previewFile.path, editContent);
      setOriginalContent(editContent);
      setHasUnsavedChanges(false);
      // Update preview content
      setPreviewContent({ ...previewContent, content: editContent });
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Revert changes
  const handleRevert = () => {
    if (!confirm('Revert all changes?')) return;
    setEditContent(originalContent);
    setHasUnsavedChanges(false);
    setSaveError(null);
  };

  // Build breadcrumb parts
  const breadcrumbParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  // Determine if we're in full-width split mode
  const showSplitView = fullWidth && !isMobile;

  // ==================== MOBILE LAYOUT ====================
  if (isMobile) {
    return (
      <div className="h-full flex flex-col bg-slate-900/50">
        {/* Mobile: Fullscreen file preview overlay */}
        {mobileShowPreview && previewFile && (
          <div className="absolute inset-0 z-30 bg-slate-950 flex flex-col">
            {/* Mobile Preview Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900 flex-shrink-0">
              <button
                onClick={closePreview}
                className="p-2 -ml-2 text-slate-400 active:text-slate-200 active:bg-slate-800 rounded-lg transition-colors touch-manipulation"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{previewFile.name}</p>
                <p className="text-xs text-slate-500">{formatSize(previewFile.size)}</p>
              </div>
              {/* Mobile action buttons */}
              <div className="flex items-center gap-1">
                {previewContent?.type === 'text' && isEditable(previewFile.extension) && !isEditing && (
                  <button
                    onClick={enterEditMode}
                    className="p-2.5 text-blue-400 active:bg-blue-500/20 rounded-lg transition-colors touch-manipulation"
                  >
                    <Edit3 className="w-5 h-5" />
                  </button>
                )}
                {isEditing && (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={isSaving || !hasUnsavedChanges}
                      className={`p-2.5 rounded-lg transition-colors touch-manipulation ${
                        hasUnsavedChanges ? 'text-terminal-green active:bg-terminal-green/20' : 'text-slate-600'
                      }`}
                    >
                      <Save className="w-5 h-5" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="p-2.5 text-slate-400 active:bg-slate-800 rounded-lg transition-colors touch-manipulation"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </>
                )}
                <a
                  href={getFileDownloadUrl(projectId, previewFile.path)}
                  className="p-2.5 text-terminal-green active:bg-terminal-green/20 rounded-lg transition-colors touch-manipulation"
                >
                  <Download className="w-5 h-5" />
                </a>
              </div>
            </div>

            {/* Mobile Preview Content */}
            <div className="flex-1 overflow-auto">
              {previewLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-8 h-8 animate-spin text-terminal-green" />
                </div>
              ) : previewError ? (
                <div className="flex items-center justify-center h-full p-4">
                  <p className="text-red-400 text-sm text-center">{previewError}</p>
                </div>
              ) : previewContent?.type === 'notebook' ? (
                <div
                  className="p-4 notebook-preview"
                  dangerouslySetInnerHTML={{ __html: previewContent.html }}
                  style={{ backgroundColor: '#fff', color: '#000' }}
                />
              ) : previewContent?.type === 'image' ? (
                <div className="flex items-center justify-center h-full p-4">
                  <img
                    src={previewContent.url}
                    alt={previewFile.name}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : previewContent?.type === 'text' ? (
                isEditing ? (
                  <div className="h-full flex flex-col">
                    {saveError && (
                      <div className="px-4 py-2 bg-red-500/20 text-red-400 text-sm">
                        Error: {saveError}
                      </div>
                    )}
                    <textarea
                      value={editContent}
                      onChange={handleContentChange}
                      className="flex-1 w-full p-4 text-sm text-slate-200 font-mono bg-slate-950 resize-none focus:outline-none"
                      spellCheck={false}
                      autoFocus
                    />
                  </div>
                ) : isMarkdown(previewFile.extension) && !showMarkdownSource ? (
                  <div className="p-4">
                    <MarkdownRenderer content={previewContent.content} />
                  </div>
                ) : (
                  <pre className="p-4 text-sm text-slate-200 font-mono whitespace-pre-wrap break-all">
                    {previewContent.content}
                  </pre>
                )
              ) : previewContent?.type === 'binary' ? (
                <div className="flex flex-col items-center justify-center h-full p-4 gap-4">
                  <File className="w-16 h-16 text-slate-500" />
                  <p className="text-slate-400 text-sm">Binary file</p>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Mobile: File list header */}
        <div className="border-b border-slate-800 p-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            {currentPath && (
              <button
                onClick={goBack}
                className="p-2 -ml-2 text-slate-400 active:text-slate-200 active:bg-slate-800 rounded-lg transition-colors touch-manipulation"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => navigateTo('')}
              className={`p-2 text-slate-400 active:text-slate-200 active:bg-slate-800 rounded-lg transition-colors touch-manipulation ${!currentPath ? '-ml-2' : ''}`}
            >
              <Home className="w-5 h-5" />
            </button>
            {currentPath && (
              <span className="text-sm text-slate-300 truncate flex-1">
                {currentPath.split('/').pop() || 'Root'}
              </span>
            )}
          </div>
        </div>

        {/* Mobile: File list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-terminal-green" />
            </div>
          ) : error ? (
            <div className="p-4 text-red-400 text-sm">{error}</div>
          ) : files.length === 0 ? (
            <div className="p-4 text-slate-500 text-sm text-center">Empty folder</div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {files.map((file) => {
                const FileIcon = getFileIcon(file.extension, file.is_directory);
                return (
                  <button
                    key={file.path}
                    onClick={() => handleFileClick(file)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-800 transition-colors touch-manipulation"
                  >
                    <FileIcon className={`w-5 h-5 flex-shrink-0 ${
                      file.is_directory ? 'text-yellow-400' : 'text-slate-400'
                    }`} />
                    <span className="flex-1 text-sm text-slate-200 truncate">
                      {file.name}
                    </span>
                    {!file.is_directory && (
                      <span className="text-xs text-slate-500 flex-shrink-0">
                        {formatSize(file.size)}
                      </span>
                    )}
                    {file.is_directory && (
                      <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== DESKTOP LAYOUT ====================
  return (
    <div className={`bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden ${showSplitView ? 'h-full' : ''}`}>
      {showSplitView ? (
        // Split view layout
        <div className="flex h-full">
          {/* Left Panel: File Tree */}
          <div className="w-1/3 min-w-[250px] max-w-[400px] border-r border-slate-800 flex flex-col">
            {/* Header with breadcrumb */}
            <div className="border-b border-slate-800 p-3 flex-shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto">
                <button
                  onClick={() => navigateTo('')}
                  className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors flex-shrink-0 touch-manipulation"
                  title="Root"
                >
                  <Home className="w-4 h-4" />
                </button>

                {breadcrumbParts.length > 0 && (
                  <>
                    <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    {breadcrumbParts.map((part, index) => {
                      const path = breadcrumbParts.slice(0, index + 1).join('/');
                      const isLast = index === breadcrumbParts.length - 1;
                      return (
                        <div key={path} className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => !isLast && navigateTo(path)}
                            className={`text-sm ${
                              isLast
                                ? 'text-slate-200 cursor-default'
                                : 'text-slate-400 hover:text-slate-200'
                            } touch-manipulation truncate max-w-[100px]`}
                            title={part}
                          >
                            {part}
                          </button>
                          {!isLast && <ChevronRight className="w-4 h-4 text-slate-600" />}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Actions row */}
              <div className="flex items-center gap-2 mt-2">
                {selectMode && selectedPaths.size > 0 && (
                  <button
                    onClick={handleBatchDownload}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs bg-terminal-green/20 text-terminal-green rounded hover:bg-terminal-green/30 transition-colors touch-manipulation"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download ({selectedPaths.size})
                  </button>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={toggleSelectMode}
                    className={`p-1.5 rounded transition-colors flex-shrink-0 touch-manipulation ${
                      selectMode
                        ? 'bg-terminal-green/20 text-terminal-green'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                    title={selectMode ? 'Exit select mode' : 'Select files'}
                  >
                    <CheckSquare className="w-4 h-4" />
                  </button>
                  <a
                    href={getFolderZipUrl(projectId, currentPath)}
                    className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors flex-shrink-0 touch-manipulation"
                    title="Download folder as ZIP"
                  >
                    <Archive className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-terminal-green" />
                </div>
              ) : error ? (
                <div className="p-4 text-red-400 text-sm">{error}</div>
              ) : files.length === 0 ? (
                <div className="p-4 text-slate-500 text-sm">Empty directory</div>
              ) : (
                <>
                  {/* Back button if not at root */}
                  {currentPath && (
                    <button
                      onClick={goBack}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-800 transition-colors text-left touch-manipulation"
                    >
                      <ArrowLeft className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-400">..</span>
                    </button>
                  )}

                  {files.map((file) => {
                    const FileIcon = getFileIcon(file.extension, file.is_directory);
                    const isChecked = selectedPaths.has(file.path);
                    const isSelected = previewFile?.path === file.path;

                    return (
                      <div
                        key={file.path}
                        onClick={() => handleFileClick(file)}
                        className={`flex items-center gap-2 px-4 py-2 hover:bg-slate-800 transition-colors cursor-pointer group ${
                          isChecked ? 'bg-slate-800' : ''
                        } ${isSelected ? 'bg-terminal-green/10 border-l-2 border-terminal-green' : ''}`}
                      >
                        {/* Selection checkbox */}
                        {selectMode && (
                          <button
                            onClick={(e) => toggleSelection(file.path, e)}
                            className="flex-shrink-0 p-0.5 cursor-pointer"
                          >
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-terminal-green" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-500 hover:text-slate-300" />
                            )}
                          </button>
                        )}

                        {/* File icon and name */}
                        <FileIcon className={`w-4 h-4 flex-shrink-0 ${
                          file.is_directory ? 'text-yellow-400' : file.extension === 'ipynb' ? 'text-orange-400' : 'text-slate-400'
                        }`} />
                        <span className="text-sm flex-1 truncate text-slate-300" title={file.name}>
                          {file.name}
                        </span>

                        {/* File size */}
                        {!file.is_directory && (
                          <span className="text-xs text-slate-500 flex-shrink-0">
                            {formatSize(file.size)}
                          </span>
                        )}

                        {/* Directory arrow */}
                        {file.is_directory && !selectMode && (
                          <ChevronRight className="w-4 h-4 text-slate-500" />
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          {/* Right Panel: Preview */}
          <div className="flex-1 flex flex-col bg-slate-950">
            {previewFile ? (
              <>
                {/* Preview Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    {isEditing ? (
                      <Edit3 className="w-4 h-4 text-terminal-green flex-shrink-0" />
                    ) : (
                      <Eye className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <span className="text-sm text-slate-200 truncate">{previewFile.name}</span>
                    <span className="text-xs text-slate-500">({formatSize(previewFile.size)})</span>
                    {hasUnsavedChanges && (
                      <span className="text-xs text-yellow-400">• Modified</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Markdown view toggle (rendered vs source) */}
                    {previewContent?.type === 'text' && isMarkdown(previewFile.extension) && !isEditing && (
                      <button
                        onClick={() => setShowMarkdownSource(!showMarkdownSource)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
                          showMarkdownSource
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                        title={showMarkdownSource ? 'Show rendered' : 'Show source'}
                      >
                        {showMarkdownSource ? (
                          <>
                            <BookOpen className="w-3.5 h-3.5" />
                            Rendered
                          </>
                        ) : (
                          <>
                            <Code className="w-3.5 h-3.5" />
                            Source
                          </>
                        )}
                      </button>
                    )}
                    {/* Edit/Save buttons for editable text files */}
                    {previewContent?.type === 'text' && isEditable(previewFile.extension) && (
                      isEditing ? (
                        <>
                          <button
                            onClick={handleSave}
                            disabled={isSaving || !hasUnsavedChanges}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
                              hasUnsavedChanges
                                ? 'bg-terminal-green text-slate-950 hover:bg-terminal-green/90'
                                : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                            }`}
                          >
                            {isSaving ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            Save
                          </button>
                          {hasUnsavedChanges && (
                            <button
                              onClick={handleRevert}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Revert
                            </button>
                          )}
                          <button
                            onClick={cancelEdit}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={enterEditMode}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/30 transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      )
                    )}
                    <a
                      href={getFileDownloadUrl(projectId, previewFile.path)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-terminal-green/20 text-terminal-green rounded hover:bg-terminal-green/30 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </a>
                    <button
                      onClick={closePreview}
                      className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Preview Content */}
                <div className="flex-1 overflow-auto">
                  {previewLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="w-6 h-6 animate-spin text-terminal-green" />
                    </div>
                  ) : previewError ? (
                    <div className="flex items-center justify-center h-full p-4">
                      <p className="text-red-400 text-sm">{previewError}</p>
                    </div>
                  ) : previewContent?.type === 'notebook' ? (
                    <div
                      className="p-4 notebook-preview"
                      dangerouslySetInnerHTML={{ __html: previewContent.html }}
                      style={{ backgroundColor: '#fff', color: '#000' }}
                    />
                  ) : previewContent?.type === 'image' ? (
                    <div className="flex items-center justify-center h-full p-4">
                      <img
                        src={previewContent.url}
                        alt={previewFile.name}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  ) : previewContent?.type === 'text' ? (
                    isEditing ? (
                      <div className="h-full flex flex-col">
                        {saveError && (
                          <div className="px-4 py-2 bg-red-500/20 text-red-400 text-sm border-b border-red-500/30">
                            Error saving: {saveError}
                          </div>
                        )}
                        <textarea
                          value={editContent}
                          onChange={handleContentChange}
                          className="flex-1 w-full p-4 text-sm text-slate-200 font-mono bg-slate-900 resize-none focus:outline-none focus:ring-1 focus:ring-terminal-green/50"
                          spellCheck={false}
                          placeholder="File content..."
                        />
                      </div>
                    ) : isMarkdown(previewFile.extension) && !showMarkdownSource ? (
                      // Render Markdown files with styling
                      <div className="p-6 overflow-auto">
                        <MarkdownRenderer content={previewContent.content} />
                      </div>
                    ) : (
                      <pre className="p-4 text-sm text-slate-200 font-mono whitespace-pre-wrap break-all overflow-x-auto">
                        {previewContent.content}
                      </pre>
                    )
                  ) : previewContent?.type === 'binary' ? (
                    <div className="flex flex-col items-center justify-center h-full p-4 gap-4">
                      <File className="w-12 h-12 text-slate-500" />
                      <p className="text-slate-400 text-sm">Binary file - cannot preview</p>
                      <a
                        href={getFileDownloadUrl(projectId, previewFile.path)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-terminal-green/20 text-terminal-green rounded-lg hover:bg-terminal-green/30 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Download File
                      </a>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              // No file selected
              <div className="flex flex-col items-center justify-center h-full p-8 text-slate-500">
                <FileText className="w-12 h-12 mb-4 opacity-50" />
                <p>Select a file to preview</p>
                <p className="text-sm mt-1">Click on any file in the tree</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        // Original compact layout (non-fullWidth)
        <>
          {/* Header with breadcrumb */}
          <div className="border-b border-slate-800 p-3">
            <div className="flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => navigateTo('')}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors flex-shrink-0 touch-manipulation"
                title="Root"
              >
                <Home className="w-4 h-4" />
              </button>

              {breadcrumbParts.length > 0 && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
                  {breadcrumbParts.map((part, index) => {
                    const path = breadcrumbParts.slice(0, index + 1).join('/');
                    const isLast = index === breadcrumbParts.length - 1;
                    return (
                      <div key={path} className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => !isLast && navigateTo(path)}
                          className={`text-sm ${
                            isLast
                              ? 'text-slate-200 cursor-default'
                              : 'text-slate-400 hover:text-slate-200'
                          } touch-manipulation`}
                        >
                          {part}
                        </button>
                        {!isLast && <ChevronRight className="w-4 h-4 text-slate-600" />}
                      </div>
                    );
                  })}
                </>
              )}

              {/* Select mode and download buttons */}
              <div className="ml-auto flex items-center gap-2">
                {selectMode && selectedPaths.size > 0 && (
                  <button
                    onClick={handleBatchDownload}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs bg-terminal-green/20 text-terminal-green rounded hover:bg-terminal-green/30 transition-colors touch-manipulation"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download {selectedPaths.size} selected
                  </button>
                )}
                <button
                  onClick={toggleSelectMode}
                  className={`p-1.5 rounded transition-colors flex-shrink-0 touch-manipulation ${
                    selectMode
                      ? 'bg-terminal-green/20 text-terminal-green'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  title={selectMode ? 'Exit select mode' : 'Select files'}
                >
                  <CheckSquare className="w-4 h-4" />
                </button>
                <a
                  href={getFolderZipUrl(projectId, currentPath)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors flex-shrink-0 touch-manipulation"
                  title="Download folder as ZIP"
                >
                  <Archive className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>

          {/* File list */}
          <div className="overflow-y-auto no-bounce" style={{ maxHeight: 'calc(100vh - 400px)', minHeight: '300px' }}>
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-terminal-green" />
              </div>
            ) : error ? (
              <div className="p-4 text-red-400 text-sm">{error}</div>
            ) : files.length === 0 ? (
              <div className="p-4 text-slate-500 text-sm">Empty directory</div>
            ) : (
              <>
                {/* Back button if not at root */}
                {currentPath && (
                  <button
                    onClick={goBack}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800 transition-colors text-left touch-manipulation"
                  >
                    <ArrowLeft className="w-4 h-4 text-slate-400" />
                    <span className="text-sm text-slate-400">..</span>
                  </button>
                )}

                {files.map((file) => {
                  const FileIcon = getFileIcon(file.extension, file.is_directory);
                  const isChecked = selectedPaths.has(file.path);

                  return (
                    <div
                      key={file.path}
                      className={`flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800 transition-colors group ${
                        isChecked ? 'bg-slate-800' : ''
                      }`}
                    >
                      {/* Selection checkbox in select mode */}
                      {selectMode && (
                        <button
                          onClick={(e) => toggleSelection(file.path, e)}
                          className="flex-shrink-0 p-0.5 cursor-pointer"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-terminal-green" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 hover:text-slate-300" />
                          )}
                        </button>
                      )}
                      {/* File/folder content */}
                      <div
                        className={`flex items-center gap-3 flex-1 min-w-0 ${file.is_directory ? 'cursor-pointer' : ''}`}
                        onClick={() => handleFileClick(file)}
                      >
                        <FileIcon className={`w-4 h-4 flex-shrink-0 ${
                          file.is_directory ? 'text-yellow-400' : file.extension === 'ipynb' ? 'text-orange-400' : 'text-slate-400'
                        }`} />
                        <span className="text-sm flex-1 truncate text-slate-300">
                          {file.name}
                        </span>
                      </div>
                      {!file.is_directory && (
                        <>
                          <span className="text-xs text-slate-500">
                            {formatSize(file.size)}
                          </span>
                          {!selectMode && (
                            <a
                              href={getFileDownloadUrl(projectId, file.path)}
                              onClick={(e) => e.stopPropagation()}
                              className="p-2 text-slate-500 hover:text-slate-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity touch-manipulation"
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </>
                      )}
                      {file.is_directory && !selectMode && (
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
