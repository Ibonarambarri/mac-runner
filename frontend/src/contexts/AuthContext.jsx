import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

// Storage keys
const AUTH_STORAGE_KEY = 'macrunner_auth';

/**
 * Get stored credentials from localStorage
 */
function getStoredAuth() {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error reading auth from storage:', e);
  }
  return null;
}

/**
 * Store credentials in localStorage
 */
function storeAuth(auth) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch (e) {
    console.error('Error storing auth:', e);
  }
}

/**
 * Clear stored credentials
 */
function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {
    console.error('Error clearing auth:', e);
  }
}

/**
 * Create Basic Auth header value
 */
export function createAuthHeader(username, password) {
  const credentials = btoa(`${username}:${password}`);
  return `Basic ${credentials}`;
}

/**
 * AuthProvider Component
 * Manages authentication state and provides login/logout functionality
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginError, setLoginError] = useState(null);

  // Initialize auth from storage
  useEffect(() => {
    const initAuth = async () => {
      const stored = getStoredAuth();
      if (stored && stored.credentials) {
        // Verify credentials are still valid BEFORE setting them
        const valid = await verifyAuth(stored.credentials);
        if (valid) {
          setCredentials(stored.credentials);
          setUser(stored.user);
          setShowLoginModal(false);
        } else {
          // Credentials expired or invalid - clear and show login
          clearStoredAuth();
          setShowLoginModal(true);
        }
      } else {
        // No stored auth - show login
        setShowLoginModal(true);
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  /**
   * Verify if credentials are still valid
   */
  const verifyAuth = async (creds) => {
    try {
      const { protocol, hostname } = window.location;
      const response = await fetch(`${protocol}//${hostname}:8000/auth/check`, {
        headers: {
          'Authorization': creds
        }
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  };

  /**
   * Login with username and password
   */
  const login = useCallback(async (username, password) => {
    setLoginError(null);
    const authHeader = createAuthHeader(username, password);

    try {
      const { protocol, hostname } = window.location;
      const response = await fetch(`${protocol}//${hostname}:8000/auth/login`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid username or password');
        }
        throw new Error('Login failed');
      }

      const userData = await response.json();

      // Store auth info
      const authData = {
        credentials: authHeader,
        user: userData
      };
      storeAuth(authData);

      setCredentials(authHeader);
      setUser(userData);
      setShowLoginModal(false);
      setLoginError(null);

      return true;
    } catch (e) {
      setLoginError(e.message);
      return false;
    }
  }, []);

  /**
   * Logout - clear credentials and show login modal
   */
  const logout = useCallback(() => {
    clearStoredAuth();
    setCredentials(null);
    setUser(null);
    setShowLoginModal(true);
  }, []);

  /**
   * Handle 401 errors from API - clear credentials and show login modal
   */
  const handleUnauthorized = useCallback(() => {
    clearStoredAuth();
    setCredentials(null);
    setUser(null);
    setShowLoginModal(true);
  }, []);

  /**
   * Get auth header for API requests
   */
  const getAuthHeader = useCallback(() => {
    return credentials;
  }, [credentials]);

  const value = {
    user,
    credentials,
    isAuthenticated: !!credentials,
    isLoading,
    showLoginModal,
    loginError,
    login,
    logout,
    handleUnauthorized,
    getAuthHeader,
    setShowLoginModal
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
