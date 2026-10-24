import { UnifiedConsole } from "../../../components/unified-console";

// Export needs a finite route at build time, not an inventory of private IDs.
// nginx serves the root shell for real device URLs; the client reads pathname.
export function generateStaticParams() {
  return process.env.DSC_STATIC_EXPORT === "true" ? [{ deviceId: "__shell" }] : [];
}

export default async function DevicePage({ params }: { params: Promise<{ deviceId: string }> }) {
  if (process.env.DSC_STATIC_EXPORT === "true") return <UnifiedConsole />;
  const { deviceId } = await params;
  return <UnifiedConsole initialDeviceId={decodeURIComponent(deviceId)} />;
}
