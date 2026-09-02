import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { LogOut } from 'lucide-react';

interface AuthControlsProps {
  onOpenAuth: () => void;
}

export const AuthControls: React.FC<AuthControlsProps> = ({ onOpenAuth }) => {
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (userEmail) {
    return (
      <button 
        onClick={() => supabase.auth.signOut()} 
        title={`Signed in as ${userEmail}. Click to sign out.`} 
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--text-dark)] transition-all cursor-pointer"
      >
        <LogOut size={12} />
        <span className="max-w-[120px] truncate hidden sm:inline">{userEmail.split('@')[0]}</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button 
        onClick={onOpenAuth} 
        className="px-3 py-1 text-xs font-medium rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer shadow-2xs"
      >
        Sign in
      </button>
      <button 
        onClick={onOpenAuth} 
        className="hidden sm:inline-flex px-3 py-1 text-xs font-semibold rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-hover)] transition-all cursor-pointer shadow-xs"
      >
        Sign up
      </button>
    </div>
  );
};

