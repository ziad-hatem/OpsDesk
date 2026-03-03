"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  HelpCircle,
  LifeBuoy,
  Loader2,
  MessageSquareText,
  Search,
  Settings,
  Ticket,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAppSelector } from "@/lib/store/hooks";
import { selectTopbarActiveOrganizationId } from "@/lib/store/slices/topbar-slice";
import type { TicketPriority } from "@/lib/tickets/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";

type HelpFaq = {
  id: string;
  question: string;
  answer: string;
  tags: string[];
};

const HELP_FAQS: HelpFaq[] = [
  {
    id: "faq-organization-switch",
    question: "How do I switch between organizations?",
    answer:
      "Use the organization dropdown in the topbar. Only organizations where you have an active membership will appear.",
    tags: ["organization", "workspace", "topbar"],
  },
  {
    id: "faq-invite-member",
    question: "How can I invite a team member?",
    answer:
      "Go to Settings > Team and use the invite dialog. Admins can invite members and assign roles. Pending invites can be resent or revoked.",
    tags: ["team", "invite", "roles"],
  },
  {
    id: "faq-ticket-assignment",
    question: "How does ticket assignment and notification work?",
    answer:
      "Assigning a ticket triggers an in-app notification to the assignee. Status, priority, and new comments also notify relevant users in realtime.",
    tags: ["tickets", "notifications", "realtime"],
  },
  {
    id: "faq-reports-range",
    question: "Can I change the date range in reports?",
    answer:
      "Yes. Use the date range picker at the top of Reports. Charts and KPIs recalculate for the selected period, with optional comparison modes.",
    tags: ["reports", "analytics", "date-range"],
  },
  {
    id: "faq-profile-avatar",
    question: "Can I upload my own profile image?",
    answer:
      "Yes. Go to Account > Profile and upload an image. Supported formats: JPG, PNG, WEBP, GIF with a maximum size of 2MB.",
    tags: ["profile", "avatar", "account"],
  },
  {
    id: "faq-account-delete",
    question: "Why can account deletion be blocked?",
    answer:
      "Deletion is blocked if you are the last admin in any organization. Assign another admin first, then retry account deletion.",
    tags: ["account", "deletion", "admin"],
  },
];

function readApiErrorFallback(statusText: string, status: number): string {
  return statusText || `Request failed with status ${status}`;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Ignore parse errors and fallback.
  }
  return readApiErrorFallback(response.statusText, response.status);
}

export default function HelpPage() {
  const router = useRouter();
  const activeOrgId = useAppSelector(selectTopbarActiveOrganizationId);

  const [searchQuery, setSearchQuery] = useState("");
  const [supportSubject, setSupportSubject] = useState("");
  const [supportPriority, setSupportPriority] = useState<TicketPriority>("medium");
  const [supportMessage, setSupportMessage] = useState("");
  const [isSubmittingSupport, setIsSubmittingSupport] = useState(false);

  const filteredFaqs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return HELP_FAQS;
    }

    return HELP_FAQS.filter((faq) => {
      const haystack = [
        faq.question,
        faq.answer,
        ...faq.tags,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [searchQuery]);

  const quickActions = useMemo(
    () => [
      {
        title: "Go to Tickets",
        description: "Create, assign, and track support work.",
        icon: Ticket,
        href: "/tickets",
      },
      {
        title: "Manage Team",
        description: "Invite members and control access roles.",
        icon: Users,
        href: "/settings/team",
      },
      {
        title: "Open Reports",
        description: "Review KPI trends and performance metrics.",
        icon: BookOpen,
        href: "/reports",
      },
      {
        title: "Account Profile",
        description: "Update password, avatar, and personal data.",
        icon: Settings,
        href: "/account/profile",
      },
    ],
    [],
  );

  const handleSubmitSupport = async () => {
    const normalizedSubject = supportSubject.trim();
    const normalizedMessage = supportMessage.trim();

    if (!activeOrgId) {
      toast.error("Select an organization first to send support requests.");
      return;
    }

    if (!normalizedSubject) {
      toast.error("Support subject is required.");
      return;
    }
    if (!normalizedMessage) {
      toast.error("Support message is required.");
      return;
    }

    setIsSubmittingSupport(true);
    const toastId = toast.loading("Submitting support request...");

    try {
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: `[Help] ${normalizedSubject}`,
          description: normalizedMessage,
          status: "open",
          priority: supportPriority,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { ticket?: { id: string } };
      toast.success("Support request created.", { id: toastId });

      setSupportSubject("");
      setSupportMessage("");
      setSupportPriority("medium");

      if (payload.ticket?.id) {
        router.push(`/tickets/${payload.ticket.id}`);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to submit support request";
      toast.error(message, { id: toastId });
    } finally {
      setIsSubmittingSupport(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Help Center</h1>
          <p className="text-slate-600 mt-1">
            Guides, FAQs, and direct support tools for your workspace.
          </p>
        </div>
        <div className="relative w-full lg:w-[420px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search help articles and FAQs..."
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {quickActions.map((action) => (
          <button
            key={action.href}
            onClick={() => router.push(action.href)}
            className="text-left rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-slate-100 p-2">
                <action.icon className="h-4 w-4 text-slate-700" />
              </div>
              <div>
                <p className="font-medium text-slate-900">{action.title}</p>
                <p className="text-sm text-slate-600 mt-1">{action.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4" />
              Frequently Asked Questions
            </CardTitle>
            <CardDescription>
              {filteredFaqs.length} result{filteredFaqs.length === 1 ? "" : "s"} found.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredFaqs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-600">
                No FAQ entries match your search.
              </div>
            ) : (
              <Accordion type="single" collapsible className="w-full">
                {filteredFaqs.map((faq) => (
                  <AccordionItem key={faq.id} value={faq.id}>
                    <AccordionTrigger>{faq.question}</AccordionTrigger>
                    <AccordionContent>
                      <p className="text-slate-700">{faq.answer}</p>
                      <p className="text-xs text-slate-500 mt-2">
                        Tags: {faq.tags.join(", ")}
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4" />
              Contact Support
            </CardTitle>
            <CardDescription>
              Create a support ticket directly from the Help Center.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!activeOrgId ? (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                Select an organization first, then submit a support request.
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Tickets are created inside your active organization.
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="support-subject">Subject</Label>
              <Input
                id="support-subject"
                value={supportSubject}
                onChange={(event) => setSupportSubject(event.target.value)}
                placeholder="Example: I can’t switch organizations"
                disabled={isSubmittingSupport}
              />
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={supportPriority}
                onValueChange={(value) => setSupportPriority(value as TicketPriority)}
                disabled={isSubmittingSupport}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="support-message">Message</Label>
              <Textarea
                id="support-message"
                value={supportMessage}
                onChange={(event) => setSupportMessage(event.target.value)}
                placeholder="Describe your issue and steps to reproduce."
                rows={6}
                disabled={isSubmittingSupport}
              />
            </div>

            <Button
              onClick={handleSubmitSupport}
              disabled={isSubmittingSupport}
              className="w-full"
            >
              {isSubmittingSupport ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <LifeBuoy className="w-4 h-4 mr-2" />
                  Submit Support Ticket
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
