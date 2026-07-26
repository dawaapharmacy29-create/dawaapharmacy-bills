import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  loginWithUsernamePin,
  logoutUsernameSession,
  normalizeAccountForLegacyCode,
  readStoredSession,
  validateStoredSession,
} from '@/lib/supabaseAuth';

const AuthContext = createContext(null);

function getInitialAuth() {
  const session = readStoredSession();
  if (!session?.session_token || !session?.account) {
    return { user: null, authenticated: false };
  }
  return { user: normalizeAccountForLegacyCode(session.account), authenticated: true };
}

export const AuthProvider = ({ children }) => {
  const initial = getInitialAuth();
  const [user, setUser] = useState(initial.user);
  const [isAuthenticated, setIsAuthenticated] = useState(initial.authenticated);
  const [isLoadingAuth, setIsLoadingAuth] = useState(!initial.authenticated);
  const [authError, setAuthError] = useState(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const checkUserAuth = useCallback(async ({ silent = false } = {}) => {
    const cached = readStoredSession();
    if (!silent && !cached?.account) setIsLoadingAuth(true);

    const result = await validateStoredSession();
    if (result?.ok) {
      setUser(normalizeAccountForLegacyCode(result.account));
      setIsAuthenticated(true);
      setAuthError(null);
    } else if (result?.error === 'network_error' && cached?.account && cached?.session_token) {
      // Keep the cached authenticated state during temporary network or Supabase delays.
      setUser(normalizeAccountForLegacyCode(cached.account));
      setIsAuthenticated(true);
      setAuthError(result);
    } else {
      setUser(null);
      setIsAuthenticated(false);
      setAuthError(result?.error === 'network_error' ? result : null);
    }

    setIsLoadingAuth(false);
    return result;
  }, []);

  useEffect(() => {
    checkUserAuth({ silent: initial.authenticated });
  }, [checkUserAuth, initial.authenticated]);

  useEffect(() => {
    const handleExpired = () => {
      // A single failed API request must not immediately eject the user.
      checkUserAuth({ silent: true });
    };
    window.addEventListener('dawaa-session-expired', handleExpired);
    return () => window.removeEventListener('dawaa-session-expired', handleExpired);
  }, [checkUserAuth]);

  const login = async (username, pin) => {
    try {
      const result = await loginWithUsernamePin(username, pin);
      if (result?.ok) {
        setUser(normalizeAccountForLegacyCode(result.account));
        setIsAuthenticated(true);
        setAuthError(null);
      }
      return result;
    } catch (error) {
      return { ok: false, error: 'network_error', message: error.message };
    }
  };

  const logout = useCallback(() => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setUser(null);
    setIsAuthenticated(false);
    logoutUsernameSession().finally(() => setIsLoggingOut(false));
  }, [isLoggingOut]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      authChecked: !isLoadingAuth,
      isLoggingOut,
      login,
      logout,
      checkUserAuth,
      checkAppState: checkUserAuth,
      navigateToLogin: () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
