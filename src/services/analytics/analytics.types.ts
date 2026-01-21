/**
 * Centralized Analytics Types
 * Single source of truth for analytics data structures
 */

export interface DateRange {
  dateFrom?: string | Date;
  dateTo?: string | Date;
}

export interface CallMetrics {
  totalCallMinutes: number;
  totalCalls: number;
  callsWithValidDuration: number;
  averageCallDuration: number; // in minutes
  callsWithTranscript: number;
  callsWithoutTranscript: number;
}

export interface ChatMetrics {
  totalConversations: number; // Completed conversations (user + bot messages)
  totalChats: number; // Total message count
  totalUserMessages: number;
  totalBotMessages: number;
  averageMessagesPerConversation: number;
}

export interface OrganizationMetrics {
  organizationId: string;
  organizationName: string;
  callMetrics: CallMetrics;
  chatMetrics: ChatMetrics;
  breakdownByDay?: Array<{
    date: string;
    callMinutes: number;
    conversations: number;
    chats: number;
  }>;
}

export interface UserMetrics {
  userId: string;
  userName: string;
  callMetrics: CallMetrics;
  chatMetrics: ChatMetrics;
}

export interface AdminMetrics {
  platformWide: {
    callMetrics: CallMetrics;
    chatMetrics: ChatMetrics;
  };
  byOrganization: OrganizationMetrics[];
  byUser?: UserMetrics[];
}

export interface AnalyticsResult {
  callMinutes: number;
  totalConversations: number;
  totalChats: number;
  breakdownByDay?: Array<{
    date: string;
    callMinutes: number;
    conversations: number;
    chats: number;
  }>;
  breakdownByUser?: Array<{
    userId: string;
    userName: string;
    callMinutes: number;
    conversations: number;
    chats: number;
  }>;
}
