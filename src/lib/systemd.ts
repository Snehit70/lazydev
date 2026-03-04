export async function restartService(): Promise<{ success: boolean; message: string }> {
  return { success: false, message: "Service management not available in proxy-only mode" };
}

export async function stopService(): Promise<{ success: boolean; message: string }> {
  return { success: false, message: "Service management not available in proxy-only mode" };
}

export function isSystemdAvailable(): boolean {
  return false;
}
