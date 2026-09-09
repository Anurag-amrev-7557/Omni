import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { clearUserDataOnLogout } from '../../services/api';
import { LogIn, LogOut, User } from 'lucide-react';

interface AuthControlsProps {
  onOpenAuth: () => void;
}

export const AuthControls: React.FC<AuthControlsProps> = ({ onOpenAuth }) => {
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? null);
    }).catch(() => {
      setUserEmail(null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    try {
      clearUserDataOnLogout();
      await supabase.auth.signOut();
      setUserEmail(null);
    } catch (e) {
      console.error("Sign out error:", e);
    }
  };

  if (userEmail) {
    return null;
  }

  return (
    <button 
      onClick={onOpenAuth} 
      className="flex items-center justify-center gap-1.5 h-8 w-[104px] px-2.5 text-xs font-medium rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-main)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)] transition-all cursor-pointer shadow-2xs select-none"
    >
      <LogIn size={13} className="text-[var(--accent-primary)] flex-shrink-0" />
      <span>Sign in</span>
    </button>
  );
};

