/**
 * Safe overlay copy for approval decide failures.
 * Never surfaces secrets, stacks, or raw auth material.
 */
export function mapOverlayApprovalError(
  code: string | undefined,
  message: string | undefined,
  status: number,
): string {
  switch (code) {
    case "APPROVAL_EXPIRED":
    case "EXPIRED":
      return "Approval expired.";
    case "APPROVAL_ALREADY_RESOLVED":
    case "ALREADY_RESOLVED":
    case "NOT_PENDING":
      return "That approval was already resolved.";
    case "APPROVAL_NOT_FOUND":
    case "NOT_FOUND":
      return "Approval not found.";
    case "DEVICE_AUTH_REQUIRED":
      return "Device authorization failed.";
    case "APPROVAL_FORBIDDEN":
      return "This approval isn't available for this device.";
    case "INVALID_DECISION":
      return "Invalid approval decision.";
    case "APPROVAL_EXECUTION_FAILED":
    case "EXECUTION_FAILED":
      return "Couldn't execute the approved action.";
    default:
      break;
  }
  if (status === 401) return "Device authorization failed.";
  if (status === 403) return "This approval isn't available for this device.";
  if (status === 404) return "Approval not found.";
  if (status === 409 || status === 410) {
    return "That approval was already resolved.";
  }
  if (status === 422) return "Invalid approval decision.";
  if (/could not approve/i.test(message ?? "")) {
    return "Couldn't execute the approved action.";
  }
  if (!message) return "Could not update approval.";
  if (/powershell|cmd\.exe|stack|token|secret|bearer|supabase/i.test(message)) {
    return "Could not update approval.";
  }
  return message.length > 160 ? "Could not update approval." : message;
}
