import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Terminal, Loader2, Wifi, WifiOff } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { startTerminalSession, getTerminalWebSocketUrl } from '../api';

/**
 * TerminalModal Component
 *
 * Full-screen modal with professional xterm.js terminal.
 * Supports:
 * - Full ANSI colors and escape sequences
 * - Interactive programs (vim, htop, etc.)
 * - Persistent shell session (cd persists)
 * - Auto-fit to container size
 * - Mobile virtual keyboard support
 */
export function TerminalModal({ isOpen, onClose }) {
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const containerRef = useRef(null);

  // Initialize xterm.js terminal
  const initTerminal = useCallback(() => {
    if (xtermRef.current || !terminalRef.current) return;

    // Create xterm instance with MacRunner dark theme
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: '#020617', // slate-950
        foreground: '#e2e8f0', // slate-200
        cursor: '#00ff88', // terminal-green
        cursorAccent: '#020617',
        selectionBackground: '#00ff8833',
        selectionForeground: '#00ff88',
        black: '#1e293b',
        red: '#f87171',
        green: '#00ff88',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#4ade80',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
      scrollback: 10000,
      // Mobile optimizations
      scrollOnUserInput: true,
    });

    // Add fit addon for auto-resizing
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Add web links addon for clickable URLs
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    // Open terminal in container
    term.open(terminalRef.current);

    // Initial fit
    setTimeout(() => {
      fitAddon.fit();
    }, 0);

    xtermRef.current = term;
  }, []);

  // Connect to WebSocket
  const connectWebSocket = useCallback((sid) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = getTerminalWebSocketUrl(sid);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);

      // Send initial resize
      if (xtermRef.current && fitAddonRef.current) {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({
            type: 'resize',
            cols: dims.cols,
            rows: dims.rows
          }));
        }
      }
    };

    ws.onmessage = (event) => {
      if (xtermRef.current) {
        if (event.data instanceof ArrayBuffer) {
          // Binary data - raw terminal output
          const text = new TextDecoder().decode(event.data);
          xtermRef.current.write(text);
        } else {
          // Text data (legacy support)
          xtermRef.current.write(event.data);
        }
      }
    };

    ws.onerror = (e) => {
      console.error('Terminal WebSocket error:', e);
      setError('Connection error');
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    wsRef.current = ws;
  }, []);

  // Handle terminal input
  const setupTerminalInput = useCallback(() => {
    if (!xtermRef.current) return;

    // Handle user input - send to WebSocket
    const onDataDisposable = xtermRef.current.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // Send raw bytes
        wsRef.current.send(new TextEncoder().encode(data));
      }
    });

    return () => {
      onDataDisposable.dispose();
    };
  }, []);

  // Handle resize
  const handleResize = useCallback(() => {
    if (fitAddonRef.current && xtermRef.current) {
      fitAddonRef.current.fit();

      // Send resize to backend
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: dims.cols,
            rows: dims.rows
          }));
        }
      }
    }
  }, []);

  // Start session when modal opens
  useEffect(() => {
    if (isOpen && !sessionId) {
      setLoading(true);
      setError(null);

      startTerminalSession()
        .then(res => {
          setSessionId(res.session_id);
        })
        .catch(e => {
          setError(e.message);
          setLoading(false);
        });
    }
  }, [isOpen, sessionId]);

  // Initialize terminal and connect when we have a session
  useEffect(() => {
    if (sessionId && isOpen) {
      // Small delay to ensure container is mounted
      const initTimeout = setTimeout(() => {
        initTerminal();
        connectWebSocket(sessionId);
        setLoading(false);
      }, 100);

      return () => clearTimeout(initTimeout);
    }
  }, [sessionId, isOpen, initTerminal, connectWebSocket]);

  // Setup input handling after terminal is ready
  useEffect(() => {
    if (xtermRef.current && isConnected) {
      const cleanup = setupTerminalInput();
      return cleanup;
    }
  }, [isConnected, setupTerminalInput]);

  // Handle window resize
  useEffect(() => {
    if (!isOpen) return;

    window.addEventListener('resize', handleResize);

    // Also observe container size changes
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [isOpen, handleResize]);

  // Focus terminal when connected
  useEffect(() => {
    if (isConnected && xtermRef.current) {
      setTimeout(() => {
        xtermRef.current.focus();
      }, 100);
    }
  }, [isConnected]);

  // Handle closing
  const handleClose = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Dispose terminal
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }

    fitAddonRef.current = null;
    setSessionId(null);
    setIsConnected(false);
    setError(null);
    onClose();
  }, [onClose]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only close on Ctrl+Shift+Escape to avoid conflicts with terminal
      if (e.key === 'Escape' && e.ctrlKey && e.shiftKey) {
        handleClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-950 w-full h-[100dvh] sm:h-[90vh] sm:max-w-5xl sm:rounded-xl border border-slate-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-terminal-green" />
            <span className="font-semibold text-slate-100">Terminal</span>
            {sessionId && (
              <span className="text-xs text-slate-500">Session #{sessionId}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Connection status */}
            <div className="flex items-center gap-1.5">
              {isConnected ? (
                <>
                  <Wifi className="w-4 h-4 text-terminal-green" />
                  <span className="text-xs text-terminal-green hidden sm:inline">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-red-400" />
                  <span className="text-xs text-red-400 hidden sm:inline">Disconnected</span>
                </>
              )}
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors touch-manipulation"
              title="Close (Ctrl+Shift+Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Terminal container */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative"
          style={{ minHeight: '300px' }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full bg-slate-950">
              <Loader2 className="w-6 h-6 animate-spin text-terminal-green" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full bg-slate-950">
              <div className="text-red-400">Error: {error}</div>
            </div>
          ) : (
            <div
              ref={terminalRef}
              className="w-full h-full"
              style={{
                padding: '8px',
                boxSizing: 'border-box',
              }}
            />
          )}
        </div>

        {/* Mobile input helper - shows keyboard on tap */}
        <div className="sm:hidden border-t border-slate-800 bg-slate-900/30 px-4 py-2 flex-shrink-0 pb-safe">
          <div className="text-xs text-slate-500 text-center">
            Tap terminal to type • Swipe to scroll
          </div>
        </div>
      </div>
    </div>
  );
}
