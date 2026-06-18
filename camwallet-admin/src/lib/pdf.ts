// Génération de rapports PDF professionnels côté client (jsPDF + AutoTable).
// Charte CamWallet : bandeau sombre, accent émeraude, tableau zébré, pagination.
// Un seul générateur paramétrable couvre les trois rapports (Transactions, KYC,
// Audit) : ligne de filtres appliqués, bloc statistiques optionnel, totaux en pied.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// Palette (RGB) alignée sur les design tokens de l'admin.
const DARK: [number, number, number] = [10, 15, 30]      // #0A0F1E
const GREEN: [number, number, number] = [0, 200, 150]    // #00C896
const INK: [number, number, number] = [22, 29, 47]       // #161D2F
const MUTED: [number, number, number] = [100, 116, 139]  // #64748B
const LIGHT: [number, number, number] = [247, 249, 252]  // zébrure

export interface PdfReportOptions {
  title: string
  subtitle?: string                                   // ex. « Période : 7 derniers jours »
  filters?: { label: string; value: string }[]        // filtres appliqués (affichés en haut)
  stats?: { label: string; value: string }[]          // bloc statistiques (rapport KYC)
  columns: string[]
  rows: (string | number)[][]
  totals?: { label: string; value: string }[]         // totaux en pied de rapport
  filename: string
  orientation?: 'portrait' | 'landscape'
}

// Génère et télécharge le PDF. Retourne true (toujours — le téléchargement direct
// n'est pas bloqué par le navigateur, contrairement à window.open).
export function generatePdfReport(opts: PdfReportOptions): boolean {
  const orientation = opts.orientation ?? 'portrait'
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const M = 12 // marge latérale
  const dateStr = new Date().toLocaleString('fr-FR')

  // Bandeau de marque + pied de page, redessinés sur CHAQUE page du tableau.
  const drawChrome = () => {
    // Bandeau sombre
    doc.setFillColor(...DARK)
    doc.rect(0, 0, pageW, 18, 'F')
    // Logo « CamWallet · Admin »
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(...GREEN)
    doc.text('Cam', M, 11.5)
    const camW = doc.getTextWidth('Cam')
    doc.setTextColor(255, 255, 255)
    doc.text('Wallet', M + camW, 11.5)
    const walletW = doc.getTextWidth('Wallet')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(148, 163, 184)
    doc.text(' · Admin', M + camW + walletW, 11.5)
    // Date de génération (à droite)
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(`Généré le ${dateStr}`, pageW - M, 11.5, { align: 'right' })

    // Pied de page : pagination + mention confidentielle
    const page = doc.getNumberOfPages()
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text('CamWallet · Rapport généré automatiquement · Confidentiel', M, pageH - 7)
    doc.text(`Page ${page}`, pageW - M, pageH - 7, { align: 'right' })
  }

  // ── En-tête de rapport (page 1 uniquement) ──────────────────
  let y = 26
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...INK)
  doc.text(opts.title, M, y)
  y += 6

  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...MUTED)
    doc.text(opts.subtitle, M, y)
    y += 5
  }

  // Ligne « Filtres appliqués »
  if (opts.filters && opts.filters.length) {
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    const parts = opts.filters.map((f) => `${f.label} : ${f.value}`).join('   |   ')
    const wrapped = doc.splitTextToSize(`Filtres appliqués — ${parts}`, pageW - M * 2)
    doc.text(wrapped, M, y)
    y += wrapped.length * 4.5 + 1
  }

  // Bloc statistiques (cartes textuelles côte à côte) — rapport KYC.
  if (opts.stats && opts.stats.length) {
    y += 2
    const gap = 4
    const cardW = (pageW - M * 2 - gap * (opts.stats.length - 1)) / opts.stats.length
    const cardH = 16
    opts.stats.forEach((s, i) => {
      const x = M + i * (cardW + gap)
      doc.setFillColor(...LIGHT)
      doc.roundedRect(x, y, cardW, cardH, 2, 2, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...MUTED)
      doc.text(s.label, x + 3, y + 5.5)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(...INK)
      doc.text(s.value, x + 3, y + 12.5)
    })
    y += cardH + 4
  }

  // ── Tableau principal ───────────────────────────────────────
  autoTable(doc, {
    head: [opts.columns],
    body: opts.rows.map((r) => r.map((c) => String(c))),
    startY: y + 2,
    margin: { top: 22, left: M, right: M, bottom: 12 },
    styles: { fontSize: 8, cellPadding: 2, textColor: INK, lineColor: [230, 234, 240], lineWidth: 0.1 },
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: LIGHT },
    didDrawPage: drawChrome,
  })

  // ── Totaux en pied de rapport ───────────────────────────────
  if (opts.totals && opts.totals.length) {
    // @ts-ignore — lastAutoTable est injecté par le plugin
    let ty = (doc.lastAutoTable?.finalY ?? y) + 8
    if (ty > pageH - 30) { doc.addPage(); drawChrome(); ty = 28 }
    doc.setFillColor(...DARK)
    const boxH = 8 + opts.totals.length * 6
    doc.roundedRect(M, ty, pageW - M * 2, boxH, 2, 2, 'F')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GREEN)
    doc.text('Totaux', M + 4, ty + 6)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9.5)
    opts.totals.forEach((tt, i) => {
      const ly = ty + 12 + i * 6
      doc.text(tt.label, M + 4, ly)
      doc.text(tt.value, pageW - M - 4, ly, { align: 'right' })
    })
  }

  doc.save(opts.filename)
  return true
}
