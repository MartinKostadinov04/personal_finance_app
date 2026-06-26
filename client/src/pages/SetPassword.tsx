import { useState, type FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Shown when a user lands via an invite or password-recovery link: they already
// have a session but must choose a password to finish setting up their account.
export function SetPassword() {
  const { user, updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const { error } = await updatePassword(password);
      if (error) setError(error);
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-600';

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-xl font-semibold text-white">You're invited 🎉</h1>
        <p className="mb-6 text-center text-sm text-zinc-500">
          {user?.email ? <>Signed in as <span className="text-zinc-300">{user.email}</span>. </> : null}
          Choose a password to finish setting up your account.
        </p>

        <form onSubmit={submit} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-400">New password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-400">Confirm password</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Set password & continue'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-zinc-500">
          <button onClick={() => signOut()} className="text-zinc-500 hover:text-zinc-300">
            Cancel and sign out
          </button>
        </p>
      </div>
    </div>
  );
}
