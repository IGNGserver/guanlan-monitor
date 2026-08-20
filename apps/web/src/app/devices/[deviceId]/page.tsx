import { UnifiedConsole } from "../../../components/unified-console";

export default async function DevicePage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  return <UnifiedConsole initialDeviceId={decodeURIComponent(deviceId)} />;
}
