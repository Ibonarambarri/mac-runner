import { useState, useEffect } from 'react';
import {
  Terminal,
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  FileCode,
  Plus,
  Pencil,
  Trash2,
  GripVertical
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getSystemScripts,
  runSystemScript,
  getScriptContent,
  createSystemScript,
  updateSystemScript,
  deleteSystemScript,
  updateScriptsOrder
} from '../api';
import ScriptEditor from './ScriptEditor';

/**
 * SortableScriptCard Component
 * Individual draggable script card
 */
function SortableScriptCard({
  script,
  isRunning,
  result,
  isExpanded,
  isCollapsed,
  onToggleCollapse,
  onToggleResult,
  onRun,
  onEdit,
  onDelete
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: script.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getScriptIcon = (type) => {
    if (type === 'python') {
      return <FileCode className="w-4 h-4 text-blue-400" />;
    }
    return <Terminal className="w-4 h-4 text-green-400" />;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden"
    >
      {/* Script header row */}
      <div className="p-3 flex items-center justify-between">
        {/* Left: Drag handle + Icon + Info */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Drag handle */}
          <button
            {...attributes}
            {...listeners}
            className="p-1 text-slate-500 hover:text-slate-300 cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical className="w-4 h-4" />
          </button>

          {/* Collapse toggle */}
          <button
            onClick={onToggleCollapse}
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isCollapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>

          {getScriptIcon(script.type)}

          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-slate-200 truncate">
              {script.display_name}
            </h4>
            {!isCollapsed && (
              <p className="text-xs text-slate-500 truncate">
                {script.description}
              </p>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 ml-3">
          {/* Result indicator */}
          {result && !isRunning && (
            <button
              onClick={onToggleResult}
              className={`p-1.5 rounded transition-colors ${
                result.success
                  ? 'text-green-400 hover:bg-green-500/20'
                  : 'text-red-400 hover:bg-red-500/20'
              }`}
            >
              {result.success ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Edit button */}
          <button
            onClick={onEdit}
            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/20 rounded transition-colors"
            title="Edit script"
          >
            <Pencil className="w-4 h-4" />
          </button>

          {/* Delete button */}
          <button
            onClick={onDelete}
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/20 rounded transition-colors"
            title="Delete script"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Run button */}
          <button
            onClick={onRun}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-terminal-green/20 text-terminal-green rounded-lg hover:bg-terminal-green/30 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Run</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Result output (expandable) */}
      {result && isExpanded && !isCollapsed && (
        <div className="border-t border-slate-700">
          <div className="p-3 bg-slate-900/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">
                Exit code: {result.exit_code}
              </span>
              <span className={`text-xs ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                {result.success ? 'Success' : 'Failed'}
              </span>
            </div>
            <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto bg-slate-950 rounded p-2">
              {result.output || '(no output)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * DeleteConfirmDialog Component
 */
function DeleteConfirmDialog({ script, onConfirm, onCancel, isDeleting }) {
  if (!script) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-slate-200 mb-2">Delete Script</h3>
        <p className="text-slate-400 mb-4">
          Are you sure you want to delete <span className="text-slate-200 font-medium">{script.display_name}</span>?
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 text-slate-300 hover:text-slate-100 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SystemScripts Component
 *
 * Displays and manages system-level maintenance scripts.
 * Features: CRUD operations, drag & drop reordering, collapsible cards.
 */
export function SystemScripts() {
  const [scripts, setScripts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [runningScript, setRunningScript] = useState(null);
  const [results, setResults] = useState({});
  const [expandedResults, setExpandedResults] = useState({});
  const [collapsedScripts, setCollapsedScripts] = useState({});

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingScript, setEditingScript] = useState(null);
  const [editingContent, setEditingContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);

  // Delete confirmation state
  const [deleteScript, setDeleteScript] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Fetch available scripts
  useEffect(() => {
    fetchScripts();
  }, []);

  const fetchScripts = async () => {
    try {
      const data = await getSystemScripts();
      setScripts(data.scripts || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Execute a script
  const handleRunScript = async (scriptName) => {
    setRunningScript(scriptName);
    setResults(prev => ({ ...prev, [scriptName]: null }));

    try {
      const result = await runSystemScript(scriptName);
      setResults(prev => ({ ...prev, [scriptName]: result }));
      setExpandedResults(prev => ({ ...prev, [scriptName]: true }));
    } catch (e) {
      setResults(prev => ({
        ...prev,
        [scriptName]: {
          success: false,
          exit_code: -1,
          output: `Error: ${e.message}`
        }
      }));
      setExpandedResults(prev => ({ ...prev, [scriptName]: true }));
    } finally {
      setRunningScript(null);
    }
  };

  // Toggle result expansion
  const toggleResult = (scriptName) => {
    setExpandedResults(prev => ({
      ...prev,
      [scriptName]: !prev[scriptName]
    }));
  };

  // Toggle script collapse
  const toggleCollapse = (scriptName) => {
    setCollapsedScripts(prev => ({
      ...prev,
      [scriptName]: !prev[scriptName]
    }));
  };

  // Handle drag end for reordering
  const handleDragEnd = async (event) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = scripts.findIndex(s => s.name === active.id);
      const newIndex = scripts.findIndex(s => s.name === over.id);

      const newScripts = arrayMove(scripts, oldIndex, newIndex);
      setScripts(newScripts);

      // Save new order to backend
      try {
        await updateScriptsOrder(newScripts.map(s => s.name));
      } catch (e) {
        console.error('Failed to save order:', e);
        // Revert on error
        fetchScripts();
      }
    }
  };

  // Open editor for creating new script
  const handleCreateScript = () => {
    setEditingScript(null);
    setEditingContent('');
    setEditorOpen(true);
  };

  // Open editor for editing existing script
  const handleEditScript = async (script) => {
    setEditingScript(script);
    setLoadingContent(true);
    setEditorOpen(true);

    try {
      const data = await getScriptContent(script.name);
      setEditingContent(data.content);
    } catch (e) {
      setError(`Failed to load script: ${e.message}`);
      setEditorOpen(false);
    } finally {
      setLoadingContent(false);
    }
  };

  // Save script (create or update)
  const handleSaveScript = async ({ name, content, scriptType, isEditing }) => {
    if (isEditing) {
      await updateSystemScript(editingScript.name, content);
    } else {
      await createSystemScript(name, content, scriptType);
    }
    await fetchScripts();
  };

  // Confirm delete
  const handleDeleteConfirm = async () => {
    if (!deleteScript) return;

    setIsDeleting(true);
    try {
      await deleteSystemScript(deleteScript.name);
      await fetchScripts();
      setDeleteScript(null);
    } catch (e) {
      setError(`Failed to delete script: ${e.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400">
        <p>Error loading scripts: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header with Add button */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-slate-400">
          {scripts.length} script{scripts.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={handleCreateScript}
          className="flex items-center gap-2 px-3 py-1.5 bg-terminal-green/20 text-terminal-green rounded-lg hover:bg-terminal-green/30 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Add Script</span>
        </button>
      </div>

      {scripts.length === 0 ? (
        <div className="text-center py-8 text-slate-500">
          <Terminal className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p>No system scripts available</p>
          <p className="text-xs mt-1">Click "Add Script" to create your first script</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={scripts.map(s => s.name)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {scripts.map(script => (
                <SortableScriptCard
                  key={script.name}
                  script={script}
                  isRunning={runningScript === script.name}
                  result={results[script.name]}
                  isExpanded={expandedResults[script.name]}
                  isCollapsed={collapsedScripts[script.name]}
                  onToggleCollapse={() => toggleCollapse(script.name)}
                  onToggleResult={() => toggleResult(script.name)}
                  onRun={() => handleRunScript(script.name)}
                  onEdit={() => handleEditScript(script)}
                  onDelete={() => setDeleteScript(script)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Script Editor Modal */}
      <ScriptEditor
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveScript}
        script={editingScript}
        initialContent={editingContent}
        isLoading={loadingContent}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        script={deleteScript}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteScript(null)}
        isDeleting={isDeleting}
      />
    </div>
  );
}

export default SystemScripts;
