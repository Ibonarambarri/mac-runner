import { createContext, useContext, useState, useRef, useCallback } from 'react';

/**
 * TerminalContext
 *
 * Provides global state management for the persistent terminal.
 * The terminal session persists even when the modal is closed.
 */
const TerminalContext = createContext(null);

export function TerminalProvider({ children }) {
  // Terminal visibility state
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);

  // Session state - persists across open/close
  const [sessionId, setSessionId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  // Refs for terminal and WebSocket - persist across renders
  const xtermRef = useRef(null);
  const wsRef = useRef(null);
  const fitAddonRef = useRef(null);
  const containerRef = useRef(null);

  const openTerminal = useCallback(() => {
    setIsTerminalOpen(true);
  }, []);

  const closeTerminal = useCallback(() => {
    setIsTerminalOpen(false);
  }, []);

  const toggleTerminal = useCallback(() => {
    setIsTerminalOpen(prev => !prev);
  }, []);

  // Provide a way to fully reset the terminal (close connection and clear session)
  const resetTerminal = useCallback(() => {
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
    setIsTerminalOpen(false);
  }, []);

  const value = {
    // State
    isTerminalOpen,
    sessionId,
    isConnected,

    // Setters
    setSessionId,
    setIsConnected,

    // Refs (for TerminalModal to use)
    xtermRef,
    wsRef,
    fitAddonRef,
    containerRef,

    // Actions
    openTerminal,
    closeTerminal,
    toggleTerminal,
    resetTerminal,
  };

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
}
