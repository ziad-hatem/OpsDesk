export type ReportsCompareWith = "previous" | "year" | "none";

export interface ReportsRevenuePoint {
  label: string;
  current: number;
  previous: number;
  year: number;
}

export interface ReportsTicketVolumePoint {
  day: string;
  tickets: number;
  resolved: number;
}

export interface ReportsCustomerGrowthPoint {
  month: string;
  customers: number;
}

export interface ReportsMetricValue {
  current: number | null;
  previous: number | null;
  year: number | null;
}

export interface ReportsMetrics {
  avgResponseTimeMinutes: ReportsMetricValue;
  customerSatisfactionScore: ReportsMetricValue;
  firstContactResolutionRate: ReportsMetricValue;
  ticketBacklogCount: ReportsMetricValue;
}

export interface ReportsResponse {
  revenueTrend: ReportsRevenuePoint[];
  ticketVolume: ReportsTicketVolumePoint[];
  customerGrowth: ReportsCustomerGrowthPoint[];
  metrics: ReportsMetrics;
  activeOrgId: string;
  currentUserId: string;
  range: {
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    yearFrom: string;
    yearTo: string;
  };
}
