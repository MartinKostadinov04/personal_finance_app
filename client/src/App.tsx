import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { LayoutDashboard, ArrowLeftRight, BarChart2, Settings2 } from 'lucide-react';
import { Dashboard } from '@/pages/Dashboard';
import { Transactions } from '@/pages/Transactions';
import { Analytics } from '@/pages/Analytics';
import { ControlPanel } from '@/pages/ControlPanel';
import { MonthProvider } from '@/contexts/MonthContext';
import { cn } from '@/lib/utils';

const NAV_GROUPS = [
  {
    label: 'Record',
    items: [
      { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
    ],
  },
  {
    label: 'Review',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/analytics', icon: BarChart2, label: 'Analytics' },
    ],
  },
];

const CONTROL_PANEL = { to: '/control-panel', icon: Settings2, label: 'Control Panel' };

function NavItem({ to, icon: Icon, label, end }: { to: string; icon: React.ElementType; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn('flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
          isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </NavLink>
  );
}

function Sidebar() {
  return (
    <aside className="w-56 shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-950 py-6">
      <div className="px-4 mb-6">
        <h1 className="text-sm font-semibold text-white tracking-tight">Personal Finance</h1>
      </div>

      <nav className="flex-1 px-2 space-y-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavItem key={item.to} to={item.to} icon={item.icon} label={item.label} end={item.to === '/'} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-2 border-t border-zinc-800 pt-2">
        <NavItem to={CONTROL_PANEL.to} icon={CONTROL_PANEL.icon} label={CONTROL_PANEL.label} />
      </div>
    </aside>
  );
}

export function App() {
  return (
    <MonthProvider>
      <BrowserRouter>
        <div className="flex h-screen bg-zinc-950 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto p-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/control-panel" element={<ControlPanel />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </MonthProvider>
  );
}
