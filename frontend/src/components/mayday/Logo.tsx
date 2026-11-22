import Image from "next/image";

/**
 * Logo Mayday (DESIGN.md › Logo). No cambiar colores, no rotar, no animar.
 * - lockup: símbolo + wordmark (proporción 266.7 × 48).
 * - mark: solo el símbolo (mínimo 16px).
 */
export function Logo({
  variant = "lockup",
  height = 32,
  priority = false,
}: {
  variant?: "lockup" | "mark";
  height?: number;
  priority?: boolean;
}) {
  const isLockup = variant === "lockup";
  const width = isLockup ? Math.round((height * 266.7) / 48) : height;
  return (
    <Image
      src={isLockup ? "/brand/mayday-lockup.svg" : "/brand/mayday-mark.svg"}
      alt="Mayday"
      width={width}
      height={height}
      priority={priority}
      unoptimized
    />
  );
}
