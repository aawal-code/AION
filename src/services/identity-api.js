import { authorize, listDevices } from './identity-store.js';

// Shared by the HTTP route and isolated native IPC acceptance slice.
export async function listAuthorizedIdentityDevices(token) {
  if (!(await authorize(token, 'identity:manage'))) return null;
  return listDevices();
}
