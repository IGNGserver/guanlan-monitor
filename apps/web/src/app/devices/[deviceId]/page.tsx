import { HomeClient } from "../../../components/home-client";

export default async function DevicePage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  return <HomeClient initialDeviceId={decodeURIComponent(deviceId)} />;
}
