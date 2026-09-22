import type { CSSProperties } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OPERATOR_LAYOUT } from "@/lib/operator";
import {
  getLifecycleWorkflow,
  type BookingOperationSnapshot,
  type LifecycleActionKind,
  type OperatorLifecycleCommand,
} from "@/lib/operator-lifecycle";

type CommandAction = Extract<LifecycleActionKind, { kind: "command" }>["command"];

type Props = {
  operation: BookingOperationSnapshot;
  paymentMethod: string;
  paymentStatus: string;
  isUpdating?: boolean;
  pendingCommand?: OperatorLifecycleCommand | null;
  pendingMarkPaid?: boolean;
  onCommand?: (command: Extract<CommandAction, "start_travel" | "arrive" | "start_wash" | "complete_wash">) => void;
  onMarkPaid?: () => void;
  onReportIssue?: () => void;
};

function actionButton(
  action: LifecycleActionKind,
  opts: {
    variant: "default" | "outline";
    className: string;
    isUpdating: boolean;
    pendingCommand?: OperatorLifecycleCommand | null;
    pendingMarkPaid?: boolean;
    onCommand?: Props["onCommand"];
    onMarkPaid?: () => void;
  },
) {
  if (action.kind === "none") return null;
  const thisPending =
    action.kind === "command"
      ? opts.isUpdating && opts.pendingCommand === action.command
      : opts.isUpdating && !!opts.pendingMarkPaid;
  const label = thisPending ? action.pendingLabel : action.label;
  return (
    <Button
      type="button"
      variant={opts.variant}
      className={opts.className}
      disabled={opts.isUpdating}
      onClick={() => {
        if (opts.isUpdating) return;
        if (action.kind === "mark_paid") opts.onMarkPaid?.();
        else {
          opts.onCommand?.(
            action.command as Extract<CommandAction, "start_travel" | "arrive" | "start_wash" | "complete_wash">,
          );
        }
      }}
    >
      {thisPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function OperatorLifecycleActions({
  operation,
  paymentMethod,
  paymentStatus,
  isUpdating = false,
  pendingCommand,
  pendingMarkPaid = false,
  onCommand,
  onMarkPaid,
  onReportIssue,
}: Props) {
  const workflow = getLifecycleWorkflow({
    phase: operation.phase,
    paymentMethod,
    paymentStatus,
    operation,
  });

  const showPrimary = workflow.primary.kind !== "none";
  const showSecondary = workflow.secondary.kind !== "none";
  const showReport = workflow.showReportIssue && !!onReportIssue;

  const workflowBarHeight =
    showPrimary && (showSecondary || showReport)
      ? "7.5rem"
      : showPrimary || showSecondary || showReport
        ? "5.5rem"
        : "3rem";

  const statusMessage =
    workflow.primary.kind === "none" && !showReport ? workflow.headline : null;

  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-40 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur",
        OPERATOR_LAYOUT.workflowBarBottom,
      )}
      style={
        {
          [OPERATOR_LAYOUT.workflowBarHeightVar]: workflowBarHeight,
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))",
        } as CSSProperties
      }
    >
      <div className="mx-auto flex max-w-lg flex-col gap-2">
        {statusMessage ? (
          <p className="text-center text-sm font-medium text-muted-foreground">{statusMessage}</p>
        ) : null}

        {actionButton(workflow.primary, {
          variant: "default",
          className: "h-12 w-full text-base",
          isUpdating,
          pendingCommand,
          pendingMarkPaid,
          onCommand,
          onMarkPaid,
        })}

        {actionButton(workflow.secondary, {
          variant: "outline",
          className: "h-10 w-full",
          isUpdating,
          pendingCommand,
          pendingMarkPaid,
          onCommand,
          onMarkPaid,
        })}

        {showReport ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full"
            disabled={isUpdating}
            onClick={onReportIssue}
          >
            {isUpdating && !pendingCommand && !pendingMarkPaid ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {workflow.reportIssueLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
