import { useState, useEffect, useCallback, useRef } from 'react';
import { getStatusWebSocketUrl } from '../api';

/**
 * Custom hook for streaming global status updates via WebSocket.
 *
 * Features:
 * - Auto-reconnection on connection loss
 * - Provides real-time updates for job/project status changes
 * - Eliminates need for polling
 *
 * @returns {Object} - { isConnected, lastEvent, subscribe }
 */
export function useStatusStream() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const subscribersRef = useRef(new Set());
  const maxReconnectAttempts = 10;

  // Subscribe to status updates
  const subscribe = useCallback((callback) => {
    subscribersRef.current.add(callback);
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  // Notify all subscribers
  const notifySubscribers = useCallback((event) => {
    setLastEvent(event);
    subscribersRef.current.forEach(callback => {
      try {
        callback(event);
      } catch (e) {
        console.error('[Status WS] Subscriber error:', e);
      }
    });
  }, []);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const url = getStatusWebSocketUrl();
    const ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[Status WS] Connected');
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // Handle ping/pong for keep-alive
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (message.type === 'pong') {
          return; // Ignore pong responses
        }

        // Notify subscribers of the event
        notifySubscribers(message);

      } catch (e) {
        console.error('[Status WS] Failed to parse message:', e);
      }
    };

    ws.onerror = (event) => {
      console.error('[Status WS] WebSocket error:', event);
    };

    ws.onclose = (event) => {
      console.log(`[Status WS] Connection closed (code: ${event.code})`);
      setIsConnected(false);

      // Attempt reconnection with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        console.log(`[Status WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttempts.current++;
          connect();
        }, delay);
      } else {
        console.error('[Status WS] Max reconnection attempts reached');
      }
    };

    wsRef.current = ws;
  }, [notifySubscribers]);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Send periodic pings to keep connection alive
  useEffect(() => {
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    return () => clearInterval(pingInterval);
  }, []);

  return {
    isConnected,
    lastEvent,
    subscribe,
  };
}

export default useStatusStream;
