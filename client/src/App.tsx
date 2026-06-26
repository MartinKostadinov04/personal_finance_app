import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, LogOut } from 'lucide-react';
import { Dashboard } from '@/pages/Dashboard';
import { Transactions } from '@/pages/Transactions';
import { Analytics } from '@/pages/Analytics';
import { ControlPanel } from '@/pages/ControlPanel';
import { Bills } from '@/pages/Bills';
import { BillDetail } from '@/pages/BillDetail';
import { Login } from '@/pages/Login';
import { MobileNav } from '@/components/MobileNav';
import { MonthProvider } from '@/contexts/MonthContext';
import { useAuth } from '@/contexts/AuthContext';
import { NAV_GROUPS, CONTROL_PANEL } from '@/lib/nav';
import { cn } from '@/lib/utils';

function NavItem({ to, icon: Icon, label, end, collapsed }: { to: string; icon: React.ElementType; label: string; end?: boolean; collapsed?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn('flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && label}
    </NavLink>
  );
}

const SIDEBAR_KEY = 'sidebar:collapsed';

function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');
  const { user, signOut } = useAuth();

  const toggle = () => {
    setCollapsed(c => {
      localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1');
      return !c;
    });
  };

  return (
    <aside className={cn(
      'shrink-0 hidden md:flex flex-col border-r border-zinc-800 bg-zinc-950 py-6 transition-[width] duration-200',
      collapsed ? 'w-14' : 'w-56'
    )}>
      <div className={cn('mb-6 flex items-center', collapsed ? 'justify-center px-0' : 'justify-between px-4')}>
        {!collapsed && <h1 className="text-sm font-semibold text-white tracking-tight">Personal Finance</h1>}
        <button
          onClick={toggle}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          className="text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 px-2 space-y-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            {!collapsed && (
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} end={item.end} collapsed={collapsed} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-2 border-t border-zinc-800 pt-2">
        <NavItem to={CONTROL_PANEL.to} icon={CONTROL_PANEL.icon} label={CONTROL_PANEL.label} collapsed={collapsed} />
        {!collapsed && user?.email && (
          <p className="px-3 pt-2 text-[11px] text-zinc-600 truncate" title={user.email}>{user.email}</p>
        )}
        <button
          onClick={() => signOut()}
          title="Sign out"
          className={cn(
            'flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors',
            collapsed && 'justify-center px-0'
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </aside>
  );
}

export function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <MonthProvider>
      <BrowserRouter>
        <div className="flex h-screen bg-zinc-950 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto p-4 pb-24 md:p-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/bills" element={<Bills />} />
              <Route path="/bills/:id" element={<BillDetail />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/control-panel" element={<ControlPanel />} />
            </Routes>
          </main>
          <MobileNav />
        </div>
      </BrowserRouter>
    </MonthProvider>
  );
}
