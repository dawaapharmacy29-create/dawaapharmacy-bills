import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  loginWithUsernamePin,
  logoutUsernameSession,
  normalizeAccountForLegacyCode,
  validateStoredSession,
} from '@/lib/supabaseAuth';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    const result = await validateStoredSession();
    if (result?.ok) {
      setUser(normalizeAccountForLegacyCode(result.account));
      setIsAuthenticated(true);
      setAuthError(null);
    } else {
      setUser(null);
      setIsAuthenticated(false);
      if (result?.error === 'network_error') setAuthError(result);
    }
    setIsLoadingAuth(false);
    return result;
  }, []);

  useEffect(() => {
    checkUserAuth();
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

  const logout = async () => {
    setUser(null);
    setIsAuthenticated(false);
    await logoutUsernameSession();
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      authChecked: !isLoadingAuth,
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
