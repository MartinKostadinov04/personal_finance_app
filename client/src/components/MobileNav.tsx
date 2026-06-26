import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu, X, LogOut } from 'lucide-react';
import { NAV_ITEMS } from '@/lib/nav';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

// Phone-only navigation: a circular bottom-right FAB that opens the destinations
// as labeled pills stacked above it. Hidden at md+ where the sidebar takes over.
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { signOut } = useAuth();

  // Render closest-to-FAB last so the visual stack reads top→bottom in nav order.
  const items = [...NAV_ITEMS].reverse();

  return (
    <div className="md:hidden">
      {/* Scrim */}
      <div
        onClick={() => setOpen(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />

      {/* Pills */}
      <div className="fixed bottom-24 right-5 z-50 flex flex-col items-end gap-2.5">
        {items.map((item, i) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setOpen(false)}
            style={{ transitionDelay: open ? `${i * 40}ms` : '0ms' }}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-full pl-4 pr-3 py-2.5 shadow-lg border text-sm font-medium transition-all duration-200',
                open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
                isActive
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-100'
              )
            }
          >
            <span>{item.label}</span>
            <item.icon className="h-4 w-4 shrink-0" />
          </NavLink>
        ))}

        {/* Sign out */}
        <button
          onClick={() => { setOpen(false); signOut(); }}
          style={{ transitionDelay: open ? `${items.length * 40}ms` : '0ms' }}
          className={cn(
            'flex items-center gap-2.5 rounded-full pl-4 pr-3 py-2.5 shadow-lg border text-sm font-medium transition-all duration-200 bg-zinc-800 border-zinc-700 text-zinc-100',
            open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
          )}
        >
          <span>Sign out</span>
          <LogOut className="h-4 w-4 shrink-0" />
        </button>
      </div>

      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-emerald-600 text-white shadow-xl flex items-center justify-center transition-colors hover:bg-emerald-500 active:scale-95"
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>
    </div>
  );
}
