import Image from "next/image";

/** Avatar de GitHub. Cuadrado con radio chico, como el resto de lo interactivo. */
export function Avatar({ src, login, size = 32 }: { src: string; login: string; size?: number }) {
  return (
    <Image
      src={src}
      alt={`Avatar de @${login}`}
      width={size}
      height={size}
      unoptimized
      className="shrink-0 rounded-sm border border-line bg-bg-200"
    />
  );
}
