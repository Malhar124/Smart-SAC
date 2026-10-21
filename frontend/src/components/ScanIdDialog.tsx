import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { extractRollNo } from "@/lib/roll";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRollNo: (rollNo: string) => void;
}

/**
 * Reads the barcode or QR code on a student ID with the desk's webcam. The scanning library loads
 * only when this opens. (A USB barcode scanner needs none of this: it types into the roll field.)
 */
export const ScanIdDialog = ({ open, onOpenChange, onRollNo }: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [lastText, setLastText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setLastText(null);
    let stop: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!result) return;
          const text = result.getText();
          const roll = extractRollNo(text);
          if (roll) {
            controls.stop();
            onRollNo(roll);
            onOpenChange(false);
          } else {
            setLastText(text);
          }
        });
        stop = () => controls.stop();
        if (cancelled) stop();
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        setProblem(
          name === "NotAllowedError"
            ? "Camera access is blocked. Allow it in the browser's site settings, or type the roll number."
            : name === "NotFoundError"
              ? "No camera found on this computer. Type the roll number instead."
              : "The camera couldn't start. Type the roll number instead."
        );
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [open, onOpenChange, onRollNo]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Scan a student ID</DialogTitle>
          <DialogDescription>Hold the barcode or QR code on the card up to the camera.</DialogDescription>
        </DialogHeader>
        {problem ? (
          <p className="border-l-4 border-destructive bg-destructive/10 rounded-r-md px-3 py-2 text-sm" role="alert">
            {problem}
          </p>
        ) : (
          <div className="overflow-hidden rounded-md bg-black aspect-video">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Camera preview" />
          </div>
        )}
        {lastText && <p className="text-sm text-muted-foreground">Read “{lastText}”, which doesn't look like a roll number. Try again or type it.</p>}
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Type it instead
        </Button>
      </DialogContent>
    </Dialog>
  );
};
