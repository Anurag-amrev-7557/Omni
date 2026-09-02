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
        className="flex items-center gap-1.5 h-[32px] px-3 text-[12.5px] font-medium rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)] transition-all cursor-pointer shadow-2xs"
      >
        <LogOut size={13} className="text-[var(--accent-primary)]" />
        <span className="max-w-[120px] truncate hidden sm:inline">{userEmail.split('@')[0]}</span>
      </button>
    );
  }

  return (
    <button 
      onClick={onOpenAuth} 
      className="flex items-center gap-1.5 h-[32px] px-3.5 text-[12.5px] font-medium rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)] transition-all cursor-pointer shadow-2xs"
    >
      Sign in
    </button>
  );
};

