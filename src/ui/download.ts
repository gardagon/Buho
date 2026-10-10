/** Descarga un archivo generado en el navegador. */
export function downloadFile(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data], { type }))
  a.download = name
  a.click()
  // Se libera después de que el navegador haya empezado la descarga.
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
