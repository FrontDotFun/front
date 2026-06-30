// ──────────────────────────────────────────────
// FRONT PROTOCOL — OAuth Callback Handler
// ──────────────────────────────────────────────

import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';

/**
 * Handles the OAuth callback redirect from the API.
 * Extracts the JWT token from the URL and stores it.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { setToken } = useAuth();

  useEffect(() => {
    const token = params.get('token');
    const error = params.get('error');

    if (error) {
      console.error('[OAuth] Error:', error);
      navigate('/auth?error=' + error, { replace: true });
      return;
    }

    if (token) {
      // Store token and redirect to trade
      setToken(token);
      navigate('/trade', { replace: true });
    } else {
      navigate('/auth', { replace: true });
    }
  }, [params, navigate, setToken]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#000',
      color: '#f0b90b',
      fontSize: '1.2rem',
      fontFamily: 'Inter, sans-serif',
    }}>
      Authenticating...
    </div>
  );
}
