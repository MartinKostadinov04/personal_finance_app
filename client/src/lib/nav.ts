import { LayoutDashboard, ArrowLeftRight, BarChart2, Settings2, Users } from 'lucide-react';

export interface NavItemDef {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
}

const TRANSACTIONS: NavItemDef = { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' };
const BILLS: NavItemDef = { to: '/bills', icon: Users, label: 'Bill Splitting' };
const DASHBOARD: NavItemDef = { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true };
const ANALYTICS: NavItemDef = { to: '/analytics', icon: BarChart2, label: 'Analytics' };
export const CONTROL_PANEL: NavItemDef = { to: '/control-panel', icon: Settings2, label: 'Control Panel' };

// Grouped nav for the desktop/tablet sidebar.
export const NAV_GROUPS: { label: string; items: NavItemDef[] }[] = [
  { label: 'Record', items: [TRANSACTIONS, BILLS] },
  { label: 'Review', items: [DASHBOARD, ANALYTICS] },
];

// Flat list used by the mobile FAB menu. MobileNav reverses this array before
// rendering, so this order is the inverse of the visual top→bottom order.
export const NAV_ITEMS: NavItemDef[] = [CONTROL_PANEL, ANALYTICS, DASHBOARD, BILLS, TRANSACTIONS];
