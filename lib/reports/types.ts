export type ReportsCompareWith = "previous" | "year" | "none";
export type ReportsScheduleFrequency = "daily" | "weekly" | "monthly";
export type ReportsScheduleRunStatus = "success" | "failed";

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

export interface ReportsSlaCompliancePoint {
  label: string;
  resolved: number;
  breaches: number;
  compliance: number;
}

export interface ReportsMetricValue {
  current: number | null;
  previous: number | null;
  year: number | null;
}

export interface ReportsMetrics {
  avgResponseTimeMinutes: ReportsMetricValue;
  avgResolutionTimeMinutes: ReportsMetricValue;
  incidentMttrMinutes: ReportsMetricValue;
  customerSatisfactionScore: ReportsMetricValue;
  firstContactResolutionRate: ReportsMetricValue;
  ticketBacklogCount: ReportsMetricValue;
  slaComplianceRate: ReportsMetricValue;
}

export interface ReportsResponse {
  revenueTrend: ReportsRevenuePoint[];
  ticketVolume: ReportsTicketVolumePoint[];
  customerGrowth: ReportsCustomerGrowthPoint[];
  slaComplianceTrend: ReportsSlaCompliancePoint[];
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

export interface ReportsScheduleItem {
  id: string;
  organization_id: string;
  name: string;
  frequency: ReportsScheduleFrequency;
  compare_with: ReportsCompareWith;
  range_days: number;
  timezone: string;
  recipients: string[];
  is_enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_status: ReportsScheduleRunStatus | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportsScheduleRunItem {
  id: string;
  organization_id: string;
  schedule_id: string | null;
  status: ReportsScheduleRunStatus;
  recipients: string[];
  report_from: string;
  report_to: string;
  error_message: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface ReportsSchedulesResponse {
  activeOrgId: string;
  schedules: ReportsScheduleItem[];
  recentRuns: ReportsScheduleRunItem[];
}
