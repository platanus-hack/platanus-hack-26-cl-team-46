/** Layout inmersivo para el simulacro: pantalla completa, sin header. */
export default function SimulationLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-1 flex-col bg-background">{children}</div>;
}
