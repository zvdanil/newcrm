import { apiClient } from './client'

export const backupApi = {
  downloadSql: async () => {
    const res = await apiClient.get('/backup/download-sql', { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const link = document.createElement('a')
    link.href = url
    const dateStr = new Date().toISOString().slice(0, 10)
    link.setAttribute('download', `iris_db_backup_${dateStr}.sql`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },
  downloadJson: async () => {
    const res = await apiClient.get('/backup/download-json', { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const link = document.createElement('a')
    link.href = url
    const dateStr = new Date().toISOString().slice(0, 10)
    link.setAttribute('download', `iris_db_backup_${dateStr}.json`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  },
  runServerBackup: async () => {
    const res = await apiClient.post<{ ok: boolean; message: string; jsonPath: string; sqlPath: string }>('/backup/run')
    return res.data
  },
}
