export const BACKUP_SERVER_URL = 'https://tomwprt.cn'

export function getBackupServerBase(): string {
  return BACKUP_SERVER_URL.replace(/\/+$/, '')
}

