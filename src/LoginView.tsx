import { useState } from "react";
import { registerPasskey, loginPasskey } from "./api/auth";
import "./App.css";

type Props = {
  onLogin: (token: string) => void;
};

export default function LoginView({ onLogin }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [registerEmail, setRegisterEmail] = useState("");

  const handleSignIn = async () => {
    setError(null);
    setLoading("Signing in…");
    try {
      const { token } = await loginPasskey();
      setLoading(null);
      onLogin(token);
    } catch (e) {
      setLoading(null);
      setError(e instanceof Error ? e.message : "Sign in failed");
    }
  };

  const handleRegister = async () => {
    setError(null);
    const email = registerEmail.trim().toLowerCase();
    if (!email) {
      setError("Enter your email to register a passkey.");
      return;
    }
    setLoading("Registering…");
    try {
      await registerPasskey(email);
      setLoading(null);
      const { token } = await loginPasskey();
      onLogin(token);
    } catch (e) {
      setLoading(null);
      setError(e instanceof Error ? e.message : "Registration failed");
    }
  };

  return (
    <div className="app login-view">
      <header className="login-view-header">
        <img src="/images/logo.png" alt="Root Access Granted" className="header-logo" />
      </header>
      <div className="card login-card">
        <h2 className="login-title">Sign in</h2>
        <p className="login-hint">
          Use a passkey (device biometrics or security key) to sign in. Only invited users can register.
        </p>
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <div className="login-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!!loading}
            onClick={handleSignIn}
          >
            {loading === "Signing in…" ? loading : "Sign in with passkey"}
          </button>

          <div className="login-register-section">
            <label htmlFor="register-email" className="login-register-label">
              New? Register with your email:
            </label>
            <div className="login-register-row">
              <input
                id="register-email"
                type="email"
                className="login-email-input"
                placeholder="you@example.com"
                value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)}
                disabled={!!loading}
                onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={!!loading || !registerEmail.trim()}
                onClick={handleRegister}
              >
                {loading === "Registering…" ? loading : "Register passkey"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <footer className="login-footer">
        <img src="/images/mascot.png" alt="" className="mascot" aria-hidden />
      </footer>
    </div>
  );
}
