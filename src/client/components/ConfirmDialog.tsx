import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /** When set, the confirm button stays disabled until this text is typed. */
  match?: string;
}

type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [typed, setTyped] = useState("");
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setRequest(null);
    setTyped("");
  }, []);

  const confirm = useCallback<ConfirmFn>((next) => {
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
    setTyped("");
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const matchReady = !request?.match || typed === request.match;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={request !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        {request ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              <DialogDescription>{request.description}</DialogDescription>
            </DialogHeader>
            {request.match ? (
              <div className="space-y-1.5">
                <Label htmlFor="confirm-match">
                  Type{" "}
                  <span className="font-mono text-ink">{request.match}</span> to
                  confirm
                </Label>
                <Input
                  id="confirm-match"
                  value={typed}
                  autoComplete="off"
                  autoFocus
                  onChange={(event) => setTyped(event.target.value)}
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => settle(false)}
              >
                {request.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                type="button"
                variant={request.tone === "danger" ? "danger" : "primary"}
                disabled={!matchReady}
                onClick={() => settle(true)}
              >
                {request.confirmLabel ?? "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </ConfirmContext.Provider>
  );
}
