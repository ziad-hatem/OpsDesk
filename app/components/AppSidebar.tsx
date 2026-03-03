"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  CalendarRange,
  LayoutDashboard,
  LifeBuoy,
  ShoppingCart,
  Settings,
  Ticket,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "./ui/sidebar";

const mainNavItems = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Tickets", href: "/tickets", icon: Ticket },
  { title: "Orders", href: "/orders", icon: ShoppingCart },
  { title: "Customers", href: "/customers", icon: Users },
  { title: "Incidents", href: "/incidents", icon: AlertTriangle },
  { title: "Reports", href: "/reports", icon: BarChart3 },
  { title: "Calendar", href: "/calendar", icon: CalendarRange },
];

const secondaryNavItems = [
  { title: "Settings", href: "/settings/team", icon: Settings },
  { title: "Help", href: "/help", icon: LifeBuoy },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-3 px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white text-sm font-semibold">
            OD
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold text-slate-900">
              OpsDesk
            </span>
            <span className="text-xs text-slate-500">Support Console</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarMenu>
            {mainNavItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === item.href}
                  tooltip={item.title}
                >
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {secondaryNavItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === item.href}
                  tooltip={item.title}
                >
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 group-data-[collapsible=icon]:hidden">
          Signed in to OpsDesk
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
