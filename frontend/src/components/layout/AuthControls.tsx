import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

export const AuthControls: React.FC = () => {
  const [mode, setMode] = useState<'sign_in' | 'sign_up' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
      setMode(null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    const result = mode === 'sign_up'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    setMessage(result.error?.message ?? (mode === 'sign_up' ? 'Check your email to confirm your account.' : 'Signed in.'));
  };

  if (userEmail) {
    return <button onClick={() => supabase.auth.signOut()} title={userEmail} className="px-2.5 py-1 text-xs font-semibold rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]">Sign out</button>;
  }

  return <>
    <button onClick={() => setMode('sign_in')} className="px-2.5 py-1 text-xs font-semibold rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)]">Sign in</button>
    <button onClick={() => setMode('sign_up')} className="hidden sm:inline-flex px-2.5 py-1 text-xs font-semibold rounded-md bg-[var(--accent-primary)] text-white hover:opacity-90">Sign up</button>
    {mode && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[var(--border-color)] bg-[var(--bg-modal)] p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-bold text-[var(--text-main)]">{mode === 'sign_up' ? 'Create account' : 'Sign in'}</h2>
        <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="mb-3 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[var(--text-main)]" />
        <input required minLength={6} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="mb-3 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[var(--text-main)]" />
        {message && <p className="mb-3 text-xs text-[var(--text-muted)]">{message}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setMode(null)} className="px-3 py-2 text-sm text-[var(--text-muted)]">Cancel</button><button disabled={loading} className="rounded-lg bg-[var(--accent-primary)] px-3 py-2 text-sm font-semibold text-white">{loading ? 'Please wait…' : mode === 'sign_up' ? 'Sign up' : 'Sign in'}</button></div>
      </form>
    </div>}
  </>;
};
