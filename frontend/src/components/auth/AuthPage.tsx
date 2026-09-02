import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Loader2, Sparkles, X, Mail, Lock, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';

interface AuthPageProps {
  isOpen: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
  reasonMessage?: string;
  showToast: (msg: string) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  isOpen,
  onClose,
  onSuccess,
  reasonMessage,
  showToast,
}) => {
  const [authMethod, setAuthMethod] = useState<'otp' | 'password'>('otp');
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Google OAuth Login
  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setErrorMessage(msg);
      showToast(msg);
      setIsLoading(false);
    }
  };

  // Email OTP / Magic Link or Password Authentication
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (authMethod === 'otp') {
        // Passwordless Magic Link / OTP
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        setSuccessMessage(`Check your inbox at ${email.trim()} for your magic sign-in link.`);
        showToast("Magic sign-in link dispatched!");
      } else {
        // Password Sign In / Sign Up
        if (isSignUp) {
          const { error, data } = await supabase.auth.signUp({
            email: email.trim(),
            password,
          });
          if (error) throw error;
          if (data.session) {
            showToast("Account created and signed in!");
            onSuccess?.();
            onClose?.();
          } else {
            setSuccessMessage("Confirmation email sent. Please verify your email.");
            showToast("Confirmation email sent.");
          }
        } else {
          const { error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (error) throw error;
          showToast("Successfully signed in!");
          onSuccess?.();
          onClose?.();
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed. Please check credentials.';
      setErrorMessage(msg);
      showToast(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex bg-[#141413] overflow-hidden fade-in select-none">
      {/* LEFT COLUMN: BRAND & AUTH FORM */}
      <div className="flex-1 flex flex-col justify-between p-4 sm:p-6 md:p-8 lg:p-10 overflow-y-auto">
        {/* Top Header Row */}
        <div className="flex items-center justify-between w-full">
          {/* Brand Logo with Warm Sunburst Mark */}
          <div className="flex items-center gap-2.5">
            <span className="font-serif text-3xl font-light tracking-tight text-[#f4f3ef]">
              Omni
            </span>
          </div>

          {/* Dismiss Button (if guest can return) */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-[#7a7771] hover:text-[#f4f3ef] hover:bg-[#222120] transition-colors cursor-pointer"
              title="Return to Omni"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Center Auth Hero & Form */}
        <div className="my-auto py-6 w-full flex flex-col items-center justify-center">
          <div className="w-full max-w-xl flex flex-col items-center text-center">
            {/* Editorial Headline */}
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-light text-[#f4f3ef] mb-4 tracking-tight text-center whitespace-nowrap">
              Question what’s next
            </h1>
            <p className="font-serif text-[18px] text-[#b8b5ad] mb-8 text-center leading-relaxed">
              Your thinking partner for big ambitions
            </p>

            {/* Soft Wall Alert if Query Limit Triggered */}
            {reasonMessage && (
              <div className="w-full max-w-[420px] mb-6 p-3.5 rounded-2xl bg-[#e07a5f]/10 border border-[#e07a5f]/30 text-xs text-[#f4f3ef] flex items-start gap-2.5 text-left">
                <Sparkles size={15} className="text-[#e07a5f] flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-[#e07a5f]">Guest Limit Reached: </span>
                  <span>{reasonMessage}</span>
                </div>
              </div>
            )}

            {/* Clean Rounded Auth Card (Exact Claude Palette) */}
            <div className="w-full max-w-[420px] p-6 sm:p-7 rounded-[28px] bg-[#1f1e1d] border border-[#2c2b29] shadow-2xl text-left">
              {/* Google OAuth Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full h-[40px] px-4 rounded-xl bg-[#2e2d2b] hover:bg-[#383734] text-[16px] font-medium text-[#f4f3ef] flex items-center justify-center gap-3 transition-all cursor-pointer shadow-xs disabled:opacity-50"
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              {/* Subtle OR Divider */}
              <div className="relative my-4 text-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#2c2b29]" />
                </div>
                <span className="relative px-3 bg-[#1f1e1d] text-[14px] font-medium text-[#7a7771] uppercase tracking-wider">
                  OR
                </span>
              </div>

              {/* Email Form */}
              <form onSubmit={handleEmailAuth} className="space-y-3">
                <div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    className="w-full h-[46px] px-3.5 rounded-xl bg-[#1c1b1a] border border-[#33322f] text-[15px] text-[#f4f3ef] placeholder-[#7a7771] outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus:border-[#605d56] transition-colors font-sans"
                  />
                </div>

                {authMethod === 'password' && (
                  <div className="fade-in">
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isSignUp ? 'Create password (6+ chars)' : 'Enter password'}
                      className="w-full h-[46px] px-3.5 rounded-xl bg-[#1c1b1a] border border-[#33322f] text-[15px] text-[#f4f3ef] placeholder-[#7a7771] outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus:border-[#605d56] transition-colors font-sans"
                    />
                  </div>
                )}

                {/* Error or Success Alert */}
                {errorMessage && (
                  <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2 fade-in">
                    <AlertCircle size={14} className="flex-shrink-0" />
                    <span className="truncate">{errorMessage}</span>
                  </div>
                )}

                {successMessage && (
                  <div className="p-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-xs flex items-center gap-2 fade-in">
                    <CheckCircle2 size={14} className="flex-shrink-0" />
                    <span>{successMessage}</span>
                  </div>
                )}

                {/* Primary Submit Button (Solid White with Dark Text) */}
                <button
                  type="submit"
                  disabled={isLoading || !email.trim()}
                  className="w-full h-[46px] rounded-xl bg-[#ffffff] hover:bg-[#ece8e1] text-[#141413] font-medium text-[14px] flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin text-[#141413]" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <span>
                      {authMethod === 'otp'
                        ? 'Continue with email'
                        : isSignUp
                        ? 'Create account'
                        : 'Sign in with password'}
                    </span>
                  )}
                </button>
              </form>

              {/* Switch Auth Method Subtext */}
              <div className="mt-4 pt-3 border-t border-[#2c2b29] flex flex-col items-center justify-center text-xs text-[#7a7771]">
                {authMethod === 'otp' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMethod('password');
                      setErrorMessage(null);
                    }}
                    className="hover:text-[#f4f3ef] hover:underline cursor-pointer transition-colors text-center"
                  >
                    Use password instead
                  </button>
                ) : (
                  <div className="flex items-center justify-between w-full">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMethod('otp');
                        setErrorMessage(null);
                      }}
                      className="hover:text-[#f4f3ef] hover:underline cursor-pointer transition-colors"
                    >
                      Send passwordless magic link
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSignUp(!isSignUp)}
                      className="text-[#e07a5f] hover:underline font-medium cursor-pointer"
                    >
                      {isSignUp ? 'Already have account? Sign in' : 'Need account? Sign up'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: CINEMATIC EDITORIAL WORKSPACE ASSET */}
      <div className="hidden lg:block lg:w-1/2 p-6 h-full">
        <div className="w-full h-full rounded-3xl border border-[#2c2b29] overflow-hidden shadow-2xl relative bg-[#1f1e1d] group">
          <img
            src="/auth-hero.jpg"
            alt="Omni Research & Thinking Workspace"
            className="w-full h-full object-cover rounded-3xl transition-transform duration-700 group-hover:scale-[1.02]"
          />
          {/* Subtle Ambient Vignette Overlay */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-t from-black/50 via-transparent to-black/20 pointer-events-none" />
          
          <div className="absolute bottom-8 left-8 right-8 text-white p-6 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10">
            <p className="font-serif text-lg font-normal leading-snug">
              &ldquo;Connecting ideas across all your research papers, notes, and datasets in one unified intelligence vault.&rdquo;
            </p>
            <p className="text-xs text-white/70 mt-2 font-mono">
              Omni Multi-Document RAG Engine
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
