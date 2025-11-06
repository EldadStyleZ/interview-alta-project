/**
 * Template variables for booking confirmation
 */
export interface BookingConfirmationVars {
  contact_name: string;
  manager_name: string;
  meeting_date: string; // Formatted date
  meeting_time: string; // Formatted time
  meeting_url?: string;
  reschedule_link?: string;
  company_name?: string;
}

/**
 * Generate booking confirmation email template
 */
export function generateBookingConfirmationEmail(vars: BookingConfirmationVars): string {
  const companyName = vars.company_name || 'Our Company';
  const rescheduleSection = vars.reschedule_link
    ? `\n\nIf you need to reschedule, please use this link: ${vars.reschedule_link}`
    : '';

  return `Subject: Meeting Confirmed: ${vars.meeting_date} at ${vars.meeting_time} with ${vars.manager_name}

Hi ${vars.contact_name},

Thank you for scheduling a discovery meeting with ${companyName}.

Meeting Details:
- Date and Time: ${vars.meeting_date} at ${vars.meeting_time}
- Attendees: ${vars.contact_name}, ${vars.manager_name}
${vars.meeting_url ? `- Meeting Link: ${vars.meeting_url}` : ''}

We look forward to speaking with you.${rescheduleSection}

Best regards,
${companyName}`;
}

/**
 * Generate booking confirmation SMS template
 */
export function generateBookingConfirmationSMS(vars: BookingConfirmationVars): string {
  const rescheduleText = vars.reschedule_link ? ` Reschedule: ${vars.reschedule_link}` : '';
  return `Meeting confirmed: ${vars.meeting_date} at ${vars.meeting_time} with ${vars.manager_name}.${vars.meeting_url ? ` Join: ${vars.meeting_url}` : ''}${rescheduleText}`;
}

/**
 * Render template based on channel
 */
export function renderTemplate(
  channel: 'email' | 'sms',
  templateId: string,
  vars: Record<string, unknown>,
): string {
  if (templateId === 'booking_confirmation_v1') {
    const confirmationVars: BookingConfirmationVars = {
      contact_name: (vars.contact_name as string) || 'Valued Customer',
      manager_name: (vars.manager_name as string) || 'Account Manager',
      meeting_date: (vars.meeting_date as string) || 'TBD',
      meeting_time: (vars.meeting_time as string) || 'TBD',
      meeting_url: vars.meeting_url as string | undefined,
      reschedule_link: vars.reschedule_link as string | undefined,
      company_name: vars.company_name as string | undefined,
    };

    if (channel === 'email') {
      return generateBookingConfirmationEmail(confirmationVars);
    } else {
      return generateBookingConfirmationSMS(confirmationVars);
    }
  }

  // Default template
  return JSON.stringify(vars);
}


