import Link from "next/link";
import { BUSINESS_ITEMS } from "@aurum/shared";
import { WorkspaceScreen } from "@/components/core/WorkspaceScreen";

export default function BusinessPage() {
  return (
    <WorkspaceScreen title="Business">
      <p className="mb-8 text-[15px] text-[var(--aurum-text-muted)]">
        CRM is not connected. No placeholder people or pipeline numbers.
      </p>
      <ul>
        {BUSINESS_ITEMS.map((item) => (
          <li
            key={item.id}
            className="border-b border-[var(--aurum-border)]"
          >
            <Link
              href={item.href}
              className="aurum-focus-ring flex items-baseline justify-between gap-4 py-4"
            >
              <span className="text-[16px] text-[var(--aurum-text)]">
                {item.label}
              </span>
              <span className="text-[13px] text-[var(--aurum-text-dim)]">
                Not connected
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </WorkspaceScreen>
  );
}
